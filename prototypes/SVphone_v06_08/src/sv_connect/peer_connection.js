/**
 * WebRTC Media Handler (v06.08)
 *
 * Minimal direct P2P media connection.
 * No STUN/TURN (addresses provided via blockchain call token).
 * No ICE candidates (direct connection to known address).
 */

class PeerConnection {
  constructor() {
    this.peerConnections = new Map() // Map<peerId, RTCPeerConnection>
    this.mediaStream = null
    this.listeners = new Map()
  }

  /**
   * Initialize local media stream (audio/video)
   */
  async initializeMediaStream(options = { audio: true, video: true }) {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: options.audio || false,
        video: options.video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
      })
      console.log('[PeerConnection] Media stream initialized')
      this.emit('media:ready', { mediaStream: this.mediaStream })
      return this.mediaStream
    } catch (error) {
      console.error('[PeerConnection] Failed to get media stream:', error)
      this.emit('media:error', { error })
      throw error
    }
  }

  /**
   * Stop all media tracks
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
   */
  createPeerConnection(peerId) {
    try {
      const peerConnection = new RTCPeerConnection({
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      })

      this.peerConnections.set(peerId, peerConnection)

      // Add local media tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.mediaStream)
        })
      }

      // Handle remote tracks
      peerConnection.ontrack = (event) => {
        console.log('[PeerConnection] Received remote track:', event.track.kind)
        this.emit('media:track-received', {
          peerId: peerId,
          stream: event.streams[0],
          track: event.track
        })
      }

      // Monitor connection state
      peerConnection.onconnectionstatechange = () => {
        console.log('[PeerConnection] Connection state:', peerId, peerConnection.connectionState)
        this.emit('peer:connection-state-changed', {
          peerId: peerId,
          state: peerConnection.connectionState
        })

        if (peerConnection.connectionState === 'connected') {
          this.emit('peer:connected', { peerId })
        } else if (peerConnection.connectionState === 'failed') {
          this.emit('peer:connection-failed', { peerId })
        }
      }

      console.log('[PeerConnection] Created peer connection for:', peerId)
      return peerConnection
    } catch (error) {
      console.error('[PeerConnection] Failed to create peer connection:', error)
      throw error
    }
  }

  /**
   * Create SDP offer
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
   * Create SDP answer
   */
  async createAnswer(peerId, offerSdp) {
    try {
      let peerConnection = this.peerConnections.get(peerId)
      if (!peerConnection) {
        peerConnection = this.createPeerConnection(peerId)
      }

      const offer = new RTCSessionDescription({
        type: 'offer',
        sdp: offerSdp
      })
      await peerConnection.setRemoteDescription(offer)

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
   * Set remote description (answer/offer from peer)
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
      console.log('[PeerConnection] Set remote description for:', peerId)
    } catch (error) {
      console.error('[PeerConnection] Failed to set remote description:', error)
      throw error
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
      signalingState: pc.signalingState
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
    this.stopMediaStream()
    console.log('[PeerConnection] Closed all peer connections')
  }

  /**
   * Event emitter
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

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PeerConnection
}
