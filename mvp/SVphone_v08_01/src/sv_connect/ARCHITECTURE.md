# SVphone Call Signaling Layer (sv_connect) - Architecture

## Overview

This directory contains **SVphone-specific customizations** built on top of the pure WebRTC implementation.

**Architecture:**
```
Original WebRTC (../WebRTC/)
    ↓
SVphone Customizations (this directory)
    ├── signaling.js     (Blockchain-based call token management)
    ├── peer_connection.js (Unchanged copy of WebRTC - for reference)
    └── call_manager.js  (SVphone orchestration layer)
```

## Components

### 1. signaling.js (SVphone-Specific)
**Blockchain-based call token signaling** - Replaces traditional WebSocket signaling.

**Custom Features:**
- Creates call initiation tokens with connection metadata (IP, port, session key)
- Broadcasts tokens to BSV blockchain mempool
- Polls blockchain for incoming call tokens
- SPV verification of tokens (ancestor proof + genesis header validation)
- Event emission for call lifecycle (initiated, incoming, answered, rejected, ended)

**No WebRTC knowledge** - This is pure SVphone protocol.

### 2. peer_connection.js (Reference Only)
**Copy of original WebRTC implementation** (see ../WebRTC/peer_connection.js)

**Purpose:**
- Kept for reference during development
- Ensures sv_connect has standalone copies of dependencies
- Can be deleted and re-imported if needed

**Note:** Future updates should reference ../WebRTC/peer_connection.js instead

### 3. call_manager.js (SVphone-Specific)
**Orchestrates between blockchain signaling and WebRTC media layers.**

**Features:**
- Coordinates call lifecycle (initiation → ringing → answered → connecting → connected)
- Binds signaling events to peer connection events
- Manages active call sessions
- Handles call acceptance, rejection, termination
- Provides unified API for calling

**SVphone Integration:**
- Uses `signaling.js` for blockchain call tokens
- Uses `peer_connection.js` for media connections
- Bridges the two layers

## Separation of Concerns

| Component | Type | Dependency | Purpose |
|-----------|------|-----------|---------|
| **WebRTC/peer_connection.js** | Original | Standard browser APIs | P2P media connection |
| **sv_connect/signaling.js** | Custom | Token protocol + blockchain | Call signaling via blockchain |
| **sv_connect/call_manager.js** | Custom | Both above | Unified call interface |

## Development Guidelines

### When to Modify Each File

**WebRTC/peer_connection.js:**
- Only when upgrading WebRTC standard
- Bug fixes in media connection
- Performance improvements in ICE gathering
- Changes to statistics collection

**sv_connect/signaling.js:**
- New blockchain-based signaling features
- Token format changes
- SPV verification logic
- Call token metadata

**sv_connect/call_manager.js:**
- Call lifecycle improvements
- Session management
- Event coordination
- Error handling

### Code Review Checklist

When modifying sv_connect:

- [ ] Does this change belong in WebRTC layer? → Move to ../WebRTC/
- [ ] Is this SVphone-specific? → Keep in sv_connect
- [ ] Does it modify peer_connection.js? → Update ../WebRTC/ instead
- [ ] Are events properly chained between layers?
- [ ] Is error handling consistent?

## Future Improvements

### Phase 1: Decouple peer_connection.js
Remove the copy in sv_connect and import from WebRTC:

```javascript
// Instead of copying, import:
const PeerConnection = require('../WebRTC/peer_connection.js');
```

### Phase 2: Extend with Custom Features
If SVphone needs custom media handling:
- Create `sv_connect/extensions/custom_peer_connection.js`
- Extend PeerConnection class
- Add SVphone-specific logic

### Phase 3: Plugin Architecture
Allow peer_connection implementations to be swapped:
- WebRTC (P2P, current)
- SFU (selective forwarding for groups)
- Traditional SIP/VoIP
- Others via plugin interface

## Event Flow

```
User initiates call
    ↓
CallManager.initiateCall()
    ↓
Signaling.createCallToken() ← Creates P token with connection data
    ↓
Token broadcast to blockchain
    ↓
CallManager receives "call:initiated" event
    ↓
PeerConnection initializes media streams
    ↓
PeerConnection creates SDP offer
    ↓
Callee receives token via blockchain polling
    ↓
Signaling verifies token (SPV)
    ↓
CallManager receives "call:incoming" event
    ↓
Callee accepts call
    ↓
CallManager.acceptCall()
    ↓
Signaling creates response token (contains callee's IP:port)
    ↓
Caller receives response token
    ↓
Signaling emits "call:answered" event with callee connection data
    ↓
PeerConnection exchanges SDP (offer/answer)
    ↓
ICE candidates exchanged
    ↓
P2P connection established
    ↓
CallManager emits "peer:connected" event
    ↓
Audio/video streams flowing
```

## Testing Considerations

### Unit Tests
- `signaling.js`: Token creation, verification, event emission
- `call_manager.js`: Call lifecycle state transitions
- `peer_connection.js`: See ../WebRTC/ (imported)

### Integration Tests
- Blockchain → Signaling → CallManager → PeerConnection
- End-to-end call flow with real tokens
- SPV verification with actual blockchain data
- Media connection with real STUN servers

### Performance Baselines
- Token broadcast latency (<5s)
- Call acceptance latency (<2s after token confirmation)
- P2P media connection time (<500ms)
- Media quality metrics (bandwidth, packet loss, RTT)

## References

- **WebRTC**: See ../WebRTC/README.md
- **P Token Protocol**: See ../../token_protocol/
- **SVphone Architecture**: See ../../../docs/
