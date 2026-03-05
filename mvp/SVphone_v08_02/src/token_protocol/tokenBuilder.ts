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
  decodeTokenRules,
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
const DEFAULT_FEE_PER_KB = 100
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
   * some kind (P, Ordinal, 1Sat Ordinals, etc.) and destroying
   * it by using it as a funding input is irreversible.
   *
   * The only code path that spends a 1-sat UTXO is createTransfer(),
   * which explicitly spends it as Input 0 when the user chooses to
   * transfer a specific known token.
   *
   * For any quarantined 1-sat UTXOs that contain P OP_RETURN data
   * addressed to this wallet, we auto-import them into the token store.
   */
  private async getSafeUtxos(): Promise<Utxo[]> {
    const utxos = await this.provider.getUtxos()
    const safe: Utxo[] = []

    for (const u of utxos) {
      if (u.satoshis <= TOKEN_SATS) {
        // Quarantined: attempt P auto-import in background, but
        // never allow spending regardless of result
        this.tryAutoImport(u).catch(() => {})
        continue
      }

      safe.push(u)
    }

    return safe
  }

  /**
   * Get spendable balance (excludes sats locked in token UTXOs).
   *
   * This returns the balance available for spending, excluding any
   * 1-sat UTXOs that are reserved for token ownership.
   */
  async getSpendableBalance(): Promise<number> {
    const safeUtxos = await this.getSafeUtxos()
    return safeUtxos.reduce((sum, u) => sum + u.satoshis, 0)
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
      // Unconfirmed TX: Always verify via ancestor transaction proofs + genesis block header
      try {
        // Get the current (unconfirmed) transaction to access its inputs
        const currentTx = await this.provider.getSourceTransaction(currentTxId)
        if (!currentTx.inputs || currentTx.inputs.length === 0) {
          return { valid: false, chain: { genesisTxId, entries: [] }, reason: 'Unconfirmed TX has no inputs' }
        }

        // MANDATORY: Get and verify ancestor proof (from Input 0, which must be confirmed)
        // This proves the input UTXO exists and is confirmed on blockchain
        const input0 = currentTx.inputs[0]
        const ancestorTxId = input0.sourceTXID
        if (!ancestorTxId) {
          return { valid: false, chain: { genesisTxId, entries: [] }, reason: 'Cannot trace ancestor transaction' }
        }

        const ancestorProof = await this.provider.getMerkleProof(ancestorTxId)
        if (!ancestorProof) {
          return { valid: false, chain: { genesisTxId, entries: [] }, reason: 'No Merkle proof for ancestor transaction' }
        }

        // Verify ancestor proof - MANDATORY: proves input exists and is confirmed
        if (!verifyMerkleProof(ancestorProof)) {
          return { valid: false, chain: { genesisTxId, entries: [] }, reason: 'Invalid Merkle proof for ancestor transaction' }
        }

        // Get genesis block height: prefer from existing token record, otherwise fetch from genesis proof
        let genesisBlockHeight: number | null = null
        const existingToken = await this.store.getToken(tokenId)
        if (existingToken?.blockHeight && existingToken.blockHeight > 0) {
          genesisBlockHeight = existingToken.blockHeight
          console.debug(`verifyBeforeImport: Using blockHeight=${genesisBlockHeight} from existing token record`)
        } else {
          // Token not in store yet - must fetch genesis proof to get blockHeight
          const genesisProof = await this.provider.getMerkleProof(genesisTxId)
          if (genesisProof) {
            genesisBlockHeight = genesisProof.blockHeight
            console.debug(`verifyBeforeImport: Using blockHeight=${genesisBlockHeight} from genesis proof`)
          }
        }

        if (genesisBlockHeight === null || genesisBlockHeight === 0) {
          return { valid: false, chain: { genesisTxId, entries: [] }, reason: 'Cannot determine genesis block height' }
        }

        // Fetch and verify genesis block header
        try {
          const header = await this.provider.getBlockHeader(genesisBlockHeight)
          // Verify we can compute merkle root - this proves genesis is real
          // (Full verification happens below when we have genesis entry)
          console.debug(`verifyBeforeImport: Verified genesis block header at height ${genesisBlockHeight}`)
        } catch (e: any) {
          return { valid: false, chain: { genesisTxId, entries: [] }, reason: `Failed to fetch genesis block header: ${e?.message}` }
        }

        // Unconfirmed token is verified via ancestor proof + genesis block header
        // Accept it (status='active') even though current TX isn't confirmed yet
        console.debug(`verifyBeforeImport: Unconfirmed token verified via ancestor proof (txId=${currentTxId.slice(0, 12)}...)`)
        return { valid: true, chain: { genesisTxId, entries: [] }, reason: 'Verified via ancestor proof and genesis block header' }
      } catch (e: any) {
        console.debug(`verifyBeforeImport: Error verifying unconfirmed token: ${e?.message}`)
        return { valid: false, chain: { genesisTxId, entries: [] }, reason: `Unconfirmed token verification failed: ${e?.message}` }
      }
    }

    const chain: ProofChain = { genesisTxId, entries }

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
   * Derive genesisOutputIndex from a transfer TX we already have.
   *
   * v05.21: genesisOutputIndex is no longer encoded in the OP_RETURN. Instead,
   * we read Input 0 of the transfer TX to find which output it spent.
   *
   * For direct transfers (genesis → recipient): Input 0 points directly to
   * the genesis TX, and sourceOutputIndex IS the genesisOutputIndex.
   *
   * For multi-hop transfers (genesis → A → B → ...): We trace Input 0 backwards
   * through each TX until we reach the genesis TX.
   *
   * @param transferTx   The transfer TX object (already fetched)
   * @param genesisTxId  The genesis TX ID (from OP_RETURN)
   * @returns The output index in the genesis TX, or null if chain traversal fails
   */
  private async deriveGenesisOutputIndex(
    transferTx: Transaction,
    genesisTxId: string,
  ): Promise<number | null> {
    if (!transferTx.inputs || transferTx.inputs.length === 0) {
      console.debug(`deriveGenesisOutputIndex: TX has no inputs`)
      return null
    }

    // Token UTXO is always Input 0
    const input0 = transferTx.inputs[0]
    const prevTxId = input0.sourceTXID
    const prevOutputIndex = input0.sourceOutputIndex

    console.debug(`deriveGenesisOutputIndex: genesisTxId=${genesisTxId.slice(0, 12)}..., input0 keys=${Object.keys(input0).join(',')}`)
    console.debug(`deriveGenesisOutputIndex: input0.sourceTXID=${prevTxId?.slice(0, 12)}, input0.sourceOutputIndex=${prevOutputIndex}`)
    console.debug(`deriveGenesisOutputIndex: input0 object=${JSON.stringify(input0, (k, v) => typeof v === 'object' && v !== null ? '[Object]' : v, 2)}`)

    if (!prevTxId) {
      console.debug(`deriveGenesisOutputIndex: Input 0 has no sourceTXID`)
      return null
    }

    // Direct transfer: Input 0 points directly to genesis TX
    if (prevTxId === genesisTxId) {
      console.debug(`deriveGenesisOutputIndex: Direct transfer, genesis output index = ${prevOutputIndex}`)
      return prevOutputIndex
    }

    // Multi-hop transfer: need to trace back through the chain
    let txId = prevTxId
    const maxHops = 1000 // Safety limit

    for (let i = 0; i < maxHops; i++) {
      const tx = await this.provider.getSourceTransaction(txId)
      if (!tx.inputs || tx.inputs.length === 0) {
        console.debug(`deriveGenesisOutputIndex: TX ${txId.slice(0, 12)}... has no inputs`)
        return null
      }

      const hop0 = tx.inputs[0]
      const hopPrevTxId = hop0.sourceTXID
      const hopPrevOutputIndex = hop0.sourceOutputIndex

      if (!hopPrevTxId) {
        console.debug(`deriveGenesisOutputIndex: Input 0 of ${txId.slice(0, 12)}... has no sourceTXID`)
        return null
      }

      if (hopPrevTxId === genesisTxId) {
        console.debug(`deriveGenesisOutputIndex: Found genesis output index ${hopPrevOutputIndex} after ${i + 2} hops`)
        return hopPrevOutputIndex
      }

      txId = hopPrevTxId
    }

    console.debug(`deriveGenesisOutputIndex: Exceeded max hops (${maxHops})`)
    return null
  }

  /**
   * Check if a quarantined UTXO is an incoming P token and
   * auto-import it into the store if so. Fire-and-forget.
   */
  private async tryAutoImport(u: Utxo): Promise<void> {
    const utxoKey = `${u.txId}:${u.outputIndex}`
    const tokenKeys = await this.getTokenUtxoKeys()
    if (tokenKeys.has(utxoKey)) return // already known

    const tx = await this.provider.getSourceTransaction(u.txId)

    // Find the P OP_RETURN output and check for a P2PKH output paying to us
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
    // Transfer TX: v05.21 derives genesisOutputIndex from Input 0 of the TX we already have
    let genesisOutputIndex: number
    if (isTransfer) {
      const derivedIndex = await this.deriveGenesisOutputIndex(tx, genesisTxId)
      if (derivedIndex === null) {
        console.debug(`tryAutoImport: failed to derive genesisOutputIndex for ${u.txId.slice(0, 12)}...`)
        return
      }
      genesisOutputIndex = derivedIndex
    } else {
      genesisOutputIndex = p2pkhOutputIndex
    }

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
      blockHeight: 0,  // Assume unconfirmed for auto-import from quarantine
      confirmationStatus: 'unconfirmed',
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

    const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedTx(
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
    // v05.22: Register pending TX for consecutive transfer support
    this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? undefined)

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
        blockHeight: 0,  // Newly minted, unconfirmed
        confirmationStatus: 'unconfirmed',
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

    const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedTx(
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
    // v05.22: Register pending TX for consecutive transfer support
    this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? undefined)

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
        blockHeight: 0,  // Newly minted, unconfirmed
        confirmationStatus: 'unconfirmed',
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
    newStateData?: string,
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

    // Use new state data if provided, otherwise keep existing
    const effectiveStateData = newStateData !== undefined ? newStateData : token.stateData

    const opReturnData: TokenOpReturnData = {
      tokenName: token.tokenName,
      tokenScript: token.tokenScript,
      tokenRules: token.tokenRules,
      tokenAttributes: token.tokenAttributes,
      stateData: effectiveStateData,
      genesisTxId: token.genesisTxId,
      proofChainEntries: proofChain?.entries ?? [],
      genesisOutputIndex: 1,  // Fixed for fungible tokens
    }

    const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedFungibleTransferTx(
      tokenSourceTxs,
      fundingUtxos,
      this.myAddress,
      recipientAddress,
      amount,
      change,
      opReturnData,
    )

    await this.provider.broadcast(rawHex)
    // v05.22: Register pending TX for consecutive transfer support
    this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? undefined)

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

    // Update state data if new value was provided
    if (newStateData !== undefined) {
      token.stateData = newStateData
    }

    await this.store.updateFungibleToken(token)

    return { txId, tokenId, amountSent: amount, change }
  }

  /**
   * Forward a specific fungible UTXO (typically one with state data/message).
   * Preserves the state data from the original UTXO.
   */
  async forwardFungibleUtxo(
    tokenId: string,
    utxoTxId: string,
    utxoOutputIndex: number,
    recipientAddress: string,
  ): Promise<FungibleTransferResult> {
    const token = await this.store.getFungibleToken(tokenId)
    if (!token) throw new Error(`Fungible token not found: ${tokenId}`)

    // Find the specific UTXO
    const utxo = token.utxos.find(
      u => u.txId === utxoTxId && u.outputIndex === utxoOutputIndex && u.status === 'active'
    )
    if (!utxo) {
      throw new Error(`UTXO not found or not active: ${utxoTxId}:${utxoOutputIndex}`)
    }

    // Fetch funding UTXOs for miner fee
    const fundingUtxos = await this.getSafeUtxos()
    if (fundingUtxos.length === 0) {
      throw new Error('No funding UTXOs available for fees')
    }

    // Fetch source transaction for the token UTXO
    const tokenSourceTx = await this.provider.getSourceTransaction(utxo.txId)

    // Get proof chain for OP_RETURN
    const proofChain = await this.store.getProofChain(tokenId)

    // Use the UTXO's state data (preserve the message)
    const stateData = utxo.stateData || token.stateData

    const opReturnData: TokenOpReturnData = {
      tokenName: token.tokenName,
      tokenScript: token.tokenScript,
      tokenRules: token.tokenRules,
      tokenAttributes: token.tokenAttributes,
      stateData,
      genesisTxId: token.genesisTxId,
      proofChainEntries: proofChain?.entries ?? [],
      genesisOutputIndex: 1,  // Fixed for fungible tokens
    }

    // Build TX: single UTXO, no change (send entire UTXO)
    const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedFungibleTransferTx(
      [{ tx: tokenSourceTx, outputIndex: utxo.outputIndex }],
      fundingUtxos,
      this.myAddress,
      recipientAddress,
      utxo.satoshis,  // Send entire UTXO
      0,              // No change
      opReturnData,
    )

    await this.provider.broadcast(rawHex)
    // v05.22: Register pending TX for consecutive transfer support
    this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? undefined)

    // Mark the UTXO as transferred
    utxo.status = 'transferred'
    await this.store.updateFungibleToken(token)

    return { txId, tokenId, amountSent: utxo.satoshis, change: 0 }
  }

  // ── Transfer ──────────────────────────────────────────────────

  async createTransfer(
    tokenId: string,
    recipientAddress: string,
    newStateData?: string,
    fileData?: { bytes: Uint8Array; mimeType: string; fileName: string },
    includeStateData: boolean = false,
  ): Promise<TransferResult> {
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

    // Handle file data: prepare file OP_RETURN for embedding
    let effectiveStateData: string
    let fileOpReturn: LockingScript | null = null

    if (fileData) {
      // Build file OP_RETURN for embedding
      fileOpReturn = buildFileOpReturn({
        mimeType: fileData.mimeType,
        fileName: fileData.fileName,
        bytes: fileData.bytes,
      })
    }

    // Determine effective stateData:
    // - If newStateData provided (may contain message+hash), use it
    // - Otherwise use stored token stateData only if includeStateData is true
    effectiveStateData = newStateData !== undefined ? newStateData : (includeStateData ? token.stateData : '')

    const { rawHex, txId, fee, spentInputs, changeOutput } = await this.buildFundedTransferTx(
      tokenSourceTx, token.currentOutputIndex,
      fundingCandidates, this.myAddress, (tx) => {
        // Transfer TX structure: Output 0 = P2PKH (recipient), Output 1 = OP_RETURN, [Output 2 = file OP_RETURN]
        tx.addOutput({
          lockingScript: new P2PKH().lock(recipientAddress),
          satoshis: TOKEN_SATS,
        })
        // v05.21: genesisOutputIndex no longer encoded in OP_RETURN (derived from chain)
        const opReturnScript = encodeOpReturn({
          tokenName: token.tokenName,
          tokenScript: token.tokenScript,
          tokenRules: token.tokenRules,
          tokenAttributes: token.tokenAttributes,
          stateData: effectiveStateData,
          genesisTxId: token.genesisTxId,
          proofChainEntries: (proofChain ?? { genesisTxId: token.genesisTxId, entries: [] }).entries,
        })
        console.debug(`buildFundedTransferTx: OP_RETURN script encoded, binary length=${opReturnScript.toBinary().length}, hex=${opReturnScript.toHex().substring(0, 100)}...`)

        tx.addOutput({
          lockingScript: opReturnScript,
          satoshis: 0,
        })

        // Optional: file data OP_RETURN (for transfers with new files)
        if (fileOpReturn) {
          tx.addOutput({
            lockingScript: fileOpReturn,
            satoshis: 0,
          })
        }
      },
    )

    await this.provider.broadcast(rawHex)
    // v05.22: Register pending TX for consecutive transfer support
    this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? undefined)

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

    const { txId, rawHex, fee, spentInputs, changeOutput } = await this.buildFundedTx(
      utxos, this.myAddress, (tx) => {
        tx.addOutput({
          lockingScript: new P2PKH().lock(recipientAddress),
          satoshis: amount,
        })
      },
    )

    await this.provider.broadcast(rawHex)
    // v05.22: Register pending TX for consecutive transfer support
    this.provider.registerPendingTx(txId, spentInputs, changeOutput ?? undefined)
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
    maxAttempts = 240,
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

  // ── Token Flushing (v05.23) ───────────────────────────────────

  /**
   * Flush an NFT token: mark it as flushed (internal state only, no blockchain transaction).
   * Optionally preserve metadata in localStorage; if not preserved, token is deleted.
   */
  async flushToken(
    tokenId: string,
    preserveMetadata: boolean = true,
  ): Promise<{ tokenId: string; flushedAt: string }> {
    const token = await this.store.getToken(tokenId)
    if (!token) throw new Error(`Token not found: ${tokenId}`)

    if (token.status === 'flushed' || token.status === 'recovered') {
      throw new Error(`Token is already flushed (status: ${token.status})`)
    }
    if (token.status === 'pending_transfer') {
      throw new Error('Cannot flush token with pending transfer')
    }
    if (token.status === 'transferred') {
      throw new Error('Cannot flush token that has been transferred away')
    }

    // Update token status to flushed
    token.status = 'flushed'
    const flushedAt = new Date().toISOString()
    token.flushedAt = flushedAt

    if (!preserveMetadata) {
      // Delete the token completely (remove from store)
      await this.store.deleteToken(tokenId)
      console.debug(`flushToken: deleted token ${tokenId} (metadata not preserved)`)
    } else {
      // Keep metadata for recovery
      await this.store.updateToken(token)
      console.debug(`flushToken: marked token ${tokenId} as flushed (metadata preserved)`)
    }

    return { tokenId, flushedAt }
  }

  /**
   * Flush fungible token UTXO(s): mark them as flushed (internal state only, no blockchain transaction).
   */
  async flushFungibleToken(
    tokenId: string,
    utxoIndexes: number[],
    preserveMetadata: boolean = true,
  ): Promise<{ tokenId: string; amountFlushed: number; flushedAt: string }> {
    const fungible = await this.store.getFungibleToken(tokenId)
    if (!fungible) throw new Error(`Fungible token not found: ${tokenId}`)

    if (utxoIndexes.length === 0) {
      throw new Error('No UTXOs specified to flush')
    }

    // Get the UTXOs to flush
    const utxosToFlush = utxoIndexes
      .map(idx => fungible.utxos[idx])
      .filter(u => u !== undefined)

    if (utxosToFlush.length !== utxoIndexes.length) {
      throw new Error('Invalid UTXO indices')
    }

    // Check all UTXOs are active
    for (const utxo of utxosToFlush) {
      if (utxo.status === 'pending_transfer' || utxo.status === 'flushed') {
        throw new Error(`Cannot flush UTXO with status: ${utxo.status}`)
      }
    }

    // Mark UTXOs as flushed
    const amountFlushed = utxosToFlush.reduce((sum, u) => sum + u.satoshis, 0)
    const flushedAt = new Date().toISOString()

    for (let i = 0; i < fungible.utxos.length; i++) {
      if (utxoIndexes.includes(i)) {
        fungible.utxos[i].status = 'flushed'
        fungible.utxos[i].flushedAt = flushedAt
      }
    }

    if (!preserveMetadata) {
      // Remove flushed UTXOs completely
      fungible.utxos = fungible.utxos.filter((_, i) => !utxoIndexes.includes(i))
      if (fungible.utxos.length === 0) {
        await this.store.deleteFungibleToken(tokenId)
        console.debug(`flushFungibleToken: deleted entire token ${tokenId} (no UTXOs remain)`)
      } else {
        await this.store.updateFungibleToken(fungible)
        console.debug(`flushFungibleToken: removed ${utxoIndexes.length} UTXOs from ${tokenId}`)
      }
    } else {
      // Keep flushed UTXOs with metadata
      await this.store.updateFungibleToken(fungible)
      console.debug(`flushFungibleToken: marked ${utxoIndexes.length} UTXOs as flushed in ${tokenId}`)
    }

    return {
      tokenId,
      amountFlushed,
      flushedAt,
    }
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

    // Build set of currently unspent outputs: "txId:outputIndex"
    // This is CRITICAL: only import outputs that are still unspent on-chain
    const unspentSet = new Set<string>()
    for (const u of utxos) {
      unspentSet.add(`${u.txId}:${u.outputIndex}`)
    }

    const allTxIds = Array.from(txIdSet)
    if (allTxIds.length === 0) {
      onStatus?.('No transactions found.')
      return []
    }

    const imported: OwnedToken[] = []
    const existingTokens = await this.store.listTokens()
    const existingFungibleTokens = await this.store.listFungibleTokens()

    // Track NFT TXs that can be skipped entirely (NFTs are 1:1 with TXs)
    const nftTxIds = new Set<string>()
    for (const t of existingTokens) {
      nftTxIds.add(t.currentTxId)
      nftTxIds.add(t.genesisTxId)
    }

    // Track specific fungible UTXOs we already know about (txId:outputIndex)
    // We can't skip TXs for fungible tokens because one TX may have multiple UTXOs
    const knownFungibleUtxos = new Set<string>()
    for (const ft of existingFungibleTokens) {
      for (const u of ft.utxos) {
        knownFungibleUtxos.add(`${u.txId}:${u.outputIndex}`)
      }
    }

    // Build set of TXs that have potential new fungible UTXOs
    // (unspent outputs not already in our fungible token baskets)
    const txsWithPotentialNewUtxos = new Set<string>()
    for (const u of utxos) {
      if (!knownFungibleUtxos.has(`${u.txId}:${u.outputIndex}`)) {
        txsWithPotentialNewUtxos.add(u.txId)
      }
    }

    onStatus?.(`Scanning ${allTxIds.length} transactions...`)
    console.debug(`checkIncoming: my address = ${this.myAddress}`)
    console.debug(`checkIncoming: NFT TXs=${nftTxIds.size}, knownFungibleUtxos=${knownFungibleUtxos.size}, txsWithPotentialNew=${txsWithPotentialNewUtxos.size}`)

    let skippedConfirmed = 0
    for (const txId of allTxIds) {
      // Optimization: Skip confirmed transactions that are already fully processed
      // (no need to fetch from API if nothing new could have changed)
      const historyEntry = history.find(h => h.txId === txId)
      const blockHeight = historyEntry?.blockHeight ?? 0

      if (blockHeight > 0 && !txsWithPotentialNewUtxos.has(txId)) {
        // This is a confirmed TX with no potential new UTXOs - definitely skip
        skippedConfirmed++
        continue
      }

      // Skip if it's a known NFT TX AND doesn't have potential new fungible UTXOs
      if (nftTxIds.has(txId) && !txsWithPotentialNewUtxos.has(txId)) {
        console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (known NFT TX, no new UTXOs)`)
        continue
      }
      // Skip if all unspent outputs from this TX are already in our fungible baskets
      if (!txsWithPotentialNewUtxos.has(txId) && !nftTxIds.has(txId)) {
        // This TX only has UTXOs we already know about
        const hasUnknownUtxo = utxos.some(u => u.txId === txId && !knownFungibleUtxos.has(`${u.txId}:${u.outputIndex}`))
        if (!hasUnknownUtxo) {
          console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (all UTXOs already known)`)
          continue
        }
      }

      try {
        const tx = await this.provider.getSourceTransaction(txId)

        // Find P OP_RETURN and ALL P2PKH outputs paying to us
        let opData: TokenOpReturnData | null = null
        const p2pkhOutputIndices: number[] = []
        const p2pkhOutputsWithSats: { index: number; sats: number }[] = []

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
            console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] = P OP_RETURN "${decoded.tokenName}" (isTransfer=${decoded.genesisTxId != null})`)
            continue
          }

          // Log why decodeOpReturn returned null for OP_RETURN-looking scripts
          if (scriptHex.includes('006a') || scriptHex.startsWith('6a')) {
            // Try to parse as file OP_RETURN (for attached files in transfers)
            const fileData = parseFileOpReturn(output.lockingScript as LockingScript)
            if (fileData) {
              // Compute hash and store metadata in localStorage for UI display
              const hashBytes = Hash.sha256(Array.from(fileData.bytes))
              const fileHash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
              const FILE_META_KEY = 'p:fileMeta'
              try {
                const data = JSON.parse(localStorage.getItem(FILE_META_KEY) || '{}')
                data[fileHash] = { mimeType: fileData.mimeType, fileName: fileData.fileName }
                localStorage.setItem(FILE_META_KEY, JSON.stringify(data))
                console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] = file OP_RETURN "${fileData.fileName}" (hash=${fileHash.slice(0, 16)}...)`)
              } catch (e) {
                console.debug(`checkIncoming: failed to store file metadata:`, e)
              }
              continue
            }

            const chunks = (output.lockingScript as LockingScript).chunks
            console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] looks like OP_RETURN but decode failed. chunks=${chunks.length}, chunk ops=[${chunks.slice(0, 5).map((c: any) => c.op.toString(16)).join(',')}]`)
            if (chunks.length >= 3) {
              const prefixData = chunks[2]?.data ?? []
              console.debug(`checkIncoming:   chunk[2] data=[${prefixData.slice(0, 5).join(',')}] (expecting 80 = "P")`)
            }
            if (chunks.length >= 4) {
              const versionData = chunks[3]?.data ?? []
              console.debug(`checkIncoming:   chunk[3] data=[${versionData.join(',')}] (expecting [1])`)
            }
          }

          // Check for P2PKH paying to our address (collect ALL matches)
          const match = isP2pkhToAddress(scriptHex, this.myAddress)
          if (match) {
            console.debug(`checkIncoming: ${txId.slice(0, 12)}... output[${i}] P2PKH match, sats=${sats}`)
            p2pkhOutputsWithSats.push({ index: i, sats })
            if (sats === TOKEN_SATS) {
              p2pkhOutputIndices.push(i)
            }
          }
        }

        // Check if this is a fungible token
        const isFungible = opData ? decodeTokenRules(opData.tokenRules).isFungible : false
        const isTxTransfer = opData?.genesisTxId != null

        // CRITICAL: Filter to only include outputs that are still unspent on-chain
        // Without this check, spent outputs from transaction history would be re-imported
        // SPV: For unconfirmed TXs, treat all P2PKH outputs as unspent
        const historyEntry = history.find(h => h.txId === txId)
        const blockHeight = historyEntry?.blockHeight ?? 0
        const unspentP2pkhIndices = p2pkhOutputIndices.filter(i =>
          blockHeight === 0 || unspentSet.has(`${txId}:${i}`)
        )

        // For fungible tokens: only specific output indices are token UTXOs (not fee change)
        // - Genesis TX: Output 0 = OP_RETURN, Output 1 = token UTXO, Output 2+ = fee change
        // - Transfer TX: Output 0 = recipient, Output 1 = OP_RETURN, Output 2 = token change, Output 3+ = fee change
        // For NFTs: only 1-sat outputs count (handled via unspentP2pkhIndices)
        const validFungibleIndices = isTxTransfer ? [0, 2] : [1]  // Transfer: recipient+change, Genesis: token output
        const fungibleOutputs = isFungible
          ? p2pkhOutputsWithSats.filter(o => o.sats > 0 && validFungibleIndices.includes(o.index) && (blockHeight === 0 || unspentSet.has(`${txId}:${o.index}`)))
          : p2pkhOutputsWithSats.filter(o => o.sats > 0 && o.sats !== TOKEN_SATS && (blockHeight === 0 || unspentSet.has(`${txId}:${o.index}`)))

        if (!opData || (unspentP2pkhIndices.length === 0 && fungibleOutputs.length === 0)) {
          console.debug(`checkIncoming: SKIP ${txId.slice(0, 12)}... (opData=${!!opData}, nftMatches=${unspentP2pkhIndices.length}, fungibleMatches=${fungibleOutputs.length})`)
          continue
        }

        const immutableBytes = buildImmutableChunkBytes(
          opData.tokenName,
          opData.tokenScript,
          opData.tokenRules,
        )

        const isTransfer = opData.genesisTxId != null
        const genesisTxId = isTransfer ? opData.genesisTxId! : txId

        // Handle fungible tokens separately
        if (isFungible && fungibleOutputs.length > 0) {
          // Fungible tokens always use genesisOutputIndex = 1
          const genesisOutputIndex = 1
          const tokenId = computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes)

          // SPV verification
          const verification = await this.verifyBeforeImport(
            tokenId, genesisTxId, genesisOutputIndex, immutableBytes,
            opData.proofChainEntries ?? [], txId,
          )
          if (!verification.valid) {
            onStatus?.(`Rejected fungible token: ${opData.tokenName} — ${verification.reason}`)
            continue
          }

          // Check if we already have this fungible token
          let fungibleToken = await this.store.getFungibleToken(tokenId)

          if (fungibleToken) {
            // Add new UTXOs to existing basket
            const now = new Date().toISOString()
            for (const output of fungibleOutputs) {
              const existingUtxo = fungibleToken.utxos.find(
                u => u.txId === txId && u.outputIndex === output.index
              )
              if (!existingUtxo) {
                fungibleToken.utxos.push({
                  txId,
                  outputIndex: output.index,
                  satoshis: output.sats,
                  status: 'active',  // Always active (pure SPV)
                  stateData: opData.stateData || undefined,  // Per-UTXO state data
                  receivedAt: now,
                  blockHeight,
                  confirmationStatus: blockHeight === 0 ? 'unconfirmed' : 'confirmed',
                })
                const confirmLabel = blockHeight === 0 ? ' (unconfirmed)' : ''
                onStatus?.(`Found fungible UTXO: ${opData.tokenName} +${output.sats} sats${confirmLabel}`)
              } else if (existingUtxo.blockHeight === 0 && blockHeight > 0) {
                // Unconfirmed UTXO just got confirmed - update metadata only
                existingUtxo.blockHeight = blockHeight
                existingUtxo.confirmationStatus = 'confirmed'
                onStatus?.(`Confirmed fungible UTXO: ${opData.tokenName} +${output.sats} sats`)
              }
            }
            // Also update token-level state data for backwards compatibility
            fungibleToken.stateData = opData.stateData
            await this.store.updateFungibleToken(fungibleToken)
          } else {
            // Create new fungible token with UTXOs
            const now = new Date().toISOString()
            fungibleToken = {
              tokenId,
              genesisTxId,
              tokenName: opData.tokenName,
              tokenScript: opData.tokenScript,
              tokenRules: opData.tokenRules,
              tokenAttributes: opData.tokenAttributes,
              stateData: opData.stateData,
              utxos: fungibleOutputs.map(o => ({
                txId,
                outputIndex: o.index,
                satoshis: o.sats,
                status: 'active',  // Always active (pure SPV)
                stateData: opData.stateData || undefined,  // Per-UTXO state data
                receivedAt: now,
                blockHeight,
                confirmationStatus: blockHeight === 0 ? 'unconfirmed' : 'confirmed',
              })),
              createdAt: now,
            }
            await this.store.addFungibleToken(fungibleToken, verification.chain)
            const confirmLabel = blockHeight === 0 ? ' (unconfirmed)' : ''
            onStatus?.(`Found fungible token: ${opData.tokenName}${confirmLabel} (${fungibleOutputs.reduce((s, o) => s + o.sats, 0)} sats)`)
          }
          continue
        }

        // NFT handling (original logic)
        if (unspentP2pkhIndices.length === 0) {
          continue  // No unspent 1-sat outputs for NFT
        }

        if (isTransfer) {
          // Transfer TX: single token, P2PKH at first matched output
          const p2pkhOutputIndex = unspentP2pkhIndices[0]
          // v05.21: derive genesisOutputIndex from Input 0 of the TX we already have
          console.debug(`checkIncoming TRANSFER: txId=${txId.slice(0, 12)}..., genesisTxId=${genesisTxId?.slice(0, 12)}..., p2pkhOutputIndex=${p2pkhOutputIndex}`)
          const genesisOutputIndex = await this.deriveGenesisOutputIndex(tx, genesisTxId)
          if (genesisOutputIndex === null) {
            console.debug(`checkIncoming TRANSFER: failed to derive genesisOutputIndex for ${txId.slice(0, 12)}...`)
            continue
          }
          console.debug(`checkIncoming TRANSFER: derived genesisOutputIndex=${genesisOutputIndex}`)

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
          // Skip if already active
          if (existing && existing.status === 'active') {
            console.debug(`[tokenBuilder] Skipping token ${tokenId.slice(0,12)}... (existing with status=active)`)
            continue
          }
          // Pending token just got confirmed - update to active
          if (existing && existing.status === 'pending' && !isUnconfirmedTx) {
            existing.status = 'active'
            await this.store.updateToken(existing)
            onStatus?.(`Confirmed token: ${existing.tokenName} (${tokenId.slice(0, 12)}...)`)
            continue
          }
          // Still pending, skip
          if (existing && existing.status === 'pending') continue
          // Return-to-sender: token was sent away but came back to us
          if (existing && (existing.status === 'transferred' || existing.status === 'pending_transfer')) {
            console.log(`[tokenBuilder] ✓ RETURN-TO-SENDER path: ${opData.tokenName}, status=${existing.status}`)
            existing.status = 'active'
            existing.currentTxId = txId
            existing.currentOutputIndex = p2pkhOutputIndex
            existing.transferTxId = undefined
            existing.stateData = opData.stateData

            // For CALL tokens: re-extract addresses for returned tokens
            // When a CALL token comes back, we need to validate the addresses match original
            console.debug(`[tokenBuilder] isCALL=${opData.tokenName?.startsWith('CALL-')}`)
            if (opData.tokenName?.startsWith('CALL-')) {
              console.log(`[tokenBuilder] 📞 CALL token (RETURNED) detected: ${opData.tokenName}, extracting addresses`)
              console.debug(`[tokenBuilder] Return-to-sender: existing token has caller=${existing.caller?.slice(0,20)}, callee=${existing.callee?.slice(0,20)}`)
              try {
                // Extract callee from the P2PKH output (who the token is being sent to)
                const calleeOutput = tx.outputs[p2pkhOutputIndex]
                console.debug(`[tokenBuilder] calleeOutput exists=${!!calleeOutput}, hasLockingScript=${!!calleeOutput?.lockingScript}`)
                if (calleeOutput?.lockingScript) {
                  const calleeAddrScript = calleeOutput.lockingScript.toHex()
                  console.debug(`[tokenBuilder] calleeAddrScript=${calleeAddrScript}`)
                  const calleeAddr = extractAddressFromP2pkhScript(calleeAddrScript)
                  console.debug(`[tokenBuilder] extractAddressFromP2pkhScript returned: ${calleeAddr}`)
                  if (calleeAddr) {
                    existing.callee = calleeAddr
                    console.log(`[tokenBuilder] ✅ CALLEE (RETURNED) extracted: ${calleeAddr}`)
                  } else {
                    console.warn(`[tokenBuilder] ⚠️ CALLEE extraction failed (returned null)`)
                  }
                } else {
                  console.warn(`[tokenBuilder] ⚠️ calleeOutput or lockingScript missing at index ${p2pkhOutputIndex}`)
                }

                // Extract caller from input 0
                console.debug(`[tokenBuilder] tx.inputs?.length=${tx.inputs?.length}`)
                if (tx.inputs?.length > 0) {
                  let callerAddr = extractCallerFromSPVEnvelope(tx.inputs[0] as any)
                  console.debug(`[tokenBuilder] extractCallerFromSPVEnvelope returned: ${callerAddr}`)
                  if (!callerAddr) {
                    console.debug(`[tokenBuilder] SPV envelope failed, trying blockchain method...`)
                    callerAddr = await extractCallerFromBlockchain(this.provider, tx.inputs[0] as any)
                    console.debug(`[tokenBuilder] extractCallerFromBlockchain returned: ${callerAddr}`)
                  }
                  if (callerAddr) {
                    existing.caller = callerAddr
                    console.log(`[tokenBuilder] ✅ CALLER (RETURNED) extracted: ${callerAddr}`)
                  } else {
                    console.warn(`[tokenBuilder] ⚠️ CALLER extraction failed (both methods returned null)`)
                  }
                } else {
                  console.warn(`[tokenBuilder] ⚠️ No inputs in transaction (tx.inputs empty)`)
                }

                console.log(`[tokenBuilder] ✅ CALL token address extraction complete:`, {
                  caller: existing.caller?.slice(0, 20),
                  callee: existing.callee?.slice(0, 20)
                })
              } catch (e: any) {
                console.error(`[tokenBuilder] ❌ Error extracting CALL token addresses (returned): ${e?.message}`)
              }
            }

            await this.store.updateToken(existing)
            await this.store.addToken(existing, verification.chain)

            imported.push(existing)
            onStatus?.(`Returned token: ${existing.tokenName} (${tokenId.slice(0, 12)}...)`)
            continue
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
              status: 'active',  // Always active (pure SPV)
              blockHeight,
              confirmationStatus: blockHeight === 0 ? 'unconfirmed' : 'confirmed',
              createdAt: new Date().toISOString(),
            }

            // For CALL tokens: extract caller and callee addresses from transaction
            console.debug(`[tokenBuilder] Token received for address extraction check`)
            console.debug(`[tokenBuilder] tokenName="${opData.tokenName}", isTransfer=${isTransfer}, p2pkhOutputIndex=${p2pkhOutputIndex}`)
            console.debug(`[tokenBuilder] tx.outputs.length=${tx.outputs.length}, tx.inputs.length=${tx.inputs?.length}`)
            console.debug(`[tokenBuilder] Checking token type: tokenName="${opData.tokenName}", startsWith('CALL-')=${opData.tokenName?.startsWith('CALL-')}`)
            if (opData.tokenName?.startsWith('CALL-')) {
              console.log(`[tokenBuilder] 📞 CALL token detected: ${opData.tokenName}, extracting addresses from tx`)
              try {
                // Extract callee: recipient of the token output (P2PKH)
                const calleeOutput = tx.outputs[p2pkhOutputIndex]
                console.debug(`[tokenBuilder] calleeOutput at index ${p2pkhOutputIndex}:`, {
                  exists: !!calleeOutput,
                  hasLockingScript: !!calleeOutput?.lockingScript
                })
                if (calleeOutput?.lockingScript) {
                  const calleeAddrScript = calleeOutput.lockingScript.toHex()
                  console.debug(`[tokenBuilder] Callee script hex: ${calleeAddrScript}`)
                  const calleeAddr = extractAddressFromP2pkhScript(calleeAddrScript)
                  if (calleeAddr) {
                    token.callee = calleeAddr
                    console.log(`[tokenBuilder] ✅ CALLEE extracted: ${calleeAddr}`)
                  } else {
                    console.warn(`[tokenBuilder] ⚠️ Could not extract callee from P2PKH script: ${calleeAddrScript}`)
                  }
                } else {
                  console.warn(`[tokenBuilder] ⚠️ calleeOutput or lockingScript missing at index ${p2pkhOutputIndex}`)
                }

                // Extract caller from input 0 (works for both transfers and genesis)
                if (tx.inputs?.length > 0) {
                  const txType = isTransfer ? 'TRANSFER' : 'GENESIS'
                  console.log(`[tokenBuilder] 📡 CALL ${txType}: extracting caller from input 0`)
                  try {
                    const input0 = tx.inputs[0] as any
                    console.debug(`[tokenBuilder] Input 0 details:`, {
                      hasSourcTXID: !!input0.sourceTXID,
                      hasSourceOutputIndex: input0.sourceOutputIndex !== undefined,
                      hasSourceOutput: !!input0.sourceOutput
                    })

                    // Try Method 1: SPV envelope (fastest)
                    let callerAddr = extractCallerFromSPVEnvelope(input0)

                    // Try Method 2: Query blockchain (fallback)
                    if (!callerAddr) {
                      console.debug(`[tokenBuilder] Method 1 unavailable, trying Method 2...`)
                      callerAddr = await extractCallerFromBlockchain(this.provider, input0)
                    }

                    if (callerAddr) {
                      token.caller = callerAddr
                      console.log(`[tokenBuilder] ✅ CALLER extracted: ${callerAddr}`)
                    } else {
                      console.warn(`[tokenBuilder] ⚠️ Could not extract caller (both methods failed)`)
                    }
                  } catch (e: any) {
                    console.error(`[tokenBuilder] ❌ Unexpected error extracting caller: ${e?.message}`)
                  }
                } else {
                  console.warn(`[tokenBuilder] ⚠️ No inputs in transaction`)
                }
              } catch (e: any) {
                console.error(`[tokenBuilder] ❌ Error extracting CALL token addresses: ${e?.message}`)
              }
              console.log(`[tokenBuilder] ✓ CALL token address extraction complete:`, {
                tokenName: token.tokenName,
                caller: token.caller?.slice(0, 20),
                callee: token.callee?.slice(0, 20)
              })
            }

            await this.store.addToken(token, verification.chain)
            imported.push(token)
            const confirmLabel = blockHeight === 0 ? ' (unconfirmed)' : ''
            onStatus?.(`Found token: ${token.tokenName}${confirmLabel} (${tokenId.slice(0, 12)}...)`)
          }
        } else {
          // Genesis TX: one token per P2PKH output
          // Verify once for the first token (all share the same genesis TX)
          const firstTokenId = computeTokenId(genesisTxId, unspentP2pkhIndices[0], immutableBytes)
          const genesisVerification = await this.verifyBeforeImport(
            firstTokenId, genesisTxId, unspentP2pkhIndices[0], immutableBytes,
            [], txId,
          )
          if (!genesisVerification.valid) {
            onStatus?.(`Rejected token: ${opData.tokenName} — ${genesisVerification.reason}`)
            continue
          }

          for (const p2pkhOutputIndex of unspentP2pkhIndices) {
            const tokenId = computeTokenId(genesisTxId, p2pkhOutputIndex, immutableBytes)
            const existing = await this.store.getToken(tokenId)
            if (existing && existing.status === 'active') {
              // Token exists - check if confirmation status needs updating
              if (existing.blockHeight === 0 && blockHeight > 0) {
                existing.blockHeight = blockHeight
                existing.confirmationStatus = 'confirmed'
                await this.store.updateToken(existing)
                onStatus?.(`Confirmed token: ${existing.tokenName} (${tokenId.slice(0, 12)}...)`)
              }
              continue
            }

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

            // Genesis TX: p2pkhOutputIndex IS the genesisOutputIndex
            console.debug(`checkIncoming GENESIS: p2pkhOutputIndex=${p2pkhOutputIndex}`)
            const token: OwnedToken = {
              tokenId,
              genesisTxId,
              genesisOutputIndex: p2pkhOutputIndex,
              currentTxId: txId,
              currentOutputIndex: p2pkhOutputIndex,
              tokenName: opData.tokenName,
              tokenScript: opData.tokenScript,
              tokenRules: opData.tokenRules,
              tokenAttributes: opData.tokenAttributes,
              stateData: opData.stateData,
              satoshis: TOKEN_SATS,
              status: 'active',  // Always active (pure SPV)
              blockHeight,
              confirmationStatus: blockHeight === 0 ? 'unconfirmed' : 'confirmed',
              createdAt: new Date().toISOString(),
            }

            // For CALL tokens in Genesis TX: extract caller and callee addresses
            console.debug(`[tokenBuilder] Checking Genesis token type: tokenName="${opData.tokenName}", startsWith('CALL-')=${opData.tokenName?.startsWith('CALL-')}`)
            if (opData.tokenName?.startsWith('CALL-')) {
              console.log(`[tokenBuilder] 📞 CALL token (GENESIS) detected: ${opData.tokenName}, extracting addresses from tx`)
              try {
                // Extract callee: recipient of the token output (P2PKH)
                const calleeOutput = tx.outputs[p2pkhOutputIndex]
                console.debug(`[tokenBuilder] GENESIS: calleeOutput at index ${p2pkhOutputIndex}:`, {
                  exists: !!calleeOutput,
                  hasLockingScript: !!calleeOutput?.lockingScript
                })
                if (calleeOutput?.lockingScript) {
                  const calleeAddrScript = calleeOutput.lockingScript.toHex()
                  console.debug(`[tokenBuilder] GENESIS: Callee script hex: ${calleeAddrScript}`)
                  const calleeAddr = extractAddressFromP2pkhScript(calleeAddrScript)
                  if (calleeAddr) {
                    token.callee = calleeAddr
                    console.log(`[tokenBuilder] ✅ CALLEE (GENESIS) extracted: ${calleeAddr}`)
                  } else {
                    console.warn(`[tokenBuilder] ⚠️ Could not extract callee from P2PKH script: ${calleeAddrScript}`)
                  }

                  // Extract caller from input 0 (Genesis TX sender)
                  if (tx.inputs?.length > 0) {
                    console.log(`[tokenBuilder] 📡 CALL GENESIS: extracting caller from input 0`)
                    try {
                      const input0 = tx.inputs[0] as any
                      console.debug(`[tokenBuilder] GENESIS: Input 0 details:`, {
                        hasSourceTXID: !!input0.sourceTXID,
                        hasSourceOutputIndex: input0.sourceOutputIndex !== undefined,
                        hasSourceOutput: !!input0.sourceOutput
                      })

                      // Try Method 1: SPV envelope (fastest)
                      let callerAddr = extractCallerFromSPVEnvelope(input0)

                      // Try Method 2: Query blockchain (fallback)
                      if (!callerAddr) {
                        console.debug(`[tokenBuilder] GENESIS: Method 1 unavailable, trying Method 2...`)
                        callerAddr = await extractCallerFromBlockchain(this.provider, input0)
                      }

                      if (callerAddr) {
                        token.caller = callerAddr
                        console.log(`[tokenBuilder] ✅ CALLER (GENESIS) extracted: ${callerAddr}`)
                      } else {
                        console.warn(`[tokenBuilder] ⚠️ Could not extract caller (both methods failed)`)
                      }
                    } catch (e: any) {
                      console.error(`[tokenBuilder] ❌ Unexpected error extracting caller: ${e?.message}`)
                    }
                  } else {
                    console.warn(`[tokenBuilder] ⚠️ No inputs in GENESIS transaction`)
                  }
                } else {
                  console.warn(`[tokenBuilder] ⚠️ GENESIS: calleeOutput or lockingScript missing at index ${p2pkhOutputIndex}`)
                }
              } catch (e: any) {
                console.error(`[tokenBuilder] ❌ Error extracting CALL token addresses (GENESIS): ${e?.message}`)
              }
              console.log(`[tokenBuilder] ✓ CALL token (GENESIS) address extraction complete:`, {
                tokenName: token.tokenName,
                caller: token.caller?.slice(0, 20),
                callee: token.callee?.slice(0, 20)
              })
            }

            await this.store.addToken(token, genesisVerification.chain)
            imported.push(token)
            const confirmLabel = blockHeight === 0 ? ' (unconfirmed)' : ''
            onStatus?.(`Found token: ${token.tokenName}${confirmLabel} #${p2pkhOutputIndex} (${tokenId.slice(0, 12)}...)`)
          }
        }
      } catch (e) {
        console.debug(`checkIncoming: skipping TX ${txId}:`, e)
        continue
      }
    }

    console.debug(`checkIncoming: Completed scan. Skipped ${skippedConfirmed} confirmed TXs, imported ${imported.length} new token(s).`)
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
    // Try NFT storage first, then fungible storage
    let token = await this.store.getToken(tokenId)

    if (!token) {
      // Check fungible token storage
      const fungibleToken = await this.store.getFungibleToken(tokenId)
      if (fungibleToken) {
        // Adapt fungible token to the shape we need for verification
        // Fungible tokens always use outputIndex = 1
        token = {
          tokenId: fungibleToken.tokenId,
          genesisTxId: fungibleToken.genesisTxId,
          genesisOutputIndex: 1,
          currentTxId: fungibleToken.utxos[0]?.txId || fungibleToken.genesisTxId,
          currentOutputIndex: fungibleToken.utxos[0]?.outputIndex || 1,
          tokenName: fungibleToken.tokenName,
          tokenScript: fungibleToken.tokenScript,
          tokenRules: fungibleToken.tokenRules,
          tokenAttributes: fungibleToken.tokenAttributes,
          stateData: fungibleToken.stateData,
          satoshis: fungibleToken.utxos.reduce((sum, u) => sum + u.satoshis, 0),
          status: 'active' as const,
        }
      }
    }

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

  // ── Call Signal TX ────────────────────────────────────────────

  /**
   * Build and broadcast a single-TX call signal using the P OP_RETURN format.
   * No genesis+transfer; the signal goes directly to recipientAddress in one TX.
   *
   * TX structure:
   *   Output 0: OP_RETURN (0 sats) — P v03 format with call/answer data
   *   Output 1: P2PKH 1-sat → recipientAddress (WoC address history indexing)
   *   Output 2: P2PKH change → caller
   *
   * @param tokenName       "CALL-{ident}" or "ANS-{ident}"
   * @param restrictions    16-char hex (callerHash4 + calleeHash4, 8 bytes)
   * @param tokenAttributes binary hex from encodeCallAttributes()
   * @param recipientAddress callee (CALL) or caller (ANS) BSV address
   * @param feePerKb        sat/KB fee rate (default 1.1 — ephemeral signals)
   */
  async createCallSignalTx(
    tokenName: string,
    restrictions: string,
    tokenAttributes: string,
    recipientAddress: string,
    feePerKb: number = 1.1,
  ): Promise<{ txId: string }> {
    const utxos = await this.getSafeUtxos()
    if (utxos.length === 0) {
      throw new Error('No spendable UTXOs. Fund your wallet address first.')
    }

    const opReturnScript = encodeOpReturn({
      tokenName,
      tokenScript: '',
      tokenRules: restrictions,
      tokenAttributes,
      stateData: '',
    })

    const opReturnBytes = opReturnScript.toBinary()
    const opReturnVarInt = opReturnBytes.length < 0xfd ? 1 : 3
    const opReturnOutputSize = 8 + opReturnVarInt + opReturnBytes.length
    const estSize = TX_OVERHEAD + BYTES_PER_INPUT + opReturnOutputSize + 2 * BYTES_PER_P2PKH_OUTPUT
    const fee = Math.ceil(estSize * feePerKb / 1000)

    const sorted = [...utxos].sort((a, b) => a.satoshis - b.satoshis)
    const utxo = sorted.find(u => u.satoshis >= TOKEN_SATS + fee)
    if (!utxo) {
      const best = sorted[sorted.length - 1]
      throw new Error(
        `Insufficient funds: need ${TOKEN_SATS + fee} sats, best UTXO has ${best?.satoshis ?? 0} sats.`
      )
    }

    const sourceTx = await this.provider.getSourceTransaction(utxo.txId)
    const tx = new Transaction()
    tx.addInput({
      sourceTransaction: sourceTx,
      sourceOutputIndex: utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(this.key),
    })
    tx.addOutput({ lockingScript: opReturnScript, satoshis: 0 })
    tx.addOutput({ lockingScript: new P2PKH().lock(recipientAddress), satoshis: TOKEN_SATS })

    const changeAmount = utxo.satoshis - TOKEN_SATS - fee
    tx.addOutput({ lockingScript: new P2PKH().lock(this.myAddress), satoshis: changeAmount })

    await tx.sign()
    const txId = tx.id('hex') as string
    await this.provider.broadcast(tx.toHex())

    this.provider.registerPendingTx(
      txId,
      [{ txId: utxo.txId, outputIndex: utxo.outputIndex }],
      changeAmount > 0 ? { outputIndex: 2, satoshis: changeAmount } : undefined,
    )

    return { txId }
  }

  // ── Transaction Building (wallet internals) ───────────────────

  private async buildFundedTx(
    utxos: Utxo[],
    changeAddress: string,
    addOutputs: (tx: Transaction) => void,
  ): Promise<{
    tx: Transaction
    rawHex: string
    txId: string
    fee: number
    spentInputs: Array<{ txId: string; outputIndex: number }>
    changeOutput: { outputIndex: number; satoshis: number } | null
  }> {
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

      const changeOutputIndex = tx.outputs.length
      tx.addOutput({
        lockingScript: new P2PKH().lock(changeAddress),
        satoshis: changeAmount,
      })

      await tx.sign()

      const txId = tx.id('hex') as string
      return {
        tx,
        rawHex: tx.toHex(),
        txId,
        fee,
        spentInputs: combo.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
        changeOutput: changeAmount > 0 ? { outputIndex: changeOutputIndex, satoshis: changeAmount } : null,
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
  ): Promise<{
    tx: Transaction
    rawHex: string
    txId: string
    fee: number
    spentInputs: Array<{ txId: string; outputIndex: number }>
    changeOutput: { outputIndex: number; satoshis: number } | null
  }> {
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

      const changeOutputIndex = tx.outputs.length
      tx.addOutput({
        lockingScript: new P2PKH().lock(changeAddress),
        satoshis: changeAmount,
      })

      await tx.sign()

      const txId = tx.id('hex') as string
      const tokenTxId = tokenSourceTx.id('hex') as string
      return {
        tx,
        rawHex: tx.toHex(),
        txId,
        fee,
        spentInputs: [
          { txId: tokenTxId, outputIndex: tokenOutputIndex },
          ...combo.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
        ],
        changeOutput: changeAmount > 0 ? { outputIndex: changeOutputIndex, satoshis: changeAmount } : null,
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
  ): Promise<{
    tx: Transaction
    rawHex: string
    txId: string
    fee: number
    spentInputs: Array<{ txId: string; outputIndex: number }>
    changeOutput: { outputIndex: number; satoshis: number } | null
  }> {
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

      // Output 3: Fee change (or Output 2 if no token change)
      const feeChangeOutputIndex = tx.outputs.length
      tx.addOutput({
        lockingScript: new P2PKH().lock(changeAddress),
        satoshis: feeChangeAmount,
      })

      await tx.sign()

      const txId = tx.id('hex') as string
      // Collect all spent inputs: token sources + funding combo
      const spentInputs: Array<{ txId: string; outputIndex: number }> = [
        ...tokenSources.map(s => ({ txId: s.tx.id('hex') as string, outputIndex: s.outputIndex })),
        ...combo.map(u => ({ txId: u.txId, outputIndex: u.outputIndex })),
      ]
      return {
        tx,
        rawHex: tx.toHex(),
        txId,
        fee,
        spentInputs,
        changeOutput: feeChangeAmount > 0 ? { outputIndex: feeChangeOutputIndex, satoshis: feeChangeAmount } : null,
      }
    }

    const totalFunding = fundingUtxos.reduce((s, u) => s + u.satoshis, 0)
    throw new Error(
      `Insufficient funding balance (${totalFunding} sats) to cover transfer fees. ${lastError}`
    )
  }

  /**
   * Recover a flushed token: change status from 'flushed' back to 'active'
   * (internal-only, no blockchain transaction)
   */
  async recoverToken(tokenId: string): Promise<{ tokenId: string; status: string }> {
    const token = await this.store.getToken(tokenId)
    if (!token) throw new Error(`Token not found: ${tokenId}`)

    if (token.status !== 'flushed') {
      throw new Error(`Token is not flushed (current status: ${token.status})`)
    }

    // Change status back to active
    token.status = 'active'
    token.flushedAt = undefined
    await this.store.updateToken(token)

    console.debug(`recoverToken: restored token ${tokenId} to active status`)
    return { tokenId, status: 'active' }
  }

  /**
   * Recover a flushed fungible UTXO: change status from 'flushed' back to 'active'
   * (internal-only, no blockchain transaction)
   */
  async recoverFungibleUtxo(tokenId: string, utxoIndex: number): Promise<{ tokenId: string; utxoIndex: number }> {
    const fungible = await this.store.getFungibleToken(tokenId)
    if (!fungible) throw new Error(`Fungible token not found: ${tokenId}`)

    const utxo = fungible.utxos[utxoIndex]
    if (!utxo) throw new Error(`UTXO index out of range: ${utxoIndex}`)

    if (utxo.status !== 'flushed') {
      throw new Error(`UTXO is not flushed (current status: ${utxo.status})`)
    }

    // Change status back to active
    utxo.status = 'active'
    utxo.flushedAt = undefined
    await this.store.updateFungibleToken(fungible)

    console.debug(`recoverFungibleUtxo: restored UTXO ${utxoIndex} of ${tokenId} to active status`)
    return { tokenId, utxoIndex }
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

/**
 * Convert a 20-byte pubKeyHash (hex) back to a BSV Base58Check address
 * Reverse of addressToPubKeyHash
 * @private
 */
function pubKeyHashToAddress(pubKeyHashHex: string): string | null {
  try {
    if (pubKeyHashHex.length !== 40) return null // Must be exactly 20 bytes (40 hex chars)

    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    // Mainnet version byte = 0x00
    const versionedHash = '00' + pubKeyHashHex

    // Compute checksum: first 4 bytes (8 hex chars) of SHA256(SHA256(versionedHash))
    // Convert hex string to byte array (browser-compatible, no Buffer)
    const hexToByteArray = (hex: string): number[] => {
      const bytes: number[] = []
      for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16))
      }
      return bytes
    }

    const versionedHashBytes = hexToByteArray(versionedHash)
    const firstSha = Hash.sha256(versionedHashBytes)
    const secondSha = Hash.sha256(Array.from(firstSha))
    const checksumHex = Array.from(secondSha)
      .slice(0, 4)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Full address bytes = version + pubKeyHash + checksum
    const fullHex = versionedHash + checksumHex

    // BigInt from hex
    let num = BigInt('0x' + fullHex)

    // Base58 encode
    let encoded = ''
    while (num > BigInt(0)) {
      encoded = ALPHABET[Number(num % BigInt(58n))] + encoded
      num = num / BigInt(58n)
    }

    // Pad with leading '1's for leading zero bytes
    let zeros = 0
    for (let i = 0; i < fullHex.length; i += 2) {
      if (fullHex.substr(i, 2) === '00') zeros++
      else break
    }
    encoded = '1'.repeat(zeros) + encoded

    console.debug(`pubKeyHashToAddress: converted ${pubKeyHashHex.slice(0, 8)}... to ${encoded.slice(0, 8)}...`)
    return encoded || null
  } catch (error) {
    console.debug(`pubKeyHashToAddress: error converting ${pubKeyHashHex}:`, error)
    return null
  }
}

/**
 * Extract recipient address from P2PKH output script
 * @private
 */
function extractAddressFromP2pkhScript(scriptHex: string): string | null {
  // Standard P2PKH is exactly 50 hex chars: 76 a9 14 {20 bytes = 40 hex} 88 ac
  if (scriptHex.length !== 50) {
    console.debug(`extractAddressFromP2pkhScript: script length ${scriptHex.length} != 50, cannot extract`)
    return null
  }
  if (!scriptHex.startsWith('76a914') || !scriptHex.endsWith('88ac')) {
    console.debug(`extractAddressFromP2pkhScript: invalid P2PKH format (start=${scriptHex.slice(0, 6)}, end=${scriptHex.slice(-4)})`)
    return null
  }

  const pubKeyHashHex = scriptHex.slice(6, 46) // extract the 20-byte pubKeyHash
  console.debug(`extractAddressFromP2pkhScript: extracted pubKeyHash ${pubKeyHashHex.slice(0, 8)}...`)
  const addr = pubKeyHashToAddress(pubKeyHashHex)
  if (!addr) {
    console.debug(`extractAddressFromP2pkhScript: pubKeyHashToAddress returned null for ${pubKeyHashHex.slice(0, 8)}...`)
  }
  return addr
}

/**
 * Extract caller address from SPV envelope (BEEF format)
 * Works for unconfirmed transactions that include the previous output in the envelope
 * @private
 */
function extractCallerFromSPVEnvelope(input: any): string | null {
  try {
    if (input.sourceOutput?.lockingScript) {
      const scriptHex = input.sourceOutput.lockingScript.toHex()
      const addr = extractAddressFromP2pkhScript(scriptHex)
      if (addr) {
        console.log(`[tokenBuilder] ✅ [Method 1] CALLER from SPV envelope: ${addr}`)
        return addr
      }
    }
  } catch (e: any) {
    console.debug(`[tokenBuilder] Note: SPV envelope method failed: ${e?.message}`)
  }
  return null
}

/**
 * Extract caller address by querying blockchain for previous transaction
 * Fallback method when SPV envelope not available
 * @private
 */
async function extractCallerFromBlockchain(provider: any, input: any): Promise<string | null> {
  try {
    if (!input.sourceTXID || input.sourceOutputIndex === undefined) return null

    console.debug(`[tokenBuilder] 🌐 [Method 2] Querying blockchain for prev TX: ${input.sourceTXID.slice(0, 12)}...`)
    const prevTx = await provider.getSourceTransaction(input.sourceTXID)

    if (prevTx.outputs?.[input.sourceOutputIndex]) {
      const prevOutput = prevTx.outputs[input.sourceOutputIndex]
      if (prevOutput.lockingScript) {
        const scriptHex = prevOutput.lockingScript.toHex()
        const addr = extractAddressFromP2pkhScript(scriptHex)
        if (addr) {
          console.log(`[tokenBuilder] ✅ [Method 2] CALLER from blockchain: ${addr}`)
          return addr
        }
      }
    }
  } catch (e: any) {
    console.warn(`[tokenBuilder] Note: Blockchain query method failed: ${e?.message}`)
  }
  return null
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
