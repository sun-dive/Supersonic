/**
 * Token persistence layer using localStorage for metadata and IndexedDB for proof chains.
 *
 * Stores OwnedToken metadata in localStorage (small data).
 * Stores ProofChain data in IndexedDB (large data, avoids quota issues).
 */
import type { ProofChain } from './tokenProtocol'
import { ProofChainCache } from './fileCache'

// ─── Types ──────────────────────────────────────────────────────────

export type TokenStatus = 'active' | 'pending' | 'pending_transfer' | 'transferred' | 'flushed' | 'recovered'

export interface OwnedToken {
  tokenId: string
  genesisTxId: string
  genesisOutputIndex: number
  currentTxId: string
  currentOutputIndex: number
  tokenName: string
  tokenScript: string
  tokenRules: string
  tokenAttributes: string
  stateData: string
  satoshis: number
  status: TokenStatus
  createdAt?: string
  feePaid?: number
  transferTxId?: string
  // v05.23: Flush recovery tracking
  flushTxId?: string           // TX that spent this token UTXO as regular sats
  flushedAt?: string           // ISO timestamp when flushed
  recoveryBlockHeight?: number // Block height where flushed UTXO can be scanned
}

// ─── Fungible Token Types ────────────────────────────────────────────

/** A single UTXO in a fungible token basket */
export interface FungibleUtxo {
  txId: string
  outputIndex: number
  satoshis: number
  status: TokenStatus
  stateData?: string  // State data received with this UTXO (e.g. text message)
  receivedAt?: string // ISO timestamp when this UTXO was received
  // v05.23: Flush recovery tracking for fungible UTXOs
  flushTxId?: string  // TX that spent this UTXO as regular sats
  flushedAt?: string  // ISO timestamp when flushed
}

/** Fungible token with shared metadata and a basket of UTXOs */
export interface FungibleToken {
  tokenId: string
  genesisTxId: string
  tokenName: string
  tokenScript: string
  tokenRules: string
  tokenAttributes: string
  stateData: string
  utxos: FungibleUtxo[]      // The basket
  createdAt?: string
  feePaid?: number
}

// ─── Storage Backend ────────────────────────────────────────────────

export interface StorageBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

export class LocalStorageBackend implements StorageBackend {
  private prefix: string
  constructor(prefix = 'p:') { this.prefix = prefix }
  async get(key: string) { return localStorage.getItem(this.prefix + key) }
  async set(key: string, value: string) { localStorage.setItem(this.prefix + key, value) }
  async delete(key: string) { localStorage.removeItem(this.prefix + key) }
  async keys() {
    return Object.keys(localStorage)
      .filter(k => k.startsWith(this.prefix))
      .map(k => k.slice(this.prefix.length))
  }
}

// ─── Token Store ────────────────────────────────────────────────────

const TOKEN_KEY = 'token:'
const PROOF_KEY = 'proof:'
const FUNGIBLE_KEY = 'fungible:'

export class TokenStore {
  constructor(
    private storage: StorageBackend,
    private proofChainCache: ProofChainCache = new ProofChainCache()
  ) {}

  /** Store token metadata in localStorage and proof chain in IndexedDB. */
  async addToken(token: OwnedToken, proofChain: ProofChain): Promise<void> {
    // Token metadata stays in localStorage (small)
    await this.storage.set(TOKEN_KEY + token.tokenId, JSON.stringify(token))
    // Proof chain moves to IndexedDB (large, avoids quota issues)
    await this.proofChainCache.store(token.tokenId, JSON.stringify(proofChain))
  }

  async getToken(tokenId: string): Promise<OwnedToken | null> {
    const data = await this.storage.get(TOKEN_KEY + tokenId)
    if (!data) return null
    const token = JSON.parse(data)
    if (!token.status) token.status = 'active'
    return token
  }

  async getProofChain(tokenId: string): Promise<ProofChain | null> {
    // Try IndexedDB first (v05.25+), then localStorage (fallback for v05.24 data)
    let data = await this.proofChainCache.get(tokenId)
    if (!data) {
      // Fallback to localStorage for backwards compatibility
      data = await this.storage.get(PROOF_KEY + tokenId)
    }
    return data ? JSON.parse(data) : null
  }

  async updateToken(token: OwnedToken): Promise<void> {
    await this.storage.set(TOKEN_KEY + token.tokenId, JSON.stringify(token))
  }

  async removeToken(tokenId: string): Promise<void> {
    // Remove from both localStorage and IndexedDB
    await this.storage.delete(TOKEN_KEY + tokenId)
    await this.proofChainCache.delete(tokenId)
    // Also try to remove from old localStorage storage (backwards compat)
    await this.storage.delete(PROOF_KEY + tokenId)
  }

  async listTokens(): Promise<OwnedToken[]> {
    const allKeys = await this.storage.keys()
    const tokens: OwnedToken[] = []
    for (const key of allKeys) {
      if (key.startsWith(TOKEN_KEY)) {
        const data = await this.storage.get(key)
        if (data) {
          const token = JSON.parse(data)
          if (!token.status) token.status = 'active'
          tokens.push(token)
        }
      }
    }
    return tokens
  }

  async findToken(idOrTxId: string): Promise<OwnedToken | null> {
    const direct = await this.getToken(idOrTxId)
    if (direct) return direct
    const all = await this.listTokens()
    return all.find(t =>
      t.genesisTxId === idOrTxId || t.currentTxId === idOrTxId
    ) ?? null
  }

  // ─── Fungible Token Methods ──────────────────────────────────────

  async addFungibleToken(token: FungibleToken, proofChain: ProofChain): Promise<void> {
    // Fungible token metadata in localStorage, proof chain in IndexedDB
    await this.storage.set(FUNGIBLE_KEY + token.tokenId, JSON.stringify(token))
    await this.proofChainCache.store(token.tokenId, JSON.stringify(proofChain))
  }

  async getFungibleToken(tokenId: string): Promise<FungibleToken | null> {
    const data = await this.storage.get(FUNGIBLE_KEY + tokenId)
    return data ? JSON.parse(data) : null
  }

  async updateFungibleToken(token: FungibleToken): Promise<void> {
    await this.storage.set(FUNGIBLE_KEY + token.tokenId, JSON.stringify(token))
  }

  async listFungibleTokens(): Promise<FungibleToken[]> {
    const allKeys = await this.storage.keys()
    const tokens: FungibleToken[] = []
    for (const key of allKeys) {
      if (key.startsWith(FUNGIBLE_KEY)) {
        const data = await this.storage.get(key)
        if (data) tokens.push(JSON.parse(data))
      }
    }
    return tokens
  }

  /** Get total balance of a fungible token (sum of active UTXOs) */
  async getFungibleBalance(tokenId: string): Promise<number> {
    const token = await this.getFungibleToken(tokenId)
    if (!token) return 0
    return token.utxos
      .filter(u => u.status === 'active')
      .reduce((sum, u) => sum + u.satoshis, 0)
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
