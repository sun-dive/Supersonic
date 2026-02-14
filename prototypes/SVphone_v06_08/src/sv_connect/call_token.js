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
   * Encode call attributes into byte-efficient binary format for blockchain storage
   *
   * Format: [Version(1)] [CallerLen(1)] [Caller(var)] [CalleeLen(1)] [Callee(var)]
   *         [IPType+IP(4-16)] [Port(2)] [KeyLen(1)] [Key(var)]
   *         [Codec(1)] [Quality(1)] [MediaTypes(1)]
   *
   * Size: ~100-150 bytes (vs 500+ for JSON)
   *
   * @param {Object} callToken - Call token with connection info
   * @returns {string} Hex-encoded binary data
   */
  encodeCallAttributes(callToken) {
    try {
      const bytes = []

      // Version marker (0x01 = binary format v1)
      bytes.push(0x01)

      // Caller address (variable-length)
      const callerBuf = new TextEncoder().encode(callToken.caller)
      bytes.push(callerBuf.length)
      bytes.push(...callerBuf)

      // Callee address (variable-length)
      const calleeBuf = new TextEncoder().encode(callToken.callee)
      bytes.push(calleeBuf.length)
      bytes.push(...calleeBuf)

      // IP address and port
      const ip = callToken.senderIp
      const port = callToken.senderPort

      // Detect IP version (0=IPv4, 1=IPv6)
      const isIPv6 = ip.includes(':')
      const ipBits = isIPv6 ? 1 : 0

      if (!isIPv6) {
        // IPv4: 4 bytes
        const parts = ip.split('.').map(p => parseInt(p, 10))
        bytes.push((ipBits << 7) | (parts[0] & 0x7F))
        bytes.push(parts[1])
        bytes.push(parts[2])
        bytes.push(parts[3])
      } else {
        // IPv6: 16 bytes (simplified)
        const ipv6Buf = this.ipv6ToBytes(ip)
        bytes.push((ipBits << 7) | (ipv6Buf[0] & 0x7F))
        bytes.push(...ipv6Buf.slice(1))
      }

      // Port (2 bytes, big-endian)
      bytes.push((port >> 8) & 0xFF)
      bytes.push(port & 0xFF)

      // Session key (variable-length)
      const keyData = callToken.sessionKey
      const keyBuf = typeof keyData === 'string'
        ? new TextEncoder().encode(keyData)
        : keyData
      bytes.push(keyBuf.length)
      bytes.push(...keyBuf)

      // Codec (1 byte enum)
      const codecMap = { 'opus': 0, 'pcm': 1, 'aac': 2 }
      bytes.push(codecMap[callToken.codec] || 0)

      // Quality (1 byte enum)
      const qualityMap = { 'sd': 0, 'hd': 1, 'vhd': 2 }
      bytes.push(qualityMap[callToken.quality] || 1)

      // Media types (1 byte bitmask)
      let mediaBitmask = 0
      if (callToken.mediaTypes?.includes('audio')) mediaBitmask |= 0x01
      if (callToken.mediaTypes?.includes('video')) mediaBitmask |= 0x02
      bytes.push(mediaBitmask)

      // Convert to hex string
      return bytes.map(b => ('0' + b.toString(16)).slice(-2)).join('')
    } catch (error) {
      console.error(`[CallToken] Failed to encode attributes:`, error)
      return '00'  // Fallback to empty if encoding fails
    }
  }

  /**
   * Helper: Convert IPv6 string to bytes
   * @private
   */
  ipv6ToBytes(ip) {
    const parts = ip.split(':').filter(p => p.length > 0)
    const bytes = new Uint8Array(16)
    let byteIndex = 0

    for (let i = 0; i < parts.length && byteIndex < 16; i++) {
      const val = parseInt(parts[i], 16) || 0
      bytes[byteIndex++] = (val >> 8) & 0xFF
      bytes[byteIndex++] = val & 0xFF
    }

    return Array.from(bytes)
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
      // Encode call connection information into tokenAttributes (byte-efficient binary format)
      const encodedAttributes = this.encodeCallAttributes(callToken)
      console.debug(`[CallToken] Encoded attributes: ${encodedAttributes.length / 2} bytes`)

      // Create P token for call signaling with encoded connection info
      const result = await this.tokenBuilder.createGenesis({
        tokenName: `CALL-${callerIdent}`,
        tokenScript: '',  // No consensus rules needed
        attributes: encodedAttributes,  // Encoded call connection info (IP, port, session key, etc.)
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
