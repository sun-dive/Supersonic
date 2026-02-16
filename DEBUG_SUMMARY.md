# SVphone v06.08 - P2P Connection Debug Summary

## Current Status: Awaiting Diagnostic Test Results

The WebRTC call setup is partially working but media panels don't open because **response tokens arrive at Phone A with empty stateData**, preventing P2P connection establishment.

---

## What's Working ✅

1. **Call Token Broadcasting**: Phone A creates and broadcasts call token
   - Token contains Phone A's connection info (IP, port, session key) in tokenAttributes
   - Token reaches Phone B's mempool successfully

2. **Incoming Call Detection**: Phone B receives and recognizes incoming call
   - Token verification passes (SPV check succeeds)
   - Incoming call event fires: `call:incoming`
   - UI shows incoming call dialog

3. **Call Acceptance UI**: User can accept the call on Phone B
   - acceptCall() method runs
   - UI updates appropriately

---

## What's NOT Working ❌

1. **Response Token stateData**: Phone B transfers response token but...
   - stateData should contain: Phone B's IP, port, session key, SDP answer
   - stateData actually contains: **NOTHING (empty)**
   - Result: Phone A can't extract Phone B's connection info

2. **P2P Connection**: Because Phone A has no connection data...
   - No way to establish RTCPeerConnection with Phone B
   - Media panels don't open
   - Call times out after 30 seconds

---

## Investigation Timeline

### Session 1: Identified Missing SDP Offer
**Commit 9f6f36b:**
- Problem: Callee couldn't create SDP answer without receiving SDP offer
- Root cause: Offer created AFTER token broadcast (too late)
- Fix: Moved offer creation to BEFORE broadcast, store in callToken.mediaOffer

### Session 2: Identified Incomplete acceptCall Event
**Commit ae34f76:**
- Problem: acceptCall() event emitted but didn't include caller's connection info
- Root cause: Event only had {callTokenId, answerer, timestamp}
- Fix: Modified acceptCall() to extract caller's info from incoming token and include:
  - calleeAddress (caller's address)
  - calleeIp (caller's IP)
  - calleePort (caller's port)
  - calleeSessionKey (caller's session key)

### Session 3: Identified SDP Answer Not Applied
**No specific commit:**
- Problem: Phone A received SDP answer but didn't apply it to connection
- Root cause: initiateP2PConnection() didn't accept or use remoteSdpAnswer parameter
- Fix: Added optional remoteSdpAnswer parameter and call setRemoteDescription()

### Session 4: **Current Issue - Empty Response stateData**
**Commit 30edbfe:**
- Problem: Response token's stateData is EMPTY when Phone A receives it
- Root cause: Unknown (three possibilities below)
- Status: Enhanced logging added, awaiting test results

---

## Three Possible Root Causes

### Hypothesis 1: Encoding Error (Data Lost Before Transfer)
```javascript
// In phone_interface.html acceptCall() lines 2303-2310
responseStateHex = this.encodeCallState(responseData)
if (!responseStateHex || responseStateHex.length === 0) {
  console.error('[SEND] ❌ ERROR: Response state hex is EMPTY!')
}
```

**Symptom:** Console shows `[SEND] ❌ ERROR: Response state hex is EMPTY!`
**Likely cause:** responseData object missing required fields (recipientAddress, recipientIp, recipientPort)
**Location:** Check if myAddress, myIp, myPort are populated

### Hypothesis 2: Transfer Parameter Issue (Data Lost at createTransfer)
```javascript
// In phone_interface.html acceptCall() lines 2340-2351
console.debug('[SEND] Calling createTransfer with:', {
  tokenId: this.currentCallToken,
  callerAddress: callerAddress,
  responseStateHex: responseStateHex ? 'provided' : 'NOT PROVIDED'
})
const transferResult = await tokenBuilder.createTransfer(
  this.currentCallToken,
  callerAddress,
  responseStateHex  // <-- Is this parameter being used?
)
```

**Symptom:** Console shows `responseStateHex: 'NOT PROVIDED'` OR parameter is ignored
**Likely cause:** createTransfer() API doesn't accept or use 3rd parameter
**Location:** Check tokenBuilder.ts createTransfer() signature

### Hypothesis 3: Token Storage Issue (Data Lost After Transfer)
```javascript
// In signaling.js handleCallResponse() lines 550-552
console.debug('[CallSignaling] StateData length:', token.stateData?.length || 0)
console.debug('[CallSignaling] StateData (full):', token.stateData)
```

**Symptom:** Phone B console shows stateData present, but Phone A console shows "StateData length: 0"
**Likely cause:** stateData not persisted to blockchain OR token retrieved before sync completes
**Location:** Check tokenBuilder token storage and retrieval logic

---

## Code Flow Diagram

```
PHONE A (Caller) Creates & Broadcasts
├─ SDP Offer created BEFORE broadcast (✅ Fixed in Session 1)
├─ Call token contains Phone A's IP:port in tokenAttributes (✅ Working)
├─ Token broadcast to blockchain
└─ Polling starts watching for response token

PHONE B (Callee) Receives & Accepts
├─ Incoming call detected (✅ Working)
├─ User clicks Accept
├─ Call manager creates SDP Answer (✅ Working)
├─ Response data encoded to hex:
│  └─ format: [Version][Status][AddressLen][Address][IP][Port][KeyLen][Key][SDPLen][SDP]
├─ encodeCallState() should produce hex string (✅ Has diagnostics)
├─ createTransfer(tokenId, callerAddress, responseStateHex) called
│  └─ ❌ ISSUE: responseStateHex not in final token?
└─ Transfer completes, returns txId

PHONE A (Caller) Polls for Response
├─ Polling detects response token
├─ handleCallResponse() tries to parse stateData
│  └─ ❌ stateData is EMPTY = parsing fails
├─ No connection info extracted = no P2P attempt
└─ Call times out after 30 seconds (❌ Timeout)
```

---

## Diagnostic Logging Added (Commit 30edbfe)

### Phone B Side (Encoding & Transfer)
**File:** phone_interface.html acceptCall() lines 2301-2357

Added logging to track:
1. `[SEND] ✅ Response encoded to XXX bytes` - Encoding succeeded
2. `[SEND] Response state hex (full):` - Actual encoded data
3. `[SEND] About to transfer token with stateData:` - What will be passed
4. `[SEND] Calling createTransfer with:` - Parameter status
5. `[SEND] ✅ Transfer completed, stateData parameter was:` - What transfer received

### Phone A Side (Response Parsing)
**File:** signaling.js handleCallResponse() lines 547-720

Added logging to track:
1. `[CallSignaling] StateData length:` - Did we receive stateData?
2. `[CallSignaling] StateData (full):` - Complete hex string
3. `[CallSignaling] ✓ Extracted recipient address:` - Successfully parsed?
4. Error messages if parsing fails at any step
5. `[CallSignaling] ✓ Parsed response data:` - Final extracted data

---

## Next Steps: Run Diagnostic Test

**See:** `/DIAGNOSTIC_GUIDE.md` for step-by-step testing procedure

The guide will help you:
1. Identify which checkpoint fails
2. Pinpoint the exact root cause
3. Provide console output for debugging

**Key checkpoints:**
- ✅ Checkpoint 1-2: Encoding successful?
- ✅ Checkpoint 3-4: Transfer receives stateData?
- ✅ Checkpoint 5-6: Phone A receives and parses stateData?
- ✅ Checkpoint 7: P2P connection initiates?

---

## Key Files Modified This Session

1. **phone_interface.html** (acceptCall method)
   - Lines 2301-2357: Enhanced logging for encoding & transfer
   - Lines 2287-2299: Get SDP answer from call manager
   - Lines 2277-2284: Prepare response data object

2. **signaling.js** (handleCallResponse method)
   - Lines 547-720: Comprehensive stateData parsing with validation
   - Lines 589-657: Detailed error logging for each decode step

3. **call_manager.js** (initiateCall method)
   - Lines 45-95: Move SDP offer creation before broadcast

---

## Test Expectations

When testing, you should see:

**Phone B Console (Callee accepting):**
```
[SEND] Call accepted, session: {...}
[SEND] ✅ Response encoded to 200 bytes
[SEND] Response state hex (full): 0102...
[SEND] Calling createTransfer with: { responseStateHex: 'provided', responseStateHexLen: 200 }
[SEND] ✅ Transfer completed, stateData parameter was: { stateDataLen: 200 }
[SEND] ✓ Token sent back to caller
```

**Phone A Console (Caller receiving response):**
```
[CallSignaling] 🔄 Processing call response token
[CallSignaling] StateData length: 200
[CallSignaling] ✓ Extracted recipient address: phoneB...
[CallSignaling] ✓ Extracted IPv4: 192.168.x.x
[CallSignaling] ✓ Extracted port: 12345
[SEND] ✅ call:answered event received
[P2P] Initiating P2P connection
```

---

## Important Notes

- **No time constraints**: The diagnostic test can take as long as needed
- **Multiple tests OK**: Run it several times if results vary
- **Document everything**: Copy all console output for analysis
- **Network may affect tests**: Use localhost if possible for reliability
- **Token confirmation**: First call takes ~10 min (genesis), subsequent calls instant

