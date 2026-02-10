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
 * - tokenRules: supply=1, divisibility=0, restrictions=0x0001 (one-time-use)
 * - tokenAttributes: contains call metadata (caller, callee, IP, port, session key)
 * - stateData: call state (status="ringing", duration=0, quality="hd")
 * - proofChain: [] (empty until confirmed)
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
      // P token metadata
      tokenName: 'svphone-call-v1',
      tokenScript: '',
      tokenRules: {
        supply: 1,
        divisibility: 0,
        restrictions: 0x0001, // One-time-use
        version: 1
      },

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
   * Requires external function to mint token via tokenBuilder
   *
   * @param {Object} callToken - Call token to broadcast
   * @param {Function} mintTokenFn - Function to mint token: (token) => Promise<{txId, tokenId}>
   * @returns {Object} {txId, tokenId, callTokenId}
   */
  async broadcastCallToken(callToken, mintTokenFn) {
    try {
      const result = await mintTokenFn(callToken)
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
        callee: callToken.callee
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

        for (const token of incomingTokens) {
          // Check if it's a call initiation token
          if (token.tokenName === 'svphone-call-v1' && token.callee === this.myAddress) {
            // Verify token via SPV before accepting
            const verification = await verifyTokenFn(token)

            if (verification.valid) {
              this.handleIncomingCall(token)
            } else {
              console.warn('[CallSignaling] Incoming call token failed verification:', {
                tokenId: token.tokenId,
                reason: verification.reason
              })
            }
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
