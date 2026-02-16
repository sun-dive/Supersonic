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
  restrictions: 0,        // NFT (no restrictions)
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
   * Format: [Version(1)]
   *         [IPType+IP(4-16)] [Port(2)] [KeyLen(1)] [Key(var)]
   *         [Codec(1)] [Quality(1)] [MediaTypes(1)]
   *         [SDPLen(2)] [SDP(var)]
   *
   * Note: Caller and callee addresses are in the transaction, not encoded here
   * Size: ~50-100 bytes + SDP size
   *
   * @param {Object} callToken - Call token with connection info and sdpOffer
   * @returns {string} Hex-encoded binary data
   */
  encodeCallAttributes(callToken, callerHash, calleeHash) {
    try {
      const bytes = []

      // Version marker (0x01 = binary format v1)
      bytes.push(0x01)

      // Address verification hashes (caller + callee, 8 hex chars each = 4 bytes each = 8 bytes total)
      // These are used by signaling.js to validate call addresses
      if (callerHash && calleeHash) {
        // Convert hex string hashes to bytes
        const callerHashBytes = []
        for (let i = 0; i < callerHash.length; i += 2) {
          callerHashBytes.push(parseInt(callerHash.substr(i, 2), 16))
        }
        const calleeHashBytes = []
        for (let i = 0; i < calleeHash.length; i += 2) {
          calleeHashBytes.push(parseInt(calleeHash.substr(i, 2), 16))
        }
        bytes.push(...callerHashBytes)  // First 4 bytes
        bytes.push(...calleeHashBytes)  // Next 4 bytes
      } else {
        // No hashes provided (for answer tokens, just push 8 zero bytes)
        bytes.push(0, 0, 0, 0, 0, 0, 0, 0)
      }

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

      // SDP Offer or Answer (variable-length, 2-byte length prefix)
      // Supports both outgoing offer (callToken.sdpOffer) and response answer (callToken.sdpAnswer)
      const sdpData = callToken.sdpOffer || callToken.sdpAnswer || ''
      const sdpBuf = new TextEncoder().encode(sdpData)
      bytes.push((sdpBuf.length >> 8) & 0xFF)  // Length high byte
      bytes.push(sdpBuf.length & 0xFF)          // Length low byte
      bytes.push(...sdpBuf)

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
   * Helper: Compute 32-bit truncated SHA256 hash of an address
   * Returns first 8 hex characters (32 bits) for compact identification
   * @private
   */
  async hashAddress(address) {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(address)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => ('0' + b.toString(16)).slice(-2)).join('')
      return hashHex.substring(0, 8)  // Return first 32 bits (8 hex chars)
    } catch (error) {
      console.error(`[CallToken] Failed to hash address:`, error)
      return '00000000'  // Fallback if hashing fails
    }
  }

  /**
   * Broadcast a call answer response token back to caller
   *
   * Answer tokens are transfers (not genesis) and include SDP Answer in tokenAttributes.
   * Used when callee accepts call and needs to send media negotiation data back to caller.
   *
   * @param {string} tokenId - Existing call token ID to transfer back
   * @param {string} callerAddress - Caller's address (recipient of answer token)
   * @param {Object} answerData - Answer data {sdpAnswer, senderIp, senderPort, sessionKey, codec, quality, mediaTypes}
   * @returns {Promise<Object>} {txId, tokenId}
   */
  async broadcastCallAnswer(tokenId, callerAddress, answerData) {
    console.debug(`[CallToken] Broadcasting call answer to ${callerAddress}`)

    try {
      // Encode answer data into tokenAttributes (same format as offer, just different SDP content)
      // For answer tokens, we don't re-encode caller/callee hashes (they stay from genesis)
      const encodedAttributes = this.encodeCallAttributes({
        sdpAnswer: answerData.sdpAnswer,  // Answer goes into same SDP field as offer
        senderIp: answerData.senderIp,
        senderPort: answerData.senderPort,
        sessionKey: answerData.sessionKey,
        codec: answerData.codec,
        quality: answerData.quality,
        mediaTypes: answerData.mediaTypes
      }, null, null)  // No address hashes for answer tokens (keep genesis hashes)
      console.debug(`[CallToken] Encoded answer attributes: ${encodedAttributes.length / 2} bytes`)

      // Transfer token back to caller with answer data
      const transferResult = await this.tokenBuilder.createTransfer(tokenId, callerAddress, {
        tokenAttributes: encodedAttributes
      })

      console.debug(`[CallToken] ✅ Answer token transferred: ${transferResult.txId}`)
      this.log(`✓ Answer token sent: ${transferResult.txId}`, 'success')
      this.log(`View on blockchain: https://whatsonchain.com/tx/${transferResult.txId}`, 'info')

      return { txId: transferResult.txId, tokenId: tokenId }
    } catch (err) {
      console.error(`[CallToken] ❌ Answer broadcast failed:`, err)
      this.log(`Answer broadcast failed: ${err.message}`, 'error')
      throw err
    }
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
    console.debug(`[CallToken] Full token object:`, {
      caller: callToken.caller,
      callee: callToken.callee,
      senderIp: callToken.senderIp,
      senderPort: callToken.senderPort,
      sessionKey: callToken.sessionKey?.slice?.(0, 20) + '...',
      codec: callToken.codec,
      quality: callToken.quality,
      mediaTypes: callToken.mediaTypes
    })

    const callerIdent = callToken.caller?.slice(0, 5) || 'unkn'

    this.log(`Creating call token for ${callToken.callee}`, 'info')

    try {
      // Compute address hashes for validation (caller + callee identification)
      // SHA256 truncated to 32 bits (8 hex chars) per address
      const callerHash = await this.hashAddress(callToken.caller)
      const calleeHash = await this.hashAddress(callToken.callee)
      console.debug(`[CallToken] Address hashes: caller=${callerHash}, callee=${calleeHash}`)

      // Encode call connection information into tokenAttributes (includes address hashes for validation)
      const encodedAttributes = this.encodeCallAttributes(callToken, callerHash, calleeHash)
      console.debug(`[CallToken] Encoded attributes: ${encodedAttributes.length / 2} bytes`)

      // Create P token for call signaling with encoded connection info
      const result = await this.tokenBuilder.createGenesis({
        tokenName: `CALL-${callerIdent}`,
        tokenScript: '',  // No consensus rules needed
        attributes: encodedAttributes,  // Encoded call connection info (includes address hashes, IP, port, session key, etc.)
        supply: CALL_TOKEN_RULES.supply,
        divisibility: CALL_TOKEN_RULES.divisibility,
        restrictions: 0,  // No restrictions (address validation via tokenAttributes hashes instead)
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
      console.debug(`[CallToken] ⏳ Waiting for genesis confirmation before transfer - polling every 5s`)
      this.log('⏳ Waiting for genesis confirmation (~60 minutes) - polling every 15s...', 'info')

      try {
        const genesisConfirmed = await this.tokenBuilder.pollForProof(tokenId, result.txId, () => {
          // Suppress individual polling messages to keep debug console clean
          // See one "polling started" message above instead of hundreds of updates
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
      console.debug(`[CallToken] Transfer parameters: tokenId=${tokenId}, calleeAddress=${callToken.callee}`)
      this.log(`📤 Transferring token to recipient (instant)...`, 'info')

      let transferResult
      try {
        console.debug(`[CallToken] Calling tokenBuilder.createTransfer(${tokenId}, ${callToken.callee})`)
        transferResult = await this.tokenBuilder.createTransfer(tokenId, callToken.callee)
        console.debug(`[CallToken] ✅ Token transferred instantly!`)
        console.debug(`[CallToken] Transfer result:`, transferResult)
        console.debug(`[CallToken] Transfer TX: ${transferResult.txId}`)
        this.log(`✓ Token transferred instantly: ${transferResult.txId}`, 'success')
        this.log(`View transfer on blockchain: https://whatsonchain.com/tx/${transferResult.txId}`, 'info')
      } catch (err) {
        console.error(`[CallToken] ❌ Token transfer failed:`, err)
        console.error(`[CallToken] Transfer error details:`, {
          message: err.message,
          stack: err.stack,
          name: err.name
        })
        this.log(`⚠️ Token transfer failed: ${err.message}`, 'warning')
        throw err
      }

      // Start background Merkle proof polling (OPTIONAL - non-blocking)
      console.debug(`[CallToken] Starting background Merkle proof polling (transfer confirmation)`)
      this.tokenBuilder.pollForProof(tokenId, transferResult.txId, () => {
        // Suppress individual polling updates - background polling only logs on completion
      }).then((found) => {
        if (found) {
          console.debug(`[CallToken] ✅ Transfer Merkle proof confirmed (background)`)
        }
      }).catch((err) => {
        console.debug(`[CallToken] Transfer proof polling (background, non-critical):`, err.message)
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
