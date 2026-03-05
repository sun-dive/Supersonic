/**
 * SVphone Phone Handlers Layer (v07.00)
 * Handles call events, media tests, and user interactions
 */

class CallHandlers {
    constructor(app, ui) {
        this.app = app
        this.ui = ui
    }

    /**
     * Initialize and make a call
     */
    async initializeCall() {
        try {
            const walletAddress = document.getElementById('myAddress')?.value
            if (!walletAddress || walletAddress === '...' || walletAddress === '') {
                this.ui.log('Error: Wallet address not loaded', 'error')
                return
            }

            const ip = document.getElementById('myIp').value
            const port = parseInt(document.getElementById('myPort').value)
            await this.app.signaling.initialize(walletAddress, ip, port)
            this.ui.log(`Initialized as ${walletAddress}`, 'success')

            const calleeAddress = document.getElementById('calleeAddress').value
            if (!calleeAddress) {
                this.ui.log('Error: Enter recipient address', 'error')
                return
            }

            if (!this.app.callTokenManager) {
                this.ui.log('Error: CallTokenManager not initialized', 'error')
                return
            }

            this.app.saveLastCalled(calleeAddress)
            const quality = document.getElementById('quality').value

            const mintTokenFn = async (token) =>
                this.app.callTokenManager.createAndBroadcastCallToken(token)

            this.ui.updateCallButtonStatus('calling')
            this.ui.log(`📞 Calling ${calleeAddress}...`, 'info')

            const session = await this.app.callManager.initiateCall(calleeAddress, {
                audio: true,
                video: true,
                quality,
                mintTokenFn
            })

            this.app.currentCallToken = session.callTokenId
            this.ui.log('✓ Call initiated successfully', 'success')

            // Start outgoing ring and 3-minute unanswered timeout
            this.ui.startOutgoingRing()
            this.app._unansweredTimeout = setTimeout(() => {
                this.ui.stopOutgoingRing()
                this.ui.log('⏱ No answer — call timed out', 'warning')
                this.ui.updateCallStatus('ended', 'No answer')
                this.ui.playDisconnectedTone(30000, () => this.endCall())
            }, 3 * 60 * 1000)

        } catch (error) {
            const errorMsg = error.message || error.toString()
            if (errorMsg.includes('Permission denied') || errorMsg.includes('Permission')) {
                this.ui.log(`⚠️  ${errorMsg}`, 'error')
            } else if (errorMsg.includes('Requested device not found')) {
                this.ui.log('⚠️  No microphone or camera found. Attempting audio-only call...', 'warning')
                try {
                    const calleeAddress = document.getElementById('calleeAddress').value
                    const quality = document.getElementById('quality').value
                    const session = await this.app.callManager.initiateCall(calleeAddress, {
                        audio: true,
                        video: false,
                        quality,
                        mintTokenFn: async (token) =>
                            this.app.callTokenManager.createAndBroadcastCallToken(token)
                    })
                    this.app.currentCallToken = session.callTokenId
                    this.ui.log('✓ Audio-only call initiated', 'success')
                    this.ui.startOutgoingRing()
                    this.app._unansweredTimeout = setTimeout(() => {
                        this.ui.stopOutgoingRing()
                        this.ui.log('⏱ No answer — call timed out', 'warning')
                        this.ui.updateCallStatus('ended', 'No answer')
                        this.ui.playDisconnectedTone(30000, () => this.endCall())
                    }, 3 * 60 * 1000)
                } catch (audioError) {
                    this.ui.log(`Error: ${audioError.message || audioError.toString()}`, 'error')
                }
            } else {
                this.ui.log(`Error: ${errorMsg}`, 'error')
            }
        }
    }

    /**
     * Toggle media stream on/off
     */
    async toggleMediaStream() {
        try {
            if (!this.app.isMediaActive) {
                try {
                    await this.app.peerConnection.initializeMediaStream({
                        audio: true,
                        video: true
                    })
                } catch (error) {
                    const errorMsg = error.message || error.toString()

                    // If audio+video fails, try audio-only
                    if (errorMsg.includes('Requested device not found')) {
                        this.ui.log('🎥 Video not available, using audio-only', 'warning')
                        await this.app.peerConnection.initializeMediaStream({
                            audio: true,
                            video: false
                        })
                    } else if (errorMsg.includes('Permission denied') || errorMsg.includes('Permission')) {
                        this.ui.log(`⚠️  ${errorMsg}`, 'error')
                        throw error
                    } else {
                        throw error
                    }
                }
                this.app.isMediaActive = true
                document.getElementById('mediaBtn').textContent = '🎤 Stop Media'
                this.ui.log('✓ Media stream started', 'success')
            } else {
                this.app.peerConnection.stopMediaStream()
                this.app.isMediaActive = false
                document.getElementById('mediaBtn').textContent = '🎤 Start Media'
                this.ui.log('Media stream stopped', 'info')
            }
        } catch (error) {
            const errorMsg = error.message || error.toString()
            this.ui.log(`Media error: ${errorMsg}`, 'error')
        }
    }

    /**
     * Accept incoming call
     */
    async acceptCall() {
        try {
            if (!this.app.currentCallToken) {
                this.ui.log('Error: No active call to accept', 'error')
                return
            }

            if (this.app._incomingTimeout) { clearTimeout(this.app._incomingTimeout); this.app._incomingTimeout = null }
            const callTokenId = this.app.currentCallToken

            // Ensure signaling has callee's IP/port — signaling.initialize() is only called
            // on the caller side (initializeCall), so callee must set these before accepting.
            const myIp = document.getElementById('myIp')?.value
            const myPort = parseInt(document.getElementById('myPort')?.value, 10) || null
            if (myIp) this.app.signaling.myIp = myIp
            if (myPort) this.app.signaling.myPort = myPort

            // broadcastAnswerFn: send answer inscription back to caller
            const broadcastAnswerFn = async (_callTokenId, callerAddress, answerData) => {
                this.ui.log(`📤 Sending answer inscription to caller...`, 'info')
                const answerCallData = {
                    v: 1,
                    proto: 'svphone',
                    type: 'answer',
                    caller: callerAddress,
                    callee: this.app.signaling.myAddress,
                    ip: answerData.senderIp,
                    port: answerData.senderPort,
                    key: answerData.sessionKey,
                    codec: answerData.codec,
                    quality: answerData.quality,
                    media: answerData.mediaTypes,
                    sdp: answerData.sdpAnswer,
                }
                const result = await window.inscriptionBuilder.buildAndBroadcast(
                    answerCallData,
                    callerAddress,
                    window.provider,
                    window.myKey,
                )
                this.ui.log(`✓ Answer sent: ${result.txId}`, 'success')
                return result
            }

            await this.app.callManager.acceptCall(callTokenId, {
                audio: true,
                video: true,
                broadcastAnswerFn,
            })

            this.ui.stopRingtone()
            document.getElementById('incomingCall').style.display = 'none'
            document.getElementById('acceptBtn').style.display = 'none'
            document.getElementById('rejectBtn').style.display = 'none'
            document.getElementById('endCallBtn').style.display = 'inline-block'

            this.ui.log('✓ Call accepted', 'success')
        } catch (error) {
            this.ui.log(`Error accepting call: ${error.message}`, 'error')
        }
    }

    /**
     * Reject incoming call
     */
    rejectCall() {
        try {
            if (!this.app.currentCallToken) {
                this.ui.log('Error: No active call to reject', 'error')
                return
            }

            if (this.app._incomingTimeout) { clearTimeout(this.app._incomingTimeout); this.app._incomingTimeout = null }
            this.app.callManager.rejectCall(this.app.currentCallToken, 'user-declined')
            this.ui.resetCallUI()
            this.ui.log('Call rejected', 'info')
        } catch (error) {
            this.ui.log(`Error rejecting call: ${error.message}`, 'error')
        }
    }

    /**
     * End active call
     */
    async endCall() {
        try {
            if (this.app._unansweredTimeout) { clearTimeout(this.app._unansweredTimeout); this.app._unansweredTimeout = null }
            this.ui.stopOutgoingRing()
            if (!this.app.currentCallToken) {
                this.ui.log('Error: No active call to end', 'error')
                return
            }

            await this.app.callManager.endCall(this.app.currentCallToken)
            this.ui.resetCallUI()
            this.ui.log('Call ended', 'info')
        } catch (error) {
            this.ui.log(`Error ending call: ${error.message}`, 'error')
        }
    }
}

class MicrophoneTestHandlers {
    constructor(app, ui) {
        this.app = app
        this.ui = ui
    }

    /**
     * Toggle a collapsible test section open/closed
     */
    _toggleTestSection(contentId, toggleId) {
        const content = document.getElementById(contentId)
        const icon = document.getElementById(toggleId)
        const collapsed = content.classList.contains('collapsed')
        content.classList.toggle('collapsed', !collapsed)
        icon.classList.toggle('collapsed', !collapsed)
        icon.textContent = collapsed ? '▼' : '▶'
    }

    toggleMicTest() { this._toggleTestSection('micTestContent', 'micTestToggle') }

    /**
     * Start microphone test
     */
    async startMicTest() {
        try {
            if (!this.app.micTester) {
                this.ui.log('Error: Microphone tester not initialized', 'error')
                return
            }

            // Update UI
            document.getElementById('startMicTestBtn').style.display = 'none'
            document.getElementById('stopMicTestBtn').style.display = 'inline-block'
            document.getElementById('micVolumeSlider').disabled = false
            document.getElementById('micMuteCheckbox').disabled = false
            document.getElementById('recordingSection').style.display = 'block'
            document.getElementById('startRecordBtn').disabled = false

            // Start test
            await this.app.micTester.startTest()
        } catch (error) {
            const errorMsg = error.message || error.toString()
            this.ui.log(`⚠️  ${errorMsg}`, 'error')

            // Reset UI on error
            document.getElementById('startMicTestBtn').style.display = 'inline-block'
            document.getElementById('stopMicTestBtn').style.display = 'none'
            document.getElementById('micVolumeSlider').disabled = true
            document.getElementById('micMuteCheckbox').disabled = true
            document.getElementById('recordingSection').style.display = 'none'
        }
    }

    /**
     * Stop microphone test
     */
    stopMicTest() {
        try {
            if (!this.app.micTester) {
                return
            }

            // Stop test
            this.app.micTester.stopTest()

            // Update UI
            document.getElementById('startMicTestBtn').style.display = 'inline-block'
            document.getElementById('stopMicTestBtn').style.display = 'none'
            document.getElementById('micVolumeSlider').disabled = true
            document.getElementById('micMuteCheckbox').disabled = true
            document.getElementById('micMuteCheckbox').checked = false
            document.getElementById('micVolumeSlider').value = 100
            document.getElementById('volumeValue').textContent = '100%'
            document.getElementById('recordingSection').style.display = 'none'
            document.getElementById('recordingTime').textContent = '0:00 / 0:10'
        } catch (error) {
            console.error('Error stopping mic test:', error)
        }
    }

    /**
     * Update microphone volume
     */
    updateMicVolume(value) {
        if (this.app.micTester && this.app.micTester.isTestActive) {
            this.app.micTester.setVolume(value)
            document.getElementById('volumeValue').textContent = value + '%'
        }
    }

    /**
     * Toggle microphone mute
     */
    toggleMicMute(isMuted) {
        if (this.app.micTester && this.app.micTester.isTestActive) {
            this.app.micTester.setMute(isMuted)
            this.ui.log(`Microphone ${isMuted ? 'muted' : 'unmuted'}`, 'info')
        }
    }

    /**
     * Start recording microphone input
     */
    async startRecording() {
        try {
            if (!this.app.micTester) {
                this.ui.log('Error: Microphone tester not initialized', 'error')
                return
            }

            await this.app.micTester.startRecording()
        } catch (error) {
            const errorMsg = error.message || error.toString()
            this.ui.log(`Error: ${errorMsg}`, 'error')
        }
    }

    /**
     * Stop recording microphone input
     */
    stopRecording() {
        try {
            if (this.app.micTester) {
                this.app.micTester.stopRecording()
            }
        } catch (error) {
            console.error('Error stopping recording:', error)
        }
    }

    /**
     * Play microphone recording
     */
    playRecording() {
        try {
            if (this.app.micTester) {
                this.app.micTester.playRecording()
            }
        } catch (error) {
            const errorMsg = error.message || error.toString()
            this.ui.log(`Playback error: ${errorMsg}`, 'error')
        }
    }
}

class CameraTestHandlers {
    constructor(app, ui) {
        this.app = app
        this.ui = ui
    }

    _toggleTestSection(contentId, toggleId) {
        const content = document.getElementById(contentId)
        const icon = document.getElementById(toggleId)
        const collapsed = content.classList.contains('collapsed')
        content.classList.toggle('collapsed', !collapsed)
        icon.classList.toggle('collapsed', !collapsed)
        icon.textContent = collapsed ? '▼' : '▶'
    }

    toggleCameraTest() { this._toggleTestSection('cameraTestContent', 'cameraTestToggle') }

    /**
     * Start camera test
     */
    async startCameraTest() {
        try {
            if (!this.app.cameraTester) {
                this.ui.log('Error: Camera tester not initialized', 'error')
                return
            }

            const quality = document.getElementById('cameraResolution')?.value || 'hd'
            await this.app.cameraTester.startTest(quality)
        } catch (error) {
            const errorMsg = error.message || error.toString()
            this.ui.log(`⚠️  ${errorMsg}`, 'error')
        }
    }

    /**
     * Stop camera test
     */
    stopCameraTest() {
        try {
            if (this.app.cameraTester) {
                this.app.cameraTester.stopTest()
            }
        } catch (error) {
            console.error('Error stopping camera test:', error)
        }
    }

    /**
     * Change camera resolution
     */
    async changeCameraResolution(quality) {
        try {
            if (this.app.cameraTester && this.app.cameraTester.isTestActive) {
                await this.app.cameraTester.changeResolution(quality)
            }
        } catch (error) {
            const errorMsg = error.message || error.toString()
            this.ui.log(`Error: ${errorMsg}`, 'error')
        }
    }

    /**
     * Toggle camera size (normal/full)
     */
    toggleCameraSize() {
        try {
            if (this.app.cameraTester) {
                this.app.cameraTester.toggleSize()
            }
        } catch (error) {
            console.error('Error toggling camera size:', error)
        }
    }

    /**
     * Enter camera fullscreen
     */
    async enterCameraFullscreen() {
        try {
            if (this.app.cameraTester) {
                await this.app.cameraTester.enterFullscreen()
            }
        } catch (error) {
            const errorMsg = error.message || error.toString()
            this.ui.log(`Fullscreen error: ${errorMsg}`, 'error')
        }
    }
}

// Export handler classes for use in phone-controller.js
window.CallHandlers = CallHandlers
window.MicrophoneTestHandlers = MicrophoneTestHandlers
window.CameraTestHandlers = CameraTestHandlers
