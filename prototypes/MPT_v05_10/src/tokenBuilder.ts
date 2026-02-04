/**
 * Token lifecycle manager -- mint, transfer, verify, detect incoming.
 *
 * This module uses:
 *   - walletProvider.ts for all network operations (UTXOs, broadcast, etc.)
 *   - tokenProtocol.ts for all verification (pure SPV, no network)
 *   - tokenStore.ts for persistence
 *   - opReturnCodec.ts for OP_RETURN encoding/decoding
 *
 * Architecture:
 *   Wallet layer (this file + walletProvider) depends on token protocol.
 *   Token protocol NEVER depends on wallet layer.
 */
import { PrivateKey, Transaction, P2PKH, LockingScript, Hash } from '@bsv/sdk'
import { WalletProvider, Utxo } from './walletProvider'
import { TokenStore, OwnedToken, FungibleToken } from './tokenStore'
import {
  computeTokenId,
  computeFungibleTokenId,
  createProofChain,
  extendProofChain,
  verifyMerkleProof,
  verifyProofChainAsync,
  MerkleProofEntry,
  ProofChain,
  VerificationResult,
} from './tokenProtocol'
import {
  encodeOpReturn,
  decodeOpReturn,
  TokenOpReturnData,
  encodeTokenRules,
  buildImmutableChunkBytes,
  buildFileOpReturn,
  parseFileOpReturn,
  FileOpReturnData,
  RESTRICTION_FUNGIBLE,
} from './opReturnCodec'

// ─── Types ──────────────────────────────────────────────────────────

export interface GenesisParams {
  tokenName: string
  tokenScript?: string     // hex, consensus script (default '' = P2PKH)
  attributes?: string      // hex (default '00')
  supply?: number          // default 1
  divisibility?: number    // default 0
  restrictions?: number    // default 0
  rulesVersion?: number    // default 1
  stateData?: string       // hex (default '')
  fileData?: {             // optional file to embed in genesis TX
    bytes: Uint8Array
    mimeType: string
    fileName: string
  }
}

export interface GenesisResult {
  txId: string
  tokenIds: string[]
}

export interface TransferResult {
  txId: string
  tokenId: string
}

export interface FungibleGenesisParams {
  tokenName: string
  tokenScript?: string     // hex, consensus script (default '' = P2PKH)
  attributes?: string      // hex (default '00')
  initialSupply: number    // satoshis to mint as initial supply
  restrictions?: number    // default includes RESTRICTION_FUNGIBLE
  rulesVersion?: number    // default 1
  stateData?: string       // hex (default '')
}

export interface FungibleGenesisResult {
  txId: string
  tokenId: string
  initialSupply: number
}

export interface FungibleTransferResult {
  txId: string
  tokenId: string
  amountSent: number
  change: number
}

// ─── Constants ──────────────────────────────────────────────────────

const TOKEN_SATS = 1
const DEFAULT_FEE_PER_KB = 150
const BYTES_PER_INPUT = 148
const BYTES_PER_P2PKH_OUTPUT = 34
const TX_OVERHEAD = 10

// ─── Token Builder ──────────────────────────────────────────────────

export class TokenBuilder {
  feePerKb = DEFAULT_FEE_PER_KB
  private key: PrivateKey
  private myAddress: string

  constructor(
    private provider: WalletProvider,
    private store: TokenStore,
    key: PrivateKey,
  ) {
    this.key = key
    this.myAddress = key.toAddress()
  }

  // ── Token UTXO Protection ───────────────────────────────────────

  /**
   * Build a set of "txId:outputIndex" keys for UTXOs currently holding
   * active or pending tokens. These must never be used as funding inputs.
   */
  private async getTokenUtxoKeys(): Promise<Set<string>> {
    const tokens = await this.store.listTokens()
    const keys = new Set<string>()
    for (const t of tokens) {
      if (t.status === 'active' || t.status === 'pending_transfer') {
        keys.add(`${t.currentTxId}:${t.currentOutputIndex}`)
      }
    }
    return keys
  }

  /**
   * Return only UTXOs that are safe to spend as funding inputs.
   *
   * ALL 1-sat UTXOs are permanently quarantined -- never spent as
   * funding inputs. A 1-sat UTXO is almost certainly a token of
   * some kind (MPT, Ordinal, 1Sat Ordinals, etc.) and destroying
   * it by using it as a funding input is irreversible.
   *
   * The only code path that spends a 1-sat UTXO is createTransfer(),
   * which explicitly spends it as Input 0 when the user chooses to
   * transfer a specific known token.
   *
   * For any quarantined 1-sat UTXOs that contain MPT OP_RETURN data
   * addressed to this wallet, we auto-import them into the token store.
   */
  private async getSafeUtxos(): Promise<Utxo[]> {
    const utxos = await this.provider.getUtxos()
    const safe: Utxo[] = []

    for (const u of utxos) {
      if (u.satoshis <= TOKEN_SATS) {
        // Quarantined: attempt MPT auto-import in background, but
        // never allow spending regardless of result
        this.tryAutoImport(u).catch(() => {})
        continue
      }

      safe.push(u)
    }

    return safe
  }

  /**
   * SPV verification gate for token import.
   *
   * Checks Token ID derivation, then verifies the genesis TX's Merkle
   * proof against its block header. Only the genesis entry is checked —
   * transfer TXs are already validated by miners when spent.
   *
   * If no proof chain entries are available (e.g. genesis TX with no
   * on-chain bundle), fetches the Merkle proof for currentTxId on demand.
   */
  private async verifyBeforeImport(
    tokenId: string,
    genesisTxId: string,
    genesisOutputIndex: number,
    immutableBytes: number[],
    proofChainEntries: MerkleProofEntry[],
    currentTxId: string,
  ): Promise<{ valid: boolean; chain: ProofChain; reason?: string }> {
    // 1. Verify Token ID derivation
    const expectedId = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes)
    if (expectedId !== tokenId) {
      return { valid: false, chain: { genesisTxId, entries: [] }, reason: 'Token ID does not match genesis' }
    }

    // 2. Build proof chain; fetch Merkle proof on demand if entries are empty
    let entries = proofChainEntries
    if (entries.length === 0) {
      try {
        const proof = await this.provider.getMerkleProof(currentTxId)
        if (proof) {
          entries = [proof]
        }
      } catch (e) {
        // TX likely unconfirmed — no Merkle proof available
      }
    }

    const chain: ProofChain = { genesisTxId, entries }

    if (entries.length === 0) {
      return { valid: false, chain, reason: 'No proof chain (TX may not be confirmed yet)' }
    }

    // 3. Find the genesis entry (oldest = last in chain, entries are newest-first)
    const genesisEntry = entries[entries.length - 1]
    if (genesisEntry.txId !== genesisTxId) {
      return { valid: false, chain, reason: 'Oldest proof entry does not match genesis TX' }
    }

    // 4. Verify genesis entry's Merkle proof (pure crypto)
    if (!verifyMerkleProof(genesisEntry)) {
      return { valid: false, chain, reason: `Merkle proof invalid for genesis TX ${genesisTxId.slice(0, 12)}...` }
    }

    // 5. Fetch block header and confirm Merkle root matches
    try {
      const header = await this.provider.getBlockHeader(genesisEntry.blockHeight)
      if (header.merkleRoot !== genesisEntry.merkleRoot) {
        return { valid: false, chain, reason: `Merkle root mismatch at height ${genesisEntry.blockHeight}` }
      }
    } catch (e: any) {
      const detail = e?.message ? `: ${e.message}` : ''
      return { valid: false, chain, reason: `Failed to fetch block header at height ${genesisEntry.blockHeight}${detail}` }
    }

    return { valid: true, chain }
  }

  /**
   * Check if a quarantined UTXO is an incoming MPT token and
   * auto-import it into the store if so. Fire-and-forget.
   */
  private async tryAutoImport(u: Utxo): Promise<void> {
    const utxoKey = `${u.txId}:${u.outputIndex}`
    const tokenKeys = await this.getTokenUtxoKeys()
    if (tokenKeys.has(utxoKey)) return // already known

    const tx = await this.provider.getSourceTransaction(u.txId)

    // Find the MPT OP_RETURN output and check for a P2PKH output paying to us
    let opData: TokenOpReturnData | null = null
    let opReturnIndex = -1
    let hasP2pkhToUs = false
    let p2pkhOutputIndex = -1

    for (let i = 0; i < tx.outputs.length; i++) {
      const output = tx.outputs[i]
      if (!output.lockingScript) continue

      const decoded = decodeOpReturn(output.lockingScript as LockingScript)
      if (decoded) {
        opData = decoded
        opReturnIndex = i
        continue
      }

      // Check if this is a P2PKH output paying to our address
      if (output.satoshis === TOKEN_SATS) {
        const scriptHex = output.lockingScript.toHex()
        if (isP2pkhToAddress(scriptHex, this.myAddress)) {
          hasP2pkhToUs = true
          p2pkhOutputIndex = i
        }
      }
    }

    if (!opData || !hasP2pkhToUs) return

    // Determine genesis info
    const isTransfer = opData.genesisTxId != null
    const genesisTxId = opData.genesisTxId ?? u.txId
    // Genesis TX: P2PKH output indices define fragment positions (1-indexed from genesis TX)
    // Transfer TX: genesisOutputIndex MUST be extracted from OP_RETURN (via opData)
    // to preserve which fragment this is (cannot derive from p2pkhOutputIndex, which is always 0)
    const genesisOutputIndex = isTransfer ? (opData.genesisOutputIndex ?? 1) : p2pkhOutputIndex

    const immutableBytes = buildImmutableChunkBytes(
      opData.tokenName,
      opData.tokenScript,
      opData.tokenRules,
    )
    const tid = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes)
    const existing = await this.store.getToken(tid)
    if (existing) return

    // SPV verification: check genesis TX Merkle proof + block header
    const verification = await this.verifyBeforeImport(
      tid, genesisTxId, genesisOutputIndex, immutableBytes,
      opData.proofChainEntries ?? [], u.txId,
    )
    if (!verification.valid) {
      console.debug(`tryAutoImport: rejected "${opData.tokenName}" from ${u.txId.slice(0, 12)}... — ${verification.reason}`)
      return
    }

    const token: OwnedToken = {
      tokenId: tid,
      genesisTxId: genesisTxId,
      genesisOutputIndex: genesisOutputIndex,
      currentTxId: u.txId,
      currentOutputIndex: p2pkhOutputIndex,
      tokenName: opData.tokenName,
      tokenScript: opData.tokenScript,
      tokenRules: opData.tokenRules,
      tokenAttributes: opData.tokenAttributes,
      stateData: opData.stateData,
      satoshis: TOKEN_SATS,
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    await this.store.addToken(token, verification.chain)
    console.debug(`tryAutoImport: imported "${opData.tokenName}" from ${u.txId.slice(0, 12)}... (verified)`)
  }

  // ── Mint ────────────────────────────────────────────────────────

  async createGenesis(params: GenesisParams): Promise<GenesisResult> {
    const address = this.myAddress

    const utxos = await this.getSafeUtxos()
    if (utxos.length === 0) {
      throw new Error('No spendable UTXOs (token UTXOs are protected). Fund your wallet address first.')
    }

    const tokenScriptHex = params.tokenScript ?? ''
    const tokenRulesHex = encodeTokenRules(
      params.supply ?? 1,
      params.divisibility ?? 0,
      params.restrictions ?? 0,
      params.rulesVersion ?? 1,
    )
    let attrsHex: string
    let fileOpReturn: LockingScript | null = null

    if (params.fileData) {
      const hashBytes = Hash.sha256(Array.from(params.fileData.bytes))
      attrsHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      fileOpReturn = buildFileOpReturn({
        mimeType: params.fileData.mimeType,
        fileName: params.fileData.fileName,
        bytes: params.fileData.bytes,
      })
    } else {
      attrsHex = params.attributes ?? '00'
    }

    const stateData = params.stateData ?? ''
    const opReturnData: TokenOpReturnData = {
      tokenName: params.tokenName,
      tokenScript: tokenScriptHex,
      tokenRules: tokenRulesHex,
      tokenAttributes: attrsHex,
      stateData,
    }

    const supply = params.supply ?? 1
    const divisibility = params.divisibility ?? 0
    // Fragment distribution in genesis TX outputs:
    // - supply=4, divisibility=2: 8 P2PKH outputs (4 tokens × 2 fragments each)
    // - supply=4, divisibility=0: 4 P2PKH outputs (4 indivisible tokens, one per output)
    const totalOutputs = divisibility > 0 ? supply * divisibility : supply

    const { rawHex, txId, fee } = await this.buildFundedTx(
      utxos, address, (t) => {
        // Output 0 = OP_RETURN (shared metadata)
        t.addOutput({
          lockingScript: encodeOpReturn(opReturnData),
          satoshis: 0,
        })
        // Outputs 1..N = P2PKH (one per token/fragment)
        for (let i = 0; i < totalOutputs; i++) {
          t.addOutput({
            lockingScript: new P2PKH().lock(address),
            satoshis: TOKEN_SATS,
          })
        }
        // Optional: file data OP_RETURN (genesis only)
        if (fileOpReturn) {
          t.addOutput({
            lockingScript: fileOpReturn,
            satoshis: 0,
          })
        }
      },
    )

    await this.provider.broadcast(rawHex)

    const immutableBytes = buildImmutableChunkBytes(
      params.tokenName,
      tokenScriptHex,
      tokenRulesHex,
    )

    const tokenIds: string[] = []
    const createdAt = new Date().toISOString()
    const emptyChain: ProofChain = { genesisTxId: txId, entries: [] }

    for (let i = 1; i <= totalOutputs; i++) {
      const tokenId = computeTokenId(txId, i, immutableBytes)
      tokenIds.push(tokenId)

      const ownedToken: OwnedToken = {
        tokenId,
        genesisTxId: txId,
        genesisOutputIndex: i,
        currentTxId: txId,
        currentOutputIndex: i,
        tokenName: params.tokenName,
        tokenScript: tokenScriptHex,
        tokenRules: tokenRulesHex,
        tokenAttributes: attrsHex,
        stateData,
        satoshis: TOKEN_SATS,
        status: 'active',
        createdAt,
        feePaid: i === 1 ? fee : undefined,
      }

      await this.store.addToken(ownedToken, emptyChain)
    }

    return { txId, tokenIds }
  }

  // ── Fungible Mint ─────────────────────────────────────────────────

  async createFungibleGenesis(params: FungibleGenesisParams): Promise<FungibleGenesisResult> {
    const address = this.myAddress

    const utxos = await this.getSafeUtxos()
    if (utxos.length === 0) {
      throw new Error('No spendable UTXOs. Fund your wallet address first.')
    }

    if (params.initialSupply < 1) {
      throw new Error('Initial supply must be at least 1 satoshi.')
    }

    const tokenScriptHex = params.tokenScript ?? ''
    // Fungible tokens: supply=1, divisibility=0, restrictions includes FUNGIBLE flag
    const restrictions = (params.restrictions ?? 0) | RESTRICTION_FUNGIBLE
    const tokenRulesHex = encodeTokenRules(
      1,  // supply = 1 (single token type)
      0,  // divisibility = 0
      restrictions,
      params.rulesVersion ?? 1,
    )
    const attrsHex = params.attributes ?? '00'
    const stateData = params.stateData ?? ''

    const opReturnData: TokenOpReturnData = {
      tokenName: params.tokenName,
      tokenScript: tokenScriptHex,
      tokenRules: tokenRulesHex,
      tokenAttributes: attrsHex,
      stateData,
    }

    const { rawHex, txId, fee } = await this.buildFundedTx(
      utxos, address, (t) => {
        // Output 0 = OP_RETURN (shared metadata)
        t.addOutput({
          lockingScript: encodeOpReturn(opReturnData),
          satoshis: 0,
        })
        // Output 1 = P2PKH with initial supply (satoshis = token amount)
        t.addOutput({
          lockingScript: new P2PKH().lock(address),
          satoshis: params.initialSupply,
        })
      },
    )

    await this.provider.broadcast(rawHex)

    const immutableBytes = buildImmutableChunkBytes(
      params.tokenName,
      tokenScriptHex,
      tokenRulesHex,
    )
    const tokenId = computeFungibleTokenId(txId, immutableBytes)

    const fungibleToken: FungibleToken = {
      tokenId,
      genesisTxId: txId,
      tokenName: params.tokenName,
      tokenScript: tokenScriptHex,
      tokenRules: tokenRulesHex,
      tokenAttributes: attrsHex,
      stateData,
      utxos: [{
        txId,
        outputIndex: 1,
        satoshis: params.initialSupply,
        status: 'active',
      }],
      createdAt: new Date().toISOString(),
      feePaid: fee,
    }

    const emptyChain: ProofChain = { genesisTxId: txId, entries: [] }
    await this.store.addFungibleToken(fungibleToken, emptyChain)

    return { txId, tokenId, initialSupply: params.initialSupply }
  }

  // ── Fungible Transfer ─────────────────────────────────────────────

  /**
   * Transfer fungible tokens to a recipient.
   *
   * Spends one or more UTXOs from the basket, creates output to recipient,
   * and returns change to sender (like a standard Bitcoin transaction).
   */
  async transferFungible(
    tokenId: string,
    recipientAddress: string,
    amount: number,
  ): Promise<FungibleTransferResult> {
    const token = await this.store.getFungibleToken(tokenId)
    if (!token) throw new Error(`Fungible token not found: ${tokenId}`)

    // Get active UTXOs sorted by satoshis (smallest first for efficient selection)
    const activeUtxos = token.utxos
      .filter(u => u.status === 'active')
      .sort((a, b) => a.satoshis - b.satoshis)

    const totalAvailable = activeUtxos.reduce((sum, u) => sum + u.satoshis, 0)
    if (amount > totalAvailable) {
      throw new Error(`Insufficient balance: have ${totalAvailable}, need ${amount}`)
    }
    if (amount < 1) {
      throw new Error('Amount must be at least 1 satoshi')
    }

    // Select UTXOs to spend (greedy: smallest first until we have enough)
    const toSpend: typeof activeUtxos = []
    let selectedTotal = 0
    for (const utxo of activeUtxos) {
      toSpend.push(utxo)
      selectedTotal += utxo.satoshis
      if (selectedTotal >= amount) break
    }

    const change = selectedTotal - amount

    // Fetch funding UTXOs for miner fee
    const fundingUtxos = await this.getSafeUtxos()
    if (fundingUtxos.length === 0) {
      throw new Error('No funding UTXOs available for fees')
    }

    // Fetch source transactions for token UTXOs
    const tokenSourceTxs: { tx: Transaction; outputIndex: number }[] = []
    for (const utxo of toSpend) {
      const tx = await this.provider.getSourceTransaction(utxo.txId)
      tokenSourceTxs.push({ tx, outputIndex: utxo.outputIndex })
    }

    // Get proof chain for OP_RETURN
    const proofChain = await this.store.getProofChain(tokenId)

    const opReturnData: TokenOpReturnData = {
      tokenName: token.tokenName,
      tokenScript: token.tokenScript,
      tokenRules: token.tokenRules,
      tokenAttributes: token.tokenAttributes,
      stateData: token.stateData,
      genesisTxId: token.genesisTxId,
      proofChainEntries: proofChain?.entries ?? [],
      genesisOutputIndex: 1,  // Fixed for fungible tokens
    }

    const { rawHex, txId, fee } = await this.buildFundedFungibleTransferTx(
      tokenSourceTxs,
      fundingUtxos,
      this.myAddress,
      recipientAddress,
      amount,
      change,
      opReturnData,
    )

    await this.provider.broadcast(rawHex)

    // Update basket: mark spent UTXOs, add change output if any
    for (const utxo of toSpend) {
      utxo.status = 'transferred'
    }

    // Add change output to basket (Output 0 = recipient, Output 1 = OP_RETURN, Output 2 = token change, Output 3 = fee change)
    if (change > 0) {
      token.utxos.push({
        txId,
        outputIndex: 2,
        satoshis: change,
        status: 'active',
      })
    }

    await this.store.updateFungibleToken(token)

    return { txId, tokenId, amountSent: amount, change }
  }

  // ── Transfer ──────────────────────────────────────────────────

  async createTransfer(tokenId: string, recipientAddress: string): Promise<TransferResult> {
    const token = await this.store.getToken(tokenId)
    console.debug(`createTransfer DEBUG: tokenId=${tokenId.slice(0,12)}, genesisTxId=${token?.genesisTxId?.slice(0,12)}, genesisOutputIndex=${token?.genesisOutputIndex}`)
    if (!token) throw new Error(`Token not found: ${tokenId}. Make sure you are using the Token ID (not a TXID).`)
    if (token.status === 'pending_transfer') {
      throw new Error(`Token already has a pending transfer (TXID: ${token.transferTxId}). Confirm or cancel it first.`)
    }
    if (token.status === 'transferred') {
      throw new Error('Token has already been transferred.')
    }

    const actualTokenId = token.tokenId
    const proofChain = await this.store.getProofChain(actualTokenId)
    const tokenSourceTx = await this.provider.getSourceTransaction(token.currentTxId)

    const fundingCandidates = await this.getSafeUtxos()
    if (fundingCandidates.length === 0) {
      throw new Error('No funding UTXOs available (token UTXOs are protected)')
    }

    const { rawHex, txId, fee } = await this.buildFundedTransferTx(
      tokenSourceTx, token.currentOutputIndex,
      fundingCandidates, this.myAddress, (tx) => {
        // Transfer TX structure: Output 0 = P2PKH (recipient), Output 1 = OP_RETURN
        tx.addOutput({
          lockingScript: new P2PKH().lock(recipientAddress),
          satoshis: TOKEN_SATS,
        })
        const opReturnScript = encodeOpReturn({
          tokenName: token.tokenName,
          tokenScript: token.tokenScript,
          tokenRules: token.tokenRules,
          tokenAttributes: token.tokenAttributes,
          stateData: token.stateData,
          genesisTxId: token.genesisTxId,
          proofChainEntries: (proofChain ?? { genesisTxId: token.genesisTxId, entries: [] }).entries,
          genesisOutputIndex: token.genesisOutputIndex,
        })
        console.debug(`buildFundedTransferTx: OP_RETURN script encoded, binary length=${opReturnScript.toBinary().length}, hex=${opReturnScript.toHex().substring(0, 100)}...`)

        tx.addOutput({
          lockingScript: opReturnScript,
          satoshis: 0,
        })
      },
    )

    await this.provider.broadcast(rawHex)

    token.status = 'pending_transfer'
    token.transferTxId = txId
    await this.store.updateToken(token)

    return { txId, tokenId: actualTokenId }
  }

  async confirmTransfer(tokenId: string): Promise<void> {
    const token = await this.store.getToken(tokenId)
    if (!token) throw new Error(`Token not found: ${tokenId}`)
    if (token.status !== 'pending_transfer') {
      throw new Error('Token is not in pending_transfer state')
    }
    token.status = 'transferred'
    await this.store.updateToken(token)
  }


  // ── File Retrieval from Genesis TX ──────────────────────────

  async fetchFileFromGenesis(genesisTxId: string, expectedHash: string): Promise<FileOpReturnData | null> {
    const tx = await this.provider.getSourceTransaction(genesisTxId)

    for (let i = 0; i < tx.outputs.length; i++) {
      const output = tx.outputs[i]
      if (!output.lockingScript) continue

      const file = parseFileOpReturn(output.lockingScript as LockingScript)
      if (!file) continue

      // Verify hash matches
      const hashBytes = Hash.sha256(Array.from(file.bytes))
      const computedHash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      if (computedHash !== expectedHash) continue

      return file
    }

    return null
  }

  // ── Send BSV ──────────────────────────────────────────────────

  async sendSats(recipientAddress: string, amount: number): Promise<{ txId: string; fee: number }> {
    if (amount < 1) throw new Error('Amount must be at least 1 satoshi')

    const utxos = await this.getSafeUtxos()
    if (utxos.length === 0) throw new Error('No spendable UTXOs (token UTXOs are protected). Fund your wallet first.')

    const { txId, rawHex, fee } = await this.buildFundedTx(
      utxos, this.myAddress, (tx) => {
        tx.addOutput({
          lockingScript: new P2PKH().lock(recipientAddress),
          satoshis: amount,
        })
      },
    )

    await this.provider.broadcast(rawHex)
    return { txId, fee }
  }

  // ── Transfer Confirmation Polling ────────────────────────────

  async pollForConfirmation(
    txId: string,
    onStatus?: (msg: string) => void,
    maxAttempts = 60,
    intervalMs = 60000,
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      onStatus?.(`Waiting for confirmation... (attempt ${i + 1}/${maxAttempts})`)

      try {
        const proof = await this.provider.getMerkleProof(txId)
        if (proof) {
          onStatus?.('Transaction confirmed!')
          return true
        }
      } catch {
        // Not confirmed yet
      }

      await new Promise(r => setTimeout(r, intervalMs))
    }

    onStatus?.('Timed out waiting for confirmation.')
    return false
  }

  // ── Proof Polling ─────────────────────────────────────────────

  async pollForProof(
    tokenId: string,
    txId: string,
    onStatus?: (msg: string) => void,
    maxAttempts = 60,
    intervalMs = 15000,
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      onStatus?.(`Waiting for confirmation... (attempt ${i + 1}/${maxAttempts})`)

      try {
        const proof = await this.provider.getMerkleProof(txId)
        if (!proof) throw new Error('not yet')

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

  async fetchMissingProofs(
    onStatus?: (msg: string) => void,
  ): Promise<number> {
    const tokens = await this.store.listTokens()
    let fetched = 0

    for (const token of tokens) {
      if (token.status === 'transferred') continue

      const chain = await this.store.getProofChain(token.tokenId)
      if (chain && chain.entries.length > 0) continue

      const txId = token.currentTxId
      onStatus?.(`Fetching proof for ${token.tokenName}...`)

      try {
        const proof = await this.provider.getMerkleProof(txId)
        if (!proof) {
          console.debug(`fetchMissingProofs: no proof yet for ${token.tokenName} (${txId.slice(0, 12)}...)`)
          continue
        }

        const newChain = createProofChain(token.genesisTxId, proof)
        await this.store.addToken(token, newChain)
        fetched++
        onStatus?.(`Got proof for ${token.tokenName}`)
      } catch (e) {
        console.warn(`fetchMissingProofs: error fetching proof for ${token.tokenName}:`, e)
        continue
      }
    }

    return fetched
  }

  // ── Incoming Token Detection ──────────────────────────────────

  async checkIncomingTokens(
    onStatus?: (msg: string) => void,
  ): Promise<OwnedToken[]> {
    onStatus?.('Fetching transactions...')

    const [history, utxos] = await Promise.all([
      this.provider.getAddressHistory(),
      this.provider.getUtxos(),
    ])

    const txIdSet = new Set<string>()
    for (const h of history) txIdSet.add(h.txId)
    for (const u of utxos) txIdSet.add(u.txId)

    const allTxIds = Array.from(txIdSet)
    if (allTxIds.length === 0) {
      onStatus?.('No transactions found.')
      return []
    }

    const imported: OwnedToken[] = []
    const existingTokens = await this.store.listTokens()
    // Include both currentTxId and genesisTxId to avoid re-scanning known TXs
    const existingTxIds = new Set<string>()
    for (const t of existingTokens) {
      existingTxIds.add(t.currentTxId)
      existingTxIds.add(t.genesisTxId)
    }

    onStatus?.(`Scanning ${allTxIds.length} transactions...`)
    console.debug(`checkIncoming: my address = ${this.myAddress}`)
    console.debug(`checkIncoming: already known TXs = ${existingTxIds.size}, scanning ${allTxIds.length} total`)

    for (const txId of allTxIds) {
      if (existingTxIds.has(txId)) {
        console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (already in store)`)
        continue
      }

      try {
        const tx = await this.provider.getSourceTransaction(txId)

        // Find MPT OP_RETURN and ALL P2PKH outputs paying to us
        let opData: TokenOpReturnData | null = null
        const p2pkhOutputIndices: number[] = []

        console.debug(`checkIncoming: ${txId.slice(0, 12)}... has ${tx.outputs.length} outputs`)
        for (let i = 0; i < tx.outputs.length; i++) {
          const output = tx.outputs[i]
          if (!output.lockingScript) continue

          const scriptHex = output.lockingScript.toHex()
          const sats = output.satoshis ?? 0
          console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] sats=${sats} scriptLen=${scriptHex.length / 2} scriptHead=${scriptHex.slice(0, 30)}...`)

          const decoded = decodeOpReturn(output.lockingScript as LockingScript)
          if (decoded) {
            opData = decoded
            console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] = MPT OP_RETURN "${decoded.tokenName}" (isTransfer=${decoded.genesisTxId != null})`)
            continue
          }

          // Log why decodeOpReturn returned null for OP_RETURN-looking scripts
          if (scriptHex.includes('006a') || scriptHex.startsWith('6a')) {
            const chunks = (output.lockingScript as LockingScript).chunks
            console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] looks like OP_RETURN but decode failed. chunks=${chunks.length}, chunk ops=[${chunks.slice(0, 5).map((c: any) => c.op.toString(16)).join(',')}]`)
            if (chunks.length >= 3) {
              const prefixData = chunks[2]?.data ?? []
              console.debug(`checkIncoming:   chunk[2] data=[${prefixData.slice(0, 5).join(',')}] (expecting 77,80,84 = "MPT")`)
            }
            if (chunks.length >= 4) {
              const versionData = chunks[3]?.data ?? []
              console.debug(`checkIncoming:   chunk[3] data=[${versionData.join(',')}] (expecting [1])`)
            }
          }

          // Check for 1-sat P2PKH paying to our address (collect ALL matches)
          if (sats === TOKEN_SATS) {
            const match = isP2pkhToAddress(scriptHex, this.myAddress)
            console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] 1-sat P2PKH match=${match}`)
            if (match) {
              p2pkhOutputIndices.push(i)
            }
          }
        }

        if (!opData || p2pkhOutputIndices.length === 0) {
          console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (opData=${!!opData}, p2pkhMatches=${p2pkhOutputIndices.length})`)
          continue
        }

        const immutableBytes = buildImmutableChunkBytes(
          opData.tokenName,
          opData.tokenScript,
          opData.tokenRules,
        )

        const isTransfer = opData.genesisTxId != null
        const genesisTxId = isTransfer ? opData.genesisTxId! : txId

        if (isTransfer) {
          // Transfer TX: single token, P2PKH at first matched output
          const p2pkhOutputIndex = p2pkhOutputIndices[0]
          const genesisOutputIndex = opData.genesisOutputIndex ?? 1
          console.debug(`checkIncoming TRANSFER: opData.genesisOutputIndex=${opData.genesisOutputIndex}, using genesisOutputIndex=${genesisOutputIndex}`)

          const tokenId = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes)

          // SPV verification: check genesis TX Merkle proof + block header
          const verification = await this.verifyBeforeImport(
            tokenId, genesisTxId, genesisOutputIndex, immutableBytes,
            opData.proofChainEntries ?? [], txId,
          )
          if (!verification.valid) {
            onStatus?.(`Rejected token: ${opData.tokenName} — ${verification.reason}`)
            continue
          }

          const existing = await this.store.getToken(tokenId)
          if (existing && (existing.status === 'transferred' || existing.status === 'pending_transfer')) {
            // Return-to-sender: token was sent away but came back to us
            existing.status = 'active'
            existing.currentTxId = txId
            existing.currentOutputIndex = p2pkhOutputIndex
            existing.transferTxId = undefined
            await this.store.updateToken(existing)
            await this.store.addToken(existing, verification.chain)

            imported.push(existing)
            onStatus?.(`Returned token: ${existing.tokenName} (${tokenId.slice(0, 12)}...)`)
          } else if (!existing) {
            const token: OwnedToken = {
              tokenId,
              genesisTxId,
              genesisOutputIndex,
              currentTxId: txId,
              currentOutputIndex: p2pkhOutputIndex,
              tokenName: opData.tokenName,
              tokenScript: opData.tokenScript,
              tokenRules: opData.tokenRules,
              tokenAttributes: opData.tokenAttributes,
              stateData: opData.stateData,
              satoshis: TOKEN_SATS,
              status: 'active',
              createdAt: new Date().toISOString(),
            }

            await this.store.addToken(token, verification.chain)
            imported.push(token)
            onStatus?.(`Found token: ${token.tokenName} (${tokenId.slice(0, 12)}...)`)
          }
        } else {
          // Genesis TX: one token per P2PKH output
          // Verify once for the first token (all share the same genesis TX)
          const firstTokenId = computeTokenId(genesisTxId, p2pkhOutputIndices[0], immutableBytes)
          const genesisVerification = await this.verifyBeforeImport(
            firstTokenId, genesisTxId, p2pkhOutputIndices[0], immutableBytes,
            [], txId,
          )
          if (!genesisVerification.valid) {
            onStatus?.(`Rejected token: ${opData.tokenName} — ${genesisVerification.reason}`)
            continue
          }

          for (const p2pkhOutputIndex of p2pkhOutputIndices) {
            const tokenId = computeTokenId(genesisTxId, p2pkhOutputIndex, immutableBytes)
            const existing = await this.store.getToken(tokenId)
            if (existing && existing.status === 'active') continue

            if (existing && (existing.status === 'transferred' || existing.status === 'pending_transfer')) {
              // Return-to-sender: token was sent away but came back to us
              existing.status = 'active'
              existing.currentTxId = txId
              existing.currentOutputIndex = p2pkhOutputIndex
              existing.transferTxId = undefined
              await this.store.updateToken(existing)
              imported.push(existing)
              onStatus?.(`Returned token: ${existing.tokenName} #${p2pkhOutputIndex} (${tokenId.slice(0, 12)}...)`)
              continue
            }

            console.debug(`checkIncoming: decoded opData.genesisOutputIndex=${opData.genesisOutputIndex}, p2pkhOutputIndex=${p2pkhOutputIndex}, using=${opData.genesisOutputIndex ?? p2pkhOutputIndex}`)
            const token: OwnedToken = {
              tokenId,
              genesisTxId,
              genesisOutputIndex: opData.genesisOutputIndex ?? p2pkhOutputIndex,
              currentTxId: txId,
              currentOutputIndex: p2pkhOutputIndex,
              tokenName: opData.tokenName,
              tokenScript: opData.tokenScript,
              tokenRules: opData.tokenRules,
              tokenAttributes: opData.tokenAttributes,
              stateData: opData.stateData,
              satoshis: TOKEN_SATS,
              status: 'active',
              createdAt: new Date().toISOString(),
            }

            await this.store.addToken(token, genesisVerification.chain)
            imported.push(token)
            onStatus?.(`Found token: ${token.tokenName} #${p2pkhOutputIndex} (${tokenId.slice(0, 12)}...)`)
          }
        }
      } catch (e) {
        console.debug(`checkIncoming: skipping TX ${txId}:`, e)
        continue
      }
    }

    onStatus?.(imported.length > 0
      ? `Done! Imported ${imported.length} token(s).`
      : 'No new incoming tokens found.')
    return imported
  }

  // ── Verification (delegates to SPV token protocol) ────────────

  /**
   * Verify a token using the pure SPV protocol.
   *
   * Fetches block headers from the wallet provider, then hands
   * everything to tokenProtocol.verifyToken() which does the
   * actual cryptographic verification with no network calls.
   */
  async verifyToken(tokenId: string): Promise<VerificationResult> {
    const token = await this.store.getToken(tokenId)
    if (!token) return { valid: false, reason: 'Token not found' }

    let chain = await this.store.getProofChain(tokenId)

    // If no proof chain stored, try to fetch one on demand
    if (!chain || chain.entries.length === 0) {
      try {
        const proof = await this.provider.getMerkleProof(token.currentTxId)
        if (proof) {
          chain = createProofChain(token.genesisTxId, proof)
          await this.store.addToken(token, chain)
        }
      } catch (e) {
        console.warn('verifyToken: failed to fetch Merkle proof on demand:', e)
      }
    }

    if (!chain || chain.entries.length === 0) {
      return { valid: false, reason: 'No proof chain (TX may not be confirmed yet)' }
    }

    // Verify token ID (pure computation)
    const immutableBytes = buildImmutableChunkBytes(
      token.tokenName,
      token.tokenScript,
      token.tokenRules,
    )
    const expectedId = computeTokenId(token.genesisTxId, token.genesisOutputIndex, immutableBytes)
    if (expectedId !== token.tokenId) {
      return { valid: false, reason: 'Token ID does not match genesis' }
    }

    // Fetch needed block headers, then verify using pure SPV protocol
    return verifyProofChainAsync(chain, async (height) => {
      return this.provider.getBlockHeader(height)
    })
  }

  // ── Transaction Building (wallet internals) ───────────────────

  private async buildFundedTx(
    utxos: Utxo[],
    changeAddress: string,
    addOutputs: (tx: Transaction) => void,
  ): Promise<{ tx: Transaction; rawHex: string; txId: string; fee: number }> {
    const sorted = [...utxos].sort((a, b) => a.satoshis - b.satoshis)

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

      for (const u of combo) {
        const sourceTx = await this.provider.getSourceTransaction(u.txId)
        tx.addInput({
          sourceTransaction: sourceTx,
          sourceOutputIndex: u.outputIndex,
          unlockingScriptTemplate: new P2PKH().unlock(this.key),
        })
      }

      addOutputs(tx)

      const fee = estimateFee(combo.length, tx.outputs.length + 1, tx.outputs, this.feePerKb)
      const totalIn = combo.reduce((s, u) => s + u.satoshis, 0)
      const protocolOut = tx.outputs.reduce((s, o) => s + (o.satoshis ?? 0), 0)
      const changeAmount = totalIn - protocolOut - fee

      if (changeAmount < 0) {
        lastError = `${combo.length} UTXO(s) totalling ${totalIn} sats too small for fees (need ${fee} sats)`
        continue
      }

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

  private async buildFundedTransferTx(
    tokenSourceTx: Transaction,
    tokenOutputIndex: number,
    fundingUtxos: Utxo[],
    changeAddress: string,
    addOutputs: (tx: Transaction) => void,
  ): Promise<{ tx: Transaction; rawHex: string; txId: string; fee: number }> {
    const sorted = [...fundingUtxos].sort((a, b) => a.satoshis - b.satoshis)

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

      tx.addInput({
        sourceTransaction: tokenSourceTx,
        sourceOutputIndex: tokenOutputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(this.key),
      })

      for (const u of combo) {
        const sourceTx = await this.provider.getSourceTransaction(u.txId)
        tx.addInput({
          sourceTransaction: sourceTx,
          sourceOutputIndex: u.outputIndex,
          unlockingScriptTemplate: new P2PKH().unlock(this.key),
        })
      }

      addOutputs(tx)

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
   * Build a funded transaction for fungible token transfers.
   *
   * TX structure:
   *   Inputs:  token UTXOs (1+) + funding UTXOs (1+)
   *   Outputs: [0] recipient P2PKH, [1] OP_RETURN, [2] token change (if any), [3] fee change
   */
  private async buildFundedFungibleTransferTx(
    tokenSources: { tx: Transaction; outputIndex: number }[],
    fundingUtxos: Utxo[],
    changeAddress: string,
    recipientAddress: string,
    amount: number,
    tokenChange: number,
    opReturnData: TokenOpReturnData,
  ): Promise<{ tx: Transaction; rawHex: string; txId: string; fee: number }> {
    const sorted = [...fundingUtxos].sort((a, b) => a.satoshis - b.satoshis)

    // Try combinations of funding UTXOs
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

      // Add token UTXO inputs
      for (const { tx: sourceTx, outputIndex } of tokenSources) {
        tx.addInput({
          sourceTransaction: sourceTx,
          sourceOutputIndex: outputIndex,
          unlockingScriptTemplate: new P2PKH().unlock(this.key),
        })
      }

      // Add funding UTXO inputs
      for (const u of combo) {
        const sourceTx = await this.provider.getSourceTransaction(u.txId)
        tx.addInput({
          sourceTransaction: sourceTx,
          sourceOutputIndex: u.outputIndex,
          unlockingScriptTemplate: new P2PKH().unlock(this.key),
        })
      }

      // Output 0: Recipient P2PKH (amount)
      tx.addOutput({
        lockingScript: new P2PKH().lock(recipientAddress),
        satoshis: amount,
      })

      // Output 1: OP_RETURN with metadata
      tx.addOutput({
        lockingScript: encodeOpReturn(opReturnData),
        satoshis: 0,
      })

      // Output 2: Token change (if any)
      if (tokenChange > 0) {
        tx.addOutput({
          lockingScript: new P2PKH().lock(changeAddress),
          satoshis: tokenChange,
        })
      }

      // Calculate fee
      const numInputs = tokenSources.length + combo.length
      const numOutputsBeforeFeeChange = tx.outputs.length
      const fee = estimateFee(numInputs, numOutputsBeforeFeeChange + 1, tx.outputs, this.feePerKb)

      const fundingIn = combo.reduce((s, u) => s + u.satoshis, 0)
      const feeChangeAmount = fundingIn - fee

      if (feeChangeAmount < 0) {
        lastError = `${combo.length} funding UTXO(s) totalling ${fundingIn} sats too small for fees (need ${fee} sats)`
        continue
      }

      // Output 3: Fee change
      tx.addOutput({
        lockingScript: new P2PKH().lock(changeAddress),
        satoshis: feeChangeAmount,
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
}

// ─── Fee Estimation ─────────────────────────────────────────────────

function estimateFee(
  numInputs: number,
  numOutputs: number,
  existingOutputs: { lockingScript?: { toBinary(): number[] }; satoshis?: number }[],
  feePerKb: number,
): number {
  let size = TX_OVERHEAD + numInputs * BYTES_PER_INPUT

  for (const o of existingOutputs) {
    const scriptLen = o.lockingScript?.toBinary()?.length ?? 25
    const varintLen = scriptLen < 0xfd ? 1 : scriptLen < 0x10000 ? 3 : 5
    size += 8 + varintLen + scriptLen
  }

  size += BYTES_PER_P2PKH_OUTPUT

  return Math.ceil(size * feePerKb / 1000)
}

// ─── P2PKH Address Detection ────────────────────────────────────────

/**
 * Check if a locking script (hex) is a standard P2PKH paying to the given address.
 *
 * Standard P2PKH script: OP_DUP OP_HASH160 <20 bytes pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
 * Hex pattern: 76a914{40 hex chars}88ac
 *
 * We extract the pubKeyHash from the script and compare it against the
 * pubKeyHash embedded in the BSV address.
 */
function isP2pkhToAddress(scriptHex: string, address: string): boolean {
  // Standard P2PKH is exactly 50 hex chars: 76 a9 14 {20 bytes = 40 hex} 88 ac
  if (scriptHex.length !== 50) return false
  if (!scriptHex.startsWith('76a914') || !scriptHex.endsWith('88ac')) return false

  const scriptPkhHex = scriptHex.slice(6, 46) // extract the 20-byte pubKeyHash

  // Decode BSV address (Base58Check) to get the pubKeyHash
  const addressPkhHex = addressToPubKeyHash(address)
  if (!addressPkhHex) {
    console.debug(`isP2pkhToAddress: addressToPubKeyHash("${address}") returned null`)
    return false
  }

  const match = scriptPkhHex === addressPkhHex
  if (!match) {
    console.debug(`isP2pkhToAddress: script PKH=${scriptPkhHex}, address PKH=${addressPkhHex} -- NO MATCH`)
  }
  return match
}

/**
 * Decode a Base58Check BSV address to extract the 20-byte pubKeyHash as hex.
 * Returns null if the address is invalid.
 */
function addressToPubKeyHash(address: string): string | null {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  // Count leading '1' characters (each represents a 0x00 byte)
  let leadingZeros = 0
  for (const char of address) {
    if (char === '1') leadingZeros++
    else break
  }

  // Base58 decode
  let num = BigInt(0)
  for (const char of address) {
    const idx = ALPHABET.indexOf(char)
    if (idx === -1) return null
    num = num * BigInt(58) + BigInt(idx)
  }

  // Convert to hex, pad to even length
  let hex = num.toString(16)
  if (hex.length % 2) hex = '0' + hex

  // Pad the BigInt result so that leading zeros + BigInt hex = 50 chars (25 bytes)
  const targetLen = 50 - leadingZeros * 2
  while (hex.length < targetLen) hex = '0' + hex

  // Prepend leading zero bytes
  hex = '00'.repeat(leadingZeros) + hex

  if (hex.length !== 50) {
    console.debug(`addressToPubKeyHash: unexpected length ${hex.length} for "${address}" (leadingZeros=${leadingZeros})`)
    return null
  }

  // The pubKeyHash is bytes 1-20 (skip version byte, ignore 4-byte checksum)
  return hex.slice(2, 42)
}
