/**
 * P2PKH + OP_RETURN token builder for the MPT prototype v02.
 *
 * Builds real BSV transactions using @bsv/sdk.
 * Token ownership is via P2PKH; metadata is in OP_RETURN.
 *
 * v02 changes:
 * - Tokens are NOT deleted on transfer; marked as 'pending_transfer'
 * - Bundle JSON is persisted in storage for recovery
 * - Explicit confirm/cancel for completing transfers
 */
import { Transaction, P2PKH, PublicKey } from '@bsv/sdk'
import { WocProvider, Utxo } from './wocProvider'
import { encodeOpReturn, TokenOpReturnData, encodeTokenRules } from './opReturnCodec'
import {
  computeTokenId,
  createProofChain,
  extendProofChain,
  MerkleProofEntry,
  ProofChain,
} from './cryptoCompat'

// ─── Types ──────────────────────────────────────────────────────────

export type TokenStatus = 'active' | 'pending_transfer' | 'transferred'

export interface OwnedToken {
  tokenId: string
  genesisTxId: string
  genesisOutputIndex: number
  currentTxId: string
  currentOutputIndex: number
  tokenName: string
  tokenRules: string
  tokenAttributes: string
  ownerPubKey: string
  stateData: string
  satoshis: number
  status: TokenStatus
  createdAt?: string           // ISO timestamp of genesis/transfer
  feePaid?: number             // fee in satoshis for the creating TX
  transferTxId?: string        // set when pending_transfer
  transferBundleJson?: string  // saved bundle for recovery
}

export interface TokenBundle {
  token: OwnedToken
  proofChain: ProofChain
}

export interface GenesisParams {
  tokenName: string
  attributes?: string // hex, optional
}

export interface GenesisResult {
  txId: string
  tokenId: string
}

export interface TransferResult {
  txId: string
  tokenId: string
  bundleJson: string
}

// ─── Storage ────────────────────────────────────────────────────────

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

// ─── Simple Token Store ─────────────────────────────────────────────

const TOKEN_KEY = 'token:'
const PROOF_KEY = 'proof:'

export class TokenStore {
  constructor(private storage: StorageBackend) {}

  async addToken(token: OwnedToken, proofChain: ProofChain): Promise<void> {
    await this.storage.set(TOKEN_KEY + token.tokenId, JSON.stringify(token))
    await this.storage.set(PROOF_KEY + token.tokenId, JSON.stringify(proofChain))
  }

  async getToken(tokenId: string): Promise<OwnedToken | null> {
    const data = await this.storage.get(TOKEN_KEY + tokenId)
    if (!data) return null
    const token = JSON.parse(data)
    // Migrate v01 tokens that lack a status field
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

  /**
   * Find a token by token ID, genesis TXID, or current TXID.
   * Falls back to scanning all tokens if direct lookup fails.
   */
  async findToken(idOrTxId: string): Promise<OwnedToken | null> {
    // Try direct token ID lookup first
    const direct = await this.getToken(idOrTxId)
    if (direct) return direct

    // Fall back to scanning by TXID fields
    const all = await this.listTokens()
    return all.find(t =>
      t.genesisTxId === idOrTxId || t.currentTxId === idOrTxId
    ) ?? null
  }
}

// ─── Token Builder ──────────────────────────────────────────────────

const TOKEN_SATS = 1

export class P2pkhTokenBuilder {
  feePerKb = DEFAULT_FEE_PER_KB

  constructor(
    private provider: WocProvider,
    private store: TokenStore
  ) {}

  /**
   * Create a genesis transaction minting a single NFT.
   *
   * TX structure:
   *   Input 0:  funding UTXO
   *   Output 0: P2PKH(owner) 1 sat     -- the token UTXO
   *   Output 1: OP_RETURN(metadata) 0 sat
   *   Output 2: P2PKH(change)
   */
  async createGenesis(params: GenesisParams): Promise<GenesisResult> {
    const key = this.provider.getPrivateKey()
    const address = this.provider.getAddress()
    const pubKeyHex = this.provider.getPublicKeyHex()

    // 1. Find funding UTXOs
    const utxos = await this.provider.getUtxos()
    if (utxos.length === 0) {
      throw new Error('No UTXOs. Fund your wallet address first.')
    }

    // 2. Build token metadata
    const tokenRulesHex = encodeTokenRules(1, 0, 0, 1) // supply=1, NFT, unrestricted, v1
    const attrsHex = params.attributes ?? '00'
    const opReturnData: TokenOpReturnData = {
      tokenName: params.tokenName,
      tokenRules: tokenRulesHex,
      tokenAttributes: attrsHex,
      ownerPubKey: pubKeyHex,
      stateData: '',
    }

    // 3. Try UTXO combinations (single, then multi) to cover fees
    const { tx, rawHex, txId, fee } = await this.buildFundedTx(
      utxos, key, address, (t) => {
        t.addOutput({
          lockingScript: new P2PKH().lock(address),
          satoshis: TOKEN_SATS,
        })
        t.addOutput({
          lockingScript: encodeOpReturn(opReturnData),
          satoshis: 0,
        })
      },
    )

    await this.provider.broadcast(rawHex)

    // 4. Compute Token ID and store
    const tokenId = computeTokenId(txId, 0)

    const ownedToken: OwnedToken = {
      tokenId,
      genesisTxId: txId,
      genesisOutputIndex: 0,
      currentTxId: txId,
      currentOutputIndex: 0,
      tokenName: params.tokenName,
      tokenRules: tokenRulesHex,
      tokenAttributes: attrsHex,
      ownerPubKey: pubKeyHex,
      stateData: '',
      satoshis: TOKEN_SATS,
      status: 'active',
      createdAt: new Date().toISOString(),
      feePaid: fee,
    }

    const emptyChain: ProofChain = { genesisTxId: txId, entries: [] }
    await this.store.addToken(ownedToken, emptyChain)

    return { txId, tokenId }
  }

  /**
   * Transfer a token to a new owner.
   *
   * TX structure:
   *   Input 0:  token UTXO (P2PKH spend)
   *   Input 1:  funding UTXO
   *   Output 0: P2PKH(newOwner) 1 sat
   *   Output 1: OP_RETURN(updated metadata) 0 sat
   *   Output 2: P2PKH(change to sender)
   *
   * The token is marked 'pending_transfer' (not deleted).
   * Call confirmTransfer() after the recipient has the bundle.
   */
  async createTransfer(tokenId: string, recipientPubKeyHex: string): Promise<TransferResult> {
    const key = this.provider.getPrivateKey()
    const myAddress = this.provider.getAddress()

    // 1. Load token (try token ID first, then fall back to TXID match)
    const token = await this.store.findToken(tokenId)
    if (!token) throw new Error(`Token not found: ${tokenId}`)
    if (token.status === 'pending_transfer') {
      throw new Error(`Token already has a pending transfer (TXID: ${token.transferTxId}). Confirm or cancel it first.`)
    }
    if (token.status === 'transferred') {
      throw new Error('Token has already been transferred.')
    }

    // Use the actual token ID for proof chain lookup
    const actualTokenId = token.tokenId
    const proofChain = await this.store.getProofChain(actualTokenId)

    // 2. Fetch token source TX and funding candidates
    const tokenSourceTx = await this.provider.getSourceTransaction(token.currentTxId)

    const utxos = await this.provider.getUtxos()
    const fundingCandidates = utxos.filter(
      u => !(u.txId === token.currentTxId && u.outputIndex === token.currentOutputIndex)
    )
    if (fundingCandidates.length === 0) {
      throw new Error('No funding UTXOs available (separate from token UTXO)')
    }

    // 3. Derive recipient address
    const recipientPubKey = PublicKey.fromString(recipientPubKeyHex)
    const recipientAddress = recipientPubKey.toAddress()

    // 4. Build TX with multi-UTXO funding (tries 1, then 2, then 3 UTXOs)
    const { rawHex, txId, fee } = await this.buildFundedTransferTx(
      tokenSourceTx, token.currentOutputIndex,
      fundingCandidates, key, myAddress, (tx) => {
        tx.addOutput({
          lockingScript: new P2PKH().lock(recipientAddress),
          satoshis: TOKEN_SATS,
        })
        tx.addOutput({
          lockingScript: encodeOpReturn({
            tokenName: token.tokenName,
            tokenRules: token.tokenRules,
            tokenAttributes: token.tokenAttributes,
            ownerPubKey: recipientPubKeyHex,
            stateData: token.stateData,
          }),
          satoshis: 0,
        })
      },
    )

    await this.provider.broadcast(rawHex)

    // Build bundle for recipient
    const recipientToken: OwnedToken = {
      ...token,
      currentTxId: txId,
      currentOutputIndex: 0,
      ownerPubKey: recipientPubKeyHex,
      status: 'active',
      createdAt: new Date().toISOString(),
      feePaid: fee,
      transferTxId: undefined,
      transferBundleJson: undefined,
    }
    const bundle: TokenBundle = {
      token: recipientToken,
      proofChain: proofChain ?? { genesisTxId: token.genesisTxId, entries: [] },
    }
    const bundleJson = JSON.stringify(bundle, null, 2)

    // Mark as pending_transfer with bundle saved
    token.status = 'pending_transfer'
    token.transferTxId = txId
    token.transferBundleJson = bundleJson
    await this.store.updateToken(token)

    return { txId, tokenId: actualTokenId, bundleJson }
  }

  /**
   * Confirm a pending transfer -- marks token as transferred.
   * Call this after the recipient has the bundle.
   */
  async confirmTransfer(tokenId: string): Promise<void> {
    const token = await this.store.getToken(tokenId)
    if (!token) throw new Error(`Token not found: ${tokenId}`)
    if (token.status !== 'pending_transfer') {
      throw new Error('Token is not in pending_transfer state')
    }
    token.status = 'transferred'
    await this.store.updateToken(token)
  }

  /**
   * Get the saved bundle JSON for a pending transfer.
   */
  async getTransferBundle(tokenId: string): Promise<string | null> {
    const token = await this.store.getToken(tokenId)
    if (!token) return null
    return token.transferBundleJson ?? null
  }

  /**
   * Import a token bundle received from a peer.
   * Validates the token ID matches the genesis TXID.
   */
  async importBundle(bundleJson: string): Promise<OwnedToken> {
    const bundle: TokenBundle = JSON.parse(bundleJson)
    const { token, proofChain } = bundle

    // Verify token ID
    const expectedId = computeTokenId(token.genesisTxId, token.genesisOutputIndex)
    if (expectedId !== token.tokenId) {
      throw new Error(`Token ID mismatch: expected ${expectedId}, got ${token.tokenId}`)
    }

    // Ensure imported token is marked active
    token.status = 'active'
    token.transferTxId = undefined
    token.transferBundleJson = undefined

    await this.store.addToken(token, proofChain)
    return token
  }

  /**
   * Poll for Merkle proof and update the stored proof chain.
   * Returns true once proof is found, false if max attempts exhausted.
   */
  async pollForProof(
    tokenId: string,
    txId: string,
    onStatus?: (msg: string) => void,
    maxAttempts = 60,
    intervalMs = 15000
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      onStatus?.(`Waiting for confirmation... (attempt ${i + 1}/${maxAttempts})`)

      try {
        const proof = await this.provider.getMerkleProof(txId)
        if (!proof) throw new Error('not yet')

        // Update proof chain
        const existing = await this.store.getProofChain(tokenId)
        const token = await this.store.getToken(tokenId)
        if (!token) return false

        let chain: ProofChain
        if (!existing || existing.entries.length === 0) {
          chain = createProofChain(txId, proof)
        } else {
          chain = extendProofChain(existing, proof)
        }

        await this.store.addToken(token, chain)
        onStatus?.('Proof chain updated!')
        return true
      } catch {
        await new Promise(r => setTimeout(r, intervalMs))
      }
    }

    onStatus?.('Timed out waiting for confirmation.')
    return false
  }

  /**
   * Build a funded transaction, trying single UTXOs first, then combining
   * 2 or 3 UTXOs. Only throws if total wallet balance is insufficient.
   */
  private async buildFundedTx(
    utxos: Utxo[],
    key: ReturnType<WocProvider['getPrivateKey']>,
    changeAddress: string,
    addOutputs: (tx: Transaction) => void,
  ): Promise<{ tx: Transaction; rawHex: string; txId: string; fee: number }> {
    const sorted = [...utxos].sort((a, b) => a.satoshis - b.satoshis)

    // Generate UTXO combinations: singles first, then pairs, then triples
    const combos: Utxo[][] = []
    for (const u of sorted) combos.push([u])
    if (sorted.length >= 2) {
      for (let i = 0; i < sorted.length; i++)
        for (let j = i + 1; j < sorted.length; j++)
          combos.push([sorted[i], sorted[j]])
    }
    if (sorted.length >= 3) {
      for (let i = 0; i < sorted.length; i++)
        for (let j = i + 1; j < sorted.length; j++)
          for (let k = j + 1; k < sorted.length; k++)
            combos.push([sorted[i], sorted[j], sorted[k]])
    }

    // Sort combos by total sats ascending so we try cheapest first
    combos.sort((a, b) =>
      a.reduce((s, u) => s + u.satoshis, 0) - b.reduce((s, u) => s + u.satoshis, 0)
    )

    let lastError = ''
    for (const combo of combos) {
      const tx = new Transaction()

      // Add funding inputs
      for (const u of combo) {
        const sourceTx = await this.provider.getSourceTransaction(u.txId)
        tx.addInput({
          sourceTransaction: sourceTx,
          sourceOutputIndex: u.outputIndex,
          unlockingScriptTemplate: new P2PKH().unlock(key),
        })
      }

      // Add protocol outputs
      addOutputs(tx)

      // Compute fee manually from estimated TX size
      const fee = estimateFee(combo.length, tx.outputs.length + 1, tx.outputs, this.feePerKb)
      const totalIn = combo.reduce((s, u) => s + u.satoshis, 0)
      const protocolOut = tx.outputs.reduce((s, o) => s + (o.satoshis ?? 0), 0)
      const changeAmount = totalIn - protocolOut - fee

      if (changeAmount < 0) {
        lastError = `${combo.length} UTXO(s) totalling ${totalIn} sats too small for fees (need ${fee} sats)`
        continue
      }

      // Add change output with explicit satoshis
      tx.addOutput({
        lockingScript: new P2PKH().lock(changeAddress),
        satoshis: changeAmount,
      })

      await tx.sign()

      return {
        tx,
        rawHex: tx.toHex(),
        txId: tx.id('hex') as string,
        fee,
      }
    }

    const totalBalance = utxos.reduce((s, u) => s + u.satoshis, 0)
    throw new Error(
      `Insufficient balance (${totalBalance} sats) to cover transaction fees. ${lastError}`
    )
  }

  /**
   * Build a funded transfer transaction. The token UTXO is always input 0;
   * funding UTXOs are added after it, trying single then multi-UTXO combos.
   */
  private async buildFundedTransferTx(
    tokenSourceTx: Transaction,
    tokenOutputIndex: number,
    fundingUtxos: Utxo[],
    key: ReturnType<WocProvider['getPrivateKey']>,
    changeAddress: string,
    addOutputs: (tx: Transaction) => void,
  ): Promise<{ tx: Transaction; rawHex: string; txId: string; fee: number }> {
    const sorted = [...fundingUtxos].sort((a, b) => a.satoshis - b.satoshis)

    // Generate funding UTXO combinations: singles, pairs, triples
    const combos: Utxo[][] = []
    for (const u of sorted) combos.push([u])
    if (sorted.length >= 2) {
      for (let i = 0; i < sorted.length; i++)
        for (let j = i + 1; j < sorted.length; j++)
          combos.push([sorted[i], sorted[j]])
    }
    if (sorted.length >= 3) {
      for (let i = 0; i < sorted.length; i++)
        for (let j = i + 1; j < sorted.length; j++)
          for (let k = j + 1; k < sorted.length; k++)
            combos.push([sorted[i], sorted[j], sorted[k]])
    }

    combos.sort((a, b) =>
      a.reduce((s, u) => s + u.satoshis, 0) - b.reduce((s, u) => s + u.satoshis, 0)
    )

    let lastError = ''
    for (const combo of combos) {
      const tx = new Transaction()

      // Input 0: token UTXO
      tx.addInput({
        sourceTransaction: tokenSourceTx,
        sourceOutputIndex: tokenOutputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(key),
      })

      // Inputs 1+: funding UTXOs
      for (const u of combo) {
        const sourceTx = await this.provider.getSourceTransaction(u.txId)
        tx.addInput({
          sourceTransaction: sourceTx,
          sourceOutputIndex: u.outputIndex,
          unlockingScriptTemplate: new P2PKH().unlock(key),
        })
      }

      // Protocol outputs
      addOutputs(tx)

      // Compute fee manually (token input + funding inputs)
      const numInputs = 1 + combo.length
      const fee = estimateFee(numInputs, tx.outputs.length + 1, tx.outputs, this.feePerKb)
      const totalIn = TOKEN_SATS + combo.reduce((s, u) => s + u.satoshis, 0)
      const protocolOut = tx.outputs.reduce((s, o) => s + (o.satoshis ?? 0), 0)
      const changeAmount = totalIn - protocolOut - fee

      if (changeAmount < 0) {
        const fundingSats = combo.reduce((s, u) => s + u.satoshis, 0)
        lastError = `${combo.length} funding UTXO(s) totalling ${fundingSats} sats too small for fees (need ${fee} sats)`
        continue
      }

      // Add change output with explicit satoshis
      tx.addOutput({
        lockingScript: new P2PKH().lock(changeAddress),
        satoshis: changeAmount,
      })

      await tx.sign()

      return {
        tx,
        rawHex: tx.toHex(),
        txId: tx.id('hex') as string,
        fee,
      }
    }

    const totalFunding = fundingUtxos.reduce((s, u) => s + u.satoshis, 0)
    throw new Error(
      `Insufficient funding balance (${totalFunding} sats) to cover transfer fees. ${lastError}`
    )
  }

  /**
   * Verify a token's proof chain against block headers.
   */
  async verifyToken(tokenId: string): Promise<{ valid: boolean; reason: string }> {
    const token = await this.store.getToken(tokenId)
    if (!token) return { valid: false, reason: 'Token not found' }

    const chain = await this.store.getProofChain(tokenId)
    if (!chain || chain.entries.length === 0) {
      return { valid: false, reason: 'No proof chain (TX may not be confirmed yet)' }
    }

    // Verify token ID
    const expectedId = computeTokenId(token.genesisTxId, token.genesisOutputIndex)
    if (expectedId !== token.tokenId) {
      return { valid: false, reason: 'Token ID does not match genesis' }
    }

    // Verify proof chain
    const { verifyProofChainAsync } = await import('./cryptoCompat')
    const isValid = await verifyProofChainAsync(chain, async (height) => {
      return this.provider.getBlockHeader(height)
    })

    if (!isValid) {
      return { valid: false, reason: 'Proof chain verification failed' }
    }

    return { valid: true, reason: 'Token is valid with verified proof chain' }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Default fee rate in satoshis per kilobyte. */
const DEFAULT_FEE_PER_KB = 150

/** Estimated bytes per P2PKH input (with signature). */
const BYTES_PER_INPUT = 148
/** Bytes per P2PKH output (value + script). */
const BYTES_PER_P2PKH_OUTPUT = 34
/** Base transaction overhead (version + locktime + varint). */
const TX_OVERHEAD = 10

/**
 * Estimate the transaction fee from input/output counts and actual output scripts.
 * Uses actual script lengths for non-change outputs and standard P2PKH size for the change output.
 */
function estimateFee(
  numInputs: number,
  numOutputs: number,
  existingOutputs: { lockingScript?: { toBinary(): number[] }; satoshis?: number }[],
  feePerKb: number,
): number {
  let size = TX_OVERHEAD + numInputs * BYTES_PER_INPUT

  // Use actual script lengths for existing outputs
  for (const o of existingOutputs) {
    const scriptLen = o.lockingScript?.toBinary()?.length ?? 25
    size += 8 + 1 + scriptLen // 8 bytes value + 1 byte varint + script
  }

  // Add standard P2PKH size for the change output
  size += BYTES_PER_P2PKH_OUTPUT

  return Math.ceil(size * feePerKb / 1000)
}
