/**
 * WhatsOnChain-based wallet provider for BSV mainnet.
 *
 * Implements the minimal operations needed by the MPT prototype:
 * UTXO lookup, broadcasting, block headers, Merkle proofs, raw TXs.
 *
 * Key management is local (PrivateKey stored in memory / localStorage).
 */
import { PrivateKey, PublicKey, Transaction } from '@bsv/sdk'
import type { MerkleProofEntry, MerklePathNode } from './cryptoCompat'

// Use local proxy when running on localhost to avoid CORS issues
const WOC_BASE = (typeof location !== 'undefined' && location.hostname === 'localhost')
  ? '/woc/v1/bsv/main'
  : 'https://api.whatsonchain.com/v1/bsv/main'

export interface Utxo {
  txId: string
  outputIndex: number
  satoshis: number
  script: string
}

export interface BlockHeader {
  height: number
  merkleRoot: string
  hash: string
  timestamp: number
  prevHash: string
}

export class WocProvider {
  private key: PrivateKey

  constructor(key: PrivateKey) {
    this.key = key
  }

  getPrivateKey(): PrivateKey {
    return this.key
  }

  getPublicKeyHex(): string {
    return this.key.toPublicKey().toString()
  }

  getAddress(): string {
    return this.key.toAddress()
  }

  // ── UTXOs ───────────────────────────────────────────────────────

  async getUtxos(): Promise<Utxo[]> {
    const address = this.getAddress()
    const resp = await fetch(`${WOC_BASE}/address/${address}/unspent`)
    if (!resp.ok) throw new Error(`WoC UTXO fetch failed: ${resp.status}`)
    const data = await resp.json()
    if (!Array.isArray(data)) return []
    return data.map((u: any) => ({
      txId: u.tx_hash as string,
      outputIndex: u.tx_pos as number,
      satoshis: u.value as number,
      script: '', // will be derived from source TX when needed
    }))
  }

  // ── Balance ─────────────────────────────────────────────────────

  async getBalance(): Promise<number> {
    const utxos = await this.getUtxos()
    return utxos.reduce((sum, u) => sum + u.satoshis, 0)
  }

  // ── Broadcast ───────────────────────────────────────────────────

  async broadcast(rawHex: string): Promise<string> {
    const resp = await fetch(`${WOC_BASE}/tx/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: rawHex }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Broadcast failed (${resp.status}): ${text}`)
    }
    // WoC returns the txid as a plain string (with quotes)
    const txId = await resp.text()
    return txId.replace(/"/g, '')
  }

  // ── Raw Transaction ─────────────────────────────────────────────

  async getRawTransaction(txId: string): Promise<string> {
    const resp = await fetch(`${WOC_BASE}/tx/${txId}/hex`)
    if (!resp.ok) throw new Error(`WoC raw TX fetch failed: ${resp.status}`)
    return resp.text()
  }

  /**
   * Fetch and parse a raw transaction into an @bsv/sdk Transaction object.
   */
  async getSourceTransaction(txId: string): Promise<Transaction> {
    const hex = await this.getRawTransaction(txId)
    return Transaction.fromHex(hex)
  }

  // ── Block Headers ───────────────────────────────────────────────

  async getBlockHeader(height: number): Promise<BlockHeader> {
    // Step 1: get block hash from height
    const hashResp = await fetch(`${WOC_BASE}/block/height/${height}`)
    if (!hashResp.ok) throw new Error(`WoC block height fetch failed: ${hashResp.status}`)
    const blockHash = (await hashResp.text()).replace(/"/g, '')

    // Step 2: get header details from block hash
    const headerResp = await fetch(`${WOC_BASE}/block/${blockHash}/header`)
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

  // ── Address History ─────────────────────────────────────────────

  /**
   * Fetch transaction history for an address.
   * Returns an array of { txId, blockHeight } objects, newest first.
   */
  async getAddressHistory(): Promise<{ txId: string; blockHeight: number }[]> {
    const address = this.getAddress()
    const resp = await fetch(`${WOC_BASE}/address/${address}/history`)
    if (!resp.ok) throw new Error(`WoC history fetch failed: ${resp.status}`)
    const data = await resp.json()
    if (!Array.isArray(data)) return []
    return data.map((entry: any) => ({
      txId: entry.tx_hash as string,
      blockHeight: (entry.height ?? 0) as number,
    }))
  }

  // ── Merkle Proof ────────────────────────────────────────────────

  /**
   * Fetch a Merkle proof in TSC format for a confirmed transaction.
   * Returns null if the TX is not yet confirmed.
   */
  async getMerkleProof(txId: string): Promise<MerkleProofEntry | null> {
    const resp = await fetch(`${WOC_BASE}/tx/${txId}/proof/tsc`)
    if (!resp.ok) {
      console.debug(`getMerkleProof: WoC returned ${resp.status} for ${txId.slice(0, 12)}...`)
      return null
    }

    const raw = await resp.json()
    console.debug('getMerkleProof: raw response:', JSON.stringify(raw).slice(0, 200))
    // WoC returns an array of proof objects; use the first one
    const data = Array.isArray(raw) ? raw[0] : raw
    if (!data || !data.target) {
      console.debug('getMerkleProof: no target in proof data:', data)
      return null
    }

    // TSC proof format:
    // { index, txOrId, target (block hash), nodes: [hash|"*"...] }
    //
    // The `nodes` array contains sibling hashes from leaf to root.
    // A "*" entry means use the current computed hash (duplicate pair).
    // The `index` tells us the leaf position, from which we derive L/R.

    const nodes: string[] = data.nodes ?? []
    const index: number = data.index ?? 0
    const path: MerklePathNode[] = []

    let idx = index
    for (const node of nodes) {
      if (node === '*') {
        // Duplicate: sibling is same as current hash. Position depends on idx.
        // We skip this or treat it as a self-pair.
        // In practice this is rare (only when a block has odd number of TXs at some level)
        idx = idx >> 1
        continue
      }

      // If our index is even, sibling is on the right. If odd, sibling is on the left.
      const position: 'L' | 'R' = (idx % 2 === 0) ? 'R' : 'L'
      path.push({ hash: node, position })
      idx = idx >> 1
    }

    // Get the Merkle root from the block header
    const blockHash = data.target
    const headerResp = await fetch(`${WOC_BASE}/block/${blockHash}/header`)
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
