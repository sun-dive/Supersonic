/**
 * WebRTC Peer Connection Manager (v06.00)
 *
 * Manages peer-to-peer media connections for voice and video calls.
 * Uses direct P2P with mDNS discovery for NAT traversal.
 * Firewalls typically allow ports 3478-3497 (standard VoIP ports), enabling traversal.
 * Uses DTLS-SRTP for encryption.
 */

class PeerConnection extends EventEmitter {
  constructor(options = {}) {
    super()
    this.peerConnections = new Map() // Map<peerId, RTCPeerConnection>

    // ICE configuration: Direct P2P without centralized STUN/TURN servers
    // WebRTC uses mDNS and direct connection for peer discovery
    // Firewalls typically keep ports 3478-3497 open (standard VoIP ports used by FaceTime, Game Center, etc.)
    // This allows NAT traversal without relying on centralized servers
    this.iceServers = options.iceServers || []  // Empty - direct P2P only

    // Optional TURN server if caller provides one (for restricted networks)
    // Defaults to port 3478 (standard STUN/TURN port)
    if (options.turnServer) {
      this.iceServers.push({
        urls: [`turn:${options.turnServer.host}:${options.turnServer.port || 3478}`],
        username: options.turnServer.username,
        credential: options.turnServer.credential
      })
    }

    // Media constraints
    this.audioConstraints = options.audioConstraints || {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }

    this.videoConstraints = options.videoConstraints || {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    }

    // State tracking
    this.mediaStream = null
    this.pendingCandidates = new Map() // Map<peerId, [RTCIceCandidate]>
  }

  /**
   * Initialize media stream (audio/video)
   *
   * @param {Object} options - Media options
   * @param {boolean} options.audio - Enable audio
   * @param {boolean} options.video - Enable video
   * @returns {Promise<MediaStream>}
   */
  /**
   * Check if an error is a media permission/security error
   * @private
   */
  _isPermissionError(error) {
    return error.name === 'NotAllowedError' ||
           error.name === 'SecurityError' ||
           error.message?.includes('Permission denied')
  }

  async initializeMediaStream(options = { audio: true, video: true }) {
    const audioOnly = { audio: this.audioConstraints, video: false }

    const tryAudioOnly = async (fromError) => {
      if (!options.audio) {
        if (this._isPermissionError(fromError)) this.emitPermissionError(fromError)
        throw this.createPermissionErrorMessage(fromError)
      }
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia(audioOnly)
        console.log('[PeerConnection] Audio-only stream initialized')
        this.emit('media:ready', { mediaStream: this.mediaStream, audioOnly: true })
        return this.mediaStream
      } catch (audioError) {
        if (this._isPermissionError(audioError)) this.emitPermissionError(audioError)
        throw this.createPermissionErrorMessage(audioError)
      }
    }

    try {
      // Attempt 1: full constraints
      try {
        const constraints = {
          audio: options.audio ? this.audioConstraints : false,
          video: options.video ? this.videoConstraints : false
        }
        this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
        console.log('[PeerConnection] Media stream initialized')
        this.emit('media:ready', { mediaStream: this.mediaStream })
        return this.mediaStream
      } catch (err1) {
        if (!options.video || this._isPermissionError(err1)) {
          return await tryAudioOnly(err1)
        }
        console.warn('[PeerConnection] Strict video constraints failed, relaxing:', err1.message)
      }

      // Attempt 2: relaxed video constraints
      try {
        const relaxed = {
          audio: options.audio ? this.audioConstraints : false,
          video: true
        }
        this.mediaStream = await navigator.mediaDevices.getUserMedia(relaxed)
        console.log('[PeerConnection] Media stream initialized with relaxed video constraints')
        this.emit('media:ready', { mediaStream: this.mediaStream })
        return this.mediaStream
      } catch (err2) {
        console.warn('[PeerConnection] Relaxed video failed, falling back to audio-only:', err2.message)
        return await tryAudioOnly(err2)
      }
    } catch (error) {
      console.error('[PeerConnection] Failed to get media stream:', error)
      this.emit('media:error', { error })
      throw error
    }
  }

  /**
   * Stop all media streams
   */
  stopMediaStream() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
      console.log('[PeerConnection] Media stream stopped')
    }
  }

  /**
   * Create a user-friendly error message for permission errors
   * @private
   */
  createPermissionErrorMessage(error) {
    const errorName = error.name || 'Unknown'
    const errorMessage = error.message || ''

    if (errorName === 'NotAllowedError') {
      return new Error(
        'Media access denied. Please:\n' +
        '1. Check browser permission settings\n' +
        '2. Make sure this site is allowed to access microphone/camera\n' +
        '3. Try allowing permissions when prompted'
      )
    } else if (errorName === 'SecurityError' || errorMessage.includes('secure')) {
      return new Error(
        'Security error accessing media. This may be due to:\n' +
        '1. Site requires HTTPS connection\n' +
        '2. Browser security restrictions\n' +
        '3. Try using HTTPS instead of HTTP'
      )
    } else if (errorMessage.includes('Permission denied')) {
      return new Error(
        'Permission denied by system:\n' +
        '1. Check OS-level privacy settings\n' +
        '2. Allow this browser access to microphone/camera in System Settings\n' +
        '3. Restart the browser and try again'
      )
    } else {
      return new Error(
        `Media access error (${errorName}): ${errorMessage}\n` +
        'Please check browser and system permission settings.'
      )
    }
  }

  /**
   * Emit permission error event with detailed info
   * @private
   */
  emitPermissionError(error) {
    console.error('[PeerConnection] Permission error:', {
      name: error.name,
      message: error.message,
      code: error.code
    })
    this.emit('media:permission-denied', {
      error: error,
      errorName: error.name,
      errorMessage: error.message
    })
  }

  /**
   * Create peer connection for a call
   *
   * @param {string} peerId - Peer identifier
   * @param {Object} offerSdp - Optional SDP offer to set as remote
   * @returns {RTCPeerConnection}
   */
  createPeerConnection(peerId, offerSdp = null) {
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      })

      // Store connection
      this.peerConnections.set(peerId, peerConnection)
      this.pendingCandidates.set(peerId, [])

      // Add media tracks from local stream
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.mediaStream)
        })
      }

      // ICE candidate handling
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.emit('ice:candidate', {
            peerId: peerId,
            candidate: event.candidate
          })
          console.log('[PeerConnection] ICE candidate generated for', peerId)
        } else {
          console.log('[PeerConnection] ICE gathering complete for', peerId)
        }
      }

      // Remote track handling
      peerConnection.ontrack = (event) => {
        this.emit('media:track-received', {
          peerId: peerId,
          stream: event.streams[0],
          track: event.track
        })
        console.log('[PeerConnection] Received remote track:', event.track.kind)
      }

      // Connection state monitoring
      peerConnection.onconnectionstatechange = () => {
        console.log('[PeerConnection] Connection state:', peerId, peerConnection.connectionState)
        this.emit('peer:connection-state-changed', {
          peerId: peerId,
          state: peerConnection.connectionState
        })

        if (peerConnection.connectionState === 'failed') {
          this.emit('peer:connection-failed', { peerId })
        } else if (peerConnection.connectionState === 'connected') {
          this.emit('peer:connected', { peerId })
        }
      }

      // ICE connection state
      peerConnection.oniceconnectionstatechange = () => {
        console.log('[PeerConnection] ICE connection state:', peerId, peerConnection.iceConnectionState)
      }

      // Signaling state
      peerConnection.onsignalingstatechange = () => {
        console.log('[PeerConnection] Signaling state:', peerId, peerConnection.signalingState)
      }

      console.log('[PeerConnection] Created peer connection for:', peerId)

      return peerConnection
    } catch (error) {
      console.error('[PeerConnection] Failed to create peer connection:', error)
      throw error
    }
  }

  /**
   * Create and send offer
   *
   * @param {string} peerId - Peer identifier
   * @returns {Promise<RTCSessionDescription>}
   */
  async createOffer(peerId) {
    try {
      let peerConnection = this.peerConnections.get(peerId)
      if (!peerConnection) {
        peerConnection = this.createPeerConnection(peerId)
      }

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      })

      await peerConnection.setLocalDescription(offer)

      console.log('[PeerConnection] Created offer for:', peerId)

      return offer
    } catch (error) {
      console.error('[PeerConnection] Failed to create offer:', error)
      throw error
    }
  }

  /**
   * Create and send answer
   *
   * @param {string} peerId - Peer identifier
   * @param {Object} offerSdp - Remote offer SDP
   * @returns {Promise<RTCSessionDescription>}
   */
  async createAnswer(peerId, offerSdp) {
    try {
      let peerConnection = this.peerConnections.get(peerId)
      if (!peerConnection) {
        peerConnection = this.createPeerConnection(peerId)
      }

      // Set remote description from offer
      const offer = new RTCSessionDescription({
        type: 'offer',
        sdp: offerSdp
      })
      await peerConnection.setRemoteDescription(offer)

      // Create answer
      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)

      console.log('[PeerConnection] Created answer for:', peerId)

      return answer
    } catch (error) {
      console.error('[PeerConnection] Failed to create answer:', error)
      throw error
    }
  }

  /**
   * Set remote description (for receiving offer/answer)
   *
   * @param {string} peerId - Peer identifier
   * @param {Object} description - SDP description
   */
  async setRemoteDescription(peerId, description) {
    try {
      const peerConnection = this.peerConnections.get(peerId)
      if (!peerConnection) {
        throw new Error(`Peer connection not found: ${peerId}`)
      }

      const desc = new RTCSessionDescription({
        type: description.type,
        sdp: description.sdp
      })

      await peerConnection.setRemoteDescription(desc)

      // Add any pending ICE candidates
      const pending = this.pendingCandidates.get(peerId) || []
      for (const candidate of pending) {
        try {
          await peerConnection.addIceCandidate(candidate)
        } catch (error) {
          console.warn('[PeerConnection] Failed to add pending ICE candidate:', error)
        }
      }
      this.pendingCandidates.set(peerId, [])

      console.log('[PeerConnection] Set remote description for:', peerId)
    } catch (error) {
      console.error('[PeerConnection] Failed to set remote description:', error)
      throw error
    }
  }

  /**
   * Add ICE candidate
   *
   * @param {string} peerId - Peer identifier
   * @param {Object} candidate - ICE candidate
   */
  async addIceCandidate(peerId, candidate) {
    try {
      const peerConnection = this.peerConnections.get(peerId)
      if (!peerConnection) {
        // Store candidate for later if connection not yet created
        if (!this.pendingCandidates.has(peerId)) {
          this.pendingCandidates.set(peerId, [])
        }
        this.pendingCandidates.get(peerId).push(candidate)
        return
      }

      const iceCandidate = new RTCIceCandidate(candidate)
      await peerConnection.addIceCandidate(iceCandidate)

      console.log('[PeerConnection] Added ICE candidate for:', peerId)
    } catch (error) {
      console.warn('[PeerConnection] Failed to add ICE candidate:', error)
    }
  }

  /**
   * Wait for ICE gathering to finish for a peer connection.
   * Resolves with the final localDescription (SDP with all candidates).
   * Times out after 5 seconds so inscriptions aren't delayed indefinitely.
   *
   * @param {string} peerId - Peer identifier
   * @returns {Promise<RTCSessionDescription>}
   */
  async waitForIceGathering(peerId) {
    const pc = this.peerConnections.get(peerId)
    if (!pc) throw new Error(`Peer connection not found: ${peerId}`)
    if (pc.iceGatheringState === 'complete') return pc.localDescription

    return new Promise((resolve) => {
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', onStateChange)
          clearTimeout(timer)
          console.log('[PeerConnection] ICE gathering complete for', peerId)
          resolve(pc.localDescription)
        }
      }
      // 5-second timeout — LAN host candidates gather in <1s in practice
      const timer = setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', onStateChange)
        console.warn('[PeerConnection] ICE gathering timeout for', peerId, '— using partial SDP')
        resolve(pc.localDescription)
      }, 5000)
      pc.addEventListener('icegatheringstatechange', onStateChange)
    })
  }

  /**
   * Get peer connection
   */
  getPeerConnection(peerId) {
    return this.peerConnections.get(peerId)
  }

  /**
   * Get connection state
   */
  getConnectionState(peerId) {
    const pc = this.peerConnections.get(peerId)
    if (!pc) return null
    return {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      iceGatheringState: pc.iceGatheringState
    }
  }

  /**
   * Close peer connection
   */
  closePeerConnection(peerId) {
    const peerConnection = this.peerConnections.get(peerId)
    if (peerConnection) {
      peerConnection.close()
      this.peerConnections.delete(peerId)
      this.pendingCandidates.delete(peerId)
      console.log('[PeerConnection] Closed peer connection for:', peerId)
    }
  }

  /**
   * Close all connections
   */
  closeAllConnections() {
    for (const [peerId, pc] of this.peerConnections) {
      pc.close()
    }
    this.peerConnections.clear()
    this.pendingCandidates.clear()
    this.stopMediaStream()
    console.log('[PeerConnection] Closed all peer connections')
  }

  /**
   * Get connection statistics
   */
  async getStats(peerId) {
    const peerConnection = this.peerConnections.get(peerId)
    if (!peerConnection) return null

    try {
      const stats = await peerConnection.getStats()
      const report = {
        audio: {},
        video: {},
        connection: {}
      }

      stats.forEach(stat => {
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          report.audio.inbound = {
            bytesReceived: stat.bytesReceived,
            packetsReceived: stat.packetsReceived,
            packetsLost: stat.packetsLost,
            jitter: stat.jitter,
            audioLevel: stat.audioLevel
          }
        }
        if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
          report.audio.outbound = {
            bytesSent: stat.bytesSent,
            packetsSent: stat.packetsSent,
            audioLevel: stat.audioLevel
          }
        }
        if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
          report.video.inbound = {
            bytesReceived: stat.bytesReceived,
            packetsReceived: stat.packetsReceived,
            packetsLost: stat.packetsLost,
            frameDecodedRate: stat.framesDecoded,
            jitter: stat.jitter
          }
        }
        if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
          report.video.outbound = {
            bytesSent: stat.bytesSent,
            packetsSent: stat.packetsSent,
            frameEncodedRate: stat.framesEncoded
          }
        }
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
          report.connection = {
            currentRoundTripTime: stat.currentRoundTripTime,
            availableOutgoingBitrate: stat.availableOutgoingBitrate,
            availableIncomingBitrate: stat.availableIncomingBitrate
          }
        }
      })

      return report
    } catch (error) {
      console.error('[PeerConnection] Failed to get stats:', error)
      return null
    }
  }

}

// Export for browser
if (typeof window !== 'undefined') {
  window.PeerConnection = PeerConnection
}

// Export for Node.js/modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PeerConnection
}
