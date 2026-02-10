/**
 * Microphone Tester (v06.04)
 *
 * Provides microphone testing with:
 * - Real-time audio level monitoring (VU meter)
 * - Volume control (0-200% gain)
 * - Mute toggle
 * - Recording and playback (max 10 seconds)
 *
 * Uses Web Audio API for audio processing and MediaRecorder for recording.
 */

class MicrophoneTester {
    constructor(logCallback) {
        // Audio context and nodes
        this.audioContext = null
        this.mediaStream = null
        this.sourceNode = null
        this.gainNode = null
        this.analyserNode = null
        this.destinationNode = null

        // Recording
        this.mediaRecorder = null
        this.recordedChunks = []
        this.recordedBlob = null
        this.recordingTimer = null
        this.recordingStartTime = null
        this.maxRecordingDuration = 10000 // 10 seconds

        // UI state
        this.isTestActive = false
        this.isMuted = false
        this.isRecording = false
        this.currentGain = 1.0 // 100%

        // Canvas animation
        this.meterCanvas = null
        this.meterContext = null
        this.animationFrameId = null

        // Logging function
        this.log = logCallback || console.log

        console.log('[MicrophoneTester] Initialized')
    }

    /**
     * Start microphone test
     * @returns {Promise<MediaStream>}
     */
    async startTest() {
        try {
            console.log('[MicrophoneTester] Starting test...')

            // Check browser support
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Your browser does not support microphone access')
            }

            if (!window.AudioContext && !window.webkitAudioContext) {
                throw new Error('Your browser does not support Web Audio API')
            }

            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            })

            console.log('[MicrophoneTester] Got media stream:', {
                audioTracks: this.mediaStream.getAudioTracks().length
            })

            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext
            this.audioContext = new AudioContext()

            // Build audio graph
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
            this.gainNode = this.audioContext.createGain()
            this.analyserNode = this.audioContext.createAnalyser()
            this.destinationNode = this.audioContext.destination

            // Configure analyser
            this.analyserNode.fftSize = 2048
            this.analyserNode.smoothingTimeConstant = 0.8

            // Connect nodes: source → gain → analyser → destination
            this.sourceNode.connect(this.gainNode)
            this.gainNode.connect(this.analyserNode)
            this.analyserNode.connect(this.destinationNode)

            console.log('[MicrophoneTester] Audio graph connected')

            // Initialize canvas
            this.initializeCanvas()

            // Set state
            this.isTestActive = true
            this.isMuted = false
            this.currentGain = 1.0

            // Start animation loop
            this.startMeterAnimation()

            // Log success
            this.log('✓ Microphone test started - Speak to see audio levels', 'success')

            return this.mediaStream
        } catch (error) {
            console.error('[MicrophoneTester] Failed to start test:', error)
            this.handleError(error)
            throw error
        }
    }

    /**
     * Stop microphone test and cleanup resources
     */
    stopTest() {
        try {
            console.log('[MicrophoneTester] Stopping test...')

            // Stop recording if active
            if (this.isRecording && this.mediaRecorder) {
                this.stopRecording()
            }

            // Stop animation
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId)
                this.animationFrameId = null
            }

            // Stop all media tracks
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop())
                this.mediaStream = null
            }

            // Close audio context
            if (this.audioContext) {
                this.audioContext.close()
                this.audioContext = null
            }

            // Clear nodes
            this.sourceNode = null
            this.gainNode = null
            this.analyserNode = null
            this.destinationNode = null

            // Clear canvas
            if (this.meterContext && this.meterCanvas) {
                this.meterContext.clearRect(0, 0, this.meterCanvas.width, this.meterCanvas.height)
            }

            // Reset state
            this.isTestActive = false
            this.isMuted = false
            this.isRecording = false
            this.currentGain = 1.0

            this.log('Microphone test stopped', 'info')
            console.log('[MicrophoneTester] Test stopped and resources cleaned up')
        } catch (error) {
            console.error('[MicrophoneTester] Error stopping test:', error)
        }
    }

    /**
     * Initialize canvas for VU meter
     * @private
     */
    initializeCanvas() {
        try {
            this.meterCanvas = document.getElementById('micLevelMeter')
            if (!this.meterCanvas) {
                console.warn('[MicrophoneTester] Meter canvas not found')
                return
            }

            this.meterContext = this.meterCanvas.getContext('2d')

            // Set canvas size
            const rect = this.meterCanvas.getBoundingClientRect()
            this.meterCanvas.width = rect.width * window.devicePixelRatio
            this.meterCanvas.height = rect.height * window.devicePixelRatio
            this.meterContext.scale(window.devicePixelRatio, window.devicePixelRatio)

            console.log('[MicrophoneTester] Canvas initialized:', {
                width: this.meterCanvas.width,
                height: this.meterCanvas.height
            })
        } catch (error) {
            console.error('[MicrophoneTester] Error initializing canvas:', error)
        }
    }

    /**
     * Start meter animation loop
     * @private
     */
    startMeterAnimation() {
        const animate = () => {
            if (this.isTestActive) {
                try {
                    this.drawMeter()
                    this.animationFrameId = requestAnimationFrame(animate)
                } catch (error) {
                    console.error('[MicrophoneTester] Animation error:', error)
                }
            }
        }
        animate()
    }

    /**
     * Draw audio level meter on canvas
     * @private
     */
    drawMeter() {
        if (!this.analyserNode || !this.meterContext || !this.meterCanvas) {
            return
        }

        // Get time-domain data
        const dataArray = new Uint8Array(this.analyserNode.fftSize)
        this.analyserNode.getByteTimeDomainData(dataArray)

        // Calculate RMS (root mean square)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
            const normalized = (dataArray[i] - 128) / 128
            sum += normalized * normalized
        }
        const rms = Math.sqrt(sum / dataArray.length)

        // Convert to decibels (-60dB to 0dB range)
        let db = 20 * Math.log10(rms)
        db = Math.max(-60, Math.min(0, db))

        // Normalize level (0 to 1)
        const level = (db + 60) / 60

        // Clear canvas
        const width = this.meterCanvas.width / window.devicePixelRatio
        const height = this.meterCanvas.height / window.devicePixelRatio
        this.meterContext.fillStyle = 'rgba(0, 0, 0, 0.3)'
        this.meterContext.fillRect(0, 0, width, height)

        // Draw gradient bar
        const gradient = this.meterContext.createLinearGradient(0, 0, width, 0)

        // Color gradient: green → yellow → red
        gradient.addColorStop(0, '#38ef7d')     // Green
        gradient.addColorStop(0.5, '#ffa500')   // Orange
        gradient.addColorStop(1.0, '#ff6b6b')   // Red

        this.meterContext.fillStyle = gradient
        this.meterContext.fillRect(0, 0, width * level, height)

        // Draw border
        this.meterContext.strokeStyle = 'rgba(255, 255, 255, 0.2)'
        this.meterContext.lineWidth = 1
        this.meterContext.strokeRect(0, 0, width, height)

        // Update dB indicator
        const levelIndicator = document.getElementById('levelIndicator')
        if (levelIndicator) {
            levelIndicator.textContent = db.toFixed(0) + ' dB'
        }
    }

    /**
     * Set volume gain (0-200%)
     * @param {number} value - Volume percentage (0-200)
     */
    setVolume(value) {
        if (!this.gainNode) {
            console.warn('[MicrophoneTester] Gain node not initialized')
            return
        }

        const gainValue = value / 100
        this.currentGain = gainValue
        this.gainNode.gain.value = this.isMuted ? 0 : gainValue

        console.log('[MicrophoneTester] Volume set to:', value + '%')
    }

    /**
     * Toggle mute state
     * @param {boolean} isMuted - Mute state
     */
    setMute(isMuted) {
        if (!this.gainNode) {
            console.warn('[MicrophoneTester] Gain node not initialized')
            return
        }

        this.isMuted = isMuted

        if (isMuted) {
            this.gainNode.gain.value = 0
            console.log('[MicrophoneTester] Microphone muted')
        } else {
            this.gainNode.gain.value = this.currentGain
            console.log('[MicrophoneTester] Microphone unmuted')
        }
    }

    /**
     * Start recording audio
     * @returns {Promise<void>}
     */
    async startRecording() {
        try {
            if (!this.mediaStream) {
                throw new Error('No media stream available')
            }

            console.log('[MicrophoneTester] Starting recording...')

            // Check MediaRecorder support
            const mimeType = this.getSupportedMimeType()
            if (!mimeType) {
                throw new Error('MediaRecorder not supported in this browser')
            }

            // Clear previous recording
            this.recordedChunks = []
            this.recordedBlob = null

            // Create MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType })

            // Handle data available
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data)
                    console.log('[MicrophoneTester] Recorded chunk:', event.data.size, 'bytes')
                }
            }

            // Handle recording stop
            this.mediaRecorder.onstop = () => {
                this.recordedBlob = new Blob(this.recordedChunks, { type: mimeType })
                console.log('[MicrophoneTester] Recording stopped:', this.recordedBlob.size, 'bytes')
                this.enablePlayback()
            }

            // Start recording
            this.mediaRecorder.start()
            this.isRecording = true
            this.recordingStartTime = Date.now()

            // Update UI
            this.updateRecordingUI()

            // Start timer
            this.startRecordingTimer()

            this.log('Recording started (10s max)...', 'info')
        } catch (error) {
            console.error('[MicrophoneTester] Recording error:', error)
            this.log(`Recording error: ${error.message}`, 'error')
            throw error
        }
    }

    /**
     * Stop recording
     */
    stopRecording() {
        try {
            if (!this.mediaRecorder || !this.isRecording) {
                console.warn('[MicrophoneTester] Recording not active')
                return
            }

            console.log('[MicrophoneTester] Stopping recording...')

            // Stop recording
            this.mediaRecorder.stop()
            this.isRecording = false

            // Clear timer
            if (this.recordingTimer) {
                clearInterval(this.recordingTimer)
                this.recordingTimer = null
            }

            // Update UI
            this.updateRecordingUI()

            this.log('✓ Recording stopped', 'success')
        } catch (error) {
            console.error('[MicrophoneTester] Error stopping recording:', error)
        }
    }

    /**
     * Play recorded audio
     */
    playRecording() {
        try {
            if (!this.recordedBlob) {
                console.warn('[MicrophoneTester] No recording available')
                this.log('No recording to play', 'warning')
                return
            }

            console.log('[MicrophoneTester] Playing recording...')

            // Create audio element
            const audioUrl = URL.createObjectURL(this.recordedBlob)
            const audio = new Audio()
            audio.src = audioUrl

            // Clean up URL when done
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl)
                this.log('Playback finished', 'info')
            }

            // Handle errors
            audio.onerror = (error) => {
                console.error('[MicrophoneTester] Playback error:', error)
                this.log('Playback error: ' + error, 'error')
                URL.revokeObjectURL(audioUrl)
            }

            // Play
            audio.play().catch(error => {
                console.error('[MicrophoneTester] Failed to play audio:', error)
                this.log('Failed to play audio: ' + error.message, 'error')
            })

            this.log('Playing recording...', 'info')
        } catch (error) {
            console.error('[MicrophoneTester] Playback error:', error)
            this.log(`Playback error: ${error.message}`, 'error')
        }
    }

    /**
     * Start recording timer (10 second max)
     * @private
     */
    startRecordingTimer() {
        let elapsed = 0
        const maxDuration = 10

        this.recordingTimer = setInterval(() => {
            elapsed++
            this.updateTimerDisplay(elapsed, maxDuration)

            if (elapsed >= maxDuration) {
                console.log('[MicrophoneTester] Recording time limit reached')
                this.stopRecording()
            }
        }, 1000)
    }

    /**
     * Update timer display
     * @private
     */
    updateTimerDisplay(elapsed, max) {
        const timerEl = document.getElementById('recordingTime')
        if (timerEl) {
            const minutes = Math.floor(elapsed / 60)
            const seconds = elapsed % 60
            timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')} / 0:${max.toString().padStart(2, '0')}`
        }
    }

    /**
     * Update recording UI state
     * @private
     */
    updateRecordingUI() {
        const recordBtn = document.getElementById('startRecordBtn')
        const stopBtn = document.getElementById('stopRecordBtn')

        if (this.isRecording) {
            if (recordBtn) recordBtn.disabled = true
            if (stopBtn) stopBtn.disabled = false
        } else {
            if (recordBtn) recordBtn.disabled = false
            if (stopBtn) stopBtn.disabled = true
        }
    }

    /**
     * Enable playback button
     * @private
     */
    enablePlayback() {
        const playBtn = document.getElementById('playRecordBtn')
        if (playBtn) {
            playBtn.disabled = false
        }
    }

    /**
     * Get supported MIME type for MediaRecorder
     * @private
     * @returns {string}
     */
    getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/ogg',
            'audio/mp4'
        ]

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log('[MicrophoneTester] Using MIME type:', type)
                return type
            }
        }

        // Return empty to let browser decide
        console.warn('[MicrophoneTester] No preferred MIME type supported')
        return ''
    }

    /**
     * Handle errors with user-friendly messages
     * @private
     */
    handleError(error) {
        let userMessage = error.message

        if (error.name === 'NotAllowedError') {
            userMessage = 'Microphone permission denied. Please allow microphone access in your browser settings.'
        } else if (error.name === 'NotFoundError') {
            userMessage = 'No microphone detected. Please connect a microphone and try again.'
        } else if (error.name === 'NotReadableError') {
            userMessage = 'Microphone is in use by another application. Close other apps and try again.'
        } else if (error.name === 'SecurityError') {
            userMessage = 'Security error: This site requires HTTPS or secure context to access microphone.'
        } else if (error.message && error.message.includes('does not support')) {
            userMessage = error.message
        }

        console.error('[MicrophoneTester]', userMessage)
        this.updateStatus(userMessage, 'error')
    }

    /**
     * Update status display
     * @private
     */
    updateStatus(message, type = 'info') {
        const statusEl = document.getElementById('micTestStatus')
        if (statusEl) {
            statusEl.textContent = message
            statusEl.className = 'mic-status ' + type
        }

        console.log('[MicrophoneTester] Status:', type, message)
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.MicrophoneTester = MicrophoneTester
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MicrophoneTester
}
