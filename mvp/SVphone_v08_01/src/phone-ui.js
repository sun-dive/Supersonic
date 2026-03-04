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
    }

    /**
     * Reset call UI to idle state
     */
    resetCallUI() {
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

    /**
     * Log message to debug console
     */
    log(message, type = 'info') {
        const consoleDom = this.displayElements.debugConsole
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
        console.log(`[${type.toUpperCase()}] ${message}`)
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
