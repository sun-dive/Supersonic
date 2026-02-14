/**
 * Call Token Manager (v06.08)
 *
 * Orchestrates the full lifecycle of SVphone call tokens:
 * - Creates genesis token with CALL_TOKEN_RULES
 * - Transfers token to recipient (makes discoverable via polling)
 * - Waits for Merkle proof confirmation (BLOCKING - required for calls)
 *
 * Note: Call tokens must be confirmed on blockchain before use.
 * This ensures only valid tokens can initiate connections (~10 minute wait).
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
   * Full lifecycle orchestration (BLOCKING - waits for confirmation):
   * 1. Creates genesis token (tokenBuilder.createGenesis)
   * 2. Transfers to recipient (tokenBuilder.createTransfer)
   * 3. Waits for Merkle proof confirmation (tokenBuilder.pollForProof, ~10 minutes)
   *
   * Note: This method blocks until the token is confirmed on the blockchain.
   * Only confirmed tokens can initiate calls.
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

      // Transfer token to recipient so they can find it via polling
      console.debug(`[CallToken] 📤 Transferring token to recipient: ${callToken.callee}`)
      this.log(`📤 Transferring token to recipient...`, 'info')

      try {
        const transferResult = await this.tokenBuilder.createTransfer(tokenId, callToken.callee)
        console.debug(`[CallToken] ✅ Token transferred successfully!`)
        console.debug(`[CallToken] Transfer TX: ${transferResult.txId}`)
        this.log(`✓ Token transferred to recipient: ${transferResult.txId}`, 'success')
        this.log(`View transfer on blockchain: https://whatsonchain.com/tx/${transferResult.txId}`, 'info')
      } catch (err) {
        console.error(`[CallToken] ❌ Token transfer failed:`, err)
        this.log(`⚠️ Token transfer failed: ${err.message}`, 'warning')
        throw err
      }

      // Wait for Merkle proof confirmation (BLOCKING - required before call can proceed)
      console.debug(`[CallToken] ⏳ Waiting for token confirmation before initiating call`)
      this.log('✓ Token created. Call will proceed when confirmed (~10 minutes)...', 'info')

      try {
        const found = await this.tokenBuilder.pollForProof(tokenId, result.txId, (msg) => {
          console.debug(`[CallToken] Proof status: ${msg}`)
          // Don't spam UI with every polling message, just show in console
        })

        if (found) {
          console.debug(`[CallToken] ✅ Merkle proof confirmed!`)
          this.log('✓ Token confirmed - proceeding with call', 'success')
        } else {
          console.warn(`[CallToken] ⚠️ Proof polling timed out`)
          this.log('⚠️ Token confirmation timed out. Call may not proceed.', 'warning')
          throw new Error('Token confirmation timed out')
        }
      } catch (err) {
        console.error(`[CallToken] Error polling for proof:`, err)
        this.log(`Error waiting for confirmation: ${err.message}`, 'error')
        throw err
      }

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
