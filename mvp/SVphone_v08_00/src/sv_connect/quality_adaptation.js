/**
 * Quality Adaptation Module (v06.01)
 *
 * Dynamically adjusts audio/video quality based on network conditions.
 * Monitors bandwidth, jitter, packet loss, and adjusts bitrate/framerate accordingly.
 */

class QualityAdaptation {
  constructor(options = {}) {
    this.listeners = new Map()

    // Configuration
    this.statsInterval = options.statsInterval || 1000 // Collect stats every 1s
    this.qualityChangeThreshold = options.qualityChangeThreshold || 0.15 // 15% change triggers adjustment
    this.maxBitrate = options.maxBitrate || 5000000 // 5 Mbps
    this.minBitrate = options.minBitrate || 100000 // 100 kbps

    // Current state
    this.currentQuality = options.initialQuality || 'hd'
    this.videoSettings = {
      bitrate: 2500000, // 2.5 Mbps for HD
      framerate: 30,
      width: 1280,
      height: 720
    }
    this.audioSettings = {
      bitrate: 64000, // 64 kbps for stereo
      channels: 2
    }

    // Statistics tracking
    this.stats = {
      bandwidth: { available: 0, used: 0 },
      packet: { loss: 0, lateArrival: 0, jitter: 0 },
      latency: { rtt: 0, delay: 0 },
      video: { bitrate: 0, framerate: 0 },
      audio: { bitrate: 0 }
    }

    // History for trend analysis
    this.history = {
      bandwidth: [],
      packetLoss: [],
      jitter: []
    }
    this.maxHistorySize = 10

    // State
    this.isMonitoring = false
    this.monitorHandle = null
    this.lastQualityChange = Date.now()
    this.qualityChangeDebounce = 5000 // 5s between quality changes
  }

  /**
   * Start monitoring network quality
   *
   * @param {PeerConnection} peerConnection - PeerConnection instance
   * @param {string} callTokenId - Current call token ID
   */
  startMonitoring(peerConnection, peerId) {
    if (this.isMonitoring) {
      console.warn('[QualityAdaptation] Already monitoring quality')
      return
    }

    this.isMonitoring = true
    this.peerConnection = peerConnection
    this.peerId = peerId

    console.log('[QualityAdaptation] Started monitoring network quality')

    const collectStats = async () => {
      try {
        await this.collectAndAnalyzeStats()

        // Check if quality adjustment is needed
        const recommendation = this.analyzeAndRecommend()
        if (recommendation.shouldAdjust) {
          await this.adjustQuality(recommendation)
        }
      } catch (error) {
        console.error('[QualityAdaptation] Error during monitoring:', error)
      }

      if (this.isMonitoring) {
        this.monitorHandle = setTimeout(collectStats, this.statsInterval)
      }
    }

    this.monitorHandle = setTimeout(collectStats, this.statsInterval)
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitorHandle) {
      clearTimeout(this.monitorHandle)
      this.monitorHandle = null
    }
    this.isMonitoring = false
    console.log('[QualityAdaptation] Stopped monitoring network quality')
  }

  /**
   * Collect RTC statistics and calculate network metrics
   * @private
   */
  async collectAndAnalyzeStats() {
    try {
      const pc = this.peerConnection.getPeerConnection(this.peerId)
      if (!pc) return

      const stats = await pc.getStats()
      let audioInbound = null
      let videoInbound = null
      let candidatePair = null

      stats.forEach(report => {
        if (report.type === 'inbound-rtp') {
          if (report.kind === 'audio') audioInbound = report
          else if (report.kind === 'video') videoInbound = report
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          candidatePair = report
        }
      })

      // Calculate bandwidth
      if (videoInbound) {
        const bytesReceived = videoInbound.bytesReceived || 0
        const timeElapsed = (videoInbound.timestamp - (this.lastStatsTimestamp || videoInbound.timestamp)) / 1000
        if (timeElapsed > 0) {
          this.stats.video.bitrate = (bytesReceived * 8) / timeElapsed
        }
        this.lastStatsTimestamp = videoInbound.timestamp

        // Packet loss and jitter
        this.stats.packet.loss = videoInbound.packetsLost || 0
        this.stats.packet.jitter = videoInbound.jitter || 0
        const totalPackets = (videoInbound.packetsReceived || 0) + this.stats.packet.loss
        this.stats.packet.lossPercentage = totalPackets > 0 ? (this.stats.packet.loss / totalPackets) * 100 : 0
      }

      if (audioInbound) {
        const bytesReceived = audioInbound.bytesReceived || 0
        const timeElapsed = (audioInbound.timestamp - (this.lastAudioTimestamp || audioInbound.timestamp)) / 1000
        if (timeElapsed > 0) {
          this.stats.audio.bitrate = (bytesReceived * 8) / timeElapsed
        }
        this.lastAudioTimestamp = audioInbound.timestamp
      }

      if (candidatePair) {
        this.stats.latency.rtt = candidatePair.currentRoundTripTime || 0
        this.stats.bandwidth.available = candidatePair.availableOutgoingBitrate || 0
      }

      // Keep history for trend analysis
      this.updateHistory()
    } catch (error) {
      console.warn('[QualityAdaptation] Failed to collect stats:', error)
    }
  }

  /**
   * Update history for trend analysis
   * @private
   */
  updateHistory() {
    this.history.bandwidth.push(this.stats.bandwidth.available)
    this.history.packetLoss.push(this.stats.packet.lossPercentage)
    this.history.jitter.push(this.stats.packet.jitter)

    // Keep only recent history
    if (this.history.bandwidth.length > this.maxHistorySize) {
      this.history.bandwidth.shift()
      this.history.packetLoss.shift()
      this.history.jitter.shift()
    }
  }

  /**
   * Analyze network conditions and recommend quality adjustments
   * @private
   */
  analyzeAndRecommend() {
    const recommendation = {
      shouldAdjust: false,
      quality: this.currentQuality,
      reason: null,
      metrics: {}
    }

    // Time-based debounce: don't change quality too frequently
    if (Date.now() - this.lastQualityChange < this.qualityChangeDebounce) {
      return recommendation
    }

    // Analyze trends
    const avgBandwidth = this.getAverageHistory(this.history.bandwidth)
    const avgPacketLoss = this.getAverageHistory(this.history.packetLoss)
    const avgJitter = this.getAverageHistory(this.history.jitter)

    recommendation.metrics = {
      avgBandwidth,
      avgPacketLoss,
      avgJitter,
      currentQuality: this.currentQuality
    }

    // Decision logic: adjust if conditions are significantly different from current quality needs
    const qualityBitrate = this.getQualityBitrate(this.currentQuality)
    const bandwidthMargin = 1.5 // Require 50% more bandwidth than needed

    // Network is congested
    if (avgPacketLoss > 5 || avgJitter > 100) {
      const downgrade = this.getDowngradedQuality()
      if (downgrade !== this.currentQuality) {
        recommendation.shouldAdjust = true
        recommendation.quality = downgrade
        recommendation.reason = `High packet loss (${avgPacketLoss.toFixed(1)}%) or jitter (${avgJitter.toFixed(0)}ms)`
        return recommendation
      }
    }

    // Insufficient bandwidth
    if (avgBandwidth < qualityBitrate * 0.8) {
      const downgrade = this.getDowngradedQuality()
      if (downgrade !== this.currentQuality) {
        recommendation.shouldAdjust = true
        recommendation.quality = downgrade
        recommendation.reason = `Insufficient bandwidth: ${(avgBandwidth / 1000000).toFixed(2)} Mbps < ${(qualityBitrate / 1000000).toFixed(2)} Mbps`
        return recommendation
      }
    }

    // Network conditions improved
    if (avgBandwidth > qualityBitrate * bandwidthMargin && avgPacketLoss < 1) {
      const upgrade = this.getUpgradedQuality()
      if (upgrade !== this.currentQuality) {
        recommendation.shouldAdjust = true
        recommendation.quality = upgrade
        recommendation.reason = `Good conditions: ${(avgBandwidth / 1000000).toFixed(2)} Mbps available`
        return recommendation
      }
    }

    return recommendation
  }

  /**
   * Adjust quality settings based on recommendation
   * @private
   */
  async adjustQuality(recommendation) {
    try {
      const oldQuality = this.currentQuality
      this.currentQuality = recommendation.quality

      const qualitySettings = this.getQualitySettings(recommendation.quality)

      this.videoSettings = {
        bitrate: qualitySettings.video.bitrate,
        framerate: qualitySettings.video.framerate,
        width: qualitySettings.video.width,
        height: qualitySettings.video.height
      }

      this.audioSettings = {
        bitrate: qualitySettings.audio.bitrate,
        channels: qualitySettings.audio.channels
      }

      this.lastQualityChange = Date.now()

      this.emit('quality:changed', {
        oldQuality,
        newQuality: recommendation.quality,
        reason: recommendation.reason,
        videoSettings: this.videoSettings,
        audioSettings: this.audioSettings,
        metrics: recommendation.metrics
      })

      console.log('[QualityAdaptation] Adjusted quality:', {
        from: oldQuality,
        to: recommendation.quality,
        reason: recommendation.reason
      })
    } catch (error) {
      console.error('[QualityAdaptation] Failed to adjust quality:', error)
    }
  }

  /**
   * Get bitrate for quality level
   * @private
   */
  getQualityBitrate(quality) {
    const presets = {
      vhd: 5000000,
      hd: 2500000,
      sd: 500000,
      ld: 100000
    }
    return presets[quality] || presets.hd
  }

  /**
   * Get settings for quality level
   * @private
   */
  getQualitySettings(quality) {
    const settings = {
      vhd: {
        video: { bitrate: 5000000, framerate: 60, width: 1920, height: 1080 },
        audio: { bitrate: 128000, channels: 2 }
      },
      hd: {
        video: { bitrate: 2500000, framerate: 30, width: 1280, height: 720 },
        audio: { bitrate: 64000, channels: 2 }
      },
      sd: {
        video: { bitrate: 500000, framerate: 24, width: 640, height: 480 },
        audio: { bitrate: 48000, channels: 1 }
      },
      ld: {
        video: { bitrate: 100000, framerate: 15, width: 320, height: 240 },
        audio: { bitrate: 24000, channels: 1 }
      }
    }
    return settings[quality] || settings.hd
  }

  /**
   * Get downgraded quality
   * @private
   */
  getDowngradedQuality() {
    const levels = ['vhd', 'hd', 'sd', 'ld']
    const currentIndex = levels.indexOf(this.currentQuality)
    if (currentIndex < levels.length - 1) {
      return levels[currentIndex + 1]
    }
    return this.currentQuality // Already at lowest
  }

  /**
   * Get upgraded quality
   * @private
   */
  getUpgradedQuality() {
    const levels = ['vhd', 'hd', 'sd', 'ld']
    const currentIndex = levels.indexOf(this.currentQuality)
    if (currentIndex > 0) {
      return levels[currentIndex - 1]
    }
    return this.currentQuality // Already at highest
  }

  /**
   * Calculate average from history
   * @private
   */
  getAverageHistory(history) {
    if (history.length === 0) return 0
    const sum = history.reduce((a, b) => a + b, 0)
    return sum / history.length
  }

  /**
   * Get current quality settings
   */
  getCurrentSettings() {
    return {
      quality: this.currentQuality,
      video: this.videoSettings,
      audio: this.audioSettings,
      stats: this.stats
    }
  }

  /**
   * Force quality to specific level
   */
  forceQuality(quality) {
    const valid = ['vhd', 'hd', 'sd', 'ld']
    if (!valid.includes(quality)) {
      throw new Error(`Invalid quality: ${quality}`)
    }

    const oldQuality = this.currentQuality
    const qualitySettings = this.getQualitySettings(quality)

    this.currentQuality = quality
    this.videoSettings = qualitySettings.video
    this.audioSettings = qualitySettings.audio
    this.lastQualityChange = Date.now()

    this.emit('quality:forced', {
      oldQuality,
      newQuality: quality,
      videoSettings: this.videoSettings,
      audioSettings: this.audioSettings
    })

    console.log('[QualityAdaptation] Forced quality:', quality)
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
          console.error(`[QualityAdaptation] Error in ${eventName} handler:`, error)
        }
      })
    }
  }
}

// Export for browser
if (typeof window !== 'undefined') {
  window.QualityAdaptation = QualityAdaptation
}

// Export for Node.js/modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QualityAdaptation
}
