# SVphone v06.08 - stateData Diagnostic Guide

## Problem Summary
Response tokens from Phone B (callee) are arriving at Phone A (caller) with **NO stateData**, preventing P2P connection establishment.

**Expected flow:**
- Phone B accepts call → encodes response data → transfers token with stateData
- Phone A receives response token → extracts stateData → initiates P2P connection

**Actual behavior:**
- Phone B claims to transfer token with stateData
- Phone A receives token but stateData is EMPTY

---

## Diagnostic Test Procedure

### Step 1: Open Two Browser Windows

**Window 1 (Phone A - Caller):**
- Open DevTools (F12)
- Navigate to: `prototypes/SVphone_v06_09/phone_interface.html`
- Open Console tab and filter for: `[SEND]` or `[RECV]`

**Window 2 (Phone B - Callee):**
- Open DevTools (F12)
- Navigate to: `prototypes/SVphone_v06_09/phone_interface.html`
- Open Console tab and filter for: `[SEND]` or `[CallSignaling]`

### Step 2: Initialize Both Phones

**On Phone A (Caller):**
1. Load wallet from `prototypes/SVphone_v06_09/wallet.html`
2. Click "Initialize Call Manager"
3. Enter Phone B's address in "Recipient Address" field
4. Note your IP in "My IP" field (should be from STUN detection)

**On Phone B (Callee):**
1. Load wallet from `prototypes/SVphone_v06_09/wallet.html`
2. Click "Initialize Call Manager"
3. Note your IP in "My IP" field

### Step 3: Test Call Initiation

**On Phone A:**
- Click "Call" button
- Watch console for logs with `[SEND]` prefix

**Expected logs in Phone A console:**
```
[SEND] 📤 Initiating call (no token for ...)
[SEND] Calling createGenesis with: {...}
[SEND] ✅ Genesis created: token123...
[SEND] ⏳ Waiting for genesis confirmation
(~10 minute wait OR immediate if using existing token)
[SEND] ✅ Genesis confirmed
[SEND] 📤 Transferring to recipient: addressB...
[SEND] Calling tokenBuilder.createTransfer({...})
[SEND] ✅ Token transferred
```

### Step 4: Wait for Phone B to Receive Call

**On Phone B console, watch for:**
```
[RECV] ✅ Incoming call from: Phone A address
[RECV] 🔔 Signaling layer detected incoming call
```

**Phone B should show incoming call dialog**

### Step 5: Accept Call on Phone B

**On Phone B:**
- Click "Accept" button
- **CRITICAL**: Watch console IMMEDIATELY for these logs (they appear instantly):

**Expected logs in Phone B console:**
```
[SEND] 📤 Accepting incoming call
[SEND] ✓ Call manager accepted call
[SEND] ✅ Response encoded to XXX bytes
[SEND] Response state hex (full): 0102034c4f434b...
[SEND] Response state hex (first 100): 0102034c4f434b...
[SEND] About to transfer token with stateData: {
  stateDataLen: XXX,
  stateDataEmpty: false,
  stateData: "0102034c4f434b..."
}
[SEND] Calling createTransfer with: {
  tokenId: "token123",
  callerAddress: "phoneA",
  responseStateHex: "provided" or "NOT PROVIDED",
  responseStateHexLen: XXX
}
[SEND] ✅ Transfer completed, stateData parameter was: {
  stateDataLen: XXX,
  stateData: "0102034c4f434b..."
}
[SEND] ✓ Token sent back to caller: txid...
```

---

## Diagnostic Checkpoints

### Checkpoint 1: Response Data Encoding
**Look for:** `[SEND] Response encoded to XXX bytes`
- **✅ If present**: Encoding succeeded
- **❌ If missing**: Encoding failed - look for error message instead
  - Error: `[SEND] ❌ ERROR encoding response state: ...`
  - Action: Report the error message

### Checkpoint 2: Response Data Content
**Look for:** `[SEND] Response state hex (full): 0102...`
- **✅ If shows hex data**: Encoding produced content
- **❌ If shows empty or very short**: Data not encoded properly
  - Check: Response state hex (first 100): "" or very short?
  - Action: Report exact content

### Checkpoint 3: Transfer Parameter
**Look for:** `[SEND] Calling createTransfer with:`
- **✅ If responseStateHex: "provided"**: Parameter was passed to createTransfer()
- **❌ If responseStateHex: "NOT PROVIDED"**: stateData never reached createTransfer()
  - This indicates responseStateHex was empty at line 2350
  - Action: Check Checkpoint 2 above

### Checkpoint 4: Transfer Completion
**Look for:** `[SEND] ✅ Transfer completed, stateData parameter was:`
- **✅ If stateDataLen > 0**: Transfer received the stateData
- **❌ If stateDataLen = 0**: Transfer did NOT receive stateData
  - This means createTransfer() was called with empty string
  - Action: Compare with Checkpoint 3 - did it say "provided"?

### Checkpoint 5: Response Token Reception on Phone A
**On Phone A console, watch for after a few seconds:**

**Expected logs in Phone A console:**
```
[RECV] 🔔 Response received from Phone B
[CallSignaling] 🔄 Processing call response token
[CallSignaling] Token ID: token123...
[CallSignaling] StateData length: XXX
[CallSignaling] StateData (full): 0102034c4f434b...
[CallSignaling] StateData (first 200 chars): 0102034c4f434b...
```

- **✅ If StateData length > 0**: Excellent! Phone A received the stateData
  - Proceed to Checkpoint 6
- **❌ If StateData length = 0**: StateData not transmitted
  - This is the root cause: Phone B sent token but without stateData
  - Action: Compare with Checkpoint 4 on Phone B - did it say stateDataLen = 0?

### Checkpoint 6: Response Parsing
**On Phone A console, look for:**
```
[CallSignaling] ✓ Extracted recipient address: phoneB...
[CallSignaling] ✓ Extracted IPv4: XXX.XXX.XXX.XXX
[CallSignaling] ✓ Extracted port: XXXXX
[CallSignaling] ✓ Extracted session key: X bytes
```

- **✅ All extraction steps present**: Parsing succeeded
  - Phone A should now have Phone B's connection info
  - P2P connection should initiate automatically
- **❌ Missing extraction steps**: Parsing failed
  - Look for error: `[CallSignaling] ❌ Invalid address length` or similar
  - Action: Report which extraction failed

### Checkpoint 7: P2P Connection Initiation
**On Phone A, should see:**
```
[P2P] Initiating P2P connection to: XXX.XXX.XXX.XXX:XXXXX
[P2P] Creating RTCPeerConnection
[P2P] Setting remote description (SDP answer) from callee...
[P2P] ICE candidates being gathered
```

- **✅ All steps present**: P2P connection starting
- **❌ Missing steps**: Connection not initiating
  - Action: Report which step is missing

---

## Troubleshooting Decision Tree

### If Checkpoint 1 fails (encoding error):
- **Error message:** Report exact error from console
- **Likely cause:** Missing recipientAddress, recipientIp, or recipientPort
- **Fix:** Check that myAddress, myIp, myPort are populated before accepting call

### If Checkpoint 2 fails (hex is empty):
- **Symptoms:** `[SEND] Response encoded to 0 bytes`
- **Likely cause:** encodeCallState() produced empty output
- **Investigate:** Check if state object fields are valid
  - `state.recipientAddress`: Should be Phone B's BSV address
  - `state.recipientIp`: Should be IPv4 or IPv6
  - `state.recipientPort`: Should be number (e.g., 8192)
  - `state.recipientSessionKey`: Should be base64 string

### If Checkpoint 3 fails (responseStateHex = "NOT PROVIDED"):
- **Symptoms:** createTransfer called with empty responseStateHex
- **Likely cause:** Encoding succeeded but responseStateHex lost before createTransfer call
- **Investigate:** Check lines 2303-2350 in phone_interface.html
  - Did encodeCallState() return empty? (But Checkpoint 2 said it succeeded?)
  - Was responseStateHex overwritten somewhere?

### If Checkpoint 4 fails (transfer got empty stateData):
- **Symptoms:** Phone B console shows "provided" at Checkpoint 3 but "0 bytes" at Checkpoint 4
- **Likely cause:** createTransfer() API doesn't accept stateData parameter in current version
- **Investigate:** Check tokenBuilder.createTransfer() signature
  - Current call: `createTransfer(tokenId, address, stateData)`
  - Does it actually use the 3rd parameter?
  - May need to check tokenBuilder implementation

### If Checkpoint 5 fails (Phone A gets empty stateData):
- **Symptoms:** Checkpoint 4 showed transfer got stateData, but Phone A receives "StateData length: 0"
- **Likely cause:** tokenBuilder.createTransfer() doesn't persist stateData to token
- **Investigate:** Is stateData being stored in the token when it's transferred?
  - May be a bug in tokenBuilder where stateData isn't being applied to transferred tokens
  - Or tokens are being retrieved from blockchain before they're fully synced

### If Checkpoint 6 fails (parsing errors):
- **Example error:** `[CallSignaling] ❌ Invalid address length: 0`
- **Likely cause:** stateData format doesn't match decoder expectations
- **Investigate:** Compare what encodeCallState() produces vs what handleCallResponse() expects
  - Check format at line 2159 vs line 575

### If Checkpoint 7 fails (no P2P connection):
- **Symptoms:** Parser succeeded but no P2P connection attempt
- **Likely cause:** call:answered event not being emitted or not being handled
- **Investigate:** Check phone_interface.html line 1893-1919
  - Is 'call:answered' event listener still registered?
  - Does it have calleeIp and calleePort in the event data?

---

## Quick Reference: What Each Logging Prefix Means

| Prefix | Location | Meaning |
|--------|----------|---------|
| `[SEND]` | phone_interface.html | Phone accepting call, encoding response, sending token back |
| `[RECV]` | phone_interface.html | Phone receiving/processing incoming tokens |
| `[CallSignaling]` | signaling.js handleCallResponse() | Parsing response token stateData |
| `[P2P]` | phone_interface.html initiateP2PConnection() | WebRTC connection setup |
| `[CallToken]` | call_token.js | Call token creation and broadcasting |

---

## Next Steps After Diagnosis

1. **Run the test** following the procedure above
2. **Collect console output** from both Phone A and Phone B
3. **Identify which checkpoint fails** using the decision tree
4. **Report the checkpoint number** and relevant console output
5. **Provide the exact error messages** if any errors occur

This will pinpoint exactly where the stateData is being lost and enable targeted fixes.

