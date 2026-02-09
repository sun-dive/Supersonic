/**
 * OP_RETURN encoder/decoder for MPT token metadata.
 *
 * v05 Format (version 0x02):
 *   OP_0 OP_RETURN <"MPT"> <version:1=0x02> <tokenName>
 *   <tokenScript> <tokenRules:8> <tokenAttributes> <stateData>
 *
 * Chunk ordering by enforcement level (highest authority first):
 *   4: tokenName        -- identity
 *   5: tokenScript      -- consensus-enforced (miners), empty = P2PKH
 *   6: tokenRules       -- application-enforced (wallet)
 *   7: tokenAttributes  -- user-level data
 *   8: stateData        -- mutable
 *
 * Transfer TXs add two extra fields (v05.21: genesisOutputIndex removed, derived from chain):
 *   <genesisTxId:32> <proofChainBinary>
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
export const MPT_VERSION = 0x02

export interface TokenOpReturnData {
  tokenName: string       // UTF-8 text
  tokenScript: string     // hex, variable (empty = P2PKH fallback, consensus-enforced)
  tokenRules: string      // hex, 8 bytes
  tokenAttributes: string // hex, variable (zero-length if unused)
  stateData: string       // hex, variable (min 1 byte)
  genesisTxId?: string    // hex, 32 bytes -- present on transfer TXs
  proofChainEntries?: MerkleProofEntry[]
  // v05.21: genesisOutputIndex removed from OP_RETURN -- derived from chain traversal during verification
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

/** Build an OP_RETURN locking script containing MPT v05 token metadata. */
export function encodeOpReturn(data: TokenOpReturnData): LockingScript {
  const nameBytes = stringToBytes(data.tokenName)
  const scriptBytes = hexToBytes(data.tokenScript)
  const rulesBytes = hexToBytes(data.tokenRules)
  const attrsBytes = hexToBytes(data.tokenAttributes)
  const stateBytes = data.stateData ? hexToBytes(data.stateData) : [0x00]

  const chunks: ScriptChunk[] = [
    { op: OP.OP_0 },
    { op: OP.OP_RETURN },
    // Indices below are in the encoder's LockingScript array (includes OP_0, OP_RETURN at [0],[1])
    // After parsePushdataChunks, data chunks shift down (OP_0, OP_RETURN skipped): [2]→[0], [3]→[1], etc.
    pushData(MPT_PREFIX),                                   // [2] in encoder → [0] in parser: "MPT"
    pushData([MPT_VERSION]),                                // [3] in encoder → [1] in parser: version (0x02)
    pushData(nameBytes),                                    // [4] in encoder → [2] in parser: tokenName
    pushData(scriptBytes.length > 0 ? scriptBytes : []),    // [5] in encoder → [3] in parser: tokenScript (consensus)
    pushData(rulesBytes),                                   // [6] in encoder → [4] in parser: tokenRules (application)
    pushData(attrsBytes.length > 0 ? attrsBytes : []),      // [7] in encoder → [5] in parser: tokenAttributes (user)
    pushData(stateBytes.length > 0 ? stateBytes : [0x00]),  // [8] in encoder → [6] in parser: stateData (mutable)
  ]

  // Optional on-chain bundle fields (transfer TXs only)
  // v05.21: genesisOutputIndex no longer encoded -- derived from chain traversal
  if (data.genesisTxId) {
    console.debug(`encodeOpReturn: Adding transfer TX fields. genesisTxId=${data.genesisTxId.substring(0, 12)}..., chunks before=${chunks.length}`)
    chunks.push(pushData(hexToBytes(data.genesisTxId)))
    chunks.push(pushData(encodeProofChainBinary(data.proofChainEntries ?? [])))
    console.debug(`encodeOpReturn: Transfer TX fields added. chunks after=${chunks.length}`)
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
  const startOffset = offset
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
      console.debug(`parsePushdataChunks: stopped at offset ${offset-1}, unknown op 0x${op.toString(16)}, parsed ${chunks.length} chunks, total bytes parsed ${offset - startOffset}`)
      break
    }
  }
  return chunks
}

/** Parse an OP_RETURN locking script back into token metadata (v05 format). */
export function decodeOpReturn(script: LockingScript): TokenOpReturnData | null {
  const raw = script.toBinary()

  // Minimum: OP_0 (0x00) OP_RETURN (0x6a) + pushdata chunks
  if (raw.length < 4) return null
  if (raw[0] !== 0x00 || raw[1] !== 0x6a) return null

  // Parse individual pushdata chunks from raw bytes after OP_0 OP_RETURN
  const chunks = parsePushdataChunks(raw, 2)

  // DEBUG: Log chunk count and first chunk info
  if (raw.length > 100) {
    const hexStart = Array.from(raw.slice(0, Math.min(80, raw.length))).map(b => b.toString(16).padStart(2, '0')).join('')
    console.debug(`decodeOpReturn: found ${chunks.length} chunks, raw script length ${raw.length} bytes, hex start: ${hexStart}...`)
  }

  // Minimum: MPT version name script rules attrs stateData = 7 data chunks
  if (chunks.length < 7) return null

  // Check MPT prefix (chunk 0 = "MPT")
  const prefix = chunks[0]
  if (prefix.length !== 3 || prefix[0] !== 0x4d || prefix[1] !== 0x50 || prefix[2] !== 0x54) {
    return null
  }

  // Check version (chunk 1) -- v05 = 0x02
  const versionData = chunks[1]
  if (versionData.length !== 1 || versionData[0] !== MPT_VERSION) return null

  const tokenName = bytesToString(chunks[2])
  const tokenScript = bytesToHex(chunks[3])
  const tokenRules = bytesToHex(chunks[4])
  const tokenAttributes = bytesToHex(chunks[5])
  const stateData = bytesToHex(chunks[6])

  const result: TokenOpReturnData = {
    tokenName,
    tokenScript,
    tokenRules,
    tokenAttributes,
    stateData,
  }

  // Optional on-chain bundle fields (transfer TXs only)
  // These are parsed from the data chunks returned by parsePushdataChunks:
  //   chunks[7] = genesisTxId (32 bytes)
  //   chunks[8] = proofChainBinary (variable length, decodes to MerkleProofEntry[])
  // v05.21: genesisOutputIndex no longer in OP_RETURN -- derived from chain traversal
  // Note: parsePushdataChunks skips OP_0 and OP_RETURN, returning only data chunks
  if (chunks.length >= 9) {
    result.genesisTxId = bytesToHex(chunks[7])
    result.proofChainEntries = decodeProofChainBinary(chunks[8])
  }

  return result
}

// ─── Immutable Chunk Bytes ──────────────────────────────────────────

/**
 * Extract the raw bytes of OP_RETURN data chunks 2-5 (tokenName, tokenScript,
 * tokenRules, tokenAttributes) and concatenate them. Used for Token ID computation.
 *
 * These are data chunks 2, 3, 4, 5 after the MPT prefix and version
 * (which are data chunks 0 and 1).
 *
 * Returns the concatenated raw data bytes (not the pushdata opcodes).
 */
export function extractImmutableChunkBytes(script: LockingScript): number[] {
  const raw = script.toBinary()
  if (raw.length < 4 || raw[0] !== 0x00 || raw[1] !== 0x6a) return []
  const chunks = parsePushdataChunks(raw, 2)
  if (chunks.length < 6) return []
  // chunks[0]=MPT, [1]=version, [2]=tokenName, [3]=tokenScript, [4]=tokenRules, [5]=tokenAttributes
  return [...chunks[2], ...chunks[3], ...chunks[4], ...chunks[5]]
}

/**
 * Build immutable chunk bytes from individual field values.
 * Used when the OP_RETURN script is not available (e.g. from stored token data).
 *
 * Order: name + script + rules (immutable fields bound to Token ID).
 * Note: tokenAttributes is mutable and NOT included in Token ID computation.
 */
export function buildImmutableChunkBytes(
  tokenName: string,
  tokenScript: string,
  tokenRules: string,
): number[] {
  const nameBytes = stringToBytes(tokenName)
  const scriptBytes = hexToBytes(tokenScript)
  const rulesBytes = hexToBytes(tokenRules)
  return [...nameBytes, ...scriptBytes, ...rulesBytes]
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

/** Restriction bitfield: bit 0 = fungible token (amount in satoshis, shared Token ID) */
export const RESTRICTION_FUNGIBLE = 0x0001

/**
 * Encode token rules as an 8-byte hex string (4 x uint16 LE).
 *
 *   Bytes 0-1: supply (whole tokens, max 65535 per genesis TX)
 *   Bytes 2-3: divisibility (fragments per whole, 0 = NFT/indivisible)
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
  isFungible: boolean
} {
  const bytes = hexToBytes(rulesHex)
  const view = new DataView(new Uint8Array(bytes).buffer)
  const restrictions = view.getUint16(4, true)
  return {
    supply: view.getUint16(0, true),
    divisibility: view.getUint16(2, true),
    restrictions,
    version: view.getUint16(6, true),
    isFungible: (restrictions & RESTRICTION_FUNGIBLE) !== 0,
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * © BSV Association
 *
 * Open BSV License Version 5 – granted by BSV Association, Grafenauweg 6, 6300
 * Zug, Switzerland (CHE-427.008.338) ("Licensor"), to you as a user (henceforth
 * "You", "User" or "Licensee").
 *
 * For the purposes of this license, the definitions below have the following
 * meanings:
 *
 * "Bitcoin Protocol" means the protocol implementation, cryptographic rules,
 * network protocols, and consensus mechanisms in the Bitcoin White Paper as
 * described here https://protocol.bsvblockchain.org.
 *
 * "Bitcoin White Paper" means the paper entitled 'Bitcoin: A Peer-to-Peer
 * Electronic Cash System' published by 'Satoshi Nakamoto' in October 2008.
 *
 * "BSV Blockchains" means:
 *   (a) the Bitcoin blockchain containing block height #556767 with the hash
 *       "000000000000000001d956714215d96ffc00e0afda4cd0a96c96f8d802b1662b" and
 *       that contains the longest honest persistent chain of blocks which has been
 *       produced in a manner which is consistent with the rules set forth in the
 *       Network Access Rules; and
 *   (b) the test blockchains that contain the longest honest persistent chains of
 *       blocks which has been produced in a manner which is consistent with the
 *       rules set forth in the Network Access Rules.
 *
 * "Network Access Rules" or "Rules" means the set of rules regulating the
 * relationship between BSV Association and the nodes on BSV based on the Bitcoin
 * Protocol rules and those set out in the Bitcoin White Paper, and available here
 * https://bsvblockchain.org/network-access-rules.
 *
 * "Software" means the software the subject of this licence, including any/all
 * intellectual property rights therein and associated documentation files.
 *
 * BSV Association grants permission, free of charge and on a non-exclusive and
 * revocable basis, to any person obtaining a copy of the Software to deal in the
 * Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
 * Software, and to permit persons to whom the Software is furnished to do so,
 * subject to and conditioned upon the following conditions:
 *
 * 1 - The text "© BSV Association," and this license shall be included in all
 * copies or substantial portions of the Software.
 * 2 - The Software, and any software that is derived from the Software or parts
 * thereof, must only be used on the BSV Blockchains.
 *
 * For the avoidance of doubt, this license is granted subject to and conditioned
 * upon your compliance with these terms only. In the event of non-compliance, the
 * license shall extinguish and you can be enjoined from violating BSV's
 * intellectual property rights (incl. damages and similar related claims).
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES REGARDING ENTITLEMENT,
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS THEREOF BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 * ─────────────────────────────────────────────────────────────────────────────
 */
