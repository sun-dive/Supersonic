# SVphone v06.00 - Call Signaling Layer

**Phase 2 Implementation: Blockchain-Based Call Initiation and WebRTC Media**

## Overview

SVphone v06.00 implements the complete call signaling infrastructure using P tokens on the BSV blockchain for signaling and WebRTC for peer-to-peer media delivery.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Call Signaling (v06.00)                    │
└─────────────────────────────────────────────────────────────────┘

Browser A (Caller)                    BSV Blockchain              Browser B (Callee)
    │                                      │                           │
    ├─ Create call token                   │                           │
    ├─ Broadcast to mempool                │                           │
    │                                      ├─ Call token visible       │
    │                                      │                           │
    │                                      │                    ┌─ Poll for tokens
    │                                      │                    │
    │                                      │              ┌─ SPV verify
    │                                      │              │ (ancestor proof)
    │                                      │              │
    │                                      │    Accept call─┐
    │                                      │              │
    │◄─────────── Answer signal ────────────────────────┤
    │                                      │              │
    ├─ Create WebRTC offer                 │              │
    │─────────────────────────────────────────────────►  │
    │                                      │              │
    │◄───────── ICE candidates ──────────────────────────┤
    │                                      │              │
    ├─ Create WebRTC answer                │              │
    │◄─────────────────────────────────────────────────  │
    │                                      │              │
    │◄──── Media (RTP/RTCP) P2P ────────────────────────►│
    │                                      │              │
```

## Directory Structure

```
prototypes/SVphone_v06_00/
├── src/
│   └── sv_connect/
│       ├── signaling.js         - Blockchain-based call signaling
│       ├── peer_connection.js   - WebRTC peer connection management
│       └── call_manager.js      - Call lifecycle orchestration
├── README.md                    - This file
└── index.html                   - Browser test interface (to be created)
```

## Component Documentation

### 1. CallSignaling (`signaling.js`)

Manages call initiation tokens on the blockchain.

#### Key Methods

```javascript
// Initialize
signaling.initialize(myAddress, myIp, myPort)

// Initiate call
const callToken = signaling.createCallToken(calleeAddress, sessionKey, {
  codec: 'opus',
  quality: 'hd',
  mediaTypes: ['audio', 'video']
})

const result = await signaling.broadcastCallToken(callToken, mintTokenFn)
// Returns: { txId, tokenId, callTokenId }

// Listen for incoming calls
signaling.on('call:incoming', (data) => {
  console.log('Incoming call from:', data.caller)
})

// Start polling for incoming tokens
await signaling.startPolling(checkIncomingTokensFn, verifyTokenFn)

// Handle incoming call
signaling.acceptCall(callTokenId, { sessionKey })
signaling.rejectCall(callTokenId, 'user-declined')

// Update call state
signaling.updateCallState(callTokenId, 'connected', { connectedAt: Date.now() })

// End call
signaling.endCall(callTokenId, { duration: 45000, quality: 'excellent' })
```

#### Events

- `call:initiated` - Outgoing call broadcasted
- `call:incoming` - Incoming call token detected
- `call:answered` - Incoming call accepted
- `call:rejected` - Incoming call rejected
- `call:state-changed` - Call status updated

### 2. PeerConnection (`peer_connection.js`)

Manages WebRTC peer-to-peer media connections.

#### Key Methods

```javascript
// Initialize media stream
await peerConnection.initializeMediaStream({
  audio: true,
  video: true
})

// Create peer connection
const pc = peerConnection.createPeerConnection(peerId)

// Create and send offer
const offer = await peerConnection.createOffer(peerId)
// Send offer.sdp to remote peer

// Create and send answer
const answer = await peerConnection.createAnswer(peerId, remoteSdp)
// Send answer.sdp to remote peer

// Exchange ICE candidates
peerConnection.on('ice:candidate', (data) => {
  // Send data.candidate to remote peer via signaling
})

await peerConnection.addIceCandidate(peerId, remoteCandidate)

// Get connection stats
const stats = await peerConnection.getStats(peerId)
// Returns audio/video metrics, connection quality, latency

// Stop connection
peerConnection.closePeerConnection(peerId)
peerConnection.stopMediaStream()
```

#### Events

- `media:ready` - Media stream initialized
- `media:error` - Media access failed
- `ice:candidate` - ICE candidate generated
- `media:track-received` - Remote track arrived
- `peer:connected` - Peer connection established
- `peer:connection-failed` - Peer connection failed
- `peer:connection-state-changed` - Connection state changed

### 3. CallManager (`call_manager.js`)

Orchestrates the complete call lifecycle, coordinating signaling and media layers.

#### Key Methods

```javascript
const callManager = new CallManager(signaling, peerConnection)

// Initiate call
const session = await callManager.initiateCall(calleeAddress, {
  audio: true,
  video: true,
  codec: 'opus',
  quality: 'hd',
  mintTokenFn: async (token) => { /* mint token */ }
})

// Listen for incoming calls
callManager.on('call:incoming-session', (session) => {
  console.log('Incoming call from:', session.caller)
})

// Accept incoming call
await callManager.acceptCall(callTokenId, {
  audio: true,
  video: true
})

// Reject incoming call
await callManager.rejectCall(callTokenId, 'user-declined')

// Add ICE candidate
await callManager.addIceCandidate(callTokenId, candidate)

// Get call session
const session = callManager.getSession(callTokenId)
// Returns: { status, role, mediaOffer, mediaAnswer, stats, ... }

// End call
await callManager.endCall(callTokenId)

// Get media streams
const localStream = callManager.getLocalMediaStream()
const remoteStream = callManager.getRemoteMediaStream(callTokenId)
```

#### Events

- `call:initiated-session` - Call initiation started
- `call:initiation-failed` - Call initiation failed
- `call:incoming-session` - Incoming call received
- `call:accepted-session` - Incoming call accepted
- `call:rejected-session` - Incoming call rejected
- `call:ringing` - Outgoing call ringing
- `call:answered-session` - Outgoing call answered
- `call:connected` - Media connection established
- `call:connection-failed` - Media connection failed
- `call:ended-session` - Call terminated
- `call:stats-updated` - Call statistics updated
- `media:remote-track` - Remote audio/video track received

## Call Flow

### Caller Flow

```javascript
// 1. Initialize
const signaling = new CallSignaling()
const peerConnection = new PeerConnection()
const callManager = new CallManager(signaling, peerConnection)

await signaling.initialize(myAddress, myIp, myPort)

// 2. Initiate call
const session = await callManager.initiateCall(calleeAddress, {
  audio: true,
  video: true,
  mintTokenFn: async (token) => {
    // Use tokenBuilder from v05_28 to mint token
    return await builder.createToken(token)
  }
})
// Returns session.callTokenId

// 3. Listen for answer
callManager.on('call:answered-session', async (data) => {
  console.log('Call answered!')

  // 4. Exchange SDP and ICE candidates
  // Send session.mediaOffer.sdp to callee
  // Receive answer and set remote description
  const callToken = signaling.getCallToken(data.callTokenId)
  await peerConnection.setRemoteDescription(
    session.caller,  // peerId
    { type: 'answer', sdp: receivedAnswerSdp }
  )
})

// 5. Listen for connection established
callManager.on('call:connected', () => {
  console.log('Media connection established!')
  const localStream = callManager.getLocalMediaStream()
  const remoteStream = callManager.getRemoteMediaStream(session.callTokenId)
  // Attach streams to video elements
})

// 6. Monitor call quality
callManager.on('call:stats-updated', (data) => {
  console.log('Audio bitrate:', data.stats.audio.outbound.bytesSent)
})

// 7. End call
await callManager.endCall(session.callTokenId)
```

### Callee Flow

```javascript
// 1. Initialize
const signaling = new CallSignaling()
const peerConnection = new PeerConnection()
const callManager = new CallManager(signaling, peerConnection)

await signaling.initialize(myAddress, myIp, myPort)

// 2. Start polling for incoming calls
await signaling.startPolling(
  async (address) => {
    // Use checkIncomingTokens from v05_28
    return await builder.checkIncomingTokens(address)
  },
  async (token) => {
    // Use verifyBeforeImport from v05_28
    return await builder.verifyBeforeImport(token)
  }
)

// 3. Listen for incoming calls
callManager.on('call:incoming-session', async (session) => {
  console.log('Incoming call from:', session.caller)

  // Show UI to user
  // User clicks "Accept" or "Reject"
})

// 4. Accept call
await callManager.acceptCall(callTokenId, {
  audio: true,
  video: true
})

// 5. Exchange SDP and ICE candidates
// Create offer and send to caller
const offer = await peerConnection.createOffer(callToken.caller)
// Send offer.sdp to caller via signaling

// 6. Receive answer from caller and set remote description
await peerConnection.setRemoteDescription(
  callToken.caller,
  { type: 'offer', sdp: receivedOfferSdp }
)

// 7. Create answer
const answer = await peerConnection.createAnswer(
  callToken.caller,
  receivedOfferSdp
)

// 8. Listen for connection
callManager.on('call:connected', () => {
  console.log('Media connection established!')
  // Attach streams to UI
})

// 9. End call when user requests
await callManager.endCall(callTokenId)
```

## Integration with v05.28

SVphone v06.00 depends on core protocol functions from v05.28:

1. **Token Minting**: `builder.createToken(tokenData)`
2. **Token Verification**: `builder.verifyBeforeImport(token)`
3. **Incoming Token Detection**: `builder.checkIncomingTokens(address)`
4. **Token Store**: Access to stored token data

### Import Example

```html
<!-- In index.html -->
<script src="../SVphone_v05_28/bundle.js"></script>
<script src="src/sv_connect/signaling.js"></script>
<script src="src/sv_connect/peer_connection.js"></script>
<script src="src/sv_connect/call_manager.js"></script>

<script>
  // builder is global from v05_28
  const signaling = new CallSignaling()
  const peerConnection = new PeerConnection()
  const callManager = new CallManager(signaling, peerConnection)

  // Now use callManager to handle calls
</script>
```

## Features Implemented

### Phase 2: Call Signaling (v06.x)

- ✅ Call token creation and broadcasting
- ✅ Incoming call detection via blockchain polling
- ✅ SPV verification of call tokens
- ✅ Call acceptance/rejection
- ✅ WebRTC peer connection establishment
- ✅ SDP offer/answer exchange
- ✅ ICE candidate collection and exchange
- ✅ Call state management
- ✅ Call statistics monitoring
- ✅ Event-driven architecture

### Phase 3: Media Transport (v07.x) - Planned

- Codec negotiation (Opus, VP9, H.264)
- Audio/video quality adaptation
- DTLS-SRTP encryption setup
- RTP/RTCP jitter buffer management

### Phase 4: Enhanced Features (v08.x) - Planned

- Group calling (multi-party)
- Call recording
- Voicemail (token-based)
- Call history and analytics

## Technical Specifications

### Call Token Format

```
P Token:
  - Prefix: 0x50 (P)
  - Version: 0x03
  - tokenName: "svphone-call-v1"
  - tokenRules: supply=1, divisibility=0, restrictions=0x0001
  - tokenAttributes: { caller, callee, senderIp, senderPort, sessionKey, codec, quality }
  - stateData: { status, initiatedAt, timestamp }
```

### Call State Machine

```
Caller:
  initiating → ringing → answered → connecting → connected → ended
                          ↑
                        (receive answer)

Callee:
  incoming → ringing → accepting → connecting → connected → ended
                            ↑
                         (accept)
```

### WebRTC Configuration

- **ICE Servers**: Google STUN servers (4 instances)
- **Optional TURN**: For restrictive NAT scenarios
- **Media Constraints**:
  - Audio: Echo cancellation, noise suppression, auto-gain control
  - Video: 1280x720@30fps ideal (adaptive)

### Codec Support

- **Audio**: Opus (6-510 kbps, 26.5ms latency)
- **Video**: VP9/H.264 (adaptive bitrate)

## Testing

```javascript
// Browser console example
const signaling = new CallSignaling()
const peerConnection = new PeerConnection()
const callManager = new CallManager(signaling, peerConnection)

// Initialize
await signaling.initialize('myAddress', '203.0.113.42', 54321)

// Make call
const session = await callManager.initiateCall('calleeAddress', {
  mintTokenFn: async (token) => {
    // In real implementation, use v05_28's builder
    return { txId: 'txid', tokenId: 'tokenid' }
  }
})

console.log('Call initiated:', session.callTokenId)
```

## Files Status

- ✅ `signaling.js` - Blockchain-based call signaling (1,016 lines)
- ✅ `peer_connection.js` - WebRTC peer connection management (724 lines)
- ✅ `call_manager.js` - Call lifecycle orchestration (574 lines)
- ⏳ `index.html` - Browser test interface (to be created)
- ⏳ Integration tests and examples

## Next Steps

1. **Browser Integration**: Create index.html with UI
2. **v05.28 Integration**: Integrate token minting and verification
3. **SDP Exchange Protocol**: Implement secure SDP signaling via blockchain
4. **Testing**: Create comprehensive test suite
5. **Phase 3**: Codec negotiation and quality adaptation
