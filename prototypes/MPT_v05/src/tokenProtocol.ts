/**
 * Pure SPV Token Protocol Layer.
 *
 * This module contains the entire MPT token verification logic using
 * ONLY Merkle proofs and block headers. It has ZERO network dependencies.
 *
 * A token is valid if:
 *   1. Token ID = SHA-256(genesisTxId || outputIndex LE || opReturnChunks[2..5] raw bytes)
 *      where chunks 2-5 = tokenName + tokenScript + tokenRules + tokenAttributes
 *   2. Every entry in the proof chain has a valid Merkle proof
 *   3. Every Merkle root matches its block header at that height
 *   4. The oldest entry's txId matches the genesis txId
 *
 * This module can run in any environment (browser, Node, offline).
 */
import { Hash } from '@bsv/sdk'

// ─── Types ──────────────────────────────────────────────────────────

export interface MerklePathNode {
  hash: string
  position: 'L' | 'R'
}

export interface MerkleProofEntry {
  txId: string
  blockHeight: number
  merkleRoot: string
  path: MerklePathNode[]
}

export interface ProofChain {
  genesisTxId: string
  entries: MerkleProofEntry[]
}

/** Minimal block header -- only the fields the token protocol needs. */
export interface BlockHeader {
  height: number
  merkleRoot: string
}

export interface VerificationResult {
  valid: boolean
  reason: string
}

// ─── Hex / Byte Helpers ─────────────────────────────────────────────

// Note on Token ID computation: immutableChunkBytes = tokenName + tokenScript + tokenRules + tokenAttributes
// These are the concatenated raw bytes from the immutable fields in the OP_RETURN script.

export function hexToBytes(hex: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16))
  }
  return bytes
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

function uint32LE(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}

// ─── Cryptographic Primitives ───────────────────────────────────────

/** Bitcoin double SHA-256. */
export function doubleSha256(data: number[]): number[] {
  return Hash.sha256(Hash.sha256(data))
}

/** Single SHA-256. */
export function sha256(data: number[]): number[] {
  return Hash.sha256(data)
}

// ─── Token ID ───────────────────────────────────────────────────────

/**
 * Compute Token ID = SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes).
 *
 * The immutableChunkBytes parameter is the concatenated raw bytes of all
 * immutable fields: tokenName + tokenScript + tokenRules + tokenAttributes.
 * This binds the token's identity to all immutable metadata including the
 * consensus script, making it deterministic and tamper-proof.
 *
 * Deterministic, purely local computation. No network access required.
 */
export function computeTokenId(
  genesisTxId: string,
  outputIndex: number,
  immutableChunkBytes: number[],
): string {
  const txIdBytes = hexToBytes(genesisTxId)
  const indexBytes = uint32LE(outputIndex)
  const hash = sha256([...txIdBytes, ...indexBytes, ...immutableChunkBytes])
  return bytesToHex(hash)
}

// ─── Merkle Proof Verification ──────────────────────────────────────

/**
 * Verify a single Merkle proof: compute root from txId + path,
 * compare against the claimed merkleRoot.
 *
 * Uses Bitcoin's double SHA-256 for the Merkle tree hash.
 * Pure computation -- no network calls.
 */
export function verifyMerkleProof(entry: MerkleProofEntry): boolean {
  // Bitcoin txids and merkle roots are displayed in reversed (little-endian) byte order.
  // The Merkle tree computation uses natural (big-endian) byte order.
  let current = hexToBytes(entry.txId).reverse()

  for (const node of entry.path) {
    const sibling = hexToBytes(node.hash).reverse()
    const combined = node.position === 'R'
      ? [...current, ...sibling]
      : [...sibling, ...current]
    current = doubleSha256(combined)
  }

  // Reverse the computed root back to display format for comparison
  const computedRoot = bytesToHex(current.reverse())
  return computedRoot === entry.merkleRoot
}

/**
 * Verify an entire proof chain using only Merkle proofs and block headers.
 *
 * @param chain       The proof chain to verify
 * @param headers     Map of blockHeight -> BlockHeader (pre-fetched or cached)
 * @returns           Verification result with reason
 *
 * This is the core SPV verification. The caller is responsible for
 * providing trusted block headers (from peers, a header chain, or an API).
 */
export function verifyProofChain(
  chain: ProofChain,
  headers: Map<number, BlockHeader>,
): VerificationResult {
  if (chain.entries.length === 0) {
    return { valid: false, reason: 'Proof chain is empty' }
  }

  for (const entry of chain.entries) {
    // Step 1: Verify Merkle proof (pure crypto)
    if (!verifyMerkleProof(entry)) {
      return {
        valid: false,
        reason: `Merkle proof invalid for TX ${entry.txId.slice(0, 12)}...`,
      }
    }

    // Step 2: Check Merkle root matches block header
    const header = headers.get(entry.blockHeight)
    if (!header) {
      return {
        valid: false,
        reason: `No block header for height ${entry.blockHeight}`,
      }
    }
    if (header.merkleRoot !== entry.merkleRoot) {
      return {
        valid: false,
        reason: `Merkle root mismatch at height ${entry.blockHeight}`,
      }
    }
  }

  // Step 3: Oldest entry must be the genesis TX
  const oldest = chain.entries[chain.entries.length - 1]
  if (oldest.txId !== chain.genesisTxId) {
    return {
      valid: false,
      reason: 'Oldest proof entry does not match genesis TX',
    }
  }

  return { valid: true, reason: 'Token is valid with verified proof chain' }
}

/**
 * Async version -- fetches block headers on demand via callback.
 * The callback is the ONLY external dependency; it can be backed by
 * a local cache, a peer connection, or an API.
 */
export async function verifyProofChainAsync(
  chain: ProofChain,
  getBlockHeader: (height: number) => Promise<BlockHeader>,
): Promise<VerificationResult> {
  if (chain.entries.length === 0) {
    return { valid: false, reason: 'Proof chain is empty' }
  }

  // Collect needed heights and fetch headers
  const heights = [...new Set(chain.entries.map(e => e.blockHeight))]
  const headers = new Map<number, BlockHeader>()
  for (const h of heights) {
    try {
      headers.set(h, await getBlockHeader(h))
    } catch (e: any) {
      const detail = e?.message ? `: ${e.message}` : ''
      return { valid: false, reason: `Failed to fetch header at height ${h}${detail}` }
    }
  }

  return verifyProofChain(chain, headers)
}

// ─── Proof Chain Construction ───────────────────────────────────────

/** Create an initial proof chain from the genesis TX's Merkle proof. */
export function createProofChain(
  genesisTxId: string,
  genesisProof: MerkleProofEntry,
): ProofChain {
  return { genesisTxId, entries: [genesisProof] }
}

/** Prepend a new transfer's proof entry to an existing chain. */
export function extendProofChain(
  chain: ProofChain,
  newEntry: MerkleProofEntry,
): ProofChain {
  return {
    genesisTxId: chain.genesisTxId,
    entries: [newEntry, ...chain.entries],
  }
}

/**
 * Full token verification: checks token ID + proof chain.
 *
 * @param tokenId              The claimed token ID
 * @param genesisTxId          Genesis transaction hash
 * @param genesisOutputIndex   Output index in genesis TX (starts at 1)
 * @param immutableChunkBytes  Concatenated raw bytes of OP_RETURN chunks 2-5 (name+script+rules+attrs)
 * @param chain                The proof chain
 * @param headers              Pre-fetched block headers
 */
export function verifyToken(
  tokenId: string,
  genesisTxId: string,
  genesisOutputIndex: number,
  immutableChunkBytes: number[],
  chain: ProofChain,
  headers: Map<number, BlockHeader>,
): VerificationResult {
  // Verify token ID derivation
  const expectedId = computeTokenId(genesisTxId, genesisOutputIndex, immutableChunkBytes)
  if (expectedId !== tokenId) {
    return { valid: false, reason: 'Token ID does not match genesis' }
  }

  // Verify proof chain
  return verifyProofChain(chain, headers)
}
