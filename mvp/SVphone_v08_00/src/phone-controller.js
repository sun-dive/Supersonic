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
        this.isMintPending = false
        this.callTokenStatus = 'none'  // none | minting | pending | confirmed | calling

        // Initialize call token manager
        this.callTokenManager = null

        // UDP port for direct P2P communication
        this.assignedUdpPort = null

        // Available CALL tokens for quick reuse
        this.availableCallTokens = []
        this.selectedCallToken = null

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
                this.autoDetectNetworkConfig()
            } catch (e) {
                this.ui.log(`⚠️  Network config error: ${e.message}`, 'error')
            }

            // Create all component modules
            this.signaling = new CallSignaling()
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

            // Fetch available CALL tokens for quick reuse
            try {
                await this.loadAvailableCallTokens()
            } catch (e) {
                this.ui.log(`⚠️  Could not load available tokens: ${e.message}`, 'warning')
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
     * Load available CALL tokens from token store
     */
    async loadAvailableCallTokens() {
        const tokenStore = window.tokenStore
        if (!tokenStore) {
            this.ui.log('⚠️  Token store not available for loading tokens', 'warning')
            return
        }

        try {
            const tokens = await tokenStore.listTokens()

            // Filter for CALL tokens
            this.availableCallTokens = tokens.filter(t =>
                t.tokenName && t.tokenName.startsWith('CALL-')
            )

            if (this.availableCallTokens.length > 0) {
                this.ui.log(`✓ Found ${this.availableCallTokens.length} available CALL token(s)`, 'success')
                this.ui.populateTokenSelector(this.availableCallTokens)
            } else {
                this.ui.log('No CALL tokens available. You can mint new ones or quick dial an existing contact.', 'info')
                this.ui.showTokensSection(false)
            }
        } catch (error) {
            this.ui.log(`Error loading tokens: ${error.message}`, 'error')
        }
    }

    /**
     * Sync wallet data from shared state
     */
    syncWalletData() {
        const myAddressField = document.getElementById('myAddress')
        const calleeAddressField = document.getElementById('calleeAddress')
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
    autoDetectNetworkConfig() {
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

        // Try to detect public IP via local network detection
        this.detectPublicIP().then(ip => {
            if (ip) {
                myIpField.value = ip
                this.ui.log(`✓ Public IP detected: ${ip}`, 'success')
            } else {
                myIpField.placeholder = 'Enter your public IP manually'
                this.ui.log('⚠️  Could not auto-detect IP. Enter manually or use localhost.', 'warning')
            }
        })
    }

    /**
     * Detect public IP via WebRTC
     */
    async detectPublicIP() {
        return new Promise((resolve) => {
            // Use WebRTC to detect local IP via mDNS (no centralized STUN needed)
            // Direct P2P discovery using native browser capabilities
            const pc = new RTCPeerConnection({
                iceServers: []  // Empty - use mDNS only
            })

            let ipFound = false

            pc.onicecandidate = (ice) => {
                if (ipFound) return

                if (ice && ice.candidate) {
                    const candidate = ice.candidate.candidate
                    // Extract IP from candidate string (format: "candidate:... IP ... port")
                    const ipMatch = candidate.match(/(\d+\.\d+\.\d+\.\d+)/g)
                    if (ipMatch) {
                        // Filter out 127.0.0.1 and get first valid IP
                        const ip = ipMatch.find(ip => !ip.startsWith('127.'))
                        if (ip) {
                            ipFound = true
                            this.ui.log(`✓ Local IP detected: ${ip}`, 'success')
                            pc.close()
                            resolve(ip)
                            return
                        }
                    }
                }

                // If no more candidates, return localhost
                if (!ice.candidate && !ipFound) {
                    ipFound = true
                    this.ui.log('Using localhost for testing', 'info')
                    pc.close()
                    resolve('127.0.0.1')
                }
            }

            // Trigger ICE gathering
            pc.createDataChannel('test')
            pc.createOffer().then(offer => pc.setLocalDescription(offer))

            // Timeout fallback (5 seconds)
            setTimeout(() => {
                if (!ipFound) {
                    ipFound = true
                    pc.close()
                    resolve('127.0.0.1')
                }
            }, 5000)
        })
    }

    /**
     * Check for incoming call tokens in store
     */
    async checkForCallTokens() {
        const tokenStore = window.tokenStore
        if (!tokenStore) {
            this.ui.log('⚠️  Token store not available', 'warning')
            console.warn('[CHECK] tokenStore not available')
            return false
        }

        try {
            const tokens = await tokenStore.listTokens()
            console.debug(`[CHECK] Total tokens in store: ${tokens.length}`)
            console.debug(`[CHECK] Token names: ${tokens.map(t => `"${t.tokenName}"`).join(', ')}`)

            // Check for call tokens (format: CALL-XXXXX where XXXXX is caller identifier)
            const callTokens = tokens.filter(t => {
                const isMatch = t.tokenName && t.tokenName.startsWith('CALL-')
                if (isMatch) {
                    console.debug(`[CHECK] ✓ Found call token: "${t.tokenName}"`)
                } else {
                    console.debug(`[CHECK] ✗ Skipping non-call token: "${t.tokenName}"`)
                }
                return isMatch
            })

            console.debug(`[CHECK] Filtered to ${callTokens.length} call tokens`)
            if (callTokens.length > 0) {
                this.ui.log(`✓ Found ${callTokens.length} call token(s)`, 'success')
                return true
            }
            console.debug(`[CHECK] No call tokens found`)
            return false
        } catch (error) {
            console.error(`[CHECK] Error checking call tokens:`, error)
            this.ui.log(`Error checking call tokens: ${error.message}`, 'error')
            return false
        }
    }

    /**
     * Encode call state for response data
     */
    encodeCallState(state) {
        // Encode call state as hex string for stateData field
        // Binary format: [Version(1)] [Status(1)] [RecipientAddressLen(1)] [RecipientAddress(var)]
        //               [IPType+IP(4-16)] [Port(2)] [KeyLen(1)] [Key(var)]
        try {
            const bytes = []

            // Version marker (0x01 = response format v1)
            bytes.push(0x01)

            // Status (0x01 = answered, 0x02 = rejected, etc.)
            const statusMap = { 'answered': 0x01, 'rejected': 0x02, 'ended': 0x03 }
            bytes.push(statusMap[state.status] || 0x01)

            // Recipient address (variable-length)
            const addressBuf = new TextEncoder().encode(state.recipientAddress)
            bytes.push(addressBuf.length)
            bytes.push(...addressBuf)

            // IP address and port
            const ip = state.recipientIp
            const port = state.recipientPort

            // Detect IP version (0=IPv4, 1=IPv6)
            const isIPv6 = ip.includes(':')
            const ipBits = isIPv6 ? 1 : 0

            if (!isIPv6) {
                // IPv4: 4 bytes
                const parts = ip.split('.').map(p => parseInt(p, 10))
                bytes.push((ipBits << 7) | (parts[0] & 0x7F))
                bytes.push(parts[1])
                bytes.push(parts[2])
                bytes.push(parts[3])
            } else {
                // IPv6: 16 bytes (simplified)
                const parts = ip.split(':').filter(p => p.length > 0)
                const ipv6Bytes = new Uint8Array(16)
                let byteIndex = 0
                for (let i = 0; i < parts.length && byteIndex < 16; i++) {
                    const val = parseInt(parts[i], 16) || 0
                    ipv6Bytes[byteIndex++] = (val >> 8) & 0xFF
                    ipv6Bytes[byteIndex++] = val & 0xFF
                }
                bytes.push((ipBits << 7) | (ipv6Bytes[0] & 0x7F))
                bytes.push(...Array.from(ipv6Bytes).slice(1))
            }

            // Port (2 bytes, big-endian)
            bytes.push((port >> 8) & 0xFF)
            bytes.push(port & 0xFF)

            // Session key (variable-length)
            const keyData = state.recipientSessionKey
            const keyBuf = typeof keyData === 'string'
                ? new TextEncoder().encode(keyData)
                : keyData
            bytes.push(keyBuf.length)
            bytes.push(...keyBuf)

            // Convert to hex string
            return bytes.map(b => ('0' + b.toString(16)).slice(-2)).join('')
        } catch (error) {
            console.warn('Failed to encode call state:', error)
            return ''
        }
    }

    /**
     * Initiate P2P connection to remote peer
     */
    async initiateP2PConnection(callTokenId, remoteAddress, remoteIp, remotePort) {
        try {
            console.debug(`[P2P] 🔗 Initiating direct P2P connection to ${remoteAddress}`)
            console.debug(`[P2P] Remote endpoint: ${remoteIp}:${remotePort}`)

            this.ui.log(`🔗 Establishing P2P connection to ${remoteAddress}...`, 'info')

            // Create peer connection for direct P2P
            const peerConnection = this.peerConnection.createPeerConnection(remoteAddress)

            console.debug(`[P2P] ✓ Peer connection created for ${remoteAddress}`)

            // Monitor connection state
            const checkConnectionState = setInterval(() => {
                const state = this.peerConnection.getConnectionState(remoteAddress)
                console.debug(`[P2P] Connection state: ${state}`)

                if (state === 'connected') {
                    clearInterval(checkConnectionState)
                    this.ui.log(`✓ P2P connection established to ${remoteAddress}`, 'success')
                    this.ui.updateCallStatus('p2p-connected', 'P2P Connected')
                } else if (state === 'failed') {
                    clearInterval(checkConnectionState)
                    this.ui.log(`✗ P2P connection failed to ${remoteAddress}`, 'error')
                }
            }, 500)

            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkConnectionState)
                const state = this.peerConnection.getConnectionState(remoteAddress)
                if (state !== 'connected') {
                    console.warn(`[P2P] ⚠️  Connection timeout after 30s (state: ${state})`)
                }
            }, 30000)

            console.debug(`[P2P] ✅ P2P connection initiated to ${remoteIp}:${remotePort}`)
        } catch (error) {
            console.error(`[P2P] ❌ P2P connection error:`, error)
            this.ui.log(`P2P connection error: ${error.message}`, 'error')
        }
    }

    /**
     * Bind HTML event listeners to handlers
     */
    bindEvents() {
        // ========== Call Manager Events ==========
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
            console.debug(`[RECV] ✅ CALL ANSWERED by ${session.callee || session.answerer}`)
            this.ui.log(`📞 Call answered by ${session.callee || session.answerer}`, 'success')
            this.ui.updateCallStatus('answered', 'Call answered - connecting...')
            // Extract callee's connection data if available
            if (session.calleeIp && session.calleePort) {
                console.debug(`[RECV] Callee connection: ${session.calleeIp}:${session.calleePort}`)
                this.calleeConnectionData = {
                    address: session.calleeAddress,
                    ip: session.calleeIp,
                    port: session.calleePort,
                    sessionKey: session.calleeSessionKey
                }
                // Initiate direct P2P connection to callee using their connection data
                this.initiateP2PConnection(session.callTokenId, session.calleeAddress, session.calleeIp, session.calleePort)
            }
        })

        this.callManager.on('call:connected', () => {
            console.debug('[call:connected] Event listener fired!')
            this.ui.log('📞 Call connected! Media stream established', 'success')
            this.ui.updateCallStatus('connected', 'Call connected')
            console.debug('[call:connected] About to call showCallStats()')
            this.ui.showCallStats()
            console.debug('[call:connected] showCallStats() completed')
            this.callStartTime = Date.now()
            this.ui.startDurationTimer()
        })

        this.callManager.on('call:ended-session', (data) => {
            this.ui.log(`📞 Call ended. Duration: ${(data.duration/1000).toFixed(1)}s`, 'info')
            this.ui.resetCallUI()
            this.ui.stopDurationTimer()
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
            if (data.track.kind === 'video') {
                this.attachRemoteVideo(data.stream)
            }
        })

        // ========== Security Events ==========
        this.security.on('security:dtls-connected', () => {
            this.ui.log('🔒 DTLS encryption established', 'success')
            this.ui.updateEncryption('DTLS v1.2')
        })

        // ========== HTML Button Event Listeners ==========
        document.getElementById('initiateCallBtn')?.addEventListener('click', () => this.callHandlers.initializeCall())
        document.getElementById('acceptBtn')?.addEventListener('click', () => this.callHandlers.acceptCall())
        document.getElementById('rejectBtn')?.addEventListener('click', () => this.callHandlers.rejectCall())
        document.getElementById('endCallBtn')?.addEventListener('click', () => this.callHandlers.endCall())
        document.getElementById('mediaBtn')?.addEventListener('click', () => this.callHandlers.toggleMediaStream())
        document.getElementById('lastCalledBtn')?.addEventListener('click', () => this.quickDial())

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
    startBackgroundPolling() {
        // Start listening for incoming call inscriptions in background
        // This runs continuously so recipient can receive calls anytime
        const myAddress = document.getElementById('myAddress')?.value

        if (!window.inscriptionBuilder || !window.provider || !myAddress) {
            this.ui.log(`⏳ Waiting for wallet to load (will retry in 2s)...`, 'warning')
            setTimeout(() => this.startBackgroundPolling(), 2000)
            return
        }

        // Ensure signaling is initialized with wallet address BEFORE polling
        if (!this.signaling.myAddress) {
            this.signaling.myAddress = myAddress
        }

        try {
            const controller = this
            const seenTxIds = new Set()

            // Scan address history for SVphone call/answer inscriptions
            const scanInscriptionsFn = async (address) => {
                if (!address) return []

                const history = await window.provider.getAddressHistory()
                const results = []

                for (const { txId } of history) {
                    if (seenTxIds.has(txId)) continue
                    seenTxIds.add(txId)

                    try {
                        const tx = await window.provider.getSourceTransaction(txId)
                        const inscription = window.inscriptionBuilder.scanTxForCallInscription(tx, address)
                        if (inscription) {
                            results.push({ txId, inscription })
                        }
                    } catch (e) {
                        // Silently skip TXs that fail to fetch
                    }
                }

                return results
            }

            // Start polling (5 second interval)
            this.signaling.startPolling(scanInscriptionsFn)
            this.ui.log('📞 Background polling for incoming calls started', 'success')

            // Listen for incoming call events from signaling layer
            this.signaling.on('call:incoming', (data) => {
                console.debug(`[RECV] ✅ call:incoming event received:`, data)
                this.ui.log(`[RECV] 🔔 Signaling layer detected incoming call`, 'info')
                this.showIncomingCall(data.caller, data.callTokenId)
            })

            // Listen for call response events (callee accepted the call)
            this.signaling.on('call:answered', (data) => {
                console.debug(`[SEND] ✅ call:answered event received:`, data)
                this.ui.log(`[SEND] 🔔 Call answered! Recipient accepted the call`, 'success')

                // Recipient's connection info is in the event data
                if (data.calleeIp && data.calleePort) {
                    this.ui.log(`📍 Connecting to recipient at ${data.calleeIp}:${data.calleePort}`, 'info')
                    // Initiate P2P connection to the callee
                    this.initiateP2PConnection(data.callTokenId, data.callee, data.calleeIp, data.calleePort)
                } else {
                    console.warn(`[SEND] Missing callee connection info:`, data)
                    this.ui.log(`⚠️ Missing callee connection info`, 'warning')
                }
            })
        } catch (error) {
            this.ui.log('[BgPolling] Failed to start: ' + error.message, 'error')
        }
    }

    /**
     * Show incoming call UI
     */
    showIncomingCall(caller, callTokenId) {
        console.debug(`[RECV] ✅ INCOMING CALL DETECTED! Caller: ${caller}`)
        this.ui.showIncomingCall(caller)
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
window.phoneApp = phoneApp
