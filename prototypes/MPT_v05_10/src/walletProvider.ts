/**
 * WhatsOnChain-based wallet provider for BSV mainnet.
 *
 * This is the WALLET layer -- responsible for all network operations:
 *   - UTXO lookup (funding transactions)
 *   - Broadcasting signed transactions
 *   - Fetching raw transactions (for building inputs)
 *   - Fetching block headers (for SPV verification)
 *   - Fetching Merkle proofs (for proof chain construction)
 *   - Address history (for incoming token detection)
 *
 * The token protocol (tokenProtocol.ts) has NO dependency on this module.
 * Verification can be done offline with pre-fetched headers.
 */
import { Transaction } from '@bsv/sdk'
import type { MerkleProofEntry, MerklePathNode, BlockHeader as SpvBlockHeader } from './tokenProtocol'

// Use local proxy on localhost to avoid CORS issues
const WOC_BASE = (typeof location !== 'undefined' && location.hostname === 'localhost')
  ? '/woc/v1/bsv/main'
  : 'https://api.whatsonchain.com/v1/bsv/main'

// ─── Types ──────────────────────────────────────────────────────────

export interface Utxo {
  txId: string
  outputIndex: number
  satoshis: number
  script: string
}

export interface WalletBlockHeader extends SpvBlockHeader {
  hash: string
  timestamp: number
  prevHash: string
}

// ─── Rate Limiter (serializing queue) ────────────────────────────────

const MIN_REQUEST_DELAY = 350

/**
 * Serializing fetch queue. All API calls go through this single queue
 * so that concurrent async paths (balance refresh, incoming scan, auto-import)
 * cannot burst past the rate limit. Each request waits for the previous
 * one to complete + the minimum delay (350ms) before starting.
 * NOTE: This relies on global fetchQueue state; do not instantiate multiple providers.
 */
let fetchQueue: Promise<void> = Promise.resolve()

function queuedFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    fetchQueue = fetchQueue.then(async () => {
      try {
        const resp = await fetch(url, init)
        resolve(resp)
      } catch (err) {
        reject(err)
      }
      // Enforce delay AFTER the request completes (or fails)
      await new Promise(r => setTimeout(r, MIN_REQUEST_DELAY))
    })
  })
}

/** queuedFetch with automatic retry on 429 (rate limited) responses. */
async function fetchWithRetry(url: string, init?: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await queuedFetch(url, init)
    if (resp.status !== 429 || attempt === maxRetries) return resp
    // Back off before retrying: 500ms, 1000ms, 1500ms
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
  }
  return queuedFetch(url, init) // unreachable, satisfies TS
}

// ─── Wallet Provider ────────────────────────────────────────────────

export class WalletProvider {
  private address: string
  private txCache = new Map<string, string>()

  constructor(address: string) {
    this.address = address
  }

  getAddress(): string {
    return this.address
  }

  // ── Wallet Operations (UTXO model) ─────────────────────────────

  async getUtxos(): Promise<Utxo[]> {
    const address = this.getAddress()
    const resp = await fetchWithRetry(`${WOC_BASE}/address/${address}/unspent`)
    if (!resp.ok) throw new Error(`WoC UTXO fetch failed: ${resp.status}`)
    const data = await resp.json()
    if (!Array.isArray(data)) return []
    return data.map((u: any) => ({
      txId: u.tx_hash as string,
      outputIndex: u.tx_pos as number,
      satoshis: u.value as number,
      script: '',
    }))
  }

  async getBalance(): Promise<number> {
    const utxos = await this.getUtxos()
    return utxos.reduce((sum, u) => sum + u.satoshis, 0)
  }

  // ── Broadcasting ──────────────────────────────────────────────

  async broadcast(rawHex: string): Promise<string> {
    const resp = await queuedFetch(`${WOC_BASE}/tx/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: rawHex }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Broadcast failed (${resp.status}): ${text}`)
    }
    const txId = await resp.text()
    return txId.replace(/"/g, '')
  }

  // ── Raw Transactions ──────────────────────────────────────────

  async getRawTransaction(txId: string): Promise<string> {
    const cached = this.txCache.get(txId)
    if (cached) return cached
    const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/hex`)
    if (!resp.ok) throw new Error(`WoC raw TX fetch failed: ${resp.status}`)
    const hex = await resp.text()
    this.txCache.set(txId, hex)
    return hex
  }

  async getSourceTransaction(txId: string): Promise<Transaction> {
    const hex = await this.getRawTransaction(txId)
    return Transaction.fromHex(hex)
  }

  // ── Block Headers (feeds into SPV verification) ───────────────

  async getBlockHeader(height: number): Promise<WalletBlockHeader> {
    const hashResp = await fetchWithRetry(`${WOC_BASE}/block/height/${height}`)
    if (!hashResp.ok) throw new Error(`WoC block height fetch failed: ${hashResp.status}`)
    const hashBody = await hashResp.text()

    // WoC may return just the hash string or a full block JSON object
    let blockHash: string
    try {
      const parsed = JSON.parse(hashBody)
      blockHash = typeof parsed === 'string' ? parsed : parsed.hash
    } catch {
      blockHash = hashBody.replace(/"/g, '')
    }

    // If we got the full block object, we can extract the header directly
    // without a second API call
    try {
      const parsed = JSON.parse(hashBody)
      if (typeof parsed === 'object' && parsed.merkleroot) {
        return {
          height,
          merkleRoot: parsed.merkleroot,
          hash: parsed.hash,
          timestamp: parsed.time,
          prevHash: parsed.previousblockhash,
        }
      }
    } catch {
      // Not JSON, proceed with separate header fetch
    }

    const headerResp = await fetchWithRetry(`${WOC_BASE}/block/${blockHash}/header`)
    if (!headerResp.ok) throw new Error(`WoC block header fetch failed: ${headerResp.status}`)
    const hdr = await headerResp.json()

    return {
      height,
      merkleRoot: hdr.merkleroot,
      hash: hdr.hash,
      timestamp: hdr.time,
      prevHash: hdr.previousblockhash,
    }
  }

  // ── Address History ───────────────────────────────────────────

  async getAddressHistory(): Promise<{ txId: string; blockHeight: number }[]> {
    const address = this.getAddress()
    const resp = await fetchWithRetry(`${WOC_BASE}/address/${address}/history`)
    if (!resp.ok) throw new Error(`WoC history fetch failed: ${resp.status}`)
    const data = await resp.json()
    if (!Array.isArray(data)) return []
    return data.map((entry: any) => ({
      txId: entry.tx_hash as string,
      blockHeight: (entry.height ?? 0) as number,
    }))
  }

  // ── Merkle Proofs (feeds into proof chain construction) ───────

  async getMerkleProof(txId: string): Promise<MerkleProofEntry | null> {
    const resp = await fetchWithRetry(`${WOC_BASE}/tx/${txId}/proof/tsc`)
    if (!resp.ok) {
      console.debug(`getMerkleProof: WoC returned ${resp.status} for ${txId.slice(0, 12)}...`)
      return null
    }

    const raw = await resp.json()
    console.debug('getMerkleProof: raw response:', JSON.stringify(raw).slice(0, 200))
    const data = Array.isArray(raw) ? raw[0] : raw
    if (!data || !data.target) {
      console.debug('getMerkleProof: no target in proof data:', data)
      return null
    }

    const nodes: string[] = data.nodes ?? []
    const index: number = data.index ?? 0
    const path: MerklePathNode[] = []

    let idx = index
    for (const node of nodes) {
      if (node === '*') {
        idx = idx >> 1
        continue
      }
      const position: 'L' | 'R' = (idx % 2 === 0) ? 'R' : 'L'
      path.push({ hash: node, position })
      idx = idx >> 1
    }

    const blockHash = data.target
    const headerResp = await fetchWithRetry(`${WOC_BASE}/block/${blockHash}/header`)
    if (!headerResp.ok) return null
    const header = await headerResp.json()

    return {
      txId,
      blockHeight: header.height,
      merkleRoot: header.merkleroot,
      path,
    }
  }
}
