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
                if (this.app.callTokenStatus === 'confirmed') {
                    this.ui.log('📋 Tokens ready! Enter recipient address', 'warning')
                } else {
                    this.ui.log('Error: Enter recipient address', 'error')
                }
                return
            }

            this.app.saveLastCalled(calleeAddress)
            const quality = document.getElementById('quality').value

            const tokenBuilder = window.tokenBuilder
            if (!tokenBuilder) {
                this.ui.log('Error: Token builder not available', 'error')
                return
            }

            // Check for selected token
            const selectedTokenId = this.ui.getSelectedToken()
            if (selectedTokenId) {
                this.ui.log(`✓ Using token: ${selectedTokenId.slice(0, 10)}...`, 'success')
                this.ui.updateCallButtonStatus('confirmed')
                this.ui.log(`📞 Calling ${calleeAddress}...`, 'info')

                const quality = document.getElementById('quality').value
                const session = await this.app.callManager.initiateCall(calleeAddress, {
                    audio: true,
                    video: true,
                    quality: quality
                })

                this.app.currentCallToken = session.callTokenId
                this.ui.log('✓ Call initiated successfully', 'success')
                return
            }

            if (this.app.isMintPending) {
                this.ui.log('⏳ Mint in progress. Please wait...', 'warning')
                return
            }

            // Token creation function
            const callTokenCreateFn = async (token) => {
                if (!this.app.callTokenManager) throw new Error('CallTokenManager not initialized')
                const result = await this.app.callTokenManager.createAndBroadcastCallToken(token)
                this.ui.updateCallButtonStatus('confirmed')
                this.ui.log('✓ Token confirmed - ready to call', 'success')
                return result
            }

            const hasCallTokens = await this.app.checkForCallTokens()
            if (!hasCallTokens) {
                // No tokens - mint new ones
                this.ui.log('📋 No call tokens. Minting...', 'info')
                this.ui.updateCallButtonStatus('minting')

                const session = await this.app.callManager.initiateCall(calleeAddress, {
                    audio: true,
                    video: true,
                    quality: quality,
                    mintTokenFn: callTokenCreateFn
                })

                this.ui.updateCallButtonStatus('calling')
                this.app.currentCallToken = session.callTokenId
                this.ui.log('✓ Call initiated successfully', 'success')
            } else {
                // Tokens exist
                if (this.app.isMintPending || this.app.callTokenStatus === 'minting' || this.app.callTokenStatus === 'pending') {
                    this.ui.log('⏳ Please wait - tokens are being created or confirmed', 'warning')
                    return
                }

                this.ui.updateCallButtonStatus('calling')
                this.ui.log(`📞 Calling ${calleeAddress}...`, 'info')

                const session = await this.app.callManager.initiateCall(calleeAddress, {
                    audio: true,
                    video: true,
                    quality: quality,
                    mintTokenFn: callTokenCreateFn
                })

                this.app.currentCallToken = session.callTokenId
                this.ui.log('✓ Call initiated successfully', 'success')
            }
        } catch (error) {
            const errorMsg = error.message || error.toString()

            // Handle specific media permission errors
            if (errorMsg.includes('Permission denied') || errorMsg.includes('Permission')) {
                this.ui.log(`⚠️  ${errorMsg}`, 'error')
            } else if (errorMsg.includes('Requested device not found')) {
                this.ui.log('⚠️  No microphone or camera found. Attempting audio-only call...', 'warning')
                // Retry with audio only by attempting the call again
                try {
                    const calleeAddress = document.getElementById('calleeAddress').value
                    const quality = document.getElementById('quality').value
                    const session = await this.app.callManager.initiateCall(calleeAddress, {
                        audio: true,
                        video: false,
                        quality: quality
                    })
                    this.app.currentCallToken = session.callTokenId
                    this.ui.log('✓ Audio-only call initiated', 'success')
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

            // Get recipient's connection data
            const recipientAddress = document.getElementById('myAddress').value
            const recipientIp = document.getElementById('myIp').value
            const recipientPort = parseInt(document.getElementById('myPort').value)

            if (!recipientAddress || !recipientIp || !recipientPort) {
                this.ui.log('⚠️  Missing connection data (address, IP, or port)', 'error')
                return
            }

            // Get the received call token from store
            const tokenStore = window.tokenStore
            if (!tokenStore) {
                this.ui.log('Error: Token store not available', 'error')
                return
            }

            const receivedToken = await tokenStore.getToken(this.app.currentCallToken)
            if (!receivedToken) {
                this.ui.log('Error: Call token not found in store', 'error')
                return
            }

            // Prepare response data to send back to caller
            const keyBytes = new Uint8Array(32)
            crypto.getRandomValues(keyBytes)
            const responseData = {
                status: 'answered',
                recipientAddress: recipientAddress,
                recipientIp: recipientIp,
                recipientPort: recipientPort,
                recipientSessionKey: btoa(String.fromCharCode(...keyBytes)),
                answeredAt: Date.now()
            }
            const responseStateHex = this.app.encodeCallState(responseData)

            // Accept call in call manager
            await this.app.callManager.acceptCall(this.app.currentCallToken, {
                audio: true,
                video: true
            })

            // Parse caller's connection data from token
            const callerAttrs = this.app.signaling.parseTokenAttributes(receivedToken.tokenAttributes)

            // Send token back to caller
            const tokenBuilder = window.tokenBuilder
            if (tokenBuilder) {
                try {
                    const callerAddress = receivedToken.caller || callerAttrs.caller
                    if (callerAddress) {
                        this.ui.log(`📤 Sending token back to caller...`, 'info')
                        const transferResult = await tokenBuilder.createTransfer(
                            this.app.currentCallToken,
                            callerAddress,
                            responseStateHex
                        )
                        this.ui.log(`✓ Token sent: ${transferResult.txId}`, 'success')
                    }
                } catch (transferError) {
                    this.ui.log(`⚠️  Could not send token: ${transferError.message}`, 'warning')
                }
            }

            // Initiate P2P connection to caller
            if (callerAttrs.caller && callerAttrs.senderIp && callerAttrs.senderPort) {
                this.app.initiateP2PConnection(this.app.currentCallToken, callerAttrs.caller, callerAttrs.senderIp, callerAttrs.senderPort)
            }

            document.getElementById('incomingCall').style.display = 'none'
            document.getElementById('acceptBtn').style.display = 'none'
            document.getElementById('rejectBtn').style.display = 'none'
            document.getElementById('endCallBtn').style.display = 'inline-block'

            this.ui.log('✓ Call accepted and token sent back to caller', 'success')
        } catch (error) {
            const errorMsg = error.message || error.toString()

            // Handle specific media permission errors
            if (errorMsg.includes('Permission denied') || errorMsg.includes('Permission')) {
                this.ui.log(`⚠️  ${errorMsg}`, 'error')
            } else if (errorMsg.includes('Requested device not found')) {
                this.ui.log('⚠️  No microphone or camera found. Attempting audio-only call...', 'warning')
                // Retry with audio only
                try {
                    // Get recipient's connection data
                    const recipientAddress = document.getElementById('myAddress').value
                    const recipientIp = document.getElementById('myIp').value
                    const recipientPort = parseInt(document.getElementById('myPort').value)

                    if (recipientAddress && recipientIp && recipientPort) {
                        // Prepare recipient's response data for audio-only call
                        const keyBytes = new Uint8Array(32)
                        crypto.getRandomValues(keyBytes)
                        const recipientSessionKey = btoa(String.fromCharCode(...keyBytes))
                        const responseData = {
                            status: 'answered',
                            recipientAddress: recipientAddress,
                            recipientIp: recipientIp,
                            recipientPort: recipientPort,
                            recipientSessionKey: recipientSessionKey,
                            answeredAt: Date.now(),
                            audioOnly: true
                        }
                        // Encode response as binary format (byte-efficient, NO JSON)
                        const responseStateHex = this.app.encodeCallState(responseData)
                        console.debug(`[SEND-AUDIO] ✅ Response encoded to ${responseStateHex.length / 2} bytes`)

                        await this.app.callManager.acceptCall(this.app.currentCallToken, {
                            audio: true,
                            video: false
                        })

                        // Send the token back to the caller
                        const tokenBuilder = window.tokenBuilder
                        const tokenStore = window.tokenStore
                        if (tokenBuilder && tokenStore) {
                            const receivedToken = await tokenStore.getToken(this.app.currentCallToken)
                            if (receivedToken) {
                                // Parse token attributes using signaling layer (handles binary v1 and legacy JSON)
                                const callerAttrsAudio = this.app.signaling.parseTokenAttributes(receivedToken.tokenAttributes)
                                const callerAddress = receivedToken.caller || callerAttrsAudio.caller
                                if (callerAddress) {
                                    try {
                                        const transferResult = await tokenBuilder.createTransfer(
                                            this.app.currentCallToken,
                                            callerAddress,
                                            responseStateHex  // Pass response data as stateData
                                        )
                                        this.ui.log(`✓ Token sent back to caller: ${transferResult.txId}`, 'success')
                                        console.debug(`[SEND] ✅ Audio-only response token transferred: ${transferResult.txId}`)
                                    } catch (transferError) {
                                        this.ui.log(`⚠️  Could not send token back: ${transferError.message}`, 'warning')
                                    }
                                }
                            }
                        }

                        // Initiate P2P connection using caller attributes (already parsed above)
                        if (callerAttrsAudio && callerAttrsAudio.caller && callerAttrsAudio.senderIp && callerAttrsAudio.senderPort) {
                            console.debug(`[P2P] 🔗 Initiating P2P connection back to caller (audio-only): ${callerAttrsAudio.caller}`)
                            this.app.initiateP2PConnection(this.app.currentCallToken, callerAttrsAudio.caller, callerAttrsAudio.senderIp, callerAttrsAudio.senderPort)
                        }

                        document.getElementById('incomingCall').style.display = 'none'
                        document.getElementById('acceptBtn').style.display = 'none'
                        document.getElementById('rejectBtn').style.display = 'none'
                        document.getElementById('endCallBtn').style.display = 'inline-block'
                        this.ui.log('✓ Audio-only call accepted and token sent back', 'success')
                    }
                } catch (audioError) {
                    const audioErrorMsg = audioError.message || audioError.toString()
                    this.ui.log(`Error accepting call: ${audioErrorMsg}`, 'error')
                }
            } else {
                this.ui.log(`Error accepting call: ${errorMsg}`, 'error')
            }
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
     * Toggle microphone test UI
     */
    toggleMicTest() {
        const content = document.getElementById('micTestContent')
        const icon = document.getElementById('micTestToggle')

        if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed')
            icon.classList.remove('collapsed')
            icon.textContent = '▼'
        } else {
            content.classList.add('collapsed')
            icon.classList.add('collapsed')
            icon.textContent = '▶'
        }
    }

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

    /**
     * Toggle camera test UI
     */
    toggleCameraTest() {
        const content = document.getElementById('cameraTestContent')
        const icon = document.getElementById('cameraTestToggle')

        if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed')
            icon.classList.remove('collapsed')
            icon.textContent = '▼'
        } else {
            content.classList.add('collapsed')
            icon.classList.add('collapsed')
            icon.textContent = '▶'
        }
    }

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
