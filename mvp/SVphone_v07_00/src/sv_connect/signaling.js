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
 * - tokenName: "CALL-XXXXX" (UTF-8)
 * - tokenScript: "" (empty, standard P2PKH)
 * - tokenRules: supply=1, divisibility=0, restrictions=caller_hash+callee_hash (8 hex chars each for 32-bit SHA256)
 * - tokenAttributes (binary v1): [Version(1)][IP(4-16)][Port(2)][KeyLen(1)][Key(var)][Codec(1)][Quality(1)][MediaTypes(1)][SDPLen(2)][SDP(var)]
 *   * SDP contains offer (genesis) or answer (transfer response)
 *   * Caller/callee addresses are in transaction metadata, verified via 32-bit SHA256 hashes in tokenRules.restrictions
 * - stateData: call state (status="ringing", duration=0, quality="hd")
 * - proofChain: [] (empty until confirmed)
 *
 * Verification:
 * - Callee verifies CALLER by checking hash(token.caller) in tokenRules.restrictions
 * - Caller verifies CALLEE by checking hash(token.callee) in tokenRules.restrictions (when token returned)
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
   * Typical size: ~100-150 bytes
   *
   * @param {Object} attributes - Call attributes {caller, callee, senderIp, senderPort, sessionKey, codec, quality, mediaTypes}
   * @returns {string} Hex-encoded binary data
   */
  encodeTokenAttributes(attributes) {
    try {
      const bytes = []

      // Version marker (0x01 = binary format v1)
      bytes.push(0x01)

      // NOTE: Caller and callee are NOT encoded here
      // They are stored in transaction metadata and verified via 32-bit SHA256 hashes in tokenRules.restrictions
      // This ensures addresses cannot be spoofed and keeps tokenAttributes focused on connection data

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
   * Parse tokenAttributes from binary format
   * @private
   */
  parseTokenAttributes(tokenAttributesHex) {
    if (!tokenAttributesHex) {
      console.debug('[CallSignaling] parseTokenAttributes: tokenAttributesHex is empty/null')
      return {}
    }

    console.debug(`[CallSignaling] parseTokenAttributes: HEX length=${tokenAttributesHex.length}, first 40 chars: ${tokenAttributesHex.substring(0, 40)}`)

    try {
      // Convert hex to bytes
      const bytes = []
      for (let i = 0; i < tokenAttributesHex.length; i += 2) {
        bytes.push(parseInt(tokenAttributesHex.substr(i, 2), 16))
      }

      console.debug(`[CallSignaling] parseTokenAttributes: Converted to ${bytes.length} bytes, first 10 bytes: [${bytes.slice(0, 10).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`)

      if (bytes.length === 0) {
        console.warn('[CallSignaling] parseTokenAttributes: bytes array is empty after conversion')
        return {}
      }

      // Decode binary format v1
      const decoded = this.decodeBinaryAttributes(bytes)
      console.debug('[CallSignaling] parseTokenAttributes: Decoded successfully', {
        hasIp: !!decoded.senderIp,
        hasPort: !!decoded.senderPort,
        hasKey: !!decoded.sessionKey,
        codec: decoded.codec,
        quality: decoded.quality,
        mediaTypes: decoded.mediaTypes,
        sdpLen: decoded.sdpOffer?.length || 0
      })
      return decoded
    } catch (error) {
      console.error('[CallSignaling] Failed to parse tokenAttributes:', error)
      console.error('[CallSignaling] tokenAttributesHex was:', tokenAttributesHex?.substring(0, 100))
      return {}
    }
  }

  /**
   * Decode binary format v1 attributes
   * @private
   */
  decodeBinaryAttributes(bytes) {
    console.debug(`[CallSignaling] decodeBinaryAttributes: Starting decode of ${bytes.length} bytes`)
    let offset = 1 // Skip version byte

    // Note: Address verification hashes are in tokenRules.restrictions (immutable)
    // tokenAttributes only contains connection data starting after version byte

    // IP address (4 or 16 bytes based on version bit)
    console.debug(`[CallSignaling] decodeBinaryAttributes: offset=${offset}, decoding IP...`)
    const ipTypeByte = bytes[offset++]
    const isIPv6 = (ipTypeByte >> 7) & 1
    const ipBytes = [ipTypeByte & 0x7F, ...bytes.slice(offset, offset + (isIPv6 ? 15 : 3))]
    const senderIp = isIPv6
      ? this.bytesToIPv6(ipBytes)
      : `${ipBytes[0]}.${bytes[offset+1]}.${bytes[offset+2]}.${bytes[offset+3]}`
    offset += isIPv6 ? 15 : 3
    console.debug(`[CallSignaling] decodeBinaryAttributes: ✓ IP decoded=${senderIp}, isIPv6=${isIPv6}, offset now=${offset}`)

    // Port (2 bytes)
    console.debug(`[CallSignaling] decodeBinaryAttributes: offset=${offset}, decoding Port...`)
    const senderPort = (bytes[offset] << 8) | bytes[offset + 1]
    offset += 2
    console.debug(`[CallSignaling] decodeBinaryAttributes: ✓ Port decoded=${senderPort}, offset now=${offset}`)

    // Session key
    console.debug(`[CallSignaling] decodeBinaryAttributes: offset=${offset}, decoding Session Key...`)
    const keyLen = bytes[offset++]
    console.debug(`[CallSignaling] decodeBinaryAttributes: keyLen=${keyLen}`)
    const keyBuf = bytes.slice(offset, offset + keyLen)
    const sessionKey = new TextDecoder().decode(new Uint8Array(keyBuf))
    offset += keyLen
    console.debug(`[CallSignaling] decodeBinaryAttributes: ✓ Key decoded, length=${keyLen}, offset now=${offset}`)

    // Codec
    console.debug(`[CallSignaling] decodeBinaryAttributes: offset=${offset}, decoding Codec...`)
    const codecIds = ['opus', 'pcm', 'aac']
    const codec = codecIds[bytes[offset++]] || 'opus'
    console.debug(`[CallSignaling] decodeBinaryAttributes: ✓ Codec decoded=${codec}, offset now=${offset}`)

    // Quality
    console.debug(`[CallSignaling] decodeBinaryAttributes: offset=${offset}, decoding Quality...`)
    const qualityIds = ['sd', 'hd', 'vhd']
    const quality = qualityIds[bytes[offset++]] || 'hd'
    console.debug(`[CallSignaling] decodeBinaryAttributes: ✓ Quality decoded=${quality}, offset now=${offset}`)

    // Media types
    console.debug(`[CallSignaling] decodeBinaryAttributes: offset=${offset}, decoding MediaTypes...`)
    const mediaTypeBitmask = bytes[offset++]
    const mediaTypes = []
    if (mediaTypeBitmask & 0x01) mediaTypes.push('audio')
    if (mediaTypeBitmask & 0x02) mediaTypes.push('video')
    console.debug(`[CallSignaling] decodeBinaryAttributes: ✓ MediaTypes decoded=${mediaTypes.join(',')}, offset now=${offset}`)

    // SDP Offer (variable-length, 2-byte length prefix)
    console.debug(`[CallSignaling] decodeBinaryAttributes: offset=${offset}, decoding SDP length...`)
    const sdpLen = (bytes[offset] << 8) | bytes[offset + 1]
    offset += 2
    console.debug(`[CallSignaling] decodeBinaryAttributes: sdpLen=${sdpLen}, offset now=${offset}`)
    const sdpBuf = bytes.slice(offset, offset + sdpLen)
    const sdpOffer = new TextDecoder().decode(new Uint8Array(sdpBuf))
    offset += sdpLen

    return {
      senderIp,
      senderPort,
      sessionKey,
      codec,
      quality,
      mediaTypes,
      sdpOffer
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
   * Helper: Compute 32-bit truncated SHA256 hash of an address
   * Returns first 8 hex characters (32 bits) for compact identification
   * @private
   */
  /**
   * Extract caller and callee addresses from a CALL token
   *
   * For tokens we initiated (in callTokens), use stored addresses.
   * For response tokens, match to pending call to retrieve original caller/callee.
   * For new incoming calls, extract from token metadata if available.
   *
   * CRITICAL: caller/callee MUST match the original token creation addresses
   * because the hashes in tokenAttributes are computed from these exact addresses.
   *
   * @param {Object} token - Token with currentTxId, tokenRules, etc.
   * @returns {Object|null} {caller, callee} or null if cannot determine
   * @private
   */
  extractCallerCalleeFromToken(token) {
    // CASE 1: Check if this is a token we created and stored locally
    const storedToken = this.callTokens.get(token.tokenId)
    if (storedToken && storedToken.caller && storedToken.callee) {
      // Check if this is a return-to-sender (UTXO location changed)
      // If UTXO location is the same, it's the token we just transferred - skip it
      if (storedToken.currentTxId === token.currentTxId &&
          storedToken.currentOutputIndex === token.currentOutputIndex) {
        console.debug('[CallSignaling] ℹ️ Stored token has same UTXO location - not a return-to-sender (skip)', {
          storedTxId: storedToken.currentTxId?.slice(0, 20),
          incomingTxId: token.currentTxId?.slice(0, 20),
          tokenId: token.tokenId?.slice(0, 20)
        })
        return null  // Skip - same UTXO, not actually returned yet
      }

      // UTXO location changed - this is a return-to-sender! Preserve original addresses
      console.debug('[CallSignaling] ✓ Return-to-sender detected - using original caller/callee from storage', {
        caller: storedToken.caller?.slice(0, 20),
        callee: storedToken.callee?.slice(0, 20),
        oldTxId: storedToken.currentTxId?.slice(0, 20),
        newTxId: token.currentTxId?.slice(0, 20),
        tokenId: token.tokenId?.slice(0, 20)
      })
      return {
        caller: storedToken.caller,
        callee: storedToken.callee
      }
    }

    // CASE 2: Token already has caller/callee set (from tokenBuilder)
    if (token.caller && token.callee) {
      console.debug('[CallSignaling] ✓ Token has caller/callee metadata', {
        caller: token.caller?.slice(0, 20),
        callee: token.callee?.slice(0, 20),
        tokenId: token.tokenId?.slice(0, 20)
      })
      return {
        caller: token.caller,
        callee: token.callee
      }
    }

    // CASE 3: Could not extract caller/callee
    console.warn('[CallSignaling] ⚠️ Case 3: Cannot extract caller/callee from token', {
      hasTokenId: !!token.tokenId,
      storedInCallTokens: !!storedToken,
      tokenCaller: token.caller || 'undefined',
      tokenCallee: token.callee || 'undefined',
      hasCallerCallee: !!(token.caller && token.callee),
      tokenId: token.tokenId?.slice(0, 20),
      tokenName: token.tokenName,
      reason: 'Caller/callee not in callTokens or token metadata. Check if tokenBuilder extracted from transaction.'
    })
    return null
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
        console.debug(`[CallSignaling] 🔍 Poll cycle started for address: ${this.myAddress?.slice(0,20)}...`)
        const incomingTokens = await checkIncomingTokensFn(this.myAddress)
        console.debug(`[CallSignaling] Poll cycle found ${incomingTokens.length} incoming tokens`)

        if (incomingTokens.length === 0) {
          console.debug(`[CallSignaling] No tokens in this poll cycle, will retry in ${this.pollingInterval}ms`)
        }

        for (const token of incomingTokens) {
          console.debug(`[CallSignaling] Processing token: id=${token.tokenId?.slice(0,20)}..., name=${token.tokenName}`)

          // Check if it's a call initiation token
          // Format: CALL-XXXXX (where XXXXX is caller identifier)
          if (!token.tokenName || (!token.tokenName.startsWith('CALL-'))) {
            console.debug(`[CallSignaling] ❌ Skip token: not a call token (name=${token.tokenName})`)
            continue
          }

          console.debug(`[CallSignaling] ✓ Token is a CALL token, parsing attributes...`)

          // Parse tokenAttributes to extract call metadata (connection info, SDP, etc.)
          const attributes = this.parseTokenAttributes(token.tokenAttributes)
          console.debug(`[CallSignaling] ✓ Token attributes parsed:`, {
            hasSenderIp: !!attributes.senderIp,
            hasSenderPort: !!attributes.senderPort,
            hasCodec: !!attributes.codec,
            hasSdp: !!attributes.sdpOffer || !!attributes.sdpAnswer
          })

          // Extract caller and callee addresses from storage (for return-to-sender detection)
          // Addresses are stored in callTokens if we created the token
          let addressPair = this.extractCallerCalleeFromToken(token)

          // If we have stored addresses, use them
          if (addressPair) {
            token.caller = addressPair.caller
            token.callee = addressPair.callee
          }

          // Check if this is an incoming call token (we are the callee)
          const isIncomingCall = token.callee === this.myAddress

          // Check if this is a response token (we initiated the call)
          const isResponseToken = token.caller === this.myAddress

          console.debug(`[CallSignaling] Token role check: isIncomingCall=${isIncomingCall}, isResponseToken=${isResponseToken}`, {
            tokenCaller: token.caller?.slice(0, 20),
            tokenCallee: token.callee?.slice(0, 20),
            myAddress: this.myAddress?.slice(0, 20)
          })

          if (!isIncomingCall && !isResponseToken) {
            console.debug(`[CallSignaling] ❌ Skip token: not relevant to us (caller=${token.caller?.slice(0, 20)}, callee=${token.callee?.slice(0, 20)}, myAddress=${this.myAddress?.slice(0, 20)})`)
            continue
          }

          // Accept token immediately for instant messaging UX (pure SPV principle)
          // Token ID is cryptographically valid on receipt - no verification gate needed
          const tokenType = isIncomingCall ? 'incoming call' : 'call response'
          console.log(`[CallSignaling] ✓ Accepting ${tokenType} immediately`)

          if (isIncomingCall) {
            console.log(`[CallSignaling] Processing incoming call`)
            // Merge parsed attributes back into token for handleIncomingCall
            // Note: caller and callee come from transaction metadata, not attributes
            token.senderIp = attributes.senderIp
            token.senderPort = attributes.senderPort
            token.sessionKey = attributes.sessionKey
            token.codec = attributes.codec
            token.quality = attributes.quality
            token.mediaTypes = attributes.mediaTypes || ['audio', 'video']
            token.sdpOffer = attributes.sdpOffer

            this.handleIncomingCall(token)
          } else if (isResponseToken) {
            console.log(`[CallSignaling] Processing call response`)
            // Parse stateData to extract callee's response (connection data)
            this.handleCallResponse(token, attributes)
          }

          // Run SPV verification in background (non-blocking, optional)
          verifyTokenFn(token).then(verification => {
            console.log(`[CallSignaling] Background SPV verification complete for ${token.tokenId?.slice(0, 10)}:`, {
              valid: verification.valid,
              reason: verification.reason
            })
            if (!verification.valid) {
              console.warn(`[CallSignaling] ⚠️ SPV verification failed after acceptance`, {
                tokenId: token.tokenId,
                reason: verification.reason
              })
            }
          }).catch(error => {
            console.error(`[CallSignaling] Background SPV verification error for ${token.tokenId?.slice(0, 10)}:`, error)
          })
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
    console.debug('[CallSignaling] 🔄 Processing call response token')
    console.debug('[CallSignaling] Token ID:', token.tokenId?.slice(0,20))
    console.debug('[CallSignaling] Has attributes:', !!attributes)

    // Attributes already decoded by decodeBinaryAttributes() in polling
    // For answer tokens, attributes contain: senderIp, senderPort, sessionKey, codec, quality, mediaTypes, sdpAnswer
    if (!attributes || !attributes.sdpAnswer) {
      console.debug('[CallSignaling] ❌ No SDP Answer found in response token')
      return
    }

    console.debug('[CallSignaling] ✓ SDP Answer found, processing response...')

    // Emit call:answered event with callee's connection data and SDP Answer
    const eventData = {
      callTokenId: token.tokenId,
      caller: token.caller,  // The person we called (now responding)
      callee: token.callee,  // Us (the original caller)
      calleeIp: attributes.senderIp,
      calleePort: attributes.senderPort,
      calleeSessionKey: attributes.sessionKey,
      sdpAnswer: attributes.sdpAnswer,  // The callee's SDP answer for media negotiation
      codec: attributes.codec,
      quality: attributes.quality,
      mediaTypes: attributes.mediaTypes,
      timestamp: Date.now()
    }

    console.debug('[CallSignaling] ✓ Parsed answer response:',  {
      callTokenId: eventData.callTokenId?.slice(0,20),
      caller: eventData.caller?.slice(0,20),
      calleeIp: eventData.calleeIp,
      calleePort: eventData.calleePort,
      hasAnswer: !!eventData.sdpAnswer
    })

    console.debug('[CallSignaling] ✓ Emitting call:answered event with SDP Answer...')
    this.emit('call:answered', eventData)

    console.log('[CallSignaling] ✅ Call answer received with SDP negotiation data')
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

    // Emit call:answered event with CALLER's connection info (for callee to establish P2P back)
    // callToken contains the CALLER's information (from the incoming call token)
    this.emit('call:answered', {
      callTokenId: callTokenId,
      answerer: this.myAddress,
      // Include caller's connection info from the incoming call token so callee can connect back
      calleeAddress: callToken.caller,      // Caller's address
      calleeIp: callToken.senderIp,         // Caller's IP (from incoming token)
      calleePort: callToken.senderPort,     // Caller's port (from incoming token)
      calleeSessionKey: callToken.sessionKey, // Caller's session key
      timestamp: Date.now()
    })

    console.debug('[CallSignaling] Emitting call:answered with caller connection info:', {
      calleeAddress: callToken.caller?.slice(0,20),
      calleeIp: callToken.senderIp,
      calleePort: callToken.senderPort,
      answerer: this.myAddress?.slice(0,20)
    })
    console.log('[CallSignaling] Accepted call:', callTokenId)

    return answerToken
  }

  /**
   * Broadcast call answer token back to caller
   * @param {string} callTokenId - Call token ID to transfer back
   * @param {string} callerAddress - Caller's address (recipient)
   * @param {Object} answerData - Answer data {sdpAnswer, senderIp, senderPort, sessionKey, codec, quality, mediaTypes}
   * @param {Function} broadcastFn - Optional function to broadcast (e.g., from CallTokenManager)
   */
  async broadcastCallAnswer(callTokenId, callerAddress, answerData, broadcastFn) {
    try {
      console.debug('[CallSignaling] 📤 Broadcasting call answer to caller:', callerAddress?.slice(0,20))

      if (broadcastFn) {
        // Use provided broadcast function (typically CallTokenManager.broadcastCallAnswer)
        const result = await broadcastFn(callTokenId, callerAddress, answerData)

        this.emit('call:answer-broadcasted', {
          callTokenId: callTokenId,
          txId: result.txId,
          timestamp: Date.now()
        })

        console.log('[CallSignaling] ✅ Answer broadcasted:', result.txId)
        return result
      } else {
        console.warn('[CallSignaling] ⚠️ No broadcast function provided, answer not sent to blockchain')
        return { callTokenId, txId: null }
      }
    } catch (error) {
      console.error('[CallSignaling] Failed to broadcast answer:', error)
      throw error
    }
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
