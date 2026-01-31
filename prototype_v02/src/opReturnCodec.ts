/**
 * OP_RETURN encoder/decoder for MPT token metadata.
 *
 * Format: OP_0 OP_RETURN <"MPT"> <version:1> <tokenName> <tokenRules:8> <tokenAttributes> <ownerPubKey:33> <stateData>
 *
 * Transfer TXs add two extra fields:
 *   <genesisTxId:32> <proofChainBinary>
 *
 * Proof chain binary layout:
 *   [1 byte: entry count]
 *   Per entry:
 *     [32 bytes: txId]
 *     [4 bytes: blockHeight LE]
 *     [32 bytes: merkleRoot]
 *     [1 byte: path node count]
 *     Per node:
 *       [32 bytes: hash]
 *       [1 byte: 0=L, 1=R]
 *
 * Each field is a separate pushdata chunk.
 */
import { LockingScript, OP } from '@bsv/sdk'
import type { MerkleProofEntry, MerklePathNode } from './cryptoCompat'

/** Script chunk: an opcode with optional data payload. */
interface ScriptChunk {
  op: number
  data?: number[]
}

export const MPT_PREFIX = [0x4d, 0x50, 0x54] // "MPT" in ASCII
export const MPT_VERSION = 0x01

export interface TokenOpReturnData {
  tokenName: string      // UTF-8 text
  tokenRules: string     // hex, 8 bytes
  tokenAttributes: string // hex, variable
  ownerPubKey: string    // hex, 33 bytes compressed pubkey
  stateData: string      // hex, variable (can be empty)
  genesisTxId?: string   // hex, 32 bytes -- present on transfer TXs
  proofChainEntries?: MerkleProofEntry[] // proof chain entries -- binary-encoded on chain
}

// ─── Helpers ────────────────────────────────────────────────────────

function hexToBytes(hex: string): number[] {
  if (hex.length === 0) return []
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16))
  }
  return bytes
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

function stringToBytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str))
}

function bytesToString(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** Create a pushdata chunk for a byte array, using correct OP_PUSHDATA encoding. */
function pushData(data: number[]): ScriptChunk {
  const len = data.length
  let op: number
  if (len > 0 && len < OP.OP_PUSHDATA1) {
    op = len // opcodes 1-75 mean "push next N bytes"
  } else if (len < 256) {
    op = OP.OP_PUSHDATA1 // 0x4c: next byte is length
  } else if (len < 65536) {
    op = OP.OP_PUSHDATA2 // 0x4d: next 2 bytes are length (LE)
  } else {
    op = OP.OP_PUSHDATA4 // 0x4e: next 4 bytes are length (LE)
  }
  return { op, data } as ScriptChunk
}

// ─── Proof Chain Binary Codec ────────────────────────────────────────

/** Write a 32-bit unsigned integer as 4-byte little-endian. */
function uint32LE(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}

/** Read a 32-bit unsigned integer from 4-byte little-endian. */
function readUint32LE(bytes: number[], offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0
}

/**
 * Encode proof chain entries to compact binary.
 *
 * Layout: [1B entryCount] per entry: [32B txId][4B height LE][32B merkleRoot][1B nodeCount] per node: [32B hash][1B position]
 */
export function encodeProofChainBinary(entries: MerkleProofEntry[]): number[] {
  const buf: number[] = [entries.length & 0xff]

  for (const entry of entries) {
    buf.push(...hexToBytes(entry.txId))          // 32 bytes
    buf.push(...uint32LE(entry.blockHeight))      // 4 bytes
    buf.push(...hexToBytes(entry.merkleRoot))     // 32 bytes
    buf.push(entry.path.length & 0xff)            // 1 byte
    for (const node of entry.path) {
      buf.push(...hexToBytes(node.hash))          // 32 bytes
      buf.push(node.position === 'L' ? 0 : 1)    // 1 byte
    }
  }

  return buf
}

/**
 * Decode proof chain entries from compact binary.
 */
export function decodeProofChainBinary(bytes: number[]): MerkleProofEntry[] {
  if (bytes.length === 0) return []

  const entries: MerkleProofEntry[] = []
  let offset = 0
  const entryCount = bytes[offset++]

  for (let i = 0; i < entryCount; i++) {
    const txId = bytesToHex(bytes.slice(offset, offset + 32)); offset += 32
    const blockHeight = readUint32LE(bytes, offset); offset += 4
    const merkleRoot = bytesToHex(bytes.slice(offset, offset + 32)); offset += 32
    const nodeCount = bytes[offset++]

    const path: MerklePathNode[] = []
    for (let j = 0; j < nodeCount; j++) {
      const hash = bytesToHex(bytes.slice(offset, offset + 32)); offset += 32
      const position: 'L' | 'R' = bytes[offset++] === 0 ? 'L' : 'R'
      path.push({ hash, position })
    }

    entries.push({ txId, blockHeight, merkleRoot, path })
  }

  return entries
}

// ─── Encode ─────────────────────────────────────────────────────────

/**
 * Build an OP_RETURN locking script containing MPT token metadata.
 */
export function encodeOpReturn(data: TokenOpReturnData): LockingScript {
  const nameBytes = stringToBytes(data.tokenName)
  const rulesBytes = hexToBytes(data.tokenRules)
  const attrsBytes = hexToBytes(data.tokenAttributes)
  const ownerBytes = hexToBytes(data.ownerPubKey)
  const stateBytes = hexToBytes(data.stateData)

  const chunks: ScriptChunk[] = [
    { op: OP.OP_FALSE } as ScriptChunk,
    { op: OP.OP_RETURN } as ScriptChunk,
    pushData(MPT_PREFIX),
    pushData([MPT_VERSION]),
    pushData(nameBytes),
    pushData(rulesBytes),
    pushData(attrsBytes),
    pushData(ownerBytes),
    pushData(stateBytes.length > 0 ? stateBytes : [0x00]), // at least 1 byte
  ]

  // Optional on-chain bundle fields (transfer TXs only)
  if (data.genesisTxId) {
    chunks.push(pushData(hexToBytes(data.genesisTxId)))
    chunks.push(pushData(encodeProofChainBinary(data.proofChainEntries ?? [])))
  }

  return new LockingScript(chunks)
}

// ─── Decode ─────────────────────────────────────────────────────────

/**
 * Parse an OP_RETURN script and extract MPT token metadata.
 * Returns null if the script is not a valid MPT OP_RETURN.
 */
export function decodeOpReturn(script: LockingScript): TokenOpReturnData | null {
  const chunks = script.chunks

  // Expect: OP_0 OP_RETURN <MPT> <version> <name> <rules> <attrs> <owner> <state>
  // That's 9 chunks minimum
  if (chunks.length < 9) return null

  // Check OP_0 OP_RETURN
  if (chunks[0].op !== OP.OP_FALSE) return null
  if (chunks[1].op !== OP.OP_RETURN) return null

  // Check MPT prefix
  const prefix = chunks[2].data
  if (!prefix || prefix.length !== 3) return null
  if (prefix[0] !== 0x4d || prefix[1] !== 0x50 || prefix[2] !== 0x54) return null

  // Check version
  const versionData = chunks[3].data
  if (!versionData || versionData[0] !== MPT_VERSION) return null

  const nameData = chunks[4].data ?? []
  const rulesData = chunks[5].data ?? []
  const attrsData = chunks[6].data ?? []
  const ownerData = chunks[7].data ?? []
  const stateData = chunks[8].data ?? []

  const result: TokenOpReturnData = {
    tokenName: bytesToString(nameData as number[]),
    tokenRules: bytesToHex(rulesData as number[]),
    tokenAttributes: bytesToHex(attrsData as number[]),
    ownerPubKey: bytesToHex(ownerData as number[]),
    stateData: bytesToHex(stateData as number[]),
  }

  // Optional on-chain bundle fields (chunks 9 and 10)
  if (chunks.length >= 11) {
    const genesisTxIdData = chunks[9].data ?? []
    const proofChainData = chunks[10].data ?? []
    result.genesisTxId = bytesToHex(genesisTxIdData as number[])
    result.proofChainEntries = decodeProofChainBinary(proofChainData as number[])
  }

  return result
}

// ─── Token Rules Encoding ───────────────────────────────────────────

/**
 * Encode token rules into an 8-byte hex string.
 * Copied from src/lib/genesis.ts to avoid scrypt-ts dependency.
 *
 * Layout: [supply: 2 bytes LE] [divisibility: 2 bytes LE]
 *         [restrictions: 2 bytes LE] [version: 2 bytes LE]
 */
export function encodeTokenRules(
  supply: number,
  divisibility: number,
  restrictions: number,
  version: number
): string {
  const buf = new Uint8Array(8)
  const view = new DataView(buf.buffer)
  view.setUint16(0, supply, true)
  view.setUint16(2, divisibility, true)
  view.setUint16(4, restrictions, true)
  view.setUint16(6, version, true)
  return bytesToHex(Array.from(buf))
}

/**
 * Decode token rules from an 8-byte hex string.
 */
export function decodeTokenRules(rulesHex: string): {
  supply: number
  divisibility: number
  restrictions: number
  version: number
} {
  const bytes = hexToBytes(rulesHex)
  const view = new DataView(new Uint8Array(bytes).buffer)
  return {
    supply: view.getUint16(0, true),
    divisibility: view.getUint16(2, true),
    restrictions: view.getUint16(4, true),
    version: view.getUint16(6, true),
  }
}
