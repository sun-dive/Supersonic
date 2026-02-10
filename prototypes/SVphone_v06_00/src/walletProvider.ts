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

// Increased from 350ms to 600ms to respect WhatsOnChain's rate limit (~1.7 req/sec)
// With 96+ transactions in history, 350ms was causing 429 (Too Many Requests) errors
const MIN_REQUEST_DELAY = 600

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
async function fetchWithRetry(url: string, init?: RequestInit, maxRetries = 5): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await queuedFetch(url, init)
    if (resp.status !== 429 || attempt === maxRetries) {
      if (resp.status === 429 && attempt === maxRetries) {
        console.warn(`fetchWithRetry: Still getting 429 after ${maxRetries} retries for ${url}`)
      }
      return resp
    }
    // Back off before retrying: 1000ms, 2000ms, 3000ms, 4000ms, 5000ms
    const backoffMs = 1000 * (attempt + 1)
    console.debug(`fetchWithRetry: Got 429, backing off ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}`)
    await new Promise(r => setTimeout(r, backoffMs))
  }
  return queuedFetch(url, init) // unreachable, satisfies TS
}

// ─── Wallet Provider ────────────────────────────────────────────────

export class WalletProvider {
  private address: string
  private txCache = new Map<string, string>()

  /**
   * v05.22: Local pending UTXO tracking for consecutive transfers.
   *
   * When we broadcast a TX, the change output won't appear in WoC's UTXO list
   * until the TX is confirmed. This prevents consecutive fragment transfers
   * because the second transfer can't find funding UTXOs.
   *
   * Solution: Track pending UTXOs locally and combine with confirmed UTXOs.
   */
  private pendingUtxos = new Map<string, Utxo>()  // key: "txId:outputIndex"
  private spentOutpoints = new Set<string>()       // key: "txId:outputIndex"

  constructor(address: string) {
    this.address = address
  }

  getAddress(): string {
    return this.address
  }

  // ── Wallet Operations (UTXO model) ─────────────────────────────

  /**
   * Get UTXOs combining confirmed (from WoC) with local pending UTXOs.
   *
   * v05.22: Enables consecutive transfers by including unconfirmed change
   * outputs and excluding locally-spent outpoints.
   */
  async getUtxos(): Promise<Utxo[]> {
    const address = this.getAddress()
    const resp = await fetchWithRetry(`${WOC_BASE}/address/${address}/unspent`)
    if (!resp.ok) throw new Error(`WoC UTXO fetch failed: ${resp.status}`)
    const data = await resp.json()

    // Start with confirmed UTXOs from WoC
    const confirmed: Utxo[] = Array.isArray(data)
      ? data.map((u: any) => ({
          txId: u.tx_hash as string,
          outputIndex: u.tx_pos as number,
          satoshis: u.value as number,
          script: '',
        }))
      : []

    // Filter out confirmed UTXOs that we've already spent locally
    const filtered = confirmed.filter(u => {
      const key = `${u.txId}:${u.outputIndex}`
      return !this.spentOutpoints.has(key)
    })

    // Remove pending UTXOs that are now confirmed (they'll be in the filtered list)
    for (const u of confirmed) {
      const key = `${u.txId}:${u.outputIndex}`
      if (this.pendingUtxos.has(key)) {
        this.pendingUtxos.delete(key)
        console.debug(`getUtxos: Pending UTXO ${key.slice(0, 16)}... now confirmed`)
      }
    }

    // Add remaining pending UTXOs (not yet confirmed)
    const pending = Array.from(this.pendingUtxos.values())

    const combined = [...filtered, ...pending]
    console.debug(`getUtxos: ${confirmed.length} confirmed, ${this.spentOutpoints.size} spent locally, ${pending.length} pending = ${combined.length} available`)
    return combined
  }

  /**
   * Register a pending transaction for local UTXO tracking.
   *
   * Call this after broadcasting a TX to enable consecutive transfers
   * before the TX is confirmed.
   *
   * @param txId - The broadcast transaction ID
   * @param spentInputs - Outpoints consumed by this TX [{txId, outputIndex}]
   * @param changeOutput - Change output created by this TX (if any)
   */
  registerPendingTx(
    txId: string,
    spentInputs: Array<{ txId: string; outputIndex: number }>,
    changeOutput?: { outputIndex: number; satoshis: number },
  ): void {
    // Mark spent inputs
    for (const input of spentInputs) {
      const key = `${input.txId}:${input.outputIndex}`
      this.spentOutpoints.add(key)
      // Also remove from pending if we're spending our own unconfirmed change
      this.pendingUtxos.delete(key)
    }

    // Track change output as pending UTXO
    if (changeOutput && changeOutput.satoshis > 0) {
      const key = `${txId}:${changeOutput.outputIndex}`
      this.pendingUtxos.set(key, {
        txId,
        outputIndex: changeOutput.outputIndex,
        satoshis: changeOutput.satoshis,
        script: '',
      })
      console.debug(`registerPendingTx: Added pending UTXO ${key.slice(0, 16)}... (${changeOutput.satoshis} sats)`)
    }

    console.debug(`registerPendingTx: TX ${txId.slice(0, 12)}... spent ${spentInputs.length} inputs, pending UTXOs: ${this.pendingUtxos.size}`)
  }

  /**
   * Clear spent outpoints for a confirmed transaction.
   *
   * Call this when a pending TX is confirmed to clean up tracking state.
   * Note: Pending UTXOs are auto-cleaned in getUtxos() when they appear confirmed.
   */
  clearConfirmedSpends(spentInputs: Array<{ txId: string; outputIndex: number }>): void {
    for (const input of spentInputs) {
      const key = `${input.txId}:${input.outputIndex}`
      this.spentOutpoints.delete(key)
    }
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
