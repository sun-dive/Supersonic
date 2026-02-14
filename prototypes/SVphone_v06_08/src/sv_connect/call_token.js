/**
 * Call Token Manager (v06.08) - PPV (Proof Payment Verification) Implementation
 *
 * Orchestrates the full lifecycle of SVphone call tokens with instant transfer UX:
 * - Creates genesis token with CALL_TOKEN_RULES
 * - Waits for genesis confirmation (BLOCKING - ~10 minutes, required before transfer)
 * - Transfers token to recipient (INSTANT - no wait after genesis confirmed)
 * - Continues Merkle proof verification in background (optional)
 *
 * PPV Model: Genesis MUST be confirmed before transfer. Subsequent transfers are instant.
 * This ensures only valid tokens initiate connections while providing instant transfer UX.
 *
 * Provides user-facing logging on top of tokenBuilder infrastructure
 */

// CALL token rules (immutable, defined once here)
const CALL_TOKEN_RULES = {
  supply: 1,              // Single NFT per call
  divisibility: 0,        // Never divisible
  restrictions: 0x0001,   // One-time-use
  version: 1              // Rules version
}

class CallTokenManager {
  constructor(tokenBuilder, uiLogger) {
    this.tokenBuilder = tokenBuilder
    this.log = uiLogger // UI logging function
  }

  /**
   * Create and broadcast a call token to the blockchain
   *
   * PPV (Proof Payment Verification) flow:
   * 1. Creates genesis token (tokenBuilder.createGenesis, instant in mempool)
   * 2. Waits for genesis confirmation (tokenBuilder.pollForProof, ~10 minutes, BLOCKING)
   * 3. Transfers to recipient (tokenBuilder.createTransfer, INSTANT after genesis confirmed)
   * 4. Returns immediately (instant UX after genesis confirmed)
   * 5. Continues background Merkle proof polling (optional, non-blocking)
   *
   * Note: Genesis MUST be confirmed before transfer can occur.
   * After genesis confirmation, transfer is instant (no wait).
   *
   * @param {Object} callToken - Call token object from signaling (must have caller, callee)
   * @returns {Promise<Object>} {tokenId, txId, tokenIds}
   */
  async createAndBroadcastCallToken(callToken) {
    console.debug(`[CallToken] Creating and broadcasting call token for ${callToken.callee}`)

    const callerIdent = callToken.caller?.slice(0, 5) || 'unkn'

    this.log(`Creating call token for ${callToken.callee}`, 'info')

    try {
      // Create simple P token for call signaling (metadata stays in signaling layer)
      const result = await this.tokenBuilder.createGenesis({
        tokenName: `CALL-${callerIdent}`,
        tokenScript: '',  // No consensus rules needed
        attributes: '00',  // Empty (metadata not stored in token)
        supply: CALL_TOKEN_RULES.supply,
        divisibility: CALL_TOKEN_RULES.divisibility,
        restrictions: CALL_TOKEN_RULES.restrictions,
        rulesVersion: CALL_TOKEN_RULES.version,
        stateData: '00'  // Empty (state tracked in signaling layer)
      })

      const tokenId = result.tokenIds?.[0] || result.tokenId
      const genesisTx = result.txId

      console.debug(`[CallToken] ✅ Token created: ${tokenId}`)
      console.debug(`[CallToken] Genesis TX: ${genesisTx}`)

      this.log(`✓ Token created: ${tokenId}`, 'success')
      this.log(`Genesis TX: ${genesisTx}`, 'success')
      this.log(`View on blockchain: https://whatsonchain.com/tx/${genesisTx}`, 'info')

      // PPV Model: Wait for genesis confirmation (BLOCKING - required before transfer)
      console.debug(`[CallToken] ⏳ Waiting for genesis confirmation before transfer`)
      this.log('⏳ Waiting for genesis confirmation (~10 minutes)...', 'info')

      try {
        const genesisConfirmed = await this.tokenBuilder.pollForProof(tokenId, result.txId, (msg) => {
          console.debug(`[CallToken] Genesis proof status: ${msg}`)
          // Don't spam UI with every polling message, just show in console
        })

        if (genesisConfirmed) {
          console.debug(`[CallToken] ✅ Genesis confirmed!`)
          this.log('✓ Genesis confirmed - transferring token (instant)...', 'success')
        } else {
          console.warn(`[CallToken] ⚠️ Genesis confirmation timed out`)
          this.log('⚠️ Genesis confirmation timed out. Cannot transfer.', 'warning')
          throw new Error('Genesis confirmation timed out')
        }
      } catch (err) {
        console.error(`[CallToken] Error waiting for genesis confirmation:`, err)
        this.log(`Error waiting for genesis confirmation: ${err.message}`, 'error')
        throw err
      }

      // Transfer token to recipient (INSTANT after genesis confirmed)
      console.debug(`[CallToken] 📤 Transferring confirmed token to recipient: ${callToken.callee}`)
      this.log(`📤 Transferring token to recipient (instant)...`, 'info')

      let transferResult
      try {
        transferResult = await this.tokenBuilder.createTransfer(tokenId, callToken.callee)
        console.debug(`[CallToken] ✅ Token transferred instantly!`)
        console.debug(`[CallToken] Transfer TX: ${transferResult.txId}`)
        this.log(`✓ Token transferred instantly: ${transferResult.txId}`, 'success')
        this.log(`View transfer on blockchain: https://whatsonchain.com/tx/${transferResult.txId}`, 'info')
      } catch (err) {
        console.error(`[CallToken] ❌ Token transfer failed:`, err)
        this.log(`⚠️ Token transfer failed: ${err.message}`, 'warning')
        throw err
      }

      // Start background Merkle proof polling (OPTIONAL - non-blocking)
      console.debug(`[CallToken] Starting background Merkle proof polling`)
      this.tokenBuilder.pollForProof(tokenId, transferResult.txId, (msg) => {
        console.debug(`[CallToken] Transfer proof status: ${msg}`)
      }).then((found) => {
        if (found) {
          console.debug(`[CallToken] ✅ Transfer Merkle proof confirmed (background)`)
        }
      }).catch((err) => {
        console.debug(`[CallToken] Transfer proof polling error (non-critical):`, err)
      })

      return { tokenId, txId: result.txId, tokenIds: result.tokenIds }
    } catch (err) {
      console.error(`[CallToken] ❌ Token creation failed:`, err)
      this.log(`Token creation failed: ${err.message}`, 'error')
      throw err
    }
  }

}

// Export for browser
if (typeof window !== 'undefined') {
  window.CallTokenManager = CallTokenManager
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CallTokenManager
}
