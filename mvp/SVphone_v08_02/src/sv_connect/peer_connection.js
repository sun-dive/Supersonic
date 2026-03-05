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
        const state = peerConnection.iceConnectionState
        console.log('[PeerConnection] ICE connection state:', peerId, state)
        this.emit('ice:state-changed', { peerId, state })

        // On failure, dump all candidate pairs so we can see what was tried
        if (state === 'failed') {
          peerConnection.getStats().then(stats => {
            const pairs = []
            const locals = new Map()
            const remotes = new Map()
            stats.forEach(s => {
              if (s.type === 'local-candidate')  locals.set(s.id, s)
              if (s.type === 'remote-candidate') remotes.set(s.id, s)
            })
            stats.forEach(s => {
              if (s.type !== 'candidate-pair') return
              const l = locals.get(s.localCandidateId)
              const r = remotes.get(s.remoteCandidateId)
              pairs.push({
                state: s.state,
                local:  l ? `${l.candidateType} ${l.address ?? l.ip}:${l.port}` : '?',
                remote: r ? `${r.candidateType} ${r.address ?? r.ip}:${r.port}` : '?',
                nominated: s.nominated
              })
            })
            this.emit('ice:pairs-on-failure', { peerId, pairs })
          }).catch(() => {})
        }
      }

      // ICE gathering state
      peerConnection.onicegatheringstatechange = () => {
        const s = peerConnection.iceGatheringState
        console.log('[PeerConnection] ICE gathering state:', peerId, s)
        this.emit('ice:gathering-changed', { peerId, state: s })
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
   * Prepare an answer and gather local ICE candidates WITHOUT starting connectivity
   * checks yet.  Checks are deferred until the caller explicitly calls
   * activateDeferredChecking(peerId, callerCandidates).
   *
   * How it works:
   *   setLocalDescription triggers gathering but NOT checking.
   *   Checking only starts once the remote description has at least one candidate pair.
   *   By stripping candidates from the offer before setRemoteDescription we get
   *   gathering without checking — giving us a complete local SDP (with real ports)
   *   to put in the ANS TX, while allowing checking to start later once the caller
   *   is known to have received the ANS TX and started their own ICE.
   *
   * @param {string} peerId - Peer identifier (= caller address)
   * @param {string} offerSdp - Full SDP from CALL TX (may have host/mDNS candidates)
   * @returns {Promise<{answerSdp: string, callerCandidates: Array}>}
   */
  async prepareAnswerDeferred(peerId, offerSdp) {
    try {
      let peerConnection = this.peerConnections.get(peerId)
      if (!peerConnection) {
        peerConnection = this.createPeerConnection(peerId)
      }

      // Extract candidate lines so we can add them later (triggering ICE checking)
      const callerCandidates = []
      let mid = null, mIdx = -1
      for (const line of offerSdp.split(/\r?\n/)) {
        if (line.startsWith('m=')) { mIdx++; mid = null }
        else if (line.startsWith('a=mid:')) mid = line.slice(6).trim()
        else if (line.startsWith('a=candidate:')) {
          callerCandidates.push({ candidate: line.slice(2), sdpMid: mid, sdpMLineIndex: mIdx })
        }
      }

      // Remove candidate lines from offer — setLocalDescription won't trigger checking
      // because there are no candidate pairs without remote candidates
      const offerNoCandidates = offerSdp
        .split(/\r?\n/)
        .filter(l => !l.startsWith('a=candidate:'))
        .join('\r\n')

      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerNoCandidates }))
      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)
      // ICE gathering starts here (host candidates ready in <200ms), but NO checking
      // because the remote description has no candidates → no candidate pairs formed yet

      console.log('[PeerConnection] Prepared deferred answer for:', peerId, `(${callerCandidates.length} caller candidates held)`)
      return { answer, callerCandidates }
    } catch (error) {
      console.error('[PeerConnection] Failed to prepare deferred answer:', error)
      throw error
    }
  }

  /**
   * Activate ICE checking that was deferred by prepareAnswerDeferred().
   * Call this after broadcasting the ANS TX and waiting for the caller to start ICE.
   * Adds the caller's candidates to the peer connection, forming candidate pairs
   * and triggering ICE connectivity checks.
   *
   * @param {string} peerId - Caller address
   * @param {Array} callerCandidates - [{candidate, sdpMid, sdpMLineIndex}]
   */
  async activateDeferredChecking(peerId, callerCandidates) {
    for (const c of callerCandidates) {
      try {
        await this.addIceCandidate(peerId, c)
      } catch (e) {
        console.warn('[PeerConnection] Deferred candidate rejected:', e.message)
      }
    }
    console.log('[PeerConnection] Deferred ICE checking activated for:', peerId)
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

  /** @private Convert IPv4 string to well-known NAT64 prefix IPv6 (64:ff9b::/96) */
  _ipv4ToNat64(ipv4) {
    const [a, b, c, d] = ipv4.split('.').map(Number)
    const hi = ((a << 8) | b).toString(16).padStart(4, '0')
    const lo = ((c << 8) | d).toString(16).padStart(4, '0')
    return `64:ff9b::${hi}:${lo}`
  }

  /**
   * Build server-reflexive ICE candidates by pairing a known public IP with
   * the host candidate ports found in a remote SDP.
   *
   * Works without STUN/TURN on full-cone and address-restricted NAT (typical
   * home broadband) because the NAT preserves the internal port in its mapping.
   * The remote peer's public IP comes from the blockchain inscription; the ports
   * come from the 'typ host' candidates in the offer/answer SDP.
   *
   * Supports dual-stack: pass publicIp4 and/or publicIp6. Each host candidate is
   * paired with the matching address-family public IP to produce valid srflx candidates.
   *
   * @param {string} sdp - Remote SDP (offer or answer)
   * @param {string|null} publicIp4 - Remote peer's public IPv4 (or null)
   * @param {string|null} publicIp6 - Remote peer's public IPv6 (or null)
   * @returns {Array<{candidate, sdpMid, sdpMLineIndex}>}
   */
  _buildPublicIpCandidates(sdp, publicIp4, publicIp6, uiLog = null) {
    const log = (msg) => { console.log(msg); if (uiLog) uiLog(msg, 'info') }
    // Legacy single-IP call: detect type and route to correct slot
    if (publicIp4 && !publicIp6 && publicIp4.includes(':')) {
      publicIp6 = publicIp4; publicIp4 = null
    }
    if (!sdp || (!publicIp4 && !publicIp6)) return []

    const candidates = []
    const lines = sdp.split(/\r?\n/)
    let sdpMid = null
    let sdpMLineIndex = -1

    // Log a summary of all candidate lines in the SDP so we can see what the browser gathered
    const allCandLines = lines.filter(l => l.startsWith('a=candidate:'))
    log(`[ICE] Remote SDP: ${allCandLines.length} candidates`)
    for (const cl of allCandLines) {
      const p = cl.slice('a=candidate:'.length).split(' ')
      const ip = p[4] || '?'; const port = p[5] || '?'; const typ = p[7] || '?'
      const label = ip.endsWith('.local') ? 'mDNS' : ip.includes(':') ? 'IPv6' : 'IPv4'
      log(`[ICE]   ${label} ${typ} ${ip}:${port}`)
    }

    for (const line of lines) {
      if (line.startsWith('m=')) {
        sdpMLineIndex++
        sdpMid = null
      } else if (line.startsWith('a=mid:')) {
        sdpMid = line.slice(6).trim()
      } else if (line.startsWith('a=candidate:') && line.includes('typ host')) {
        if (!line.toLowerCase().includes(' udp ')) continue

        // candidate:<foundation> <component> <transport> <priority> <ip> <port> typ host ...
        const parts = line.slice('a=candidate:'.length).split(' ')
        if (parts.length < 6) continue
        const component = parts[1]
        const port = parseInt(parts[5])
        const localIp = parts[4]
        if (isNaN(port) || !localIp) continue

        const isIpv6Host = localIp.includes(':')

        // Pick matching public IP for this host candidate's address family
        const publicIp = isIpv6Host ? publicIp6 : publicIp4
        if (!publicIp) continue // No public IP for this address family

        const mid = sdpMid ?? String(Math.max(0, sdpMLineIndex))
        const mIdx = Math.max(0, sdpMLineIndex)

        // IPv4 gets higher priority than IPv6 — more reliable across mixed networks
        const priority = isIpv6Host ? 1677000000 : 1677729535

        log(`[ICE] srflx (${isIpv6Host ? 'IPv6' : 'IPv4'}): ${localIp}:${port} → ${publicIp}:${port}`)
        candidates.push({
          candidate: `candidate:pub${port} ${component} UDP ${priority} ${publicIp} ${port} typ srflx raddr ${localIp} rport ${port}`,
          sdpMid: mid,
          sdpMLineIndex: mIdx
        })

        // NAT64 synthesis: if remote is IPv4-only, also inject a 64:ff9b::<ipv4> candidate.
        // An IPv6-only local peer (e.g. mobile on LTE) can send to this address via the
        // carrier's NAT64 gateway. The Mac then sees the packet from the NAT64 gateway IPv4,
        // creates a peer-reflexive candidate, and responds back — enabling bidirectional ICE.
        if (!isIpv6Host && publicIp4 && !publicIp6) {
          const nat64Ip = this._ipv4ToNat64(publicIp4)
          log(`[ICE] nat64: ${localIp}:${port} → ${nat64Ip}:${port}`)
          candidates.push({
            candidate: `candidate:nat${port} ${component} UDP 1677000000 ${nat64Ip} ${port} typ srflx raddr ${localIp} rport ${port}`,
            sdpMid: mid,
            sdpMLineIndex: mIdx
          })
        }
      }
    }

    const label = [publicIp4, publicIp6].filter(Boolean).join(' / ')
    log(`[ICE] Built ${candidates.length} candidates for remote ${label}`)
    return candidates
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
      // 1.5-second timeout — host candidates gather in <200ms without STUN
      const timer = setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', onStateChange)
        console.warn('[PeerConnection] ICE gathering timeout for', peerId, '— using partial SDP')
        resolve(pc.localDescription)
      }, 1500)
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
