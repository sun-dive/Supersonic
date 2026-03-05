/**
 * SVphone Phone UI Layer (v07.00)
 *
 * Handles:
 * - UI rendering and updates
 * - DOM state management
 * - Logging and debugging console
 * - Call status display
 * - Media/stats display
 */

class PhoneUI {
    constructor() {
        // UI element references
        this.addressElements = {
            myAddress: document.getElementById('myAddress'),
            myIp: document.getElementById('myIp'),
            myPort: document.getElementById('myPort'),
            calleeAddress: document.getElementById('calleeAddress'),
        }

        this.buttonElements = {
            initiateCallBtn: document.getElementById('initiateCallBtn'),
            acceptBtn: document.getElementById('acceptBtn'),
            rejectBtn: document.getElementById('rejectBtn'),
            endCallBtn: document.getElementById('endCallBtn'),
            mediaBtn: document.getElementById('mediaBtn'),
            lastCalledBtn: document.getElementById('lastCalledBtn'),
        }

        this.statusElements = {
            callStatus: document.getElementById('callStatus'),
            callStatusText: document.getElementById('callStatusText'),
            statusValue: document.getElementById('statusValue'),
            qualityValue: document.getElementById('qualityValue'),
            durationValue: document.getElementById('durationValue'),
            encryptionValue: document.getElementById('encryptionValue'),
        }

        this.displayElements = {
            incomingCall: document.getElementById('incomingCall'),
            incomingFrom: document.getElementById('incomingFrom'),
            videoContainer: document.getElementById('videoContainer'),
            statsGrid: document.getElementById('statsGrid'),
            debugConsole: document.getElementById('debugConsole'),
        }

        this.mediaElements = {
            localVideo: document.getElementById('localVideo'),
            remoteVideo: document.getElementById('remoteVideo'),
        }

        this.state = {
            isMediaActive: false,
            callStartTime: null,
            durationInterval: null,
        }

        this.console = {
            scrollTop: 0,
        }

        // Pre-unlock Web Audio API on first user gesture so ringtone plays
        // immediately when an incoming call arrives (browsers block audio
        // until the user has interacted with the page).
        this._ringtoneCtx = null
        this._ringtonePlaying = false
        this._ringtoneTimer = null
        const unlock = () => {
            if (!this._ringtoneCtx) this._ringtoneCtx = new AudioContext()
            this._ringtoneCtx.resume()
        }
        document.addEventListener('click', unlock, { once: true })
        document.addEventListener('touchstart', unlock, { once: true })
    }

    /**
     * Update call button status and UI
     */
    updateCallButtonStatus(status) {
        const btn = this.buttonElements.initiateCallBtn
        if (!btn) return

        if (status === 'calling') {
            btn.textContent = '📞 Call Ringing'
            btn.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)'
        } else {
            btn.textContent = '☎️ Make a Call'
            btn.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)'
        }
        btn.disabled = false
    }

    /**
     * Update call status indicator
     */
    updateCallStatus(status, text) {
        const statusEl = this.statusElements.callStatus
        const statusText = this.statusElements.callStatusText
        statusEl.className = `call-status ${status}`
        statusText.textContent = text
        statusEl.style.display = 'block'
        this.statusElements.statusValue.textContent = status.toUpperCase()
    }

    /**
     * Update quality indicator
     */
    updateQuality(quality) {
        this.statusElements.qualityValue.innerHTML =
            `<span class="quality-indicator quality-${quality}">${quality.toUpperCase()}</span>`
    }

    /**
     * Update encryption status
     */
    updateEncryption(status) {
        this.statusElements.encryptionValue.textContent = status
    }

    /**
     * Display call stats grid
     */
    showCallStats() {
        console.debug('[showCallStats] Called')
        const videoContainer = this.displayElements.videoContainer
        const statsGrid = this.displayElements.statsGrid

        if (videoContainer) {
            videoContainer.style.display = 'grid'
        } else {
            console.error('[showCallStats] ERROR: videoContainer not found!')
        }

        if (statsGrid) {
            statsGrid.style.display = 'grid'
        } else {
            console.error('[showCallStats] ERROR: statsGrid not found!')
        }
    }

    /**
     * Update call statistics display
     */
    updateStats(stats) {
        if (stats.video?.outbound) {
            const bitrate = (stats.video.outbound.bytesSent * 8 / 1000).toFixed(0)
            document.getElementById('videoBitrate').textContent = bitrate + ' kbps'
        }
        if (stats.audio?.outbound) {
            const bitrate = (stats.audio.outbound.bytesSent * 8 / 1000).toFixed(0)
            document.getElementById('audioBitrate').textContent = bitrate + ' kbps'
        }
        if (stats.video?.inbound) {
            const loss = ((stats.video.inbound.packetsLost /
                (stats.video.inbound.packetsReceived + stats.video.inbound.packetsLost)) * 100).toFixed(2)
            document.getElementById('packetLoss').textContent = loss + '%'
            document.getElementById('jitter').textContent =
                ((stats.video.inbound.jitter || 0) * 1000).toFixed(0) + ' ms'
        }
    }

    /**
     * Attach local video stream
     */
    attachLocalVideo(stream) {
        if (stream) {
            this.mediaElements.localVideo.srcObject = stream
            this.log('Local video attached', 'success')
        }
    }

    /**
     * Attach remote video stream
     */
    attachRemoteVideo(stream) {
        this.mediaElements.remoteVideo.srcObject = stream
        this.log('Remote video attached', 'success')
    }

    /**
     * Show incoming call UI
     */
    showIncomingCall(caller) {
        console.debug(`[RECV] ✅ INCOMING CALL DETECTED! Caller: ${caller}`)
        this.displayElements.incomingCall.style.display = 'block'
        this.displayElements.incomingFrom.textContent = caller
        this.buttonElements.acceptBtn.style.display = 'inline-block'
        this.buttonElements.rejectBtn.style.display = 'inline-block'
        this.updateCallStatus('ringing', '📞 Incoming call...')
        this.log(`📞 Incoming call from: ${caller}`, 'info')
        // Pre-fill callee field so user can call back after the call ends
        const calleeField = this.addressElements.calleeAddress
        if (calleeField && !calleeField.value) calleeField.value = caller
        this.startRingtone()
    }

    /**
     * Reset call UI to idle state
     */
    resetCallUI() {
        this.stopRingtone()
        this.stopOutgoingRing()
        this.statusElements.callStatus.style.display = 'none'
        this.buttonElements.acceptBtn.style.display = 'none'
        this.buttonElements.rejectBtn.style.display = 'none'
        this.buttonElements.endCallBtn.style.display = 'none'
        this.displayElements.incomingCall.style.display = 'none'
        this.displayElements.videoContainer.style.display = 'none'
        this.displayElements.statsGrid.style.display = 'none'
        this.statusElements.statusValue.textContent = 'Ready'
        this.statusElements.qualityValue.textContent = '-'
        this.statusElements.durationValue.textContent = '0s'
        this.statusElements.encryptionValue.textContent = '-'
        this.updateCallButtonStatus('none')
    }

    /**
     * Start duration timer display
     */
    startDurationTimer() {
        this.state.durationInterval = setInterval(() => {
            if (this.state.callStartTime) {
                const duration = Math.floor((Date.now() - this.state.callStartTime) / 1000)
                const mins = Math.floor(duration / 60)
                const secs = duration % 60
                this.statusElements.durationValue.textContent =
                    `${mins}:${secs.toString().padStart(2, '0')}`
            }
        }, 1000)
    }

    /**
     * Stop duration timer
     */
    stopDurationTimer() {
        if (this.state.durationInterval) {
            clearInterval(this.state.durationInterval)
            this.state.durationInterval = null
        }
    }

    // ── Audio tones ──────────────────────────────────────────────────

    _startRing(key) {
        if (this[`_${key}Playing`]) return
        if (!this._ringtoneCtx) this._ringtoneCtx = new AudioContext()
        this._ringtoneCtx.resume().then(() => {
            this[`_${key}Playing`] = true
            this._ringCycle(key)
        })
    }

    _ringCycle(key) {
        if (!this[`_${key}Playing`]) return
        const ctx = this._ringtoneCtx
        if (key === 'incoming') {
            // US payphone mechanical bell: two strikes per ring cycle
            this._bellStrike(ctx, ctx.currentTime)
            this._bellStrike(ctx, ctx.currentTime + 0.7)
        } else {
            // Outgoing: standard dual-tone 440Hz+480Hz, 2s on
            const gain = ctx.createGain()
            gain.gain.value = 0.25
            gain.connect(ctx.destination)
            const now = ctx.currentTime
            ;[440, 480].forEach(freq => {
                const osc = ctx.createOscillator()
                osc.frequency.value = freq
                osc.connect(gain)
                osc.start(now)
                osc.stop(now + 2)
            })
        }
        this[`_${key}Timer`] = setTimeout(() => this._ringCycle(key), 6000)
    }

    /**
     * Single mechanical bell strike — multiple harmonic partials with a sharp
     * attack and exponential decay. Two slightly detuned fundamentals create
     * the beating/vibrato of a physical bell.
     */
    _bellStrike(ctx, t) {
        // [frequency, relative volume] — fundamental ~550Hz + bell harmonics
        const partials = [
            [550,  0.40],
            [554,  0.30],  // slight detune for physical "beating" effect
            [1100, 0.20],  // 2nd harmonic
            [1654, 0.12],  // 3rd harmonic (slightly inharmonic)
            [2750, 0.06],  // 5th — adds "clang"
        ]
        const master = ctx.createGain()
        master.gain.setValueAtTime(0.7, t)
        master.gain.exponentialRampToValueAtTime(0.001, t + 0.8)
        master.connect(ctx.destination)
        partials.forEach(([freq, vol]) => {
            const osc = ctx.createOscillator()
            const g   = ctx.createGain()
            g.gain.value = vol
            osc.type = 'sine'
            osc.frequency.value = freq
            osc.connect(g)
            g.connect(master)
            osc.start(t)
            osc.stop(t + 0.85)
        })
    }

    _stopRing(key) {
        this[`_${key}Playing`] = false
        if (this[`_${key}Timer`]) { clearTimeout(this[`_${key}Timer`]); this[`_${key}Timer`] = null }
    }

    /** Incoming ring — callee hears this */
    startRingtone()     { this._startRing('incoming') }
    stopRingtone()      { this._stopRing('incoming') }

    /** Outgoing ring tone — caller hears this while waiting for answer */
    startOutgoingRing() { this._startRing('outgoing') }
    stopOutgoingRing()  { this._stopRing('outgoing') }

    /**
     * Classic disconnected / reorder tone: 480Hz + 620Hz, 0.25s on / 0.25s off.
     * Plays for durationMs then calls onDone().
     */
    playDisconnectedTone(durationMs, onDone) {
        if (!this._ringtoneCtx) this._ringtoneCtx = new AudioContext()
        this._ringtoneCtx.resume().then(() => {
            const ctx = this._ringtoneCtx
            const end = ctx.currentTime + durationMs / 1000
            const pulse = (t) => {
                if (t >= end) { if (onDone) onDone(); return }
                const gain = ctx.createGain()
                gain.gain.value = 0.3
                gain.connect(ctx.destination)
                ;[480, 620].forEach(freq => {
                    const osc = ctx.createOscillator()
                    osc.frequency.value = freq
                    osc.connect(gain)
                    osc.start(t)
                    osc.stop(t + 0.25)
                })
                setTimeout(() => pulse(ctx.currentTime + 0.25), (t + 0.5 - ctx.currentTime) * 1000)
            }
            pulse(ctx.currentTime)
        })
    }

    /**
     * Log message to debug console
     */
    log(message, type = 'info') {
        const consoleDom = this.displayElements.debugConsole
        console.log(`[${type.toUpperCase()}] ${message}`)
        if (!consoleDom) return
        const timestamp = new Date().toLocaleTimeString()

        if (message.includes('\n')) {
            const lines = message.split('\n')
            lines.forEach((line, index) => {
                const logLine = document.createElement('div')
                logLine.className = `console-line ${type}`
                if (index === 0) {
                    logLine.textContent = `[${timestamp}] ${line}`
                } else {
                    logLine.textContent = `            ${line}`
                    logLine.style.paddingLeft = '2em'
                }
                consoleDom.appendChild(logLine)
            })
        } else {
            const line = document.createElement('div')
            line.className = `console-line ${type}`
            line.textContent = `[${timestamp}] ${message}`
            consoleDom.appendChild(line)
        }

        consoleDom.scrollTop = consoleDom.scrollHeight
    }

    /**
     * Clear debug console
     */
    clearConsole() {
        this.displayElements.debugConsole.innerHTML = ''
    }

}

// Export for use in phone-controller.js
window.PhoneUI = PhoneUI
