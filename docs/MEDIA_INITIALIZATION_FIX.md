# Media Initialization Fix - SVphone v06.04

**Commit**: d62419c

## Problem
When users clicked "Initiate Call" after successfully minting call tokens, the app would fail with error: **"Requested device not found"**. This prevented the call from proceeding even though tokens were successfully created and confirmed on the blockchain.

## Root Cause
The media initialization code in `peer_connection.js` was attempting to access the microphone and camera with **strict video constraints** (1280x720@30fps) without:
1. Proper permission dialog handling
2. Graceful fallback if video was unavailable
3. Clear error messages distinguishing between "device not found" vs "permission denied"

The browser's permission dialog wasn't appearing because the constraints were so strict they would fail before the dialog could be shown.

## Solution

### 1. Enhanced `peer_connection.js` - `initializeMediaStream()` Method

Implemented a **three-tier fallback strategy**:

```
Attempt 1: Audio+Video with ideal constraints (1280x720@30fps)
    ↓ (if fails with non-permission error)
Attempt 2: Audio+Video with relaxed constraints (any resolution/framerate)
    ↓ (if video still fails)
Attempt 3: Audio-only (microphone access required)
    ↓
    Success or throw error with user-friendly message
```

**Benefits**:
- Browser permission dialog appears at Attempt 1 (before constraints validation)
- Works with any camera resolution
- Gracefully downgrades to audio-only if camera unavailable
- Clear error messages for permission vs device errors

### 2. Updated `phone_interface.html` - Error Handling

#### `initializeCall()` Method
- Added detection for "Requested device not found" errors
- Automatically retries with `video: false` for audio-only calls
- User-friendly message: "⚠️ No microphone or camera found. Attempting audio-only call..."
- Success message: "✓ Audio-only call initiated"

#### `acceptCall()` Method
- Same audio-only fallback logic as initializeCall()
- Detects permission denied vs device missing
- Shows helpful messages for each error type

#### `toggleMediaStream()` Method
- Includes try-catch around initial media initialization
- Catches and retries with audio-only on device not found
- Shows specific message: "🎥 Video not available, using audio-only"
- Prompts to check browser settings if permission denied

## User Experience Flow

### Before Fix
```
Initiate Call
  ↓
Mint call tokens ✓
  ↓
Wait for confirmation ✓
  ↓
[ERROR] "Requested device not found"
  ↓
Call fails, user stuck
```

### After Fix
```
Initiate Call
  ↓
Mint call tokens ✓
  ↓
Wait for confirmation ✓
  ↓
Browser shows: "Allow this site to access your microphone and camera?"
  ↓
User grants permission or denies video
  ↓
If video denied: "⚠️ Attempting audio-only call..."
  ↓
Call connects with audio (or audio+video if permission granted) ✓
```

## Supported Scenarios

✅ **Audio+Video**: Both microphone and camera available, user grants permission
✅ **Audio-Only**: Microphone available, camera missing or permission denied for camera
✅ **Audio-Only (Permission Denied)**: User denies microphone permission on retry (fails gracefully)
✅ **Permission Denied Initial**: User denies microphone on first dialog (clear error message)

## Technical Changes

### File: `prototypes/SVphone_v06_04/src/sv_connect/peer_connection.js`

**Lines 57-95**: Replaced simple `getUserMedia()` call with multi-tier fallback:
1. Try with strict constraints
2. Catch and check if video-related (not permission)
3. Relax constraints and retry
4. If still fails and audio available, try audio-only
5. Throw clear error message for permission denied

### File: `prototypes/SVphone_v06_04/phone_interface.html`

**Lines 950-984**: Updated `initializeCall()` with error detection and audio-only retry
**Lines 1012-1060**: Updated `acceptCall()` with error detection and audio-only retry
**Lines 985-1020**: Updated `toggleMediaStream()` with graceful fallback

## Testing

To verify the fix works:

1. **Open browser console** (F12 → Console tab)
2. **Click "Initiate Call"**
3. **Look for permission dialog** - Should appear asking for microphone/camera access
4. **Options**:
   - Grant permission → Call proceeds with audio+video
   - Deny video, allow audio → Call proceeds with audio-only
   - Deny audio → Error message with helpful instructions

Console logs will show:
- `[PeerConnection] Media stream initialized with relaxed constraints:` (if using fallback)
- `[PeerConnection] Audio-only stream initialized:` (if no video available)
- Clear error if permission denied

## Backward Compatibility

✅ No breaking changes
✅ Existing audio+video calls still work
✅ Works with all modern browsers (Chrome, Firefox, Safari, Edge)
✅ Graceful degradation on devices without cameras

## Future Improvements

- Optional user preference: "Always use audio-only" setting
- Display which media types are active during call (video icon shows if camera in use)
- Remember user's past media permission choices
- Show audio level indicator when audio-only
