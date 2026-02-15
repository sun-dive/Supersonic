/**
 * SVphone Call Manager (v06.00)
 *
 * Orchestrates between signaling layer (blockchain) and media layer (WebRTC).
 * Manages the complete call lifecycle from initiation to termination.
 */

class CallManager {
  constructor(signaling, peerConnection) {
    this.signaling = signaling
    this.peerConnection = peerConnection
    this.activeCallSessions = new Map() // Map<callTokenId, CallSession>
    this.listeners = new Map()

    // Bind signaling events
    this.signaling.on('call:initiated', (data) => this.onCallInitiated(data))
    this.signaling.on('call:incoming', (data) => this.onIncomingCall(data))
    this.signaling.on('call:answered', (data) => this.onCallAnswered(data))
    this.signaling.on('call:rejected', (data) => this.onCallRejected(data))

    // Bind peer connection events
    this.peerConnection.on('peer:connected', (data) => this.onPeerConnected(data))
    this.peerConnection.on('peer:connection-failed', (data) => this.onPeerConnectionFailed(data))
    this.peerConnection.on('media:track-received', (data) => this.onRemoteTrackReceived(data))
    this.peerConnection.on('media:ready', (data) => this.onMediaReady(data))
  }

  /**
   * Initiate a call
   *
   * @param {string} calleeAddress - Recipient's BSV address
   * @param {Object} options - Call options
   * @returns {Promise<CallSession>}
   */
  async initiateCall(calleeAddress, options = {}) {
    try {
      // Initialize media stream if not already done
      if (!this.peerConnection.mediaStream) {
        await this.peerConnection.initializeMediaStream({
          audio: options.audio !== false,
          video: options.video !== false
        })
      }

      // Create ephemeral session key for encryption
      const sessionKey = this.peerConnection.constructor.prototype.generateSessionKey?.call(this.peerConnection) ||
        btoa(String.fromCharCode(...new Uint8Array(32).map(() => Math.random() * 256)))

      // Create call initiation token
      const callToken = this.signaling.createCallToken(calleeAddress, sessionKey, {
        codec: options.codec || 'opus',
        quality: options.quality || 'hd',
        mediaTypes: options.mediaTypes || ['audio', 'video']
      })

      // **IMPORTANT: Create WebRTC offer BEFORE broadcasting the token**
      // This ensures the callee can retrieve the offer when accepting the call
      let mediaOffer = null
      try {
        console.debug('[CallManager] Creating SDP offer before token broadcast...')
        mediaOffer = await this.peerConnection.createOffer(calleeAddress)
        callToken.mediaOffer = mediaOffer  // Store offer in call token for callee to retrieve
        console.debug('[CallManager] ✓ SDP offer created and stored in callToken')
      } catch (error) {
        console.warn('[CallManager] Failed to create media offer before broadcast:', error)
      }

      // Broadcast to blockchain (now includes mediaOffer if successful)
      const broadcastResult = await this.signaling.broadcastCallToken(
        callToken,
        options.mintTokenFn
      )

      // Create session tracking
      const session = {
        callTokenId: broadcastResult.callTokenId,
        txId: broadcastResult.txId,
        calleeAddress: calleeAddress,
        role: 'caller',
        status: 'initiating', // initiating → ringing → connecting → connected → ended
        createdAt: Date.now(),
        sessionKey: sessionKey,
        mediaOffer: mediaOffer,  // Store in session as well
        mediaAnswer: null,
        iceCandidates: [],
        stats: {}
      }

      this.activeCallSessions.set(broadcastResult.callTokenId, session)

      this.emit('call:initiated-session', session)
      console.log('[CallManager] Initiated call to:', calleeAddress)

      return session
    } catch (error) {
      console.error('[CallManager] Failed to initiate call:', error)
      this.emit('call:initiation-failed', { error })
      throw error
    }
  }

  /**
   * Handle outgoing call initiated event
   * @private
   */
  onCallInitiated(data) {
    const session = this.activeCallSessions.get(data.callTokenId)
    if (session) {
      session.status = 'ringing'
      this.emit('call:ringing', data)
      console.log('[CallManager] Call ringing:', data.calleeAddress)
    }
  }

  /**
   * Handle incoming call
   * @private
   */
  onIncomingCall(data) {
    const session = {
      callTokenId: data.callTokenId,
      caller: data.caller,
      role: 'callee',
      status: 'incoming', // incoming → ringing → accepting → connecting → connected → ended
      createdAt: Date.now(),
      mediaOffer: null,
      mediaAnswer: null,
      iceCandidates: [],
      stats: {}
    }

    this.activeCallSessions.set(data.callTokenId, session)
    this.emit('call:incoming-session', session)
    console.log('[CallManager] Incoming call from:', data.caller)
  }

  /**
   * Accept incoming call
   *
   * @param {string} callTokenId - Call token ID
   * @param {Object} options - Acceptance options
   * @returns {Promise<CallSession>}
   */
  async acceptCall(callTokenId, options = {}) {
    try {
      const session = this.activeCallSessions.get(callTokenId)
      if (!session) {
        throw new Error(`Call session not found: ${callTokenId}`)
      }

      // Initialize media stream if not already done
      if (!this.peerConnection.mediaStream) {
        await this.peerConnection.initializeMediaStream({
          audio: options.audio !== false,
          video: options.video !== false
        })
      }

      // Update session
      session.status = 'accepting'

      // Accept call on signaling layer
      const answerToken = this.signaling.acceptCall(callTokenId, {
        sessionKey: options.sessionKey
      })
      session.answerToken = answerToken

      // Create WebRTC answer
      const callToken = this.signaling.getCallToken(callTokenId)
      if (callToken?.mediaOffer) {
        try {
          const answer = await this.peerConnection.createAnswer(
            callToken.caller,
            callToken.mediaOffer.sdp
          )
          session.mediaAnswer = answer
        } catch (error) {
          console.warn('[CallManager] Failed to create media answer:', error)
        }
      }

      session.status = 'connecting'
      this.emit('call:accepted-session', session)
      console.log('[CallManager] Accepted call:', callTokenId)

      return session
    } catch (error) {
      console.error('[CallManager] Failed to accept call:', error)
      this.emit('call:acceptance-failed', { callTokenId, error })
      throw error
    }
  }

  /**
   * Reject incoming call
   */
  async rejectCall(callTokenId, reason = 'user-declined') {
    try {
      this.signaling.rejectCall(callTokenId, reason)

      const session = this.activeCallSessions.get(callTokenId)
      if (session) {
        session.status = 'rejected'
      }

      this.emit('call:rejected-session', { callTokenId, reason })
      console.log('[CallManager] Rejected call:', callTokenId)
    } catch (error) {
      console.error('[CallManager] Failed to reject call:', error)
      throw error
    }
  }

  /**
   * Handle call answered event
   * @private
   */
  async onCallAnswered(data) {
    const session = this.activeCallSessions.get(data.callTokenId)
    if (session) {
      session.status = 'answered'

      // If we have the callee's SDP answer, apply it to the peer connection
      if (data.sdpAnswer && session.peerId) {
        try {
          console.debug('[CallManager] Setting remote description with SDP answer from callee')
          const answer = new RTCSessionDescription({
            type: 'answer',
            sdp: data.sdpAnswer
          })
          await this.peerConnection.setRemoteDescription(session.peerId, answer)
          console.log('[CallManager] ✅ Remote description set - ICE candidate exchange can begin')
        } catch (error) {
          console.error('[CallManager] Failed to set remote description:', error)
          this.emit('call:failed', { callTokenId: data.callTokenId, reason: 'Failed to apply remote description' })
          return
        }
      }

      this.emit('call:answered-session', data)
      console.log('[CallManager] Call answered')
    }
  }

  /**
   * Handle call rejected event
   * @private
   */
  onCallRejected(data) {
    const session = this.activeCallSessions.get(data.callTokenId)
    if (session) {
      session.status = 'rejected'
      this.emit('call:rejected-session', data)
    }
  }

  /**
   * Add ICE candidate to peer connection
   */
  async addIceCandidate(callTokenId, candidate) {
    try {
      const session = this.activeCallSessions.get(callTokenId)
      if (!session) {
        throw new Error(`Call session not found: ${callTokenId}`)
      }

      const callToken = this.signaling.getCallToken(callTokenId)
      const peerId = session.role === 'caller' ? callToken.callee : callToken.caller

      await this.peerConnection.addIceCandidate(peerId, candidate)
      session.iceCandidates.push(candidate)
    } catch (error) {
      console.error('[CallManager] Failed to add ICE candidate:', error)
    }
  }

  /**
   * Handle peer connected
   * @private
   */
  onPeerConnected(data) {
    // Find session by peer ID
    let session = null
    let peerId = null
    for (const [callTokenId, sess] of this.activeCallSessions) {
      const callToken = this.signaling.getCallToken(callTokenId)
      if (callToken) {
        peerId = sess.role === 'caller' ? callToken.callee : callToken.caller
        if (peerId === data.peerId) {
          session = sess
          break
        }
      }
    }

    if (session) {
      session.status = 'connected'
      session.connectedAt = Date.now()

      // Start collecting statistics
      this.startStatsMonitoring(session.callTokenId)

      // Show Active Call Panel if available
      if (typeof app !== 'undefined' && app.showActiveCallPanel) {
        app.currentPeerId = peerId
        app.showActiveCallPanel(peerId)
      }

      this.emit('call:connected', {
        callTokenId: session.callTokenId,
        timestamp: Date.now()
      })

      console.log('[CallManager] Peer connected')
    }
  }

  /**
   * Handle peer connection failed
   * @private
   */
  onPeerConnectionFailed(data) {
    console.error('[CallManager] Peer connection failed:', data.peerId)

    // Hide Active Call Panel if available
    if (typeof app !== 'undefined' && app.hideActiveCallPanel) {
      app.hideActiveCallPanel()
    }

    this.emit('call:connection-failed', data)
  }

  /**
   * Handle media stream ready (local media initialized)
   * @private
   */
  onMediaReady(data) {
    console.log('[CallManager] Local media stream ready')
    // Attach local video to Active Call Panel if available
    if (typeof app !== 'undefined' && data.mediaStream) {
      const localVideo = document.getElementById('localVideo')
      if (localVideo) {
        localVideo.srcObject = data.mediaStream
        console.log('[CallManager] Local video attached to call panel')
      }
    }
    this.emit('media:local-ready', data)
  }

  /**
   * Handle remote media track received
   * @private
   */
  onRemoteTrackReceived(data) {
    this.emit('media:remote-track', data)
    console.log('[CallManager] Received remote', data.track.kind, 'track')

    // Attach remote video to Active Call Panel if available
    if (typeof app !== 'undefined' && data.stream) {
      const remoteVideo = document.getElementById('remoteVideo')
      if (remoteVideo) {
        remoteVideo.srcObject = data.stream
        console.log('[CallManager] Remote video attached to call panel')
      }
    }
  }

  /**
   * Start monitoring call statistics
   * @private
   */
  startStatsMonitoring(callTokenId) {
    const session = this.activeCallSessions.get(callTokenId)
    if (!session) return

    const callToken = this.signaling.getCallToken(callTokenId)
    const peerId = session.role === 'caller' ? callToken.callee : callToken.caller

    const monitorInterval = setInterval(async () => {
      if (session.status !== 'connected') {
        clearInterval(monitorInterval)
        return
      }

      try {
        const stats = await this.peerConnection.getStats(peerId)
        if (stats) {
          session.stats = {
            ...session.stats,
            lastUpdated: Date.now(),
            ...stats
          }
          this.emit('call:stats-updated', {
            callTokenId: callTokenId,
            stats: stats
          })
        }
      } catch (error) {
        console.warn('[CallManager] Failed to collect stats:', error)
      }
    }, 5000) // Collect stats every 5 seconds

    session.statsMonitor = monitorInterval
  }

  /**
   * End call
   *
   * @param {string} callTokenId - Call token ID
   * @param {Object} options - End options
   */
  async endCall(callTokenId, options = {}) {
    try {
      const session = this.activeCallSessions.get(callTokenId)
      if (!session) {
        throw new Error(`Call session not found: ${callTokenId}`)
      }

      // Stop stats monitoring
      if (session.statsMonitor) {
        clearInterval(session.statsMonitor)
      }

      // Close peer connection
      const callToken = this.signaling.getCallToken(callTokenId)
      if (callToken) {
        const peerId = session.role === 'caller' ? callToken.callee : callToken.caller
        this.peerConnection.closePeerConnection(peerId)
      }

      // Update signaling
      const duration = session.connectedAt ? Date.now() - session.connectedAt : 0
      this.signaling.endCall(callTokenId, {
        duration: duration,
        quality: session.stats
      })

      // Update session
      session.status = 'ended'
      session.endedAt = Date.now()

      this.emit('call:ended-session', {
        callTokenId: callTokenId,
        duration: duration,
        stats: session.stats
      })

      console.log('[CallManager] Ended call:', callTokenId, `(${duration}ms)`)
    } catch (error) {
      console.error('[CallManager] Failed to end call:', error)
      throw error
    }
  }

  /**
   * Get call session
   */
  getSession(callTokenId) {
    return this.activeCallSessions.get(callTokenId)
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.activeCallSessions.values())
  }

  /**
   * Get local media stream
   */
  getLocalMediaStream() {
    return this.peerConnection.mediaStream
  }

  /**
   * Get remote media stream
   */
  getRemoteMediaStream(callTokenId) {
    const session = this.activeCallSessions.get(callTokenId)
    if (!session) return null

    const callToken = this.signaling.getCallToken(callTokenId)
    const peerId = session.role === 'caller' ? callToken.callee : callToken.caller
    const pc = this.peerConnection.getPeerConnection(peerId)

    if (pc) {
      const receivers = pc.getReceivers()
      if (receivers.length > 0) {
        const tracks = receivers.map(r => r.track)
        return new MediaStream(tracks)
      }
    }

    return null
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
          console.error(`[CallManager] Error in ${eventName} handler:`, error)
        }
      })
    }
  }
}

// Export for browser
if (typeof window !== 'undefined') {
  window.CallManager = CallManager
}

// Export for Node.js/modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CallManager
}
