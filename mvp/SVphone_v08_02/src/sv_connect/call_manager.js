/**
 * SVphone Call Manager (v06.00)
 *
 * Orchestrates between signaling layer (blockchain) and media layer (WebRTC).
 * Manages the complete call lifecycle from initiation to termination.
 */

class EventEmitter {
  constructor() {
    this.listeners = new Map()
  }

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
      if (index > -1) callbacks.splice(index, 1)
    }
  }

  emit(eventName, data) {
    const callbacks = this.listeners.get(eventName)
    if (callbacks) {
      callbacks.forEach(cb => {
        try { cb(data) } catch (error) {
          console.error(`[EventEmitter] Error in ${eventName} handler:`, error)
        }
      })
    }
  }
}

class CallManager extends EventEmitter {
  constructor(signaling, peerConnection) {
    super()
    this.signaling = signaling
    this.peerConnection = peerConnection
    this.activeCallSessions = new Map() // Map<callTokenId, CallSession>

    // Bind signaling events
    this.signaling.on('call:initiated', (data) => this.onCallInitiated(data))
    this.signaling.on('call:incoming', (data) => this.onIncomingCall(data))
    this.signaling.on('call:answered', (data) => this.onCallAnswered(data))
    this.signaling.on('call:rejected', (data) => this.onCallRejected(data))

    // Bind peer connection events
    this.peerConnection.on('peer:connected', (data) => this.onPeerConnected(data))
    this.peerConnection.on('peer:connection-failed', (data) => this.onPeerConnectionFailed(data))
    this.peerConnection.on('media:track-received', (data) => this.onRemoteTrackReceived(data))
    this.peerConnection.on('peer:connection-state-changed', ({ peerId, state }) => {
      this.emit('call:log', { msg: `[WebRTC] conn: ${state}`, type: state === 'failed' ? 'error' : 'info' })
    })
    this.peerConnection.on('ice:state-changed', ({ peerId, state }) => {
      this.emit('call:log', { msg: `[ICE] state: ${state}`, type: state === 'failed' ? 'error' : 'info' })
    })
    this.peerConnection.on('ice:gathering-changed', ({ peerId, state }) => {
      this.emit('call:log', { msg: `[ICE] gathering: ${state}`, type: 'info' })
    })
    this.peerConnection.on('ice:pairs-on-failure', ({ peerId, pairs }) => {
      this.emit('call:log', { msg: `[ICE] ${pairs.length} pair(s) tried:`, type: 'error' })
      for (const p of pairs) {
        this.emit('call:log', { msg: `  ${p.state} L:${p.local} → R:${p.remote}`, type: 'error' })
      }
    })
  }

  /**
   * Get the remote peer ID for a session (callee if caller, caller if callee)
   * @private
   */
  _getPeerId(session, callToken) {
    return session.role === 'caller' ? callToken.callee : callToken.caller
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
      // Initialize media stream, or re-initialize if video requirement changed
      const needsVideo = options.video !== false
      const hasVideo   = (this.peerConnection.mediaStream?.getVideoTracks().length ?? 0) > 0
      if (!this.peerConnection.mediaStream || needsVideo !== hasVideo) {
        if (this.peerConnection.mediaStream) {
          this.peerConnection.mediaStream.getTracks().forEach(t => t.stop())
          this.peerConnection.mediaStream = null
        }
        await this.peerConnection.initializeMediaStream({
          audio: options.audio !== false,
          video: needsVideo
        })
      }

      // Create ephemeral session key for encryption
      const sessionKey = this.peerConnection.constructor.prototype.generateSessionKey?.call(this.peerConnection) ||
        btoa(String.fromCharCode(...new Uint8Array(32).map(() => Math.random() * 256)))

      // Create call initiation token
      const callToken = this.signaling.createCallToken(calleeAddress, sessionKey, {
        codec: options.codec || 'opus',
        quality: options.quality || 'hd',
        mediaTypes: options.mediaTypes || (needsVideo ? ['audio', 'video'] : ['audio'])
      })

      // Create WebRTC offer and wait for ICE gathering to complete so all candidates
      // are in the SDP before it gets inscribed on-chain.
      let mediaOffer = null
      try {
        console.debug('[CallManager] Creating SDP offer...')
        await this.peerConnection.createOffer(calleeAddress)
        // Wait for ICE gathering — localDescription.sdp will include all candidates
        const finalOffer = await this.peerConnection.waitForIceGathering(calleeAddress)
        mediaOffer = finalOffer  // RTCSessionDescription with complete SDP
        callToken.sdpOffer = mediaOffer
        console.debug('[CallManager] ✓ SDP offer ready (ICE gathered)')
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
      if (callToken?.sdpOffer) {
        try {
          // Use deferred ICE checking: gather local candidates immediately (so they appear in
          // the ANS TX SDP) but do NOT start connectivity checks yet.  Checks are held until
          // after the ANS TX is broadcast — giving the caller time to receive it and start their
          // own ICE.  Without this, the callee's ICE fails in ~5s (before the caller starts),
          // then the caller's ICE starts 15s later against a dead callee ICE agent.
          const iceLog = (msg, type = 'info') => this.emit('call:log', { msg, type })
          const { answer, callerCandidates } = await this.peerConnection.prepareAnswerDeferred(
            callToken.caller,
            callToken.sdpOffer.sdp
          )
          session.mediaAnswer = answer
          console.debug('[CallManager] ✓ Deferred answer prepared, gathering candidates...')

          // Broadcast ANS TX immediately after gathering (no 5s wait for STUN srflx we don't have)
          try {
            const finalAnswer = await this.peerConnection.waitForIceGathering(callToken.caller)
            const answerSdp = finalAnswer?.sdp || answer.sdp
            console.debug('[CallManager] Broadcasting SDP answer to caller...')
            await this.signaling.broadcastCallAnswer(
              callTokenId,
              callToken.caller,
              {
                sdpAnswer: answerSdp,
                senderIp: this.signaling.myIp,
                senderIp4: this.signaling.myIp4 ?? null,
                senderIp6: this.signaling.myIp6 ?? null,
                senderPort: this.signaling.myPort,
                sessionKey: answerToken.answererSessionKey,
                codec: callToken.codec,
                quality: callToken.quality,
                mediaTypes: callToken.mediaTypes
              },
              options.broadcastAnswerFn
            )
            console.debug('[CallManager] ✓ SDP answer broadcasted. Starting ICE retry loop...')
            iceLog('[ICE] ANS sent. Will retry ICE every 20s for up to 3 min.')

            // ICE retry loop — no new TXs needed.
            //
            // Strategy: keep the PC in ICE "new" state (no candidate pairs) between attempts.
            // The browser keeps its UDP ports open even in "new", so the caller's STUN probes
            // can arrive and trigger peer-reflexive candidate discovery at any time.
            //
            // When we DO add candidates (every 20s), ICE transitions to "checking".
            // If it fails (~5-30s), we close the PC, recreate it with the same offer SDP
            // (caller's credentials are preserved), and wait again.  The DTLS fingerprint
            // in the callee's ANS TX stays valid as long as we reuse the same PC instance;
            // recreating is only needed if "failed" is reached and the browser has locked up.
            const ICE_FIRST_DELAY_MS  = 10000   // wait 10s before first attempt
            const ICE_RETRY_DELAY_MS  = 20000   // wait 20s between retries
            const ICE_MAX_WAIT_MS     = 3 * 60 * 1000  // 3-minute ceiling
            const iceLoopStart        = Date.now()
            let   iceRetryTimer       = null
            let   iceAttempt          = 0

            const stopIceLoop = () => {
              if (iceRetryTimer) { clearTimeout(iceRetryTimer); iceRetryTimer = null }
            }

            const attemptIceConnect = async () => {
              // Abort if call ended or already connected
              const sess = this.activeCallSessions.get(callTokenId)
              if (!sess || sess.status === 'ended' || sess.status === 'connected') {
                stopIceLoop(); return
              }
              const pc = this.peerConnection.getPeerConnection(callToken.caller)
              if (pc) {
                const s = pc.iceConnectionState
                if (s === 'connected' || s === 'completed') { stopIceLoop(); return }
              }
              if (Date.now() - iceLoopStart > ICE_MAX_WAIT_MS) {
                iceLog('[ICE] 3-minute timeout — no connection. Hang up and redial.', 'error')
                stopIceLoop(); return
              }

              iceAttempt++
              iceLog(`[ICE] Attempt ${iceAttempt} (ip4: ${callToken.senderIp4 ?? 'none'} / ip6: ${callToken.senderIp6 ?? 'none'})`)

              // Re-add candidates regardless of ICE state — on some browsers,
              // adding candidates after 'failed' triggers a new check round.
              // We intentionally do NOT reset the PC here because creating a new PC
              // would change the DTLS fingerprint, breaking the handshake with the caller
              // who already has the original fingerprint from the ANS TX.

              // Add caller's native SDP candidates → ICE transitions from "new" to "checking"
              this.peerConnection.activateDeferredChecking(callToken.caller, callerCandidates)
                .catch(e => console.warn('[CallManager] ICE candidate error:', e.message))

              // Inject synthetic srflx based on caller's known public IP
              if (callToken.senderIp4 || callToken.senderIp6) {
                const pubCandidates = this.peerConnection._buildPublicIpCandidates(
                  callToken.sdpOffer.sdp, callToken.senderIp4 ?? null, callToken.senderIp6 ?? null, iceLog
                )
                for (const c of pubCandidates) {
                  this.peerConnection.addIceCandidate(callToken.caller, c)
                    .catch(() => {})
                }
              }

              // Schedule next attempt (will be cancelled if ICE connects before it fires)
              iceRetryTimer = setTimeout(attemptIceConnect, ICE_RETRY_DELAY_MS)
            }

            // Stop the loop when connected or call ends
            const onConnected    = () => stopIceLoop()
            const onSessionEnded = () => stopIceLoop()
            this.on('call:connected',     onConnected)
            this.on('call:ended-session', onSessionEnded)

            // First attempt: 10s gives the caller time to receive the ANS TX and start their ICE
            iceRetryTimer = setTimeout(attemptIceConnect, ICE_FIRST_DELAY_MS)
          } catch (error) {
            console.warn('[CallManager] Failed to broadcast media answer:', error)
          }
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
  onCallAnswered(data) {
    let session = this.activeCallSessions.get(data.callTokenId)

    // Fallback: answer inscription txId ≠ call inscription txId. If direct lookup
    // misses (e.g., session stored under call txId), find caller session by callee address.
    if (!session && data.callee) {
      for (const [, s] of this.activeCallSessions) {
        if (s.role === 'caller' && s.calleeAddress === data.callee) {
          session = s
          break
        }
      }
    }

    if (session) {
      session.status = 'answered'
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
      const peerId = this._getPeerId(session, callToken)

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
    for (const [callTokenId, sess] of this.activeCallSessions) {
      const callToken = this.signaling.getCallToken(callTokenId)
      if (callToken) {
        const peerId = this._getPeerId(sess, callToken)
        if (peerId === data.peerId) {
          session = sess
          break
        }
      }
    }

    if (session) {
      console.debug('[CallManager] onPeerConnected: Found session, setting status to connected')
      session.status = 'connected'
      session.connectedAt = Date.now()

      // Start collecting statistics
      console.debug('[CallManager] onPeerConnected: Starting stats monitoring')
      this.startStatsMonitoring(session.callTokenId)

      console.debug('[CallManager] onPeerConnected: About to emit call:connected event')
      this.emit('call:connected', {
        callTokenId: session.callTokenId,
        timestamp: Date.now()
      })
      console.debug('[CallManager] onPeerConnected: Emitted call:connected event')

      console.log('[CallManager] Peer connected')
    } else {
      console.error('[CallManager] onPeerConnected: NO SESSION FOUND! This is the problem!')
    }
  }

  /**
   * Handle peer connection failed
   * @private
   */
  onPeerConnectionFailed(data) {
    console.error('[CallManager] Peer connection failed:', data.peerId)
    this.emit('call:connection-failed', data)
  }

  /**
   * Handle remote media track received
   * @private
   */
  onRemoteTrackReceived(data) {
    this.emit('media:remote-track', data)
    console.log('[CallManager] Received remote', data.track.kind, 'track')
  }

  /**
   * Start monitoring call statistics
   * @private
   */
  startStatsMonitoring(callTokenId) {
    const session = this.activeCallSessions.get(callTokenId)
    if (!session) return

    const callToken = this.signaling.getCallToken(callTokenId)
    const peerId = this._getPeerId(session, callToken)

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
        const peerId = this._getPeerId(session, callToken)
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
    const peerId = this._getPeerId(session, callToken)
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

}

// Export for browser
if (typeof window !== 'undefined') {
  window.CallManager = CallManager
}

// Export for Node.js/modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CallManager
}
