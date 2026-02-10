# SVphone Phone Interface

## Overview

The phone interface (`index.html`) provides a complete browser-based UI for testing SVphone v06.01 call functionality.

## Features

### Call Controls
- **Initiate Call**: Enter recipient address and start a call
- **Accept/Reject**: Handle incoming calls
- **End Call**: Terminate active calls
- **Quality Selection**: Choose preferred call quality (VHD/HD/SD/LD)
- **Media Control**: Start/stop camera and microphone

### Real-Time Statistics
- **Video Bitrate**: Current video transmission rate
- **Audio Bitrate**: Current audio transmission rate
- **Packet Loss**: Percentage of lost packets
- **Latency (RTT)**: Round-trip time
- **Available Bandwidth**: Estimated available bitrate
- **Jitter**: Variation in packet arrival times
- **Frame Rate**: Current video frame rate
- **Resolution**: Current video resolution

### Media Display
- **Local Video**: Your camera feed
- **Remote Video**: Caller's camera feed
- **Video Controls**: Mute/unmute, camera on/off

### Security Information
- **Encryption Status**: DTLS-SRTP encryption state
- **Audio Codec**: Codec being used for audio
- **Video Codec**: Codec being used for video
- **Quality Level**: Current call quality preset

### Debug Console
- **Real-time Logs**: All events logged with timestamps
- **Error Messages**: Errors and warnings displayed
- **Clear Console**: Reset log output

## User Flow

### Making a Call (Caller)

1. Enter your BSV address in "Your BSV Address"
2. Enter your public IP (auto-detected in production)
3. Click "Start Media" to enable camera/microphone
4. Enter recipient's BSV address
5. Select desired quality (HD recommended)
6. Click "📞 Initiate Call"
7. Wait for recipient to accept
8. Once connected, monitor statistics in real-time
9. Click "End Call" to terminate

### Receiving a Call (Callee)

1. Enter your BSV address
2. Incoming call notification appears
3. Click "Accept" to accept or "Reject" to decline
4. Once accepted, media stream connects automatically
5. Camera and microphone active
6. Monitor call statistics
7. Click "End Call" to terminate

## Call States

```
Caller:
  Ready → Initiating → Ringing → Connecting → Connected → Ended

Callee:
  Ready → Receiving → Accepting → Connecting → Connected → Ended
```

## Quality Presets

| Preset | Video Bitrate | Framerate | Resolution | Audio |
|--------|---------------|-----------|-----------|-------|
| **VHD** | 5 Mbps | 60 fps | 1920×1080 | 128 kbps |
| **HD** | 2.5 Mbps | 30 fps | 1280×720 | 64 kbps |
| **SD** | 500 kbps | 24 fps | 640×480 | 48 kbps |
| **LD** | 100 kbps | 15 fps | 320×240 | 24 kbps |

## Network Monitoring

The interface automatically monitors network conditions and updates statistics:

- **Bandwidth**: Shows available outgoing bitrate
- **Packet Loss**: Percentage of dropped packets
- **Latency**: Round-trip time in milliseconds
- **Quality Indicator**: Visual indicator of current quality level

Quality is automatically adjusted based on network conditions:
- If bandwidth drops, quality downgrades
- If packet loss increases, quality downgrades
- When conditions improve, quality upgrades

## Keyboard Shortcuts (Future Enhancement)

```
Space   - Toggle mute/unmute
V       - Toggle video on/off
E       - End call
A       - Accept incoming call
R       - Reject incoming call
Q       - Force quality level (cycle)
D       - Open debug console
```

## Troubleshooting

### Media Not Working
1. Check browser permissions for camera/microphone
2. Verify camera and microphone are not in use by other apps
3. Check console for "Media error" messages
4. Try different quality level

### No Incoming Calls
1. Verify BSV address is correct
2. Check blockchain polling is active (check console)
3. Verify recipient has your address
4. Check token minting succeeded (TX hash in logs)

### Poor Quality
1. Lower quality preset
2. Check available bandwidth
3. Move closer to WiFi router
4. Check for network congestion (other apps, downloads)

### Connection Issues
1. Check STUN server availability
2. Verify ICE candidates are collecting
3. Try different STUN server
4. Check firewall/NAT settings

## Testing Scenarios

### Local Loopback Test
1. Open interface in two browser tabs
2. Tab 1: Enter address "1A1z7agoat5dwrQvV" (caller)
3. Tab 2: Enter address "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" (callee)
4. Tab 1: Initiate call to Tab 2's address
5. Tab 2: Accept incoming call
6. Both tabs show connected status
7. Monitor statistics

### Network Degradation Test
1. Simulate network issues using browser DevTools
2. Throttle bandwidth (e.g., 500 kbps)
3. Add packet loss (e.g., 5%)
4. Watch quality automatically downgrade
5. Remove throttle and watch quality upgrade

### Codec Negotiation Test
1. Check console for codec selection
2. Verify both sides agree on codecs
3. Check SDP offer/answer exchange logs
4. Verify audio and video codecs match

## Browser Requirements

- **Chrome/Chromium**: 65+ (WebRTC support)
- **Firefox**: 55+ (WebRTC support)
- **Safari**: 11+ (WebRTC support)
- **Camera/Microphone**: Must be available and permitted

## Future Enhancements

- [ ] Real microphone/camera audio visualization
- [ ] Call recording
- [ ] Screen sharing
- [ ] Group calling (3+ participants)
- [ ] Call history storage
- [ ] Saved contacts
- [ ] Voicemail recording
- [ ] Call scheduling
- [ ] Advanced statistics dashboard
- [ ] Network simulation tools

## API Reference

### Window Object

The interface exposes `window.app` for testing:

```javascript
// Make a call
app.initializeCall()

// Accept/reject incoming call
app.acceptCall()
app.rejectCall()

// End active call
app.endCall()

// Toggle media
app.toggleMediaStream()

// Logging
app.log('Message', 'info')  // info, success, error, warning
app.clearConsole()

// Debugging
app.currentCallToken     // Current call token ID
app.currentRole          // 'caller' or 'callee'
app.callManager          // CallManager instance
app.quality              // QualityAdaptation instance
app.security             // MediaSecurity instance
```

## Development

### Adding Features

1. Modify `index.html` to add UI elements
2. Use `app.log()` for debugging
3. Access modules through `app.callManager`, `app.quality`, etc.
4. Update statistics display via `updateStats()` and related methods

### Testing Modules

Each module can be tested independently:

```javascript
// Test codec negotiation
const codecs = new CodecNegotiation()
const capabilities = codecs.getCodecCapabilities()

// Test quality adaptation
const quality = new QualityAdaptation()
quality.startMonitoring(peerConnection, peerId)

// Test security
const security = new MediaSecurity()
await security.initialize()
const encrypted = security.isEncrypted(peerConnection)
```

## File Structure

```
src/interface/
├── README.md           - This file
└── index.html         - Main browser interface
   └── [embedded JavaScript]
       ├── SVphoneApp class
       ├── Event handlers
       ├── UI updates
       └── Statistics monitoring
```
