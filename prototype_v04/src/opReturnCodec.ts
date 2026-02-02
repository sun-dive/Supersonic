/**
 * OP_RETURN encoder/decoder for MPT token metadata.
 *
 * Format: OP_0 OP_RETURN <"MPT"> <version:1> <tokenName> <tokenRules:8>
 *         <tokenAttributes> <stateData>
 *
 * Transfer TXs add three extra fields:
 *   <genesisTxId:32> <proofChainBinary> <genesisOutputIndex:4>
 *
 * Proof chain binary layout:
 *   Per entry (repeat until data exhausted):
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
import type { MerkleProofEntry, MerklePathNode } from './tokenProtocol'

// ─── Constants ──────────────────────────────────────────────────────

interface ScriptChunk {
  op: number
  data?: number[]
}

export const MPT_PREFIX = [0x4d, 0x50, 0x54] // "MPT" in ASCII
export const MPT_VERSION = 0x01

export interface TokenOpReturnData {
  tokenName: string       // UTF-8 text
  tokenRules: string      // hex, 8 bytes
  tokenAttributes: string // hex, variable (zero-length if unused)
  stateData: string       // hex, variable (min 1 byte)
  genesisTxId?: string    // hex, 32 bytes -- present on transfer TXs
  proofChainEntries?: MerkleProofEntry[]
  genesisOutputIndex?: number // uint32 LE -- present on transfer TXs
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

/** Create a pushdata chunk with correct OP_PUSHDATA encoding. */
function pushData(data: number[]): ScriptChunk {
  const len = data.length
  let op: number
  if (len > 0 && len < OP.OP_PUSHDATA1) {
    op = len // opcodes 1-75 mean "push next N bytes"
  } else if (len < 256) {
    op = OP.OP_PUSHDATA1
  } else if (len < 65536) {
    op = OP.OP_PUSHDATA2
  } else {
    op = OP.OP_PUSHDATA4
  }
  return { op, data } as ScriptChunk
}

// ─── Proof Chain Binary Codec ───────────────────────────────────────

function uint32LE(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}

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
 * Layout per entry (no entry count prefix -- repeat until data exhausted):
 *   [32B txId][4B height LE][32B merkleRoot]
 *   [1B nodeCount] per node: [32B hash][1B position]
 */
export function encodeProofChainBinary(entries: MerkleProofEntry[]): number[] {
  const buf: number[] = []
  for (const entry of entries) {
    buf.push(...hexToBytes(entry.txId))
    buf.push(...uint32LE(entry.blockHeight))
    buf.push(...hexToBytes(entry.merkleRoot))
    buf.push(entry.path.length & 0xff)
    for (const node of entry.path) {
      buf.push(...hexToBytes(node.hash))
      buf.push(node.position === 'L' ? 0 : 1)
    }
  }
  return buf
}

/** Decode proof chain entries from compact binary. Reads until data exhausted. */
export function decodeProofChainBinary(bytes: number[]): MerkleProofEntry[] {
  if (bytes.length === 0) return []
  const entries: MerkleProofEntry[] = []
  let offset = 0

  while (offset < bytes.length) {
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

/** Build an OP_RETURN locking script containing MPT token metadata. */
export function encodeOpReturn(data: TokenOpReturnData): LockingScript {
  const nameBytes = stringToBytes(data.tokenName)
  const rulesBytes = hexToBytes(data.tokenRules)
  const attrsBytes = hexToBytes(data.tokenAttributes)
  const stateBytes = data.stateData ? hexToBytes(data.stateData) : [0x00]

  const chunks: ScriptChunk[] = [
    { op: OP.OP_0 },
    { op: OP.OP_RETURN },
    pushData(MPT_PREFIX),
    pushData([MPT_VERSION]),
    pushData(nameBytes),
    pushData(rulesBytes),
    pushData(attrsBytes.length > 0 ? attrsBytes : []),
    pushData(stateBytes.length > 0 ? stateBytes : [0x00]),
  ]

  // Optional on-chain bundle fields (transfer TXs only)
  if (data.genesisTxId) {
    chunks.push(pushData(hexToBytes(data.genesisTxId)))
    chunks.push(pushData(encodeProofChainBinary(data.proofChainEntries ?? [])))
    chunks.push(pushData(uint32LE(data.genesisOutputIndex ?? 1)))
  }

  return new LockingScript(chunks)
}

// ─── Decode ─────────────────────────────────────────────────────────

/**
 * Parse pushdata items from raw script bytes.
 *
 * The @bsv/sdk LockingScript parser does not parse individual pushdata
 * chunks after OP_RETURN -- it treats the payload as opaque. So we
 * parse the raw bytes ourselves.
 */
function parsePushdataChunks(bytes: number[], offset: number): number[][] {
  const chunks: number[][] = []
  while (offset < bytes.length) {
    const op = bytes[offset++]
    if (op === 0) {
      // OP_0 -- push empty array
      chunks.push([])
    } else if (op >= 1 && op <= 75) {
      // Direct push: next `op` bytes
      chunks.push(bytes.slice(offset, offset + op))
      offset += op
    } else if (op === 0x4c) {
      // OP_PUSHDATA1: 1-byte length
      const len = bytes[offset++]
      chunks.push(bytes.slice(offset, offset + len))
      offset += len
    } else if (op === 0x4d) {
      // OP_PUSHDATA2: 2-byte length LE
      const len = bytes[offset] | (bytes[offset + 1] << 8)
      offset += 2
      chunks.push(bytes.slice(offset, offset + len))
      offset += len
    } else if (op === 0x4e) {
      // OP_PUSHDATA4: 4-byte length LE
      const len = bytes[offset] | (bytes[offset + 1] << 8) |
                  (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
      offset += 4
      chunks.push(bytes.slice(offset, offset + len))
      offset += len
    } else {
      // Unknown opcode -- stop parsing
      break
    }
  }
  return chunks
}

/** Parse an OP_RETURN locking script back into token metadata. */
export function decodeOpReturn(script: LockingScript): TokenOpReturnData | null {
  const raw = script.toBinary()

  // Minimum: OP_0 (0x00) OP_RETURN (0x6a) + pushdata chunks
  if (raw.length < 4) return null
  if (raw[0] !== 0x00 || raw[1] !== 0x6a) return null

  // Parse individual pushdata chunks from raw bytes after OP_0 OP_RETURN
  const chunks = parsePushdataChunks(raw, 2)

  // Minimum: MPT version name rules attrs stateData = 6 data chunks
  if (chunks.length < 6) return null

  // Check MPT prefix (chunk 0 = "MPT")
  const prefix = chunks[0]
  if (prefix.length !== 3 || prefix[0] !== 0x4d || prefix[1] !== 0x50 || prefix[2] !== 0x54) {
    return null
  }

  // Check version (chunk 1)
  const versionData = chunks[1]
  if (versionData.length !== 1 || versionData[0] !== MPT_VERSION) return null

  const tokenName = bytesToString(chunks[2])
  const tokenRules = bytesToHex(chunks[3])
  const tokenAttributes = bytesToHex(chunks[4])
  const stateData = bytesToHex(chunks[5])

  const result: TokenOpReturnData = {
    tokenName,
    tokenRules,
    tokenAttributes,
    stateData,
  }

  // Optional on-chain bundle fields (chunks 6, 7, 8 -- transfer TXs)
  if (chunks.length >= 8) {
    result.genesisTxId = bytesToHex(chunks[6])
    result.proofChainEntries = decodeProofChainBinary(chunks[7])
    if (chunks.length >= 9 && chunks[8].length === 4) {
      result.genesisOutputIndex = readUint32LE(chunks[8], 0)
    }
  }

  return result
}

// ─── Immutable Chunk Bytes ──────────────────────────────────────────

/**
 * Extract the raw bytes of OP_RETURN data chunks 2-4 (tokenName, tokenRules,
 * tokenAttributes) and concatenate them. Used for Token ID computation.
 *
 * These are data chunks 2, 3, 4 after the MPT prefix and version
 * (which are data chunks 0 and 1).
 *
 * Returns the concatenated raw data bytes (not the pushdata opcodes).
 */
export function extractImmutableChunkBytes(script: LockingScript): number[] {
  const raw = script.toBinary()
  if (raw.length < 4 || raw[0] !== 0x00 || raw[1] !== 0x6a) return []
  const chunks = parsePushdataChunks(raw, 2)
  if (chunks.length < 5) return []
  // chunks[0]=MPT, [1]=version, [2]=tokenName, [3]=tokenRules, [4]=tokenAttributes
  return [...chunks[2], ...chunks[3], ...chunks[4]]
}

/**
 * Build immutable chunk bytes from individual field values.
 * Used when the OP_RETURN script is not available (e.g. from stored token data).
 */
export function buildImmutableChunkBytes(
  tokenName: string,
  tokenRules: string,
  tokenAttributes: string,
): number[] {
  const nameBytes = stringToBytes(tokenName)
  const rulesBytes = hexToBytes(tokenRules)
  const attrsBytes = hexToBytes(tokenAttributes)
  return [...nameBytes, ...rulesBytes, ...attrsBytes]
}

// ─── File OP_RETURN (second output for file data in genesis TX) ─────

const MPT_FILE_MARKER = [0x4d, 0x50, 0x54, 0x2d, 0x46, 0x49, 0x4c, 0x45] // "MPT-FILE"

export interface FileOpReturnData {
  mimeType: string
  fileName: string
  bytes: Uint8Array
}

/** Build a second OP_RETURN output containing embedded file data. */
export function buildFileOpReturn(file: FileOpReturnData): LockingScript {
  const chunks: ScriptChunk[] = [
    { op: OP.OP_0 },
    { op: OP.OP_RETURN },
    pushData(MPT_FILE_MARKER),
    pushData(stringToBytes(file.mimeType)),
    pushData(stringToBytes(file.fileName)),
    pushData(Array.from(file.bytes)),
  ]
  return new LockingScript(chunks)
}

/** Parse a file OP_RETURN output. Returns null if not an MPT-FILE output. */
export function parseFileOpReturn(script: LockingScript): FileOpReturnData | null {
  const raw = script.toBinary()
  if (raw.length < 4 || raw[0] !== 0x00 || raw[1] !== 0x6a) return null

  const chunks = parsePushdataChunks(raw, 2)
  if (chunks.length < 4) return null

  // Check MPT-FILE marker
  const marker = chunks[0]
  if (marker.length !== 8 || bytesToString(marker) !== 'MPT-FILE') return null

  return {
    mimeType: bytesToString(chunks[1]),
    fileName: bytesToString(chunks[2]),
    bytes: new Uint8Array(chunks[3]),
  }
}

// ─── Token Rules Encoding ───────────────────────────────────────────

/**
 * Encode token rules as an 8-byte hex string (4 x uint16 LE).
 *
 *   Bytes 0-1: supply (max 65535 per genesis TX)
 *   Bytes 2-3: divisibility (decimal places, 0 = NFT)
 *   Bytes 4-5: restrictions (bitfield, 0 = none)
 *   Bytes 6-7: version (rules schema version)
 */
export function encodeTokenRules(
  supply: number,
  divisibility: number,
  restrictions: number,
  version: number,
): string {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint16(0, supply, true)
  view.setUint16(2, divisibility, true)
  view.setUint16(4, restrictions, true)
  view.setUint16(6, version, true)
  return bytesToHex(Array.from(new Uint8Array(buf)))
}

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
