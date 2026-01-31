import { createHash } from 'crypto'

/**
 * A Merkle proof entry for a single transaction.
 *
 * This follows the BSV Unified Merkle Path (BUMP) structure used in
 * the BEEF (BRC-62) format. Each entry proves a transaction was
 * included in a specific block.
 */
export interface MerkleProofEntry {
    /** The TXID this proof is for (hex). */
    txId: string
    /** Block height the TX was mined in. */
    blockHeight: number
    /** Merkle root of the block (hex). */
    merkleRoot: string
    /**
     * Merkle path — array of sibling hashes from leaf to root.
     * Each element is { hash: hex string, position: 'L' | 'R' }
     * indicating whether the sibling is on the left or right.
     */
    path: MerklePathNode[]
}

export interface MerklePathNode {
    hash: string
    position: 'L' | 'R'
}

/**
 * A complete proof chain for a token, from current TX back to genesis.
 * Entries are ordered newest-first (index 0 = most recent transfer).
 */
export interface ProofChain {
    /** Genesis TXID — the chain must terminate here. */
    genesisTxId: string
    /** Ordered list of Merkle proofs, newest first. */
    entries: MerkleProofEntry[]
}

/**
 * Verify a single Merkle proof against a known Merkle root.
 *
 * Computes the Merkle root from the TXID and path, then compares
 * it to the declared Merkle root.
 *
 * @returns true if the computed root matches the declared root.
 */
export function verifyMerkleProof(entry: MerkleProofEntry): boolean {
    let currentHash: Uint8Array = Buffer.from(entry.txId, 'hex')

    for (const node of entry.path) {
        const sibling = Buffer.from(node.hash, 'hex')
        let combined: Uint8Array

        if (node.position === 'R') {
            // Sibling is on the right: hash(current || sibling)
            combined = Buffer.concat([currentHash, sibling])
        } else {
            // Sibling is on the left: hash(sibling || current)
            combined = Buffer.concat([sibling, currentHash])
        }

        // Bitcoin uses double SHA-256 for Merkle trees.
        currentHash = doubleSha256(combined)
    }

    const computedRoot = Buffer.from(currentHash).toString('hex')
    return computedRoot === entry.merkleRoot
}

/**
 * Verify an entire proof chain from the most recent transfer back to genesis.
 *
 * For each entry:
 *   1. Verifies the Merkle proof against its declared Merkle root.
 *   2. Calls the block header verifier to confirm the Merkle root
 *      belongs to a valid block at the declared height.
 *
 * Finally, confirms the chain terminates at the expected genesis TXID.
 *
 * @param chain           - The proof chain to verify.
 * @param verifyBlockHeader - A callback that checks whether a given Merkle root
 *                            is valid for a block at the given height. This is
 *                            where SPV clients check against their block header chain.
 * @returns true if the entire chain is valid.
 */
export function verifyProofChain(
    chain: ProofChain,
    verifyBlockHeader: (merkleRoot: string, blockHeight: number) => boolean
): boolean {
    if (chain.entries.length === 0) {
        return false
    }

    // Verify each proof entry.
    for (const entry of chain.entries) {
        // 1. Verify the Merkle proof itself.
        if (!verifyMerkleProof(entry)) {
            return false
        }

        // 2. Verify the Merkle root against block headers.
        if (!verifyBlockHeader(entry.merkleRoot, entry.blockHeight)) {
            return false
        }
    }

    // 3. Confirm the chain terminates at the genesis TX.
    const oldestEntry = chain.entries[chain.entries.length - 1]
    return oldestEntry.txId === chain.genesisTxId
}

/**
 * Extend an existing proof chain with a new transfer's Merkle proof.
 *
 * Called after a transfer TX is mined and its Merkle proof is obtained.
 * The new entry is prepended (newest first).
 */
export function extendProofChain(
    chain: ProofChain,
    newEntry: MerkleProofEntry
): ProofChain {
    return {
        genesisTxId: chain.genesisTxId,
        entries: [newEntry, ...chain.entries],
    }
}

/**
 * Create an initial proof chain from the genesis TX's Merkle proof.
 */
export function createProofChain(
    genesisTxId: string,
    genesisProof: MerkleProofEntry
): ProofChain {
    return {
        genesisTxId,
        entries: [genesisProof],
    }
}

/** Bitcoin double SHA-256. */
function doubleSha256(data: Uint8Array): Uint8Array {
    const first = createHash('sha256').update(data).digest()
    return createHash('sha256').update(first).digest()
}
