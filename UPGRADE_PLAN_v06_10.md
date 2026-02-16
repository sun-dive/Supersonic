# Upgrade Plan: v06_10 ← v06_09 + v06_08 (Selected Features)

## Strategy

**Baseline**: v06_10 starts from v06_09 (clean, working)
**Source**: Selectively integrate features from v06_08
**Goal**: Add P2P capability without introducing bugs

---

## Features to Integrate (In Order)

### ✅ SAFE TO ADD - No Known Issues

#### 1. **Address Hashing** (call_token.js)
- **From**: v06_08 call_token.js lines 138-150 + 190-196
- **What it does**: Encodes caller/callee addresses in token restrictions field
- **Status**: ✅ Works correctly, improves token security
- **Integration**: Add `hashAddress()` method + update `createAndBroadcastCallToken()`
- **Testing**: Check that restrictions field has 16 hex chars
- **Risk**: LOW - isolated feature, no side effects

#### 2. **Response Token Parsing** (signaling.js)
- **From**: v06_08 signaling.js lines 547-720 (`handleCallResponse()` method)
- **What it does**: Binary parsing of response token stateData with validation
- **Status**: ✅ Works correctly, required for Phone A to get Phone B's connection info
- **Integration**: Replace entire `handleCallResponse()` method
- **Testing**: Verify response tokens parse without errors, emits correct event data
- **Risk**: LOW - replaces existing code with better version

#### 3. **SDP Offer Pre-broadcast** (call_manager.js)
- **From**: v06_08 call_manager.js lines 45-95 (first part of `initiateCall()`)
- **What it does**: Creates SDP offer BEFORE broadcasting token so callee can retrieve it
- **Status**: ✅ Works correctly, required for WebRTC handshake
- **Integration**: Modify `initiateCall()` to create offer before broadcast
- **Testing**: Verify SDP offer included in token, callee can retrieve it
- **Risk**: LOW - adds pre-broadcast step, doesn't break existing logic

#### 4. **Active Call Panel UI** (phone_interface.html)
- **From**: v06_08 phone_interface.html CSS + methods (lines 639-900+)
- **What it does**: Full-screen call interface with media panels
- **Status**: ✅ UI works correctly
- **Integration**: Add CSS styles + `initiateP2PConnection()` method + UI HTML
- **Testing**: Verify UI displays, controls work
- **Risk**: LOW - purely UI addition, no behavioral changes

#### 5. **Diagnostic Logging** (phone_interface.html)
- **From**: v06_08 phone_interface.html `acceptCall()` method
- **What it does**: `[SEND]` logs for response token encoding/transfer
- **Status**: ✅ Works correctly, essential for debugging
- **Integration**: Add logging to `acceptCall()` method
- **Testing**: Verify console shows `[SEND]` logs during call acceptance
- **Risk**: LOW - logging only, no behavior changes

---

### ❌ DO NOT ADD - Known Bugs

#### **Reusable Token Feature** (phone_interface.html)
- **From**: v06_08 phone_interface.html lines 1984-2026
- **What it does**: Attempts to reuse existing tokens for same recipient
- **Status**: ❌ BUGGY - tokens can only transfer once, reuse fails
- **Why it's bad**: Finds used token, tries to transfer again, silently fails
- **Decision**: SKIP entirely, always create new tokens
- **Alternative**: In v06_10, always mint new token per call (v06_09 approach)

---

## Integration Order

1. **Phase 1**: Add address hashing (safe, isolated)
2. **Phase 2**: Add SDP offer pre-broadcast (needed for WebRTC)
3. **Phase 3**: Add response token parsing (needed to extract connection data)
4. **Phase 4**: Add P2P connection setup (`initiateP2PConnection()`)
5. **Phase 5**: Add Active Call Panel UI
6. **Phase 6**: Add diagnostic logging

---

## Phase 1: Address Hashing

**File**: `prototypes/SVphone_v06_10/src/sv_connect/call_token.js`

### Add Method
Copy from v06_08, lines 138-150:
```javascript
async hashAddress(address) {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(address)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => ('0' + b.toString(16)).slice(-2)).join('')
    return hashHex.substring(0, 8)
  } catch (error) {
    console.error(`[CallToken] Failed to hash address:`, error)
    return '00000000'
  }
}
```

### Modify createAndBroadcastCallToken()
In `createGenesis()` call, after encoding attributes (v06_08 lines 190-196):
```javascript
// Compute address hashes for restrictions field
const callerHash = await this.hashAddress(callToken.caller)
const calleeHash = await this.hashAddress(callToken.callee)
const restrictionsHash = callerHash + calleeHash
console.debug(`[CallToken] Restrictions field: ${restrictionsHash}`)

// Then pass to createGenesis:
restrictions: restrictionsHash,
```

**Test**: Verify token restrictions field is 16 hex characters

---

## Phase 2: SDP Offer Pre-broadcast

**File**: `prototypes/SVphone_v06_10/src/sv_connect/call_manager.js`

### Modify initiateCall()
Move SDP offer creation from AFTER broadcast to BEFORE:

```javascript
async initiateCall(calleeAddress, options = {}) {
  // 1. Create SDP offer FIRST
  let mediaOffer = null
  try {
    mediaOffer = await this.peerConnection.createOffer(calleeAddress)
    callToken.mediaOffer = mediaOffer  // Store in token
  } catch (error) {
    console.warn('[CallManager] Failed to create media offer:', error)
  }

  // 2. THEN broadcast token
  const broadcastResult = await this.signaling.broadcastCallToken(callToken, options.mintTokenFn)

  // ... rest of method
}
```

**Test**: Verify SDP offer exists before broadcast, callee can retrieve

---

## Phase 3: Response Token Parsing

**File**: `prototypes/SVphone_v06_10/src/sv_connect/signaling.js`

### Replace handleCallResponse()
Copy entire method from v06_08 lines 547-720

**Key features**:
- Validates stateData exists
- Extracts all binary fields with bounds checking
- Emits `call:answered` event with full data
- Comprehensive error logging

**Test**: Verify response tokens parse, event includes all fields

---

## Phase 4: P2P Connection Setup

**File**: `prototypes/SVphone_v06_10/phone_interface.html`

### Add Method: initiateP2PConnection()
From v06_08 lines 2464-2525:
```javascript
async initiateP2PConnection(callTokenId, remoteAddress, remoteIp, remotePort, remoteSdpAnswer = null) {
  // Get peer connection
  // Create offer (if not already done)
  // Apply remote answer
  // Gather ICE candidates
  // Show media panels
}
```

### Add Response Listener
```javascript
this.signaling.on('call:answered', (data) => {
  console.debug(`[RECV] ✅ call:answered event received:`, data)
  if (data.calleeIp && data.calleePort) {
    this.initiateP2PConnection(
      data.callTokenId,
      data.callee,
      data.calleeIp,
      data.calleePort,
      data.sdpAnswer
    )
  }
})
```

**Test**: Verify P2P connection attempts after receiving response

---

## Phase 5: Active Call Panel UI

**File**: `prototypes/SVphone_v06_10/phone_interface.html`

### Add CSS
From v06_08 lines 639-900: All `.active-call-panel`, `.call-header`, media element styles

### Add HTML Structure
In phone_interface.html, add container for call panel (initially hidden)

**Test**: Verify UI displays on active call

---

## Phase 6: Diagnostic Logging

**File**: `prototypes/SVphone_v06_10/phone_interface.html`

### Add Logging to acceptCall()
From v06_08 lines 2301-2357:
```javascript
console.debug(`[SEND] ✅ Response encoded to ${responseStateHex.length / 2} bytes`)
console.debug(`[SEND] Response state hex (full):`, responseStateHex)
console.debug(`[SEND] About to transfer token with stateData:`, {...})
console.debug(`[SEND] Calling createTransfer with:`, {...})
```

**Test**: Verify `[SEND]` logs appear in console

---

## Testing Checklist

### After Each Phase
- [ ] Code compiles/loads without errors
- [ ] Console shows no JavaScript errors
- [ ] Feature-specific logging appears

### Full Integration Test (After All Phases)
- [ ] Phone A calls Phone B
- [ ] Token is minted and transferred
- [ ] Phone B receives call notification
- [ ] Phone B accepts call
- [ ] Phone A receives response token
- [ ] P2P connection establishes
- [ ] Both phones show active call panel
- [ ] Media flows (audio/video)

---

## Files to Modify

1. `prototypes/SVphone_v06_10/src/sv_connect/call_token.js` (Phase 1)
2. `prototypes/SVphone_v06_10/src/sv_connect/call_manager.js` (Phase 2)
3. `prototypes/SVphone_v06_10/src/sv_connect/signaling.js` (Phase 3)
4. `prototypes/SVphone_v06_10/phone_interface.html` (Phases 4, 5, 6)

---

## What We're NOT Copying from v06_08

- ❌ Reusable token feature (has bugs)
- ❌ PPV model changes (not needed for P2P testing)
- ❌ Any unused/orphaned methods
- ❌ Experimental features with issues

---

## References

**v06_08 Source Code**:
- `prototypes/SVphone_v06_08/phone_interface.html`
- `prototypes/SVphone_v06_08/src/sv_connect/call_token.js`
- `prototypes/SVphone_v06_08/src/sv_connect/call_manager.js`
- `prototypes/SVphone_v06_08/src/sv_connect/signaling.js`

**v06_09 Baseline**:
- `prototypes/SVphone_v06_09/phone_interface.html` (clean starting point)

**v06_10 Target**:
- `prototypes/SVphone_v06_10/phone_interface.html` (will be enhanced)

