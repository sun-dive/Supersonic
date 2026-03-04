/**
 * Codec Negotiation Module (v06.01)
 *
 * Handles audio and video codec selection, SDP negotiation, and quality preferences.
 * Supports Opus for audio and VP9/H.264 for video with adaptive bitrate.
 */

class CodecNegotiation {
  constructor(options = {}) {
    this.listeners = new Map()

    // Supported codecs in priority order
    this.audioCodecs = [
      {
        name: 'opus',
        mimeType: 'audio/opus',
        channels: 2,
        clockRate: 48000,
        bitrate: { min: 6000, max: 510000, preferred: 64000 }, // bps
        latency: 26.5, // ms
        jitterBuffer: true,
        dtx: true, // Discontinuous Transmission
        fec: true // Forward Error Correction
      }
    ]

    this.videoCodecs = [
      {
        name: 'vp9',
        mimeType: 'video/VP9',
        profile: 0,
        bitrate: { min: 100000, max: 5000000, preferred: 1000000 }, // bps
        framerate: { min: 5, max: 60, preferred: 30 },
        scalability: 'temporal', // L0T2, L0T3, etc.
        adaptiveQuality: true,
        dynamicPayloadType: true,
        ssrc: null
      },
      {
        name: 'h264',
        mimeType: 'video/H264',
        profile: 'baseline',
        level: '3.1',
        bitrate: { min: 100000, max: 5000000, preferred: 1000000 }, // bps
        framerate: { min: 5, max: 60, preferred: 30 },
        adaptiveQuality: true,
        dynamicPayloadType: true,
        ssrc: null
      }
    ]

    // Quality presets
    this.qualityPresets = {
      vhd: { // Very High Definition
        audio: { bitrate: 128000, channels: 2 },
        video: { bitrate: 5000000, framerate: 60, resolution: '1920x1080' }
      },
      hd: { // High Definition
        audio: { bitrate: 64000, channels: 2 },
        video: { bitrate: 2500000, framerate: 30, resolution: '1280x720' }
      },
      sd: { // Standard Definition
        audio: { bitrate: 48000, channels: 1 },
        video: { bitrate: 500000, framerate: 24, resolution: '640x480' }
      },
      ld: { // Low Definition (low bandwidth)
        audio: { bitrate: 24000, channels: 1 },
        video: { bitrate: 100000, framerate: 15, resolution: '320x240' }
      }
    }

    // Configuration
    this.preferredAudioCodec = options.preferredAudioCodec || 'opus'
    this.preferredVideoCodec = options.preferredVideoCodec || 'vp9'
    this.preferredQuality = options.preferredQuality || 'hd'
    this.maxBitrate = options.maxBitrate || 5000000 // 5 Mbps default
  }

  /**
   * Get SDP offer with codec preferences
   *
   * @param {RTCPeerConnection} peerConnection
   * @param {Object} options - Negotiation options
   * @returns {Promise<RTCSessionDescription>}
   */
  async createOfferWithCodecs(peerConnection, options = {}) {
    try {
      // Set transceivers with codec preferences BEFORE creating offer
      this.applyCodecPreferences(peerConnection, options)

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      })

      // Parse and modify SDP if needed
      const modifiedSdp = this.modifySdpForCodecs(offer.sdp, options)

      const modifiedOffer = new RTCSessionDescription({
        type: 'offer',
        sdp: modifiedSdp
      })

      return modifiedOffer
    } catch (error) {
      console.error('[CodecNegotiation] Failed to create offer with codecs:', error)
      throw error
    }
  }

  /**
   * Get SDP answer with codec preferences
   *
   * @param {RTCPeerConnection} peerConnection
   * @param {Object} options - Negotiation options
   * @returns {Promise<RTCSessionDescription>}
   */
  async createAnswerWithCodecs(peerConnection, options = {}) {
    try {
      // Set transceivers with codec preferences BEFORE creating answer
      this.applyCodecPreferences(peerConnection, options)

      const answer = await peerConnection.createAnswer()

      // Parse and modify SDP if needed
      const modifiedSdp = this.modifySdpForCodecs(answer.sdp, options)

      const modifiedAnswer = new RTCSessionDescription({
        type: 'answer',
        sdp: modifiedSdp
      })

      return modifiedAnswer
    } catch (error) {
      console.error('[CodecNegotiation] Failed to create answer with codecs:', error)
      throw error
    }
  }

  /**
   * Apply codec preferences to peer connection
   * @private
   */
  applyCodecPreferences(peerConnection, options = {}) {
    try {
      // Get transceivers
      const transceivers = peerConnection.getTransceivers()

      for (const transceiver of transceivers) {
        if (transceiver.receiver.track.kind === 'audio') {
          const audioCodecs = RTCRtpReceiver.getCapabilities('audio').codecs
          const preferredCodecs = this.filterCodecsByPreference(audioCodecs, 'audio', options)
          transceiver.setCodecPreferences(preferredCodecs)
        } else if (transceiver.receiver.track.kind === 'video') {
          const videoCodecs = RTCRtpReceiver.getCapabilities('video').codecs
          const preferredCodecs = this.filterCodecsByPreference(videoCodecs, 'video', options)
          transceiver.setCodecPreferences(preferredCodecs)
        }
      }

      console.log('[CodecNegotiation] Applied codec preferences')
    } catch (error) {
      console.warn('[CodecNegotiation] Failed to apply codec preferences:', error)
    }
  }

  /**
   * Filter and prioritize codecs based on preferences
   * @private
   */
  filterCodecsByPreference(availableCodecs, kind, options = {}) {
    const preferred = kind === 'audio'
      ? options.audioCodec || this.preferredAudioCodec
      : options.videoCodec || this.preferredVideoCodec

    // Filter for preferred codec
    const preferredCodecs = availableCodecs.filter(codec => {
      const mime = codec.mimeType.toLowerCase()
      return mime.includes(preferred.toLowerCase())
    })

    // Sort by preference, putting preferred codec first
    const sorted = availableCodecs.sort((a, b) => {
      const aIsPreferred = preferredCodecs.find(c => c.mimeType === a.mimeType) ? 0 : 1
      const bIsPreferred = preferredCodecs.find(c => c.mimeType === b.mimeType) ? 0 : 1
      return aIsPreferred - bIsPreferred
    })

    return sorted
  }

  /**
   * Modify SDP for codec bitrate constraints
   * @private
   */
  modifySdpForCodecs(sdp, options = {}) {
    const quality = options.quality || this.preferredQuality
    const preset = this.qualityPresets[quality]

    if (!preset) {
      console.warn('[CodecNegotiation] Unknown quality preset:', quality)
      return sdp
    }

    let modifiedSdp = sdp

    // Add bitrate constraints to SDP
    // GOOG REMB (RTCP feedback) for congestion control
    if (preset.audio?.bitrate) {
      modifiedSdp = this.setSdpBitrate(modifiedSdp, 'audio', preset.audio.bitrate)
    }

    if (preset.video?.bitrate) {
      modifiedSdp = this.setSdpBitrate(modifiedSdp, 'video', preset.video.bitrate)
    }

    return modifiedSdp
  }

  /**
   * Set bitrate in SDP
   * @private
   */
  setSdpBitrate(sdp, kind, bitrate) {
    const lines = sdp.split('\n')
    let result = []
    let mediaSection = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      result.push(line)

      // Detect media section
      if (line.startsWith('m=')) {
        mediaSection = line.substring(2).split(' ')[0]
      }

      // Add bitrate constraint after media line or codec line
      if (mediaSection === kind && (line.startsWith('m=') || line.startsWith('a=rtpmap:'))) {
        // Add b=TIAS (Transport Independent Application Specific) bandwidth modifier
        if (i + 1 < lines.length && !lines[i + 1].startsWith('b=')) {
          result.push(`b=TIAS:${bitrate}`)
        }
        mediaSection = null // Reset after adding
      }
    }

    return result.join('\n')
  }

  /**
   * Analyze remote SDP and extract codec information
   */
  analyzeRemoteSdp(sdp) {
    const analysis = {
      audioCodec: null,
      videoCodec: null,
      audioBitrate: null,
      videoBitrate: null,
      audioChannels: null,
      videoFramerate: null,
      videoResolution: null
    }

    const lines = sdp.split('\n')
    let currentMedia = null

    for (const line of lines) {
      // Detect media sections
      if (line.startsWith('m=audio')) {
        currentMedia = 'audio'
      } else if (line.startsWith('m=video')) {
        currentMedia = 'video'
      }

      // Extract codec from rtpmap
      if (line.startsWith('a=rtpmap:')) {
        const match = line.match(/a=rtpmap:(\d+)\s+([^/]+)/)
        if (match) {
          const codec = match[2].split('/')[0].toLowerCase()
          if (currentMedia === 'audio' && codec.includes('opus')) {
            analysis.audioCodec = 'opus'
          } else if (currentMedia === 'video') {
            if (codec.includes('vp9')) analysis.videoCodec = 'vp9'
            else if (codec.includes('h264')) analysis.videoCodec = 'h264'
          }
        }
      }

      // Extract bitrate
      if (line.startsWith('b=TIAS:')) {
        const bitrate = parseInt(line.split(':')[1])
        if (currentMedia === 'audio') analysis.audioBitrate = bitrate
        if (currentMedia === 'video') analysis.videoBitrate = bitrate
      }

      // Extract fmtp parameters (audio channels, video resolution, etc.)
      if (line.startsWith('a=fmtp:')) {
        const params = line.split(' ')
        for (const param of params) {
          if (param.includes('useinbandfec')) analysis.audioFEC = true
          if (param.includes('stereo=1')) analysis.audioChannels = 2
        }
      }
    }

    return analysis
  }

  /**
   * Get codec capabilities
   */
  getCodecCapabilities() {
    return {
      audioCodecs: this.audioCodecs,
      videoCodecs: this.videoCodecs,
      qualityPresets: Object.keys(this.qualityPresets),
      preferredAudio: this.preferredAudioCodec,
      preferredVideo: this.preferredVideoCodec,
      preferredQuality: this.preferredQuality
    }
  }

  /**
   * Recommend quality based on available bandwidth
   *
   * @param {number} availableBitrate - Available bandwidth in bps
   * @returns {string} Recommended quality preset
   */
  recommendQuality(availableBitrate) {
    // Very rough estimation based on bandwidth
    if (availableBitrate >= 5000000) return 'vhd'
    if (availableBitrate >= 2500000) return 'hd'
    if (availableBitrate >= 500000) return 'sd'
    return 'ld'
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
          console.error(`[CodecNegotiation] Error in ${eventName} handler:`, error)
        }
      })
    }
  }
}

// Export for browser
if (typeof window !== 'undefined') {
  window.CodecNegotiation = CodecNegotiation
}

// Export for Node.js/modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CodecNegotiation
}
