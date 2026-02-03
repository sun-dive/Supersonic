/**
 * Token persistence layer using localStorage.
 *
 * Stores OwnedToken metadata and ProofChain data separately,
 * keyed by token ID.
 */
import type { ProofChain } from './tokenProtocol'

// ─── Types ──────────────────────────────────────────────────────────

export type TokenStatus = 'active' | 'pending_transfer' | 'transferred'

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
  constructor(prefix = 'mpt:') { this.prefix = prefix }
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

export class TokenStore {
  constructor(private storage: StorageBackend) {}

  /** Store token and its proof chain separately but with matching keys for consistent lookups. */
  async addToken(token: OwnedToken, proofChain: ProofChain): Promise<void> {
    // Dual keys: 'token:' + tokenId and 'proof:' + tokenId keep metadata and proof in sync
    await this.storage.set(TOKEN_KEY + token.tokenId, JSON.stringify(token))
    await this.storage.set(PROOF_KEY + token.tokenId, JSON.stringify(proofChain))
  }

  async getToken(tokenId: string): Promise<OwnedToken | null> {
    const data = await this.storage.get(TOKEN_KEY + tokenId)
    if (!data) return null
    const token = JSON.parse(data)
    if (!token.status) token.status = 'active'
    return token
  }

  async getProofChain(tokenId: string): Promise<ProofChain | null> {
    const data = await this.storage.get(PROOF_KEY + tokenId)
    return data ? JSON.parse(data) : null
  }

  async updateToken(token: OwnedToken): Promise<void> {
    await this.storage.set(TOKEN_KEY + token.tokenId, JSON.stringify(token))
  }

  async removeToken(tokenId: string): Promise<void> {
    await this.storage.delete(TOKEN_KEY + tokenId)
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
}
