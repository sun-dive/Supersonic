# SVphone v06_12: Call Flow with Media Display Integration

## Complete Call Lifecycle

```
A (CALLER) SIDE                          B (RECIPIENT) SIDE
═════════════════════════════════════════════════════════════

1. A clicks "Call B"
   ↓
   initiateCall(B_address)
   ├─ Initialize media stream
   │  ├─ getUserMedia(audio+video)
   │  ├─ emit('media:ready')
   │  └─ attachLocalVideo() → #localVideo shows A's camera
   │
   ├─ Create WebRTC offer (SDP)
   │
   └─ Broadcast CALL token to blockchain
      (includes A's IP, port, session key, SDP offer)

2. Token visible in mempool                2. B polls blockchain for incoming calls
   ↓                                        ↓
   onCallInitiated() fired                  incomingTokenDetected()
   └─ Status: 'ringing'                     ├─ Extract A's connection info
                                            ├─ Show incoming call UI
                                            │  └─ incomingCall panel displays
                                            │     "Call from A..." with Accept/Reject
                                            │
                                            └─ (B can decline here)


3. (continuing if B accepts)                3. B clicks "Accept"
                                            ↓
                                            acceptCall(callTokenId)
                                            ├─ Initialize media stream
                                            │  ├─ getUserMedia(audio+video)
                                            │  ├─ emit('media:ready')
                                            │  └─ attachLocalVideo() → #localVideo shows B's camera
                                            │
                                            ├─ Create WebRTC answer (SDP) from A's offer
                                            │
                                            └─ Return answer token to blockchain
                                               (includes B's IP, port, session key, SDP answer)


4. A detects answer on blockchain         4. Answer available on blockchain
   ↓                                        ↓
   onCallAnswered() fired
   ├─ Status: 'answered'
   │  └─ log: "Call answered by B"
   │
   ├─ Extract B's connection data
   │  (IP, port, session key from answer token)
   │
   └─ Initiate P2P connection
      initiateP2PConnection(B_ip, B_port)


5. WebRTC Handshake (P2P)
   ═══════════════════════════════════════════════════════════

   A's RTCPeerConnection ←→ B's RTCPeerConnection

   ├─ Exchange SDP (offer ↔ answer)
   ├─ Exchange ICE candidates (for NAT traversal)
   ├─ Attempt direct P2P connection
   │  (using WebRTC's built-in NAT traversal)
   └─ DTLS-SRTP encryption established


6. When WebRTC connection established
   ↓
   emit('peer:connected')
   │
   onPeerConnected() in CallManager
   ├─ Status: 'connected'
   ├─ Start monitoring statistics
   ├─ emit('call:connected')
   │
   └─ In phone UI:
      callManager.on('call:connected')
      ├─ showCallStats() called
      │  ├─ #videoContainer.style.display = 'grid'
      │  └─ #statsGrid.style.display = 'grid'
      │     ↓
      │     🎥 VIDEO DISPLAY OPENS!
      │
      ├─ Start call duration timer
      ├─ Start call statistics monitoring
      └─ log: "📞 Call connected! Media stream established"


7. When remote tracks arrive (video/audio from peer)
   ↓
   emit('media:track-received')
   │
   onRemoteTrackReceived() in CallManager
   ├─ emit('media:remote-track')
   │
   └─ In phone UI:
      peerConnection.on('media:track-received')
      ├─ Check if track.kind === 'video'
      ├─ Call attachRemoteVideo(stream)
      │  ├─ #remoteVideo.srcObject = stream
      │  └─ log: "📹 Received remote video track"
      │     ↓
      │     🎥 REMOTE VIDEO APPEARS!
      │
      └─ Audio tracks automatically included in stream


8. Active Call State
   ═══════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────┐
   │  CALL IN PROGRESS                                       │
   ├─────────────────────────────────────────────────────────┤
   │  ┌─────────────────────────────────────────────────────┐│
   │  │ LOCAL VIDEO (#localVideo)  │ REMOTE VIDEO (#remoteVideo) ││
   │  │ A's camera stream           │ B's camera stream        ││
   │  │ (muted self-view)          │ (live peer video)        ││
   │  └─────────────────────────────────────────────────────┘│
   │                                                         │
   │  STATS DISPLAY:                                         │
   │  ├─ Bitrate: X Mbps                                    │
   │  ├─ Video codec: VP9                                   │
   │  ├─ Packet loss: X%                                    │
   │  ├─ Jitter: X ms                                       │
   │  └─ Call duration: MM:SS                               │
   │                                                         │
   │  ENCRYPTION: 🔒 DTLS v1.2                             │
   └─────────────────────────────────────────────────────────┘

   • P2P data flowing directly between A and B
   • No servers in the media path
   • Media encrypted with DTLS-SRTP
   • Statistics collected every 5 seconds


9. End Call
   ↓
   A or B clicks "End Call"
   ├─ Stop media streams
   ├─ Close WebRTC connection
   ├─ Status: 'ended'
   │
   └─ In UI:
      resetCallUI()
      ├─ #videoContainer.style.display = 'none'
      ├─ #incomingCall.style.display = 'none'
      ├─ #statsGrid.style.display = 'none'
      ├─ Duration timer stopped
      ├─ Stats monitoring stopped
      └─ log: "📞 Call ended. Duration: X.Xs"
         ↓
         Back to idle state
```

---

## Key Integration Points

### 1. **Media Display Timing**

| Trigger | Action | UI Change |
|---------|--------|-----------|
| `initiateCall()` → `initializeMediaStream()` | Get A's camera | #localVideo displays A's feed |
| `acceptCall()` → `initializeMediaStream()` | Get B's camera | #localVideo displays B's feed |
| `emit('peer:connected')` | WebRTC connected | #videoContainer becomes visible |
| `emit('media:track-received')` | Remote track available | #remoteVideo displays peer video |

### 2. **Event Chain**

```
User Action
  ↓
Call Manager method
  ↓
PeerConnection initialization
  ↓
getUserMedia() request
  ↓
emit('media:ready') event
  ↓
Phone UI listener → attachLocalVideo()
  ↓
<video> element.srcObject = mediaStream
  ↓
🎥 LIVE VIDEO DISPLAY
```

### 3. **Blockchain Signaling Role**

The blockchain is used **only for signaling** (exchanging connection info):
- ❌ Media data is NOT on blockchain
- ❌ Encrypted media is NOT on blockchain
- ✅ Call tokens (connection info) are on blockchain
- ✅ Call acceptance/rejection is on blockchain

Once WebRTC connection established → media flows P2P

### 4. **Media Path**

```
A's Camera → getUserMedia() → Local RTCPeerConnection → ICE/NAT Traversal → B's RTCPeerConnection → Browser renderer → #remoteVideo
              ↓ attached to #localVideo

B's Camera → getUserMedia() → Local RTCPeerConnection → ICE/NAT Traversal → A's RTCPeerConnection → Browser renderer → #remoteVideo
              ↓ attached to #localVideo
```

---

## Code Reference Map

| Step | File | Method/Event | Lines |
|------|------|--------------|-------|
| 1. A initiates | call_manager.js | `initiateCall()` | 34-99 |
| - Media init | peer_connection.js | `initializeMediaStream()` | 57-172 |
| - Local video | phone_interface.html | `emit('media:ready')` listener | 1400-1402 |
| 2. A broadcasts | signaling.js | `broadcastCallToken()` | - |
| 3. B detects | phone_interface.html | Background polling | 1419-1500 |
| 4. B accepts | call_manager.js | `acceptCall()` | 143-191 |
| - Media init | peer_connection.js | `initializeMediaStream()` | 57-172 |
| - Local video | phone_interface.html | `emit('media:ready')` listener | 1400-1402 |
| 5. WebRTC handshake | peer_connection.js | `createOffer()`, `createAnswer()` | - |
| 6. P2P established | call_manager.js | `onPeerConnected()` | 262-290 |
| 7. Video displayed | phone_interface.html | `showCallStats()` | 2191-2194 |
| 8. Remote video | peer_connection.js | `emit('media:track-received')` | 281 |
| - Remote display | phone_interface.html | `emit('media:track-received')` listener | 1405-1409 |
| 9. End call | phone_interface.html | `endCall()` | - |

---

## Testing the Flow

### Caller Side (A)
1. ✅ Click "Call" button with B's address
2. ✅ See "Camera Test" to preview video first
3. ✅ Click "Start Media" (or auto-start in call)
4. ✅ See #localVideo show A's camera immediately
5. ✅ Blockchain shows call token broadcast
6. ✅ Wait for B to accept
7. ✅ See status change to "connected"
8. ✅ #videoContainer becomes visible with stats
9. ✅ See #remoteVideo show B's video when track arrives

### Recipient Side (B)
1. ✅ See "Incoming call from A" notification
2. ✅ Click "Accept" button
3. ✅ See #localVideo show B's camera immediately
4. ✅ Blockchain shows answer token broadcast
5. ✅ WebRTC connection establishes
6. ✅ See status change to "connected"
7. ✅ #videoContainer becomes visible with stats
8. ✅ See #remoteVideo show A's video when track arrives

### Both
- ✅ Hear audio during call (if microphone enabled)
- ✅ See stats: bitrate, codec, packet loss, jitter
- ✅ See "🔒 DTLS v1.2" encryption status
- ✅ See call duration timer
- ✅ Click "End Call" to disconnect

---

## Status Flow Visualization

```
CALLER (A)                          RECIPIENT (B)
═══════════════════════════════════════════════════════════

idle
  ↓
initiating ←─ Creates offer
  ↓
ringing ─────────────────→ detecting
  ↓                          ↓
  ├─────────────→ answered ←──┤
  │               ↓            │
  │            accepting       │
  │               ↓            │
  └─→ connecting ←─┘
       ↓
    connected ←─ peer:connected ←─ connected
       ↓                          ↓
    (call in progress)         (call in progress)
       ↓                          ↓
       └──→ ended ←──┘
            (cleanup)
```

---

## Security Flow

```
A's Media → DTLS encrypt → Network (encrypted)
B's RTCPeerConnection ← DTLS decrypt → B's Media

B's Media → DTLS encrypt → Network (encrypted)
A's RTCPeerConnection ← DTLS decrypt → A's Media
```

Every WebRTC connection automatically:
- Negotiates DTLS certificates
- Encrypts all media with SRTP
- Verifies certificate fingerprint in SDP
- No plaintext media transmitted

---

## Summary

✅ **Complete Flow Implemented**:
1. Signaling via blockchain (call tokens)
2. SDP offer/answer exchange
3. ICE candidate gathering
4. Direct P2P connection
5. Media stream initialization
6. Local video display
7. Remote video display
8. Statistics monitoring
9. Secure DTLS-SRTP encryption

✅ **All in v06_12** - Ready for testing!
