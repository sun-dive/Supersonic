/**
 * SVphone Call Signaling Layer (v08.00)
 *
 * Implements call initiation, acceptance, and termination using 1-sat ordinal
 * inscriptions for signaling and WebRTC for peer-to-peer media.
 *
 * Call flow: Caller sends inscription → Recipient polls address history → P2P connection established
 *
 * Inscription format: standard 1sat ordinal (OP_FALSE OP_IF "ord" ...) with JSON call data:
 * { v, proto:"svphone", type:"call"|"answer", caller, callee, ip, port, key, codec, quality, media, sdp }
 */

class CallSignaling {
  // Codec enumeration
  static CODECS = { opus: 0, pcm: 1, aac: 2 }
  static CODEC_IDS = ['opus', 'pcm', 'aac']

  // Quality enumeration
  static QUALITIES = { sd: 0, hd: 1, vhd: 2 }
  static QUALITY_IDS = ['sd', 'hd', 'vhd']

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
   * Normalise inscription data into a common call info object.
   * Inscription JSON fields map directly to the call token format.
   * @private
   */
  inscriptionToCallInfo(inscription) {
    return {
      senderIp: inscription.ip,
      senderPort: inscription.port,
      sessionKey: inscription.key,
      codec: inscription.codec ?? 'opus',
      quality: inscription.quality ?? 'hd',
      mediaTypes: inscription.media ?? ['audio'],
      sdpOffer: inscription.type === 'call' ? inscription.sdp : undefined,
      sdpAnswer: inscription.type === 'answer' ? inscription.sdp : undefined,
    }
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
   * Create call initiation token with connection info
   * @param {string} calleeAddress - Recipient BSV address
   * @param {string} sessionKey - Ephemeral DH key (base64)
   * @param {Object} options - {codec, quality, mediaTypes}
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
   * Broadcast call token to blockchain (mint new or use existing)
   * @param {Object} callToken - Token to broadcast
   * @param {Function} mintTokenFn - Optional: (token) => Promise<{txId, tokenId}>
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
   * Start polling for incoming call inscriptions.
   *
   * @param {Function} scanInscriptionsFn - async (myAddress) => Array<{txId, inscription}>
   *   Should return inscription objects for all new SVphone inscriptions addressed to myAddress.
   */
  async startPolling(scanInscriptionsFn) {
    if (this.isPolling) {
      console.warn('[CallSignaling] Already polling for incoming inscriptions')
      return
    }

    this.isPolling = true
    console.log('[CallSignaling] Started polling for incoming call inscriptions')

    const pollOnce = async () => {
      try {
        const results = await scanInscriptionsFn(this.myAddress)

        for (const { txId, inscription } of results) {
          const callId = txId

          // Skip already-seen inscriptions
          if (this.callTokens.has(callId)) continue

          const callInfo = this.inscriptionToCallInfo(inscription)

          if (inscription.type === 'call' && inscription.callee === this.myAddress) {
            this.handleIncomingCall(callId, inscription, callInfo)
          } else if (inscription.type === 'answer' && inscription.caller === this.myAddress) {
            this.handleCallResponse(callId, inscription, callInfo)
          }
        }
      } catch (error) {
        console.error('[CallSignaling] Polling error:', error.message)
      }

      if (this.isPolling) {
        this.pollHandle = setTimeout(pollOnce, this.pollingInterval)
      }
    }

    // Start polling
    this.pollHandle = setTimeout(pollOnce, 100)
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
   * Handle incoming call inscription
   * @private
   */
  handleIncomingCall(callId, inscription, callInfo) {
    const callToken = {
      callTokenId: callId,
      txId: callId,
      caller: inscription.caller,
      callee: inscription.callee,
      senderIp: callInfo.senderIp,
      senderPort: callInfo.senderPort,
      sessionKey: callInfo.sessionKey,
      codec: callInfo.codec,
      quality: callInfo.quality,
      mediaTypes: callInfo.mediaTypes,
      sdpOffer: callInfo.sdpOffer,
      status: 'ringing',
      receivedAt: Date.now()
    }

    this.callTokens.set(callId, callToken)

    this.emit('call:incoming', {
      callTokenId: callId,
      caller: inscription.caller,
      callerIp: callInfo.senderIp,
      callerPort: callInfo.senderPort,
      codec: callInfo.codec,
      quality: callInfo.quality,
      sdpOffer: callInfo.sdpOffer,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Incoming call from:', inscription.caller)
  }

  /**
   * Handle answer inscription from callee
   * @private
   */
  handleCallResponse(callId, inscription, callInfo) {
    if (!callInfo.sdpAnswer) return

    this.callTokens.set(callId, { callTokenId: callId, txId: callId, status: 'answered' })

    this.emit('call:answered', {
      callTokenId: callId,
      caller: inscription.caller,
      callee: inscription.callee,
      calleeIp: callInfo.senderIp,
      calleePort: callInfo.senderPort,
      calleeSessionKey: callInfo.sessionKey,
      sdpAnswer: callInfo.sdpAnswer,
      codec: callInfo.codec,
      quality: callInfo.quality,
      mediaTypes: callInfo.mediaTypes,
      timestamp: Date.now()
    })

    console.log('[CallSignaling] Call answer received from', inscription.callee?.slice(0, 20))
  }

  /**
   * Accept incoming call
   * @param {string} callTokenId - Call token ID to accept
   * @param {Object} options - Acceptance options
   * @returns {Object} Answer token to send back
   */
  acceptCall(callTokenId, options = {}) {
    const callToken = this._validateCallToken(callTokenId)

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
   * @param {string} callTokenId - Call token ID
   * @param {string} callerAddress - Caller's address (recipient)
   * @param {Object} answerData - {sdpAnswer, senderIp, senderPort, sessionKey, codec, quality, mediaTypes}
   * @param {Function} broadcastFn - Optional broadcast function
   */
  async broadcastCallAnswer(callTokenId, callerAddress, answerData, broadcastFn) {
    if (!broadcastFn) {
      console.warn('[CallSignaling] No broadcast function provided')
      return { callTokenId, txId: null }
    }

    try {
      const result = await broadcastFn(callTokenId, callerAddress, answerData)

      this.emit('call:answer-broadcasted', {
        callTokenId: callTokenId,
        txId: result.txId,
        timestamp: Date.now()
      })

      console.log('[CallSignaling] Answer broadcasted:', result.txId)
      return result
    } catch (error) {
      console.error('[CallSignaling] Failed to broadcast answer:', error.message)
      throw error
    }
  }

  /**
   * Reject incoming call
   * @param {string} callTokenId - Call token ID to reject
   * @param {string} reason - Rejection reason
   */
  rejectCall(callTokenId, reason = 'user-declined') {
    const callToken = this._validateCallToken(callTokenId)

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
    const callToken = this._validateCallToken(callTokenId)

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
    const callToken = this._validateCallToken(callTokenId)

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
   * Validate call token exists (helper)
   * @private
   */
  _validateCallToken(callTokenId) {
    const callToken = this.callTokens.get(callTokenId)
    if (!callToken) {
      throw new Error(`Call token not found: ${callTokenId}`)
    }
    return callToken
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
