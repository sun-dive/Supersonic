/**
 * WebRTC Peer Connection Manager (v06.00)
 *
 * Manages peer-to-peer media connections for voice and video calls.
 * Uses ICE (STUN/TURN) for NAT traversal and DTLS-SRTP for encryption.
 */

class PeerConnection {
  constructor(options = {}) {
    this.peerConnections = new Map() // Map<peerId, RTCPeerConnection>
    this.listeners = new Map()

    // ICE configuration
    this.iceServers = options.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]

    // Optional TURN server for restrictive NAT
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
  async initializeMediaStream(options = { audio: true, video: true }) {
    try {
      const constraints = {
        audio: options.audio ? this.audioConstraints : false,
        video: options.video ? this.videoConstraints : false
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints)

      console.log('[PeerConnection] Media stream initialized:', {
        audioTracks: this.mediaStream.getAudioTracks().length,
        videoTracks: this.mediaStream.getVideoTracks().length
      })

      this.emit('media:ready', { mediaStream: this.mediaStream })

      return this.mediaStream
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
          console.error(`[PeerConnection] Error in ${eventName} handler:`, error)
        }
      })
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
