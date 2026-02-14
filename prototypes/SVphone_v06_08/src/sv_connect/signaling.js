/**
 * SVphone Call Signaling Layer (v06.00)
 *
 * Implements call initiation, acceptance, and termination using blockchain-based
 * P tokens for signaling and WebRTC for peer-to-peer media.
 *
 * Flow:
 * 1. Caller creates call initiation token with connection info (IP, port, session key)
 * 2. Token broadcast to BSV blockchain mempool
 * 3. Recipient polls blockchain for incoming call tokens
 * 4. Recipient verifies token via SPV (ancestor proof + genesis header)
 * 5. Direct RTP/RTCP P2P connection established between peers
 */

/**
 * Call token format (P protocol):
 * - Prefix: 0x50 (P)
 * - Version: 0x03
 * - tokenName: "svphone-call-v1" (UTF-8)
 * - tokenScript: "" (empty, standard P2PKH)
 * - tokenRules: supply=1, divisibility=0, restrictions=0x0001 (one-time-use, defined in CallTokenManager)
 * - tokenAttributes: contains call metadata (caller, callee, IP, port, session key)
 * - stateData: call state (status="ringing", duration=0, quality="hd")
 * - proofChain: [] (empty until confirmed)
 *
 * Note: tokenRules are defined in CallTokenManager.CALL_TOKEN_RULES, not in this signaling layer
 */

class CallSignaling {
  constructor(options = {}) {
    this.callTokens = new Map() // Map<callTokenId, CallToken>
    this.activeCalls = new Map() // Map<peerId, ActiveCall>
    this.listeners = new Map() // Map<eventName, [callbacks]>

    // Configuration
    this.rpcUrl = options.rpcUrl || 'http://localhost:8332'
    this.pollingInterval = options.pollingInterval || 5000 // 5s poll for incoming tokens
    this.callTimeout = options.callTimeout || 60000 // 60s call ring timeout
    this.signalingTimeout = options.signalingTimeout || 10000 // 10s for call answer

    // State
    this.isPolling = false
    this.pollHandle = null
    this.myAddress = null
    this.myIp = null
    this.myPort = null
  }

  /**
   * Encode call attributes into byte-efficient binary format
   *
   * Format (optimized for blockchain storage):
   * [Version(1)] [CallerLen(1)] [Caller(var)] [CalleeLen(1)] [Callee(var)]
   * [IPType(1-bit)+IP(4|16)] [Port(2)] [KeyLen(1)] [Key(var)]
   * [Codec(1)] [Quality(1)] [MediaTypes(1)]
   *
   * Typical size: ~100-150 bytes (vs 500+ bytes for JSON)
   *
   * @param {Object} attributes - Call attributes {caller, callee, senderIp, senderPort, sessionKey, codec, quality, mediaTypes}
   * @returns {string} Hex-encoded binary data
   */
  encodeTokenAttributes(attributes) {
    try {
      const bytes = []

      // Version marker (0x01 = binary format v1)
      bytes.push(0x01)

      // Caller address (variable-length string)
      const callerBuf = new TextEncoder().encode(attributes.caller)
      bytes.push(callerBuf.length)
      bytes.push(...callerBuf)

      // Callee address (variable-length string)
      const calleeBuf = new TextEncoder().encode(attributes.callee)
      bytes.push(calleeBuf.length)
      bytes.push(...calleeBuf)

      // IP address and port
      const ip = attributes.senderIp
      const port = attributes.senderPort

      // Detect IP version (0=IPv4, 1=IPv6)
      const isIPv6 = ip.includes(':')
      const ipBits = isIPv6 ? 1 : 0

      if (!isIPv6) {
        // IPv4: 4 bytes (with version bit in MSB)
        const parts = ip.split('.').map(p => parseInt(p, 10))
        bytes.push((ipBits << 7) | (parts[0] & 0x7F))
        bytes.push(parts[1])
        bytes.push(parts[2])
        bytes.push(parts[3])
      } else {
        // IPv6: 16 bytes (with version bit in MSB of first byte)
        const ipv6Buf = this.ipv6ToBytes(ip)
        bytes.push((ipBits << 7) | (ipv6Buf[0] & 0x7F))
        bytes.push(...ipv6Buf.slice(1))
      }

      // Port (2 bytes, big-endian)
      bytes.push((port >> 8) & 0xFF)
      bytes.push(port & 0xFF)

      // Session key (variable-length binary)
      const keyData = attributes.sessionKey
      const keyBuf = typeof keyData === 'string'
        ? new TextEncoder().encode(keyData)
        : keyData
      bytes.push(keyBuf.length)
      bytes.push(...keyBuf)

      // Codec (1 byte enum: 0=opus, 1=pcm, 2=aac)
      const codecMap = { 'opus': 0, 'pcm': 1, 'aac': 2 }
      bytes.push(codecMap[attributes.codec] || 0)

      // Quality (1 byte enum: 0=sd, 1=hd, 2=vhd)
      const qualityMap = { 'sd': 0, 'hd': 1, 'vhd': 2 }
      bytes.push(qualityMap[attributes.quality] || 1)

      // Media types (1 byte bitmask: bit0=audio, bit1=video)
      let mediaBitmask = 0
      if (attributes.mediaTypes?.includes('audio')) mediaBitmask |= 0x01
      if (attributes.mediaTypes?.includes('video')) mediaBitmask |= 0x02
      bytes.push(mediaBitmask)

      // Convert bytes to hex string
      return bytes.map(b => ('0' + b.toString(16)).slice(-2)).join('')
    } catch (error) {
      console.error('[CallSignaling] Failed to encode tokenAttributes:', error)
      return ''
    }
  }

  /**
   * Parse tokenAttributes from binary or legacy JSON format
   * Automatically detects format version and decodes accordingly
   * @private
   */
  parseTokenAttributes(tokenAttributesHex) {
    if (!tokenAttributesHex) return {}

    try {
      // Convert hex to bytes
      const bytes = []
      for (let i = 0; i < tokenAttributesHex.length; i += 2) {
        bytes.push(parseInt(tokenAttributesHex.substr(i, 2), 16))
      }

      if (bytes.length === 0) return {}

      // Check version marker
      const version = bytes[0]

      if (version === 0x01) {
        // Binary format v1
        return this.decodeBinaryAttributes(bytes)
      } else {
        // Legacy JSON format (backward compatibility)
        return this.decodeLegacyJsonAttributes(tokenAttributesHex)
      }
    } catch (error) {
      console.error('[CallSignaling] Failed to parse tokenAttributes:', error)
      return {}
    }
  }

  /**
   * Decode binary format v1 attributes
   * @private
   */
  decodeBinaryAttributes(bytes) {
    let offset = 1 // Skip version byte

    // Caller address
    const callerLen = bytes[offset++]
    const callerBuf = bytes.slice(offset, offset + callerLen)
    const caller = new TextDecoder().decode(new Uint8Array(callerBuf))
    offset += callerLen

    // Callee address
    const calleeLen = bytes[offset++]
    const calleeBuf = bytes.slice(offset, offset + calleeLen)
    const callee = new TextDecoder().decode(new Uint8Array(calleeBuf))
    offset += calleeLen

    // IP address (4 or 16 bytes based on version bit)
    const ipTypeByte = bytes[offset++]
    const isIPv6 = (ipTypeByte >> 7) & 1
    const ipBytes = [ipTypeByte & 0x7F, ...bytes.slice(offset, offset + (isIPv6 ? 15 : 3))]
    const senderIp = isIPv6
      ? this.bytesToIPv6(ipBytes)
      : `${ipBytes[0]}.${bytes[offset+1]}.${bytes[offset+2]}.${bytes[offset+3]}`
    offset += isIPv6 ? 15 : 3

    // Port (2 bytes)
    const senderPort = (bytes[offset] << 8) | bytes[offset + 1]
    offset += 2

    // Session key
    const keyLen = bytes[offset++]
    const keyBuf = bytes.slice(offset, offset + keyLen)
    const sessionKey = new TextDecoder().decode(new Uint8Array(keyBuf))
    offset += keyLen

    // Codec
    const codecIds = ['opus', 'pcm', 'aac']
    const codec = codecIds[bytes[offset++]] || 'opus'

    // Quality
    const qualityIds = ['sd', 'hd', 'vhd']
    const quality = qualityIds[bytes[offset++]] || 'hd'

    // Media types
    const mediaTypeBitmask = bytes[offset++]
    const mediaTypes = []
    if (mediaTypeBitmask & 0x01) mediaTypes.push('audio')
    if (mediaTypeBitmask & 0x02) mediaTypes.push('video')

    return {
      caller,
      callee,
      senderIp,
      senderPort,
      sessionKey,
      codec,
      quality,
      mediaTypes
    }
  }

  /**
   * Decode legacy JSON format (backward compatibility)
   * @private
   */
  decodeLegacyJsonAttributes(tokenAttributesHex) {
    try {
      let attributesJson = ''
      for (let i = 0; i < tokenAttributesHex.length; i += 2) {
        const hex = tokenAttributesHex.substr(i, 2)
        attributesJson += String.fromCharCode(parseInt(hex, 16))
      }
      return JSON.parse(attributesJson)
    } catch (error) {
      console.error('[CallSignaling] Failed to decode legacy JSON:', error)
      return {}
    }
  }

  /**
   * Helper: Convert IPv6 string to 16-byte array
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
   * Helper: Convert 16-byte array to IPv6 string
   * @private
   */
  bytesToIPv6(bytes) {
    const parts = []
    for (let i = 0; i < 16; i += 2) {
      parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16))
    }
    return parts.join(':')
  }

  /**
   * Initialize the signaling layer with wallet address and network info
   */
  async initialize(myAddress, myIp, myPort) {
    this.myAddress = myAddress
    this.myIp = myIp
    this.myPort = myPort

    console.log('[CallSignaling] Initialized', {
      address: myAddress,
      ip: myIp,
      port: myPort
    })
  }

  /**
   * Create a call initiation token
   *
   * @param {string} calleeAddress - Recipient's BSV address
   * @param {string} sessionKey - Base64-encoded ephemeral DH key
   * @param {Object} options - Call options (codec, quality, etc.)
   * @returns {Object} Call token ready to broadcast
   */
  createCallToken(calleeAddress, sessionKey, options = {}) {
    const callToken = {
      // Call attributes (mutable, stored in tokenAttributes)
      caller: this.myAddress,
      callee: calleeAddress,
      senderIp: this.myIp,
      senderPort: this.myPort,
      sessionKey: sessionKey, // Ephemeral DH key for encryption

      // Call options
      codec: options.codec || 'opus',
      quality: options.quality || 'hd',
      mediaTypes: options.mediaTypes || ['audio', 'video'],

      // State (mutable, stored in stateData)
      status: 'ringing', // ringing → answered → connected → ended
      initiatedAt: Date.now(),
      timestamp: Math.floor(Date.now() / 1000), // Block height approximation

      // Call ID (computed from token ID after broadcast)
      callTokenId: null,
      currentTxId: null
    }

    console.log('[CallSignaling] Created call token:', {
      calleeAddress,
      codec: callToken.codec,
      quality: callToken.quality
    })

    return callToken
  }

  /**
   * Broadcast call token to blockchain
   * Either mints new token or uses existing token
   *
   * @param {Object} callToken - Call token to broadcast
   * @param {Function} mintTokenFn - Function to mint token (optional): (token) => Promise<{txId, tokenId}>
   *                                 If not provided, uses first existing call token
   * @returns {Object} {txId, tokenId, callTokenId}
   */
  async broadcastCallToken(callToken, mintTokenFn) {
    try {
      let result

      if (mintTokenFn) {
        // Mint new token if mintTokenFn provided
        result = await mintTokenFn(callToken)
      } else {
        // Use existing token if no mintTokenFn provided
        // For now, generate a pseudo-result with call token data
        // The actual token broadcasting will use existing tokens from tokenBuilder
        result = {
          tokenId: callToken.callTokenId || `existing-${Date.now()}`,
          txId: callToken.currentTxId || `existing-tx-${Date.now()}`
        }
      }

      callToken.callTokenId = result.tokenId
      callToken.currentTxId = result.txId

      this.callTokens.set(result.tokenId, callToken)

      this.emit('call:initiated', {
        callTokenId: result.tokenId,
        txId: result.txId,
        calleeAddress: callToken.callee,
        timestamp: Date.now()
      })

      console.log('[CallSignaling] Broadcasted call token:', {
        tokenId: result.tokenId,
        txId: result.txId,
        callee: callToken.callee,
        mode: mintTokenFn ? 'new-mint' : 'existing-token'
      })

      return {
        txId: result.txId,
        tokenId: result.tokenId,
        callTokenId: result.tokenId
      }
    } catch (error) {
      console.error('[CallSignaling] Failed to broadcast call token:', error)
      throw error
    }
  }

  /**
   * Start polling for incoming call tokens
   *
   * @param {Function} checkIncomingTokensFn - Function to check incoming tokens
   * @param {Function} verifyTokenFn - Function to verify token via SPV
   */
  async startPolling(checkIncomingTokensFn, verifyTokenFn) {
    if (this.isPolling) {
      console.warn('[CallSignaling] Already polling for incoming tokens')
      return
    }

    this.isPolling = true
    console.log('[CallSignaling] Started polling for incoming call tokens')

    const pollOnce = async () => {
      try {
        const incomingTokens = await checkIncomingTokensFn(this.myAddress)
        console.debug(`[CallSignaling] Poll found ${incomingTokens.length} tokens`)

        for (const token of incomingTokens) {
          // Check if it's a call initiation token
          // Format: CALL-XXXXX (where XXXXX is caller identifier)
          if (!token.tokenName || (!token.tokenName.startsWith('CALL-'))) {
            console.debug(`[CallSignaling] Skip token: not a call token (name=${token.tokenName})`)
            continue
          }

          // Parse tokenAttributes to extract call metadata
          const attributes = this.parseTokenAttributes(token.tokenAttributes)
          console.debug(`[CallSignaling] Token attributes parsed:`, {
            callee: attributes.callee,
            caller: attributes.caller,
            myAddress: this.myAddress
          })

          // Check if this is an incoming call token (we are the callee)
          const isIncomingCall = attributes.callee === this.myAddress

          // Check if this is a response token (we initiated the call)
          const isResponseToken = attributes.caller === this.myAddress

          if (!isIncomingCall && !isResponseToken) {
            console.debug(`[CallSignaling] Skip token: not relevant to us (caller=${attributes.caller}, callee=${attributes.callee}, myAddress=${this.myAddress})`)
            continue
          }

          // Verify token via SPV before processing
          const tokenType = isIncomingCall ? 'incoming call' : 'call response'
          console.log(`[CallSignaling] Verifying ${tokenType} token`)
          const verification = await verifyTokenFn(token)

          if (verification.valid) {
            if (isIncomingCall) {
              console.log(`[CallSignaling] Token verified! Processing incoming call`)
              // Merge parsed attributes back into token for handleIncomingCall
              token.caller = attributes.caller
              token.callee = attributes.callee
              token.senderIp = attributes.senderIp
              token.senderPort = attributes.senderPort
              token.sessionKey = attributes.sessionKey
              token.codec = attributes.codec
              token.quality = attributes.quality
              token.mediaTypes = attributes.mediaTypes || ['audio', 'video']

              this.handleIncomingCall(token)
            } else if (isResponseToken) {
              console.log(`[CallSignaling] Token verified! Processing call response`)
              // Parse stateData to extract callee's response (connection data)
              this.handleCallResponse(token, attributes)
            }
          } else {
            console.warn('[CallSignaling] Incoming call token failed verification:', {
              tokenId: token.tokenId,
              reason: verification.reason
            })
          }
        }
      } catch (error) {
        console.error('[CallSignaling] Error during polling:', error)
      }

      if (this.isPolling) {
        this.pollHandle = setTimeout(pollOnce, this.pollingInterval)
      }
    }

    // Start polling
    this.pollHandle = setTimeout(pollOnce, 100) // Initial poll after 100ms
  }

  /**
   * Stop polling for incoming tokens
   */
  stopPolling() {
    if (this.pollHandle) {
      clearTimeout(this.pollHandle)
      this.pollHandle = null
    }
    this.isPolling = false
    console.log('[CallSignaling] Stopped polling for incoming call tokens')
  }

  /**
   * Handle incoming call token
   * @private
   */
  handleIncomingCall(token) {
    const callToken = {
      callTokenId: token.tokenId,
      currentTxId: token.currentTxId,
      caller: token.caller,
      callee: token.callee,
      senderIp: token.senderIp,
      senderPort: token.senderPort,
      sessionKey: token.sessionKey,
      codec: token.codec,
      quality: token.quality,
      mediaTypes: token.mediaTypes || ['audio', 'video'],
      status: 'ringing',
      receivedAt: Date.now()
    }

    this.callTokens.set(token.tokenId, callToken)

    this.emit('call:incoming', {
      callTokenId: token.tokenId,
      caller: token.caller,
      callerIp: token.senderIp,
      callerPort: token.senderPort,
      codec: token.codec,
      quality: token.quality,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Incoming call from:', token.caller)
  }

  /**
   * Handle call response token from callee
   * @private
   */
  handleCallResponse(token, attributes) {
    console.debug('[CallSignaling] Processing call response token')

    // Parse stateData to extract callee's connection information
    let responseData = {}
    if (token.stateData) {
      try {
        // Decode hex-encoded stateData
        let stateDataJson = ''
        for (let i = 0; i < token.stateData.length; i += 2) {
          const hex = token.stateData.substr(i, 2)
          stateDataJson += String.fromCharCode(parseInt(hex, 16))
        }
        responseData = JSON.parse(stateDataJson)
        console.debug('[CallSignaling] Parsed response data:', responseData)
      } catch (err) {
        console.warn('[CallSignaling] Failed to parse response stateData:', err.message)
        return
      }
    }

    // Check if this is actually a response (status = answered)
    if (responseData.status !== 'answered') {
      console.debug('[CallSignaling] Token is not a call response (status=' + (responseData.status || 'none') + ')')
      return
    }

    // Emit call:answered event with callee's connection data
    this.emit('call:answered', {
      callTokenId: token.tokenId,
      callee: responseData.recipientAddress,
      calleeIp: responseData.recipientIp,
      calleePort: responseData.recipientPort,
      calleeSessionKey: responseData.recipientSessionKey,
      audioOnly: responseData.audioOnly || false,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Call response received from:', responseData.recipientAddress)
  }

  /**
   * Accept incoming call
   * @param {string} callTokenId - Call token ID to accept
   * @param {Object} options - Acceptance options
   * @returns {Object} Answer token to send back
   */
  acceptCall(callTokenId, options = {}) {
    const callToken = this.callTokens.get(callTokenId)
    if (!callToken) {
      throw new Error(`Call token not found: ${callTokenId}`)
    }

    callToken.status = 'answered'
    callToken.answeredAt = Date.now()

    const answerToken = {
      type: 'call-answer',
      callTokenId: callTokenId,
      answerer: this.myAddress,
      answererIp: this.myIp,
      answererPort: this.myPort,
      answererSessionKey: options.sessionKey || this.generateSessionKey(),
      timestamp: Date.now()
    }

    this.emit('call:answered', {
      callTokenId: callTokenId,
      answerer: this.myAddress,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Accepted call:', callTokenId)

    return answerToken
  }

  /**
   * Reject incoming call
   * @param {string} callTokenId - Call token ID to reject
   * @param {string} reason - Rejection reason
   */
  rejectCall(callTokenId, reason = 'user-declined') {
    const callToken = this.callTokens.get(callTokenId)
    if (!callToken) {
      throw new Error(`Call token not found: ${callTokenId}`)
    }

    callToken.status = 'rejected'
    callToken.rejectedAt = Date.now()
    callToken.rejectionReason = reason

    this.emit('call:rejected', {
      callTokenId: callTokenId,
      reason: reason,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Rejected call:', callTokenId)
  }

  /**
   * Update call state
   * @param {string} callTokenId - Call token ID
   * @param {string} status - New status (connecting, connected, ended)
   * @param {Object} metadata - Additional metadata to store
   */
  updateCallState(callTokenId, status, metadata = {}) {
    const callToken = this.callTokens.get(callTokenId)
    if (!callToken) {
      throw new Error(`Call token not found: ${callTokenId}`)
    }

    callToken.status = status
    Object.assign(callToken, metadata)

    this.emit('call:state-changed', {
      callTokenId: callTokenId,
      status: status,
      metadata: metadata,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Updated call state:', { callTokenId, status })
  }

  /**
   * End call
   * @param {string} callTokenId - Call token ID to end
   * @param {Object} stats - Call statistics
   */
  endCall(callTokenId, stats = {}) {
    const callToken = this.callTokens.get(callTokenId)
    if (!callToken) {
      throw new Error(`Call token not found: ${callTokenId}`)
    }

    const duration = callToken.connectedAt
      ? Date.now() - callToken.connectedAt
      : 0

    callToken.status = 'ended'
    callToken.endedAt = Date.now()
    callToken.duration = duration
    callToken.stats = stats

    this.emit('call:ended', {
      callTokenId: callTokenId,
      duration: duration,
      stats: stats,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Ended call:', {
      callTokenId: callTokenId,
      duration: duration
    })
  }

  /**
   * Get call token details
   */
  getCallToken(callTokenId) {
    return this.callTokens.get(callTokenId)
  }

  /**
   * Generate ephemeral session key (base64-encoded random bytes)
   * @private
   */
  generateSessionKey() {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return btoa(String.fromCharCode(...bytes))
  }

  /**
   * Event emitter methods
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, [])
    }
    this.listeners.get(eventName).push(callback)
  }

  off(eventName, callback) {
    const callbacks = this.listeners.get(eventName)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  emit(eventName, data) {
    const callbacks = this.listeners.get(eventName)
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(data)
        } catch (error) {
          console.error(`[CallSignaling] Error in ${eventName} handler:`, error)
        }
      })
    }
  }
}

// Export for browser
if (typeof window !== 'undefined') {
  window.CallSignaling = CallSignaling
}

// Export for Node.js/modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CallSignaling
}
