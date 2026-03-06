/**
 * SVphone Phone Controller Layer (v07.00)
 *
 * Handles:
 * - Application orchestration and initialization
 * - Background polling coordination
 * - Event binding and listener management
 * - State synchronization
 */

class PhoneController {
    constructor() {
        // Core modules
        this.callManager = null
        this.signaling = null
        this.peerConnection = null
        this.codecs = null
        this.quality = null
        this.security = null
        this.micTester = null
        this.cameraTester = null

        // UI layer
        this.ui = null

        // Event handlers
        this.callHandlers = null
        this.micHandlers = null
        this.cameraHandlers = null

        // Call state
        this.currentCallToken = null
        this.currentRole = null
        this.calleeConnectionData = null
        this.isMediaActive = false
        this.callStartTime = null
        this.durationInterval = null
        // Initialize call token manager
        this.callTokenManager = null

        // UDP port for direct P2P communication
        this.assignedUdpPort = null

        // Screen Wake Lock (prevents screen sleep dropping the call)
        this.wakeLock = null

        this.init()
    }

    /**
     * Initialize application on startup
     */
    async init() {
        try {
            console.log('[SVphone] Initializing controller...')

            // Initialize UI layer
            this.ui = new PhoneUI()
            this.ui.log('Initializing SVphone v07.00...', 'info')

            // Sync wallet data from shared state (wallet.html)
            try {
                this.syncWalletData()
            } catch (e) {
                this.ui.log(`⚠️  Wallet sync error: ${e.message}`, 'error')
            }

            // Load last called address (phone UI local history)
            try {
                this.loadLastCalled()
            } catch (e) {
                this.ui.log(`⚠️  Last called load error: ${e.message}`, 'error')
            }

            // Auto-detect IP and generate ephemeral port
            try {
                await this.autoDetectNetworkConfig()
            } catch (e) {
                this.ui.log(`⚠️  Network config error: ${e.message}`, 'error')
            }

            // Create all component modules
            this.signaling = new CallSignaling()
            // Apply IPs detected before signaling was created
            this.signaling.myIp4 = this._detectedIp4 ?? null
            this.signaling.myIp6 = this._detectedIp6 ?? null
            this.peerConnection = new PeerConnection({
                // Direct P2P with no centralized STUN servers
                // Uses mDNS discovery and standard VoIP ports (3478-3497)
                // iceServers: [] (empty - default in PeerConnection)
            })
            this.callManager = new CallManager(this.signaling, this.peerConnection)
            this.codecs = new CodecNegotiation()
            this.quality = new QualityAdaptation()
            this.security = new MediaSecurity()
            this.micTester = new MicrophoneTester((msg, type) => this.ui.log(msg, type))
            this.cameraTester = new CameraTester((msg, type) => this.ui.log(msg, type))

            // Initialize call token manager
            if (window.CallTokenManager) {
                this.callTokenManager = new CallTokenManager((msg, type) => this.ui.log(msg, type))
                console.debug('[INIT] CallTokenManager initialized')
            }

            // Create handler instances with references to this controller and UI
            this.callHandlers = new CallHandlers(this, this.ui)
            this.micHandlers = new MicrophoneTestHandlers(this, this.ui)
            this.cameraHandlers = new CameraTestHandlers(this, this.ui)

            // Bind event listeners
            this.bindEvents()

            // Diagnostic: Check if calleeAddress field is accessible
            const calleeField = document.getElementById('calleeAddress')
            if (calleeField) {
                console.debug('[DIAG] calleeAddress field found:', {
                    id: calleeField.id,
                    type: calleeField.type,
                    disabled: calleeField.disabled,
                    readonly: calleeField.readOnly,
                    visible: calleeField.offsetParent !== null,
                    value: calleeField.value || '(empty)'
                })
            } else {
                console.error('[DIAG] calleeAddress field NOT FOUND in DOM!')
            }

            // Start background polling for incoming calls
            try {
                this.startBackgroundPolling()
            } catch (e) {
                this.ui.log(`⚠️  Could not start background polling: ${e.message}`, 'warning')
            }

            this.ui.log('SVphone initialized successfully', 'success')
        } catch (error) {
            this.ui.log(`❌ Initialization failed: ${error.message}`, 'error')
            console.error('[SVphone] Init error:', error)
        }
    }

    /**
     * Sync wallet data from shared state
     */
    syncWalletData() {
        const myAddressField = document.getElementById('myAddress')
        let found = false

        // Try 1: Get address from bundle.js wallet (if wallet.html is open in same session)
        const addressEl = document.getElementById('address')
        if (addressEl && addressEl.textContent && addressEl.textContent !== '...') {
            const addr = addressEl.textContent.trim()
            myAddressField.value = addr
            // Don't auto-populate callee - let user enter the address they want to call
            this.ui.log(`✓ Wallet synced from bundle: ${addr}`, 'success')
            found = true
        }

        // Try 2: Get address from localStorage (if wallet.html was opened before)
        if (!found) {
            const storedAddress = localStorage.getItem('svphone_wallet_address')
            if (storedAddress && storedAddress !== '...') {
                myAddressField.value = storedAddress
                // Don't auto-populate callee - let user enter the address they want to call
                this.ui.log(`✓ Wallet restored from storage: ${storedAddress}`, 'success')
                found = true
            }
        }

        // If found, we're done
        if (found) return

        // If not found, show helpful message
        myAddressField.placeholder = 'Open wallet.html to load wallet address'
        this.ui.log('💡 Wallet not initialized. Open wallet.html first, then return here.', 'info')
    }

    /**
     * Load last called address from storage
     */
    loadLastCalled() {
        const lastCalledAddress = localStorage.getItem('svphone_phone_last_called_address')
        const lastCalledBtn = document.getElementById('lastCalledBtn')
        const lastCalledBtnText = document.getElementById('lastCalledBtnText')
        const lastCalledInfo = document.getElementById('lastCalledInfo')
        const lastCalledAddressEl = document.getElementById('lastCalledAddress')

        if (lastCalledAddress && lastCalledAddress.trim()) {
            // Show the redial button with the address
            lastCalledBtnText.textContent = lastCalledAddress.slice(0, 10) + '...'
            lastCalledBtn.style.display = 'block'

            // Show the info text
            lastCalledAddressEl.textContent = lastCalledAddress
            lastCalledInfo.style.display = 'block'
        } else {
            lastCalledBtn.style.display = 'none'
            lastCalledInfo.style.display = 'none'
        }
    }

    /**
     * Save last called address
     */
    saveLastCalled(address) {
        if (address && address.trim()) {
            localStorage.setItem('svphone_phone_last_called_address', address.trim())
            this.loadLastCalled()
        }
    }

    // ─── Public proxy methods for inline onclick handlers in HTML ────────

    toggleMicTest()        { this.micHandlers.toggleMicTest() }
    startMicTest()         { return this.micHandlers.startMicTest() }
    stopMicTest()          { this.micHandlers.stopMicTest() }
    startRecording()       { return this.micHandlers.startRecording() }
    stopRecording()        { this.micHandlers.stopRecording() }
    playRecording()        { this.micHandlers.playRecording() }

    toggleCameraTest()     { this.cameraHandlers.toggleCameraTest() }
    startCameraTest()      { return this.cameraHandlers.startCameraTest() }
    stopCameraTest()       { this.cameraHandlers.stopCameraTest() }
    toggleCameraSize()     { this.cameraHandlers.toggleCameraSize() }
    enterCameraFullscreen(){ return this.cameraHandlers.enterCameraFullscreen() }

    initializeCall()       { return this.callHandlers.initializeCall() }
    toggleMediaStream()    { return this.callHandlers.toggleMediaStream() }
    acceptCall()           { return this.callHandlers.acceptCall() }
    rejectCall()           { this.callHandlers.rejectCall() }
    endCall()              { return this.callHandlers.endCall() }
    clearConsole()         { this.ui.clearConsole() }

    /**
     * Quick dial using last called address
     */
    quickDial() {
        const lastCalledAddress = localStorage.getItem('svphone_phone_last_called_address')
        if (lastCalledAddress) {
            document.getElementById('calleeAddress').value = lastCalledAddress
            this.ui.log(`📞 Quick dial: ${lastCalledAddress}`, 'info')
            this.callHandlers.initializeCall()
        }
    }

    /**
     * Auto-detect network configuration
     */
    async autoDetectNetworkConfig() {
        const myIpField = document.getElementById('myIp')
        const myPortField = document.getElementById('myPort')

        // Assign random UDP port in standard VoIP range (3478-3497)
        // These ports are typically open on firewalls for apps like FaceTime and Game Center
        const minPort = 3478
        const maxPort = 3497
        const randomPort = minPort + Math.floor(Math.random() * (maxPort - minPort + 1))
        myPortField.value = randomPort
        this.assignedUdpPort = randomPort
        console.log(`[SVphone] Assigned UDP port: ${randomPort} (VoIP range 3478-3497)`)

        // Detect both public IPv4 and IPv6 in parallel.
        // svphone.com is IPv4-only (shared hosting) — fetching ip.php there forces IPv4.
        // api6.ipify.org is AAAA-only — fetching it forces IPv6.
        myIpField.value = ''
        myIpField.placeholder = 'Detecting public IP...'

        const fetchIpv4 = async () => {
            const urls = ['https://svphone.com/ip.php', 'https://api.ipify.org?format=json', 'https://ifconfig.me/ip']
            for (const url of urls) {
                try {
                    const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
                    const ip = url.includes('ipify') ? (await r.json()).ip : (await r.text()).trim()
                    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip
                } catch { /* try next */ }
            }
            return null
        }

        const fetchIpv6 = async () => {
            // api6.ipify.org has AAAA-only DNS — fetching it forces an IPv6 connection
            const urls = ['https://api6.ipify.org?format=json']
            for (const url of urls) {
                try {
                    const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
                    const ip = url.includes('ipify') ? (await r.json()).ip : (await r.text()).trim()
                    if (ip && ip.includes(':')) return ip
                } catch { /* try next */ }
            }
            return null
        }

        const [ip4Res, ip6Res] = await Promise.allSettled([fetchIpv4(), fetchIpv6()])
        const myIp4 = ip4Res.status === 'fulfilled' ? ip4Res.value : null
        const myIp6 = ip6Res.status === 'fulfilled' ? ip6Res.value : null

        // Store on controller — signaling doesn't exist yet at this point in init()
        this._detectedIp4 = myIp4
        this._detectedIp6 = myIp6

        const myIp6Field = document.getElementById('myIp6')
        const displayIp = myIp4 || myIp6 || ''
        if (displayIp) {
            myIpField.value = myIp4 || ''
            myIpField.placeholder = myIp4 ? '' : 'None detected'
            if (myIp6Field) myIp6Field.value = myIp6 || ''
            // this.signaling set after autoDetectNetworkConfig returns — assigned in init()
            if (this.signaling) this.signaling.myIp = displayIp
            const label = myIp4 && myIp6 ? ' (dual-stack)' : myIp6 ? ' (IPv6 only)' : ''
            this.ui.log(`✓ Public IP: ${displayIp}${label}`, 'success')
        } else {
            myIpField.placeholder = 'Enter your public IP'
            this.ui.log('⚠️  Could not detect public IP — enter manually', 'warning')
        }
    }

    /**
     * Bind HTML event listeners to handlers
     */
    bindEvents() {
        // ========== Call Manager Events ==========
        this.callManager.on('call:log', ({ msg, type }) => this.ui.log(msg, type))

        this.callManager.on('call:initiated-session', (session) => {
            this.ui.log(`📞 Call initiated to ${session.calleeAddress}`, 'info')
            this.currentCallToken = session.callTokenId
            this.currentRole = 'caller'
            this.ui.updateCallStatus('ringing', 'Call ringing...')
            this.playRingtone()  // Play ring sound when calling
        })

        this.callManager.on('call:incoming-session', (session) => {
            this.ui.log(`📞 Incoming call from ${session.caller}`, 'info')
            this.showIncomingCall(session.caller, session.callTokenId)
            this.currentCallToken = session.callTokenId
            this.currentRole = 'callee'
        })

        this.callManager.on('call:answered-session', (session) => {
            const remoteAddress = session.callee || session.calleeAddress
            const remoteParty = remoteAddress || session.answerer
            console.debug(`[RECV] ✅ CALL ANSWERED by ${remoteParty}`)
            // Cancel outgoing ring and unanswered timeout
            this.ui.stopOutgoingRing()
            if (this._unansweredTimeout) { clearTimeout(this._unansweredTimeout); this._unansweredTimeout = null }
            this.ui.log(`📞 Call answered by ${remoteParty}`, 'success')
            this.ui.updateCallStatus('answered', 'Call answered - connecting...')

            if (session.sdpAnswer && remoteAddress) {
                // Caller received answer inscription: complete WebRTC handshake by setting
                // the remote description on the existing peer connection (the one that has
                // the offer as local description).  Do NOT call createPeerConnection() here —
                // that would discard the existing connection and the SDP exchange would fail.
                console.debug(`[RECV] Setting remote description (answer SDP) for ${remoteAddress}`)
                this.peerConnection.setRemoteDescription(remoteAddress, { type: 'answer', sdp: session.sdpAnswer })
                    .then(() => {
                        this.ui.log('✓ WebRTC handshake complete, ICE connecting...', 'success')
                        // Inject callee's public IP as srflx candidates (NAT traversal without STUN)
                        this.ui.log(`[ICE] Callee ip4: ${session.calleeIp4 ?? 'none'} ip6: ${session.calleeIp6 ?? 'none'}`, 'info')
                        if (session.calleeIp4 || session.calleeIp6) {
                            const pubCandidates = this.peerConnection._buildPublicIpCandidates(
                                session.sdpAnswer, session.calleeIp4 ?? null, session.calleeIp6 ?? null,
                                this.ui.log.bind(this.ui)
                            )
                            for (const c of pubCandidates) {
                                this.peerConnection.addIceCandidate(remoteAddress, c)
                                    .catch(e => console.warn('[Phone] Public IP candidate rejected:', e.message))
                            }
                        }
                    })
                    .catch(err => this.ui.log(`⚠️ WebRTC answer error: ${err.message}`, 'error'))
            } else {
                // Callee: this fires locally from signaling.acceptCall().
                // createAnswer() already set both local and remote descriptions — ICE is running.
                console.debug(`[RECV] Callee ICE running after acceptCall`)
                this.calleeConnectionData = {
                    address: remoteAddress,
                    ip: session.calleeIp,
                    port: session.calleePort,
                    sessionKey: session.calleeSessionKey
                }
            }
        })

        this.callManager.on('call:connected', () => {
            console.debug('[call:connected] Event listener fired!')
            this.ui.log('📞 Call connected! Media stream established', 'success')
            this.ui.updateCallStatus('connected', 'Call connected')
            document.getElementById('endCallBtn').style.display = 'inline-block'
            console.debug('[call:connected] About to call showCallStats()')
            this.ui.showCallStats()
            console.debug('[call:connected] showCallStats() completed')
            this.callStartTime = Date.now()
            this.ui.startDurationTimer()
            // Acquire screen wake lock to prevent screen sleep from dropping the call
            if ('wakeLock' in navigator) {
                navigator.wakeLock.request('screen')
                    .then(lock => { this.wakeLock = lock; this.ui.log('Screen wake lock active', 'info') })
                    .catch(e => console.warn('[WakeLock] Could not acquire:', e.message))
            }
        })

        this.callManager.on('call:ended-session', (data) => {
            this.ui.log(`📞 Call ended. Duration: ${(data.duration/1000).toFixed(1)}s`, 'info')
            this.ui.resetCallUI()
            this.ui.stopDurationTimer()
            // Release screen wake lock
            if (this.wakeLock) { this.wakeLock.release(); this.wakeLock = null }
        })

        // Re-acquire wake lock if browser releases it (e.g. tab hidden then shown) during an active call
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.wakeLock === null && this.currentCallToken) {
                navigator.wakeLock?.request('screen')
                    .then(lock => { this.wakeLock = lock })
                    .catch(() => {})
            }
        })

        // ========== Quality Adaptation Events ==========
        this.quality.on('quality:changed', (data) => {
            this.ui.log(`📊 Quality changed: ${data.oldQuality} → ${data.newQuality}`, 'warning')
            this.ui.updateQuality(data.newQuality)
        })

        // ========== Call Manager Stats Events ==========
        this.callManager.on('call:stats-updated', (data) => {
            this.ui.updateStats(data.stats)
        })

        // ========== Peer Connection Events ==========
        this.peerConnection.on('media:ready', () => {
            this.ui.log('🎤 Media stream ready', 'success')
            this.attachLocalVideo()
        })

        this.peerConnection.on('media:track-received', (data) => {
            this.ui.log(`📹 Received remote ${data.track.kind} track`, 'info')
            this.attachRemoteVideo(data.stream)
        })

        // ========== Security Events ==========
        this.security.on('security:dtls-connected', () => {
            this.ui.log('🔒 DTLS encryption established', 'success')
            this.ui.updateEncryption('DTLS v1.2')
        })




        // ========== Microphone Test UI ==========
        document.getElementById('micTestToggle')?.addEventListener('click', () => this.micHandlers.toggleMicTest())
        document.getElementById('startMicTestBtn')?.addEventListener('click', () => this.micHandlers.startMicTest())
        document.getElementById('stopMicTestBtn')?.addEventListener('click', () => this.micHandlers.stopMicTest())
        document.getElementById('micVolumeSlider')?.addEventListener('input', (e) => this.micHandlers.updateMicVolume(e.target.value))
        document.getElementById('micMuteCheckbox')?.addEventListener('change', (e) => this.micHandlers.toggleMicMute(e.target.checked))
        document.getElementById('startRecordBtn')?.addEventListener('click', () => this.micHandlers.startRecording())
        document.getElementById('stopRecordBtn')?.addEventListener('click', () => this.micHandlers.stopRecording())
        document.getElementById('playRecordBtn')?.addEventListener('click', () => this.micHandlers.playRecording())

        // ========== Camera Test UI ==========
        document.getElementById('cameraTestToggle')?.addEventListener('click', () => this.cameraHandlers.toggleCameraTest())
        document.getElementById('startCameraTestBtn')?.addEventListener('click', () => this.cameraHandlers.startCameraTest())
        document.getElementById('stopCameraTestBtn')?.addEventListener('click', () => this.cameraHandlers.stopCameraTest())
        document.getElementById('cameraResolution')?.addEventListener('change', (e) => this.cameraHandlers.changeCameraResolution(e.target.value))
        document.getElementById('toggleCameraSizeBtn')?.addEventListener('click', () => this.cameraHandlers.toggleCameraSize())
        document.getElementById('cameraFullscreenBtn')?.addEventListener('click', () => this.cameraHandlers.enterCameraFullscreen())
    }

    /**
     * Start background polling for incoming calls
     */
    async startBackgroundPolling() {
        // Start listening for incoming call signals in background.
        // This runs continuously so recipient can receive calls anytime.
        const myAddress = document.getElementById('myAddress')?.value

        if (!window.tokenBuilder || !window.provider || !myAddress || !this.callTokenManager) {
            this.ui.log(`⏳ Waiting for wallet to load (will retry in 2s)...`, 'warning')
            setTimeout(() => this.startBackgroundPolling(), 2000)
            return
        }

        // Ensure signaling is initialized with wallet address BEFORE polling
        if (!this.signaling.myAddress) {
            this.signaling.myAddress = myAddress
        }

        try {
            const seenTxIds = new Set()

            // Pre-seed seenTxIds with the current address history so that TXs already
            // on-chain when polling starts are ignored.  Only signals that arrive
            // AFTER this point (new calls/answers) will be processed.
            try {
                const initialHistory = await window.provider.getAddressHistory()
                for (const { txId } of initialHistory) seenTxIds.add(txId)
                console.log(`[Poll] Pre-seeded ${seenTxIds.size} existing txIds — will only process new signals`)
            } catch (e) {
                console.warn('[Poll] Could not pre-seed seenTxIds:', e.message)
            }

            // Scan address history for SVphone call/answer OP_RETURN signals
            const scanSignalsFn = async (address) => {
                if (!address) return []

                const history = await window.provider.getAddressHistory()
                console.log(`[Poll] address=${address.slice(0,12)}… history=${history.length} txs`)
                const results = []

                for (const { txId } of history) {
                    if (seenTxIds.has(txId)) continue

                    try {
                        const tx = await window.provider.getSourceTransaction(txId)
                        // Cap seenTxIds to prevent unbounded growth over long sessions
                        if (seenTxIds.size > 500) {
                            const oldest = seenTxIds.values().next().value
                            seenTxIds.delete(oldest)
                        }
                        seenTxIds.add(txId) // Only mark seen after successful fetch

                        // Scan outputs for P OP_RETURN call signals
                        let signal = null
                        for (const output of tx.outputs) {
                            if (!output.lockingScript) continue
                            const decoded = window.decodeOpReturn(output.lockingScript)
                            if (!decoded) continue
                            const name = decoded.tokenName
                            if (!name?.startsWith('CALL-') && !name?.startsWith('ANS-')) continue

                            const attrs = this.callTokenManager.decodeCallAttributes(decoded.tokenAttributes)
                            if (!attrs?.senderIp) continue

                            const isCall = name.startsWith('CALL-') && attrs.callee === address
                            const isAnswer = name.startsWith('ANS-') && attrs.caller === address
                            if (!isCall && !isAnswer) continue

                            signal = {
                                type: isCall ? 'call' : 'answer',
                                caller: attrs.caller,
                                callee: attrs.callee,
                                ip: attrs.senderIp,
                                ip4: attrs.senderIp4 ?? null,
                                ip6: attrs.senderIp6 ?? null,
                                port: attrs.senderPort,
                                key: attrs.sessionKey,
                                codec: attrs.codec,
                                quality: attrs.quality,
                                media: attrs.mediaTypes,
                                // CALL: wrap as object so call_manager.js can access .sdp property
                                // ANS:  plain string — phone-controller.js:314 wraps it with {type,sdp}
                                sdp: isCall ? { type: 'offer', sdp: attrs.sdpOffer }
                                            : attrs.sdpOffer,
                            }
                            break
                        }

                        if (signal) {
                            // UI-visible log so user can verify decoded token data
                            const sdpStr = signal.sdp ? (typeof signal.sdp === 'object' ? signal.sdp.sdp : signal.sdp) : ''
                            const sdpLen = sdpStr?.length ?? 0
                            const sdpCands = (sdpStr.match(/a=candidate:/g) || []).length
                            this.ui.log(
                                `[Token] ${signal.type.toUpperCase()}: ip4=${signal.ip4 ?? 'none'} ` +
                                `ip6=${signal.ip6 ? signal.ip6.slice(0,16)+'…' : 'none'} ` +
                                `port=${signal.port ?? 0} sdp=${sdpLen}B (${sdpCands} cands)`,
                                'info'
                            )
                            results.push({ txId, inscription: signal })
                        }
                    } catch (e) {
                        console.warn(`[Poll] fetch failed for ${txId.slice(0,12)}…:`, e.message)
                    }
                }

                return results
            }

            // Start polling
            this.signaling.startPolling(scanSignalsFn)
            this.ui.log('📞 Background polling for incoming calls started', 'success')
            // call:incoming and call:answered are forwarded by CallManager via
            // call:incoming-session and call:answered-session — handled in bindEvents()
        } catch (error) {
            this.ui.log('[BgPolling] Failed to start: ' + error.message, 'error')
        }
    }

    /**
     * Show incoming call UI
     */
    showIncomingCall(caller, callTokenId) {
        console.debug(`[RECV] ✅ INCOMING CALL DETECTED! Caller: ${caller}`)
        this.currentCallToken = callTokenId
        this.ui.showIncomingCall(caller)

        // Auto-return to standby if not answered within 3 minutes
        this._incomingTimeout = setTimeout(() => {
            this._incomingTimeout = null
            this.ui.log('⏱ Incoming call timed out — returning to standby', 'info')
            this.ui.resetCallUI()
        }, 3 * 60 * 1000)
    }

    /**
     * Play ringtone sound
     */
    playRingtone() {
        try {
            // Create a simple ringtone using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)()
            const oscillator = audioContext.createOscillator()
            const gainNode = audioContext.createGain()

            oscillator.connect(gainNode)
            gainNode.connect(audioContext.destination)

            // Ring pattern: 440Hz (A4) for 0.5s, 0.5s silence, repeat 2x
            oscillator.frequency.value = 440
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)

            const startTime = audioContext.currentTime
            oscillator.start(startTime)
            gainNode.gain.setValueAtTime(0.3, startTime)
            gainNode.gain.setValueAtTime(0, startTime + 0.5)

            gainNode.gain.setValueAtTime(0.3, startTime + 1)
            gainNode.gain.setValueAtTime(0, startTime + 1.5)

            oscillator.stop(startTime + 1.5)
        } catch (error) {
            console.warn('Ringtone playback failed:', error)
        }
    }

    /**
     * Attach local video stream
     */
    attachLocalVideo() {
        const stream = this.peerConnection.mediaStream
        if (stream) {
            this.ui.attachLocalVideo(stream)
        }
    }

    /**
     * Attach remote video stream
     */
    attachRemoteVideo(stream) {
        this.ui.attachRemoteVideo(stream)
    }
}

// Initialize application when DOM is ready
let phoneApp = null

function initPhoneApp() {
    try {
        console.log('[SVphone] Initializing phone application...')
        phoneApp = new PhoneController()
        window.app = phoneApp
        window.phoneApp = phoneApp
        console.log('[SVphone] Phone application initialized successfully')
    } catch (error) {
        console.error('[SVphone] Initialization error:', error)
        console.error('[SVphone] Stack:', error.stack)
        alert('SVphone initialization failed: ' + error.message)
    }
}

// Wait for DOM to be fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPhoneApp)
} else {
    initPhoneApp()
}

// Export for external access
window.PhoneController = PhoneController
