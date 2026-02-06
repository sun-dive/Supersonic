/**
 * Flushed Token Recovery System (v05.23)
 *
 * When a token is flushed, its 1-sat UTXO is spent as regular sats.
 * The recovery system scans for these historic spends and re-imports
 * the token metadata if the UTXO is still unspent on the blockchain.
 *
 * Recovery Process:
 * 1. Query address transaction history
 * 2. Filter for TXs that spent 1-sat outputs (likely flushed tokens)
 * 3. Check if those UTXOs are still unspent
 * 4. Re-import tokens with original metadata and status='recovered'
 */

import type { WalletProvider } from './walletProvider'
import type { TokenStore, OwnedToken } from './tokenStore'
import type { Utxo } from './walletProvider'

/**
 * Information about a potentially flushed token found on blockchain
 */
export interface FlushedTokenInfo {
  flushedTxId: string        // TX that spent the 1-sat token UTXO
  blockHeight: number        // Confirmation height
  satoshis: number           // Amount in flushed output
  isSpent: boolean           // Whether this UTXO has been spent since
  originalTokenId?: string   // If known from local storage
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  recovered: OwnedToken[]    // Successfully recovered tokens
  failed: string[]           // Failed recovery attempts (error messages)
  unspent: FlushedTokenInfo[] // Flushed tokens still unspent (recoverable)
}

/**
 * Scan the blockchain for flushed tokens and attempt recovery
 */
export async function scanAndRecoverFlushedTokens(
  provider: WalletProvider,
  store: TokenStore,
  onStatus?: (msg: string) => void,
): Promise<RecoveryResult> {
  onStatus?.('Scanning for flushed tokens...')

  const result: RecoveryResult = {
    recovered: [],
    failed: [],
    unspent: [],
  }

  try {
    // Get address transaction history
    const history = await provider.getAddressHistory()
    const utxos = await provider.getUtxos()

    // Build set of currently unspent UTXOs: "txId:outputIndex"
    const unspentSet = new Set<string>()
    for (const u of utxos) {
      unspentSet.add(`${u.txId}:${u.outputIndex}`)
    }

    onStatus?.(`Checking ${history.length} transactions...`)

    // Get all tokens with flushed metadata to help identify flushed UTXOs
    const allTokens = await store.listTokens()
    const tokensByFlushTx = new Map<string, OwnedToken>()
    for (const token of allTokens) {
      if (token.flushTxId) {
        tokensByFlushTx.set(token.flushTxId, token)
      }
    }

    // Scan for 1-sat outputs in transaction history
    for (const histTx of history) {
      try {
        const tx = await provider.getSourceTransaction(histTx.txId)
        const outputs = tx.getOutputs()

        for (let i = 0; i < outputs.length; i++) {
          const output = outputs[i]
          const outpoint = `${histTx.txId}:${i}`

          // Look for 1-sat outputs (typical token UTXO value)
          if (output.satoshis === 1) {
            const isCurrentlySpent = !unspentSet.has(outpoint)

            // Check if we have metadata for this flushed UTXO
            let originalToken: OwnedToken | undefined
            for (const token of allTokens) {
              if (token.flushTxId === histTx.txId && !isCurrentlySpent) {
                originalToken = token
                break
              }
            }

            if (!isCurrentlySpent && originalToken) {
              // This 1-sat UTXO is still unspent and we have its metadata
              result.unspent.push({
                flushedTxId: histTx.txId,
                blockHeight: histTx.blockHeight,
                satoshis: 1,
                isSpent: false,
                originalTokenId: originalToken.tokenId,
              })
            }
          }
        }
      } catch (e: any) {
        // Silently skip TXs we can't fetch
        continue
      }
    }

    onStatus?.(
      `Found ${result.unspent.length} recoverable flushed token(s)`,
    )

    // Attempt to recover each unspent flushed token
    for (const flushed of result.unspent) {
      try {
        if (!flushed.originalTokenId) {
          result.failed.push(`Unknown token ID for flushed TX ${flushed.flushedTxId}`)
          continue
        }

        const token = await store.getToken(flushed.originalTokenId)
        if (!token) {
          result.failed.push(`Token metadata not found for ${flushed.originalTokenId}`)
          continue
        }

        // Restore token status to 'recovered'
        token.status = 'recovered'
        token.flushedAt = undefined
        token.flushTxId = undefined

        await store.updateToken(token)
        result.recovered.push(token)

        onStatus?.(
          `Recovered: ${token.tokenName} (${token.tokenId.slice(0, 12)}...)`,
        )
      } catch (e: any) {
        result.failed.push(`Recovery failed for ${flushed.originalTokenId}: ${e.message}`)
      }
    }
  } catch (e: any) {
    result.failed.push(`Scan failed: ${e.message}`)
  }

  return result
}

/**
 * Check if a specific token can be recovered by searching for its flushed UTXO
 */
export async function canRecoverToken(
  tokenId: string,
  provider: WalletProvider,
  store: TokenStore,
): Promise<boolean> {
  try {
    const token = await store.getToken(tokenId)
    if (!token || !token.flushTxId) return false

    // Get the flush TX and check if any of its outputs are still unspent
    const history = await provider.getAddressHistory()
    const utxos = await provider.getUtxos()

    const unspentSet = new Set<string>()
    for (const u of utxos) {
      unspentSet.add(`${u.txId}:${u.outputIndex}`)
    }

    // Find the flush TX in history
    const flushHistTx = history.find(h => h.txId === token.flushTxId)
    if (!flushHistTx) return false

    // Get outputs from flush TX
    const tx = await provider.getSourceTransaction(token.flushTxId)
    const outputs = tx.getOutputs()

    // Check if any output is still unspent
    for (let i = 0; i < outputs.length; i++) {
      const outpoint = `${token.flushTxId}:${i}`
      if (unspentSet.has(outpoint)) {
        return true
      }
    }

    return false
  } catch {
    return false
  }
}
