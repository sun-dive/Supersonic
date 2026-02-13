/**
 * Call Token Manager (v06.08)
 *
 * Handles creation, encoding, and broadcasting of SVphone call tokens
 * Separates call token logic from the main phone interface
 */

class CallTokenManager {
  constructor(tokenBuilder, uiLogger) {
    this.tokenBuilder = tokenBuilder
    this.log = uiLogger // UI logging function
  }

  /**
   * Create and broadcast a call token to the blockchain
   * Handles: encoding, minting, transfer, and confirmation polling
   *
   * @param {Object} callToken - Call token object from signaling
   * @returns {Promise<Object>} {tokenId, txId, tokenIds}
   */
  async createAndBroadcastCallToken(callToken) {
    console.debug(`[CallToken] Creating and broadcasting call token for ${callToken.callee}`)

    const attributesHex = this.encodeCallTokenAttributes(callToken)
    const stateHex = this.encodeCallTokenState(callToken)
    const callerIdent = callToken.caller?.slice(0, 5) || 'unkn'

    this.log(`Creating call token for ${callToken.callee}`, 'info')

    try {
      // Create token on blockchain
      const result = await this.mintCallToken({
        tokenName: `svphone-call-v1-${callerIdent}`,
        tokenScript: callToken.tokenScript || '',
        attributes: attributesHex,
        supply: callToken.tokenRules?.supply || 1,
        divisibility: callToken.tokenRules?.divisibility || 0,
        restrictions: callToken.tokenRules?.restrictions || 0,
        rulesVersion: callToken.tokenRules?.version || 1,
        stateData: stateHex
      })

      const tokenId = result.tokenIds?.[0] || result.tokenId
      const genesisTx = result.txId

      console.debug(`[CallToken] ✅ Token created: ${tokenId}`)
      console.debug(`[CallToken] Genesis TX: ${genesisTx}`)

      this.log(`✓ Token created: ${tokenId}`, 'success')
      this.log(`Genesis TX: ${genesisTx}`, 'success')
      this.log(`View on blockchain: https://whatsonchain.com/tx/${genesisTx}`, 'info')

      // Transfer token to recipient so they can find it via polling
      await this.transferCallToken(tokenId, callToken.callee)

      // Poll for Merkle proof (background, don't block)
      this.waitForCallTokenConfirmation(tokenId, result.txId)

      return { tokenId, txId: result.txId, tokenIds: result.tokenIds }
    } catch (err) {
      console.error(`[CallToken] ❌ Token creation failed:`, err)
      this.log(`Token creation failed: ${err.message}`, 'error')
      throw err
    }
  }

  /**
   * Encode call token attributes (immutable metadata)
   * JSON → UTF-8 → Hex
   */
  encodeCallTokenAttributes(token) {
    const attributesJson = JSON.stringify({
      caller: token.caller,
      callee: token.callee,
      senderIp: token.senderIp,
      senderPort: token.senderPort,
      sessionKey: token.sessionKey,
      codec: token.codec,
      quality: token.quality,
      mediaTypes: token.mediaTypes
    })

    console.debug(`[CallToken] Attributes JSON: ${attributesJson.slice(0, 100)}...`)

    const attributesHex = Array.from(new TextEncoder().encode(attributesJson))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    console.debug(`[CallToken] Attributes Hex: ${attributesHex.slice(0, 50)}... (${attributesHex.length} chars)`)

    return attributesHex || '00'
  }

  /**
   * Encode call token state (mutable metadata)
   * JSON → UTF-8 → Hex
   */
  encodeCallTokenState(token) {
    const stateJson = JSON.stringify({
      status: token.status,
      initiatedAt: token.initiatedAt,
      timestamp: token.timestamp
    })

    const stateHex = Array.from(new TextEncoder().encode(stateJson))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    return stateHex
  }

  /**
   * Mint call token on blockchain
   */
  async mintCallToken(tokenData) {
    console.debug(`[CallToken] Minting token: ${tokenData.tokenName}`)

    const result = await this.tokenBuilder.createGenesis({
      tokenName: tokenData.tokenName,
      tokenScript: tokenData.tokenScript,
      attributes: tokenData.attributes,
      supply: tokenData.supply,
      divisibility: tokenData.divisibility,
      restrictions: tokenData.restrictions,
      rulesVersion: tokenData.rulesVersion,
      stateData: tokenData.stateData
    })

    return result
  }

  /**
   * Transfer call token to recipient
   * Allows recipient to find token via polling
   */
  async transferCallToken(tokenId, recipientAddress) {
    console.debug(`[CallToken] 📤 Transferring token to recipient: ${recipientAddress}`)
    this.log(`📤 Transferring token to recipient...`, 'info')

    try {
      const transferResult = await this.tokenBuilder.createTransfer(tokenId, recipientAddress)
      console.debug(`[CallToken] ✅ Token transferred successfully!`)
      console.debug(`[CallToken] Transfer TX: ${transferResult.txId}`)
      this.log(`✓ Token transferred to recipient: ${transferResult.txId}`, 'success')
      this.log(`View transfer on blockchain: https://whatsonchain.com/tx/${transferResult.txId}`, 'info')
      return transferResult
    } catch (err) {
      console.error(`[CallToken] ❌ Token transfer failed:`, err)
      this.log(`⚠️ Token transfer failed: ${err.message}`, 'warning')
      // Continue anyway - token was created, transfer can be retried
      throw err
    }
  }

  /**
   * Wait for Merkle proof confirmation
   * Polls for proof in background, updates UI when confirmed
   */
  async waitForCallTokenConfirmation(tokenId, txId) {
    console.debug(`[CallToken] ⏳ Starting proof confirmation polling`)
    this.log('⏳ Polling for Merkle proof (may take ~10 minutes)...', 'info')

    try {
      const found = await this.tokenBuilder.pollForProof(tokenId, txId, (msg) => {
        console.debug(`[CallToken] Proof status: ${msg}`)
        this.log(`Proof status: ${msg}`, 'debug')
      })

      if (found) {
        console.debug(`[CallToken] ✅ Merkle proof confirmed!`)
        this.log('✓ Merkle proof confirmed - token is now fully verified', 'success')
        // Note: Caller should update UI state (e.g., call button status)
        return true
      }
      return false
    } catch (err) {
      console.error(`[CallToken] Error polling for proof:`, err)
      this.log(`Error polling for proof: ${err.message}`, 'warning')
      return false
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
