/**
 * Camera Tester (v06.04)
 *
 * Provides camera testing with:
 * - Real-time video preview
 * - Resolution selection (VHD/HD/SD/LD)
 * - Full-size mode (600px height)
 * - Fullscreen mode (native browser fullscreen)
 *
 * Uses Web API (getUserMedia, Fullscreen API)
 */

class CameraTester {
    constructor(logCallback) {
        // Media stream
        this.mediaStream = null
        this.videoElement = null

        // State
        this.isTestActive = false
        this.currentQuality = 'hd'
        this.isFullSize = false
        this.isFullscreen = false

        // Resolution presets (matching quality presets)
        this.resolutionPresets = {
            vhd: { width: 1920, height: 1080, frameRate: 60 },
            hd:  { width: 1280, height: 720,  frameRate: 30 },
            sd:  { width: 640,  height: 480,  frameRate: 24 },
            ld:  { width: 320,  height: 240,  frameRate: 15 }
        }

        // Fullscreen change listener
        this.fullscreenChangeListener = null

        // Logging function
        this.log = logCallback || console.log

        console.log('[CameraTester] Initialized')
    }

    /**
     * Start camera test
     * @param {string} quality - Quality preset (vhd, hd, sd, ld)
     * @returns {Promise<MediaStream>}
     */
    async startTest(quality = 'hd') {
        try {
            console.log('[CameraTester] Starting test with quality:', quality)

            // Check browser support
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Your browser does not support camera access')
            }

            // Get video element
            this.videoElement = document.getElementById('cameraPreview')
            if (!this.videoElement) {
                throw new Error('Video preview element not found')
            }

            // Get resolution constraints
            const constraints = this.resolutionPresets[quality] || this.resolutionPresets.hd
            this.currentQuality = quality

            // Request camera access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: constraints.width },
                    height: { ideal: constraints.height },
                    frameRate: { ideal: constraints.frameRate }
                },
                audio: false  // No audio for camera test
            })

            console.log('[CameraTester] Got media stream:', {
                videoTracks: this.mediaStream.getVideoTracks().length,
                quality: quality,
                constraints: constraints
            })

            // Attach stream to video element
            this.videoElement.srcObject = this.mediaStream

            // Set state
            this.isTestActive = true
            this.isFullSize = false
            this.isFullscreen = false

            // Enable controls
            this.enableControls()

            // Log success
            this.log(`✓ Camera test started (${quality.toUpperCase()})`, 'success')

            return this.mediaStream
        } catch (error) {
            console.error('[CameraTester] Failed to start test:', error)
            this.handleError(error)
            throw error
        }
    }

    /**
     * Stop camera test and cleanup resources
     */
    stopTest() {
        try {
            console.log('[CameraTester] Stopping test...')

            // Exit fullscreen if active
            if (this.isFullscreen && document.fullscreenElement) {
                document.exitFullscreen().catch(err => {
                    console.warn('[CameraTester] Error exiting fullscreen:', err)
                })
                this.isFullscreen = false
            }

            // Remove fullscreen change listener
            if (this.fullscreenChangeListener) {
                document.removeEventListener('fullscreenchange', this.fullscreenChangeListener)
                this.fullscreenChangeListener = null
            }

            // Stop all video tracks
            if (this.mediaStream) {
                this.mediaStream.getVideoTracks().forEach(track => track.stop())
                this.mediaStream = null
            }

            // Clear video element
            if (this.videoElement) {
                this.videoElement.srcObject = null
            }

            // Reset size to small
            this.isFullSize = false
            this.resetVideoSize()

            // Reset state
            this.isTestActive = false
            this.currentQuality = 'hd'

            // Disable controls
            this.disableControls()

            this.log('Camera test stopped', 'info')
            console.log('[CameraTester] Test stopped and resources cleaned up')
        } catch (error) {
            console.error('[CameraTester] Error stopping test:', error)
        }
    }

    /**
     * Change camera resolution
     * @param {string} quality - Quality preset (vhd, hd, sd, ld)
     */
    async changeResolution(quality) {
        try {
            if (!this.isTestActive) {
                console.warn('[CameraTester] Test not active')
                return
            }

            console.log('[CameraTester] Changing resolution to:', quality)

            // Stop current stream
            if (this.mediaStream) {
                this.mediaStream.getVideoTracks().forEach(track => track.stop())
            }

            // Start new stream with new resolution
            await this.startTest(quality)
            this.log(`Resolution changed to ${quality.toUpperCase()}`, 'info')
        } catch (error) {
            console.error('[CameraTester] Error changing resolution:', error)
            this.log(`Error changing resolution: ${error.message}`, 'error')
        }
    }

    /**
     * Toggle between small (250px) and full-size (600px) view
     */
    toggleSize() {
        try {
            if (!this.isTestActive || !this.videoElement) {
                console.warn('[CameraTester] Test not active')
                return
            }

            const toggleBtn = document.getElementById('toggleSizeBtn')
            if (!toggleBtn) return

            if (this.isFullSize) {
                // Return to small
                this.resetVideoSize()
                this.isFullSize = false
                toggleBtn.textContent = '📐 Full-Size'
                this.log('Switched to small view', 'info')
            } else {
                // Expand to full-size
                this.videoElement.style.height = '600px'
                this.isFullSize = true
                toggleBtn.textContent = '📐 View Small'
                this.log('Switched to full-size view', 'info')
            }

            console.log('[CameraTester] Size toggled, isFullSize:', this.isFullSize)
        } catch (error) {
            console.error('[CameraTester] Error toggling size:', error)
        }
    }

    /**
     * Reset video size to default (250px)
     * @private
     */
    resetVideoSize() {
        if (this.videoElement) {
            this.videoElement.style.height = '250px'
        }
    }

    /**
     * Enter fullscreen mode
     */
    async enterFullscreen() {
        try {
            if (!this.isTestActive || !this.videoElement) {
                console.warn('[CameraTester] Test not active')
                return
            }

            console.log('[CameraTester] Entering fullscreen...')

            // Request fullscreen
            await this.videoElement.requestFullscreen()
            this.isFullscreen = true

            // Listen for fullscreen exit
            this.fullscreenChangeListener = () => {
                if (!document.fullscreenElement) {
                    this.isFullscreen = false
                    this.updateFullscreenButton()
                    console.log('[CameraTester] Exited fullscreen')
                }
            }
            document.addEventListener('fullscreenchange', this.fullscreenChangeListener)

            this.updateFullscreenButton()
            this.log('Entered fullscreen mode (press ESC to exit)', 'info')
        } catch (error) {
            console.error('[CameraTester] Error entering fullscreen:', error)
            this.log(`Fullscreen error: ${error.message}`, 'error')
        }
    }

    /**
     * Exit fullscreen mode
     */
    exitFullscreen() {
        try {
            if (document.fullscreenElement) {
                document.exitFullscreen()
                this.isFullscreen = false
                this.updateFullscreenButton()
                this.log('Exited fullscreen mode', 'info')
                console.log('[CameraTester] Exited fullscreen')
            }
        } catch (error) {
            console.error('[CameraTester] Error exiting fullscreen:', error)
        }
    }

    /**
     * Update fullscreen button state
     * @private
     */
    updateFullscreenButton() {
        const btn = document.getElementById('fullscreenBtn')
        if (btn) {
            btn.textContent = this.isFullscreen ? '↙ Exit Fullscreen' : '⛶ Fullscreen'
        }
    }

    /**
     * Enable UI controls
     * @private
     */
    enableControls() {
        // Start/Stop buttons
        document.getElementById('startCameraTestBtn').style.display = 'none'
        document.getElementById('stopCameraTestBtn').style.display = 'inline-block'

        // Resolution selector
        const resolutionSelect = document.getElementById('cameraResolution')
        if (resolutionSelect) {
            resolutionSelect.disabled = false
            resolutionSelect.value = this.currentQuality
        }

        // Size toggle button
        const toggleBtn = document.getElementById('toggleSizeBtn')
        if (toggleBtn) {
            toggleBtn.disabled = false
            toggleBtn.textContent = '📐 Full-Size'
        }

        // Fullscreen button
        const fullscreenBtn = document.getElementById('fullscreenBtn')
        if (fullscreenBtn) {
            fullscreenBtn.disabled = false
            fullscreenBtn.textContent = '⛶ Fullscreen'
        }
    }

    /**
     * Disable UI controls
     * @private
     */
    disableControls() {
        // Start/Stop buttons
        document.getElementById('startCameraTestBtn').style.display = 'inline-block'
        document.getElementById('stopCameraTestBtn').style.display = 'none'

        // Resolution selector
        const resolutionSelect = document.getElementById('cameraResolution')
        if (resolutionSelect) {
            resolutionSelect.disabled = true
            resolutionSelect.value = 'hd'
        }

        // Size toggle button
        const toggleBtn = document.getElementById('toggleSizeBtn')
        if (toggleBtn) {
            toggleBtn.disabled = true
            toggleBtn.textContent = '📐 Full-Size'
        }

        // Fullscreen button
        const fullscreenBtn = document.getElementById('fullscreenBtn')
        if (fullscreenBtn) {
            fullscreenBtn.disabled = true
            fullscreenBtn.textContent = '⛶ Fullscreen'
        }

        // Reset video size
        this.resetVideoSize()
        this.isFullSize = false
    }

    /**
     * Handle errors with user-friendly messages
     * @private
     */
    handleError(error) {
        let userMessage = error.message

        if (error.name === 'NotAllowedError') {
            userMessage = 'Camera permission denied. Please allow camera access in your browser settings.'
        } else if (error.name === 'NotFoundError') {
            userMessage = 'No camera detected. Please connect a camera and try again.'
        } else if (error.name === 'NotReadableError') {
            userMessage = 'Camera is in use by another application. Close other apps and try again.'
        } else if (error.name === 'SecurityError') {
            userMessage = 'Security error: This site requires HTTPS or secure context to access camera.'
        } else if (error.message && error.message.includes('does not support')) {
            userMessage = error.message
        }

        console.error('[CameraTester]', userMessage)
        this.updateStatus(userMessage, 'error')
    }

    /**
     * Update status display
     * @private
     */
    updateStatus(message, type = 'info') {
        const statusEl = document.getElementById('cameraTestStatus')
        if (statusEl) {
            statusEl.textContent = message
            statusEl.className = 'camera-status ' + type
        }

        console.log('[CameraTester] Status:', type, message)
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.CameraTester = CameraTester
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CameraTester
}
