# Bug Investigation - v05.24

## Status Summary

| Bug | Status | Details |
|-----|--------|---------|
| 1. Transferred tokens still appear | ✅ FIXED | Return-to-sender logic restored |
| 2. Verification shows "Valid: true" for transferred | ⏳ INVESTIGATING | Need SPV fix without breaking incoming verification |
| 3. Instant forwarding of NFT no longer works | ❓ NEEDS CLARIFICATION | Function exists, UI exists, need error details |
| 4. Sending fungible token no longer works | ❓ NEEDS CLARIFICATION | UI and function appear identical to v05.21, need error details |

---

## Detailed Findings

### Bug #1: Transferred Tokens Still Appear ✅ FIXED
- **Root Cause**: Return-to-sender logic was removed from `checkIncomingTokens()`
- **Fix Applied**: Restored lines 1468-1480 in tokenBuilder.ts to re-activate transferred/pending_transfer tokens when they come back
- **Testing**: Need to verify that single NFT transfer from A→B no longer shows in A's wallet after confirmation
- **Related Code**: tokenBuilder.ts lines 1468-1480 (transfer TX section), lines 1518-1528 (genesis TX section - already correct)

### Bug #2: Verification Shows "Valid: true" for Transferred Tokens ⏳ NEEDS FIX
- **Issue**: When a token is transferred, sender can still verify it as "Valid: true"
- **Expected**: Should show "Valid: false" with reason "Token has been transferred"
- **Current Check**: handleVerify() in app.ts checks `token.status === 'transferred'` (lines 1248-1253)
- **Status Update**: Token status SHOULD be set to 'transferred' by confirmTransfer() in tokenBuilder.ts
- **Investigation Point**: Need to verify confirmTransfer() is being called and status is actually saved to localStorage
- **SPV Consideration**: Cannot use UTXO existence check (breaks incoming verification), must rely on status field

### Bug #3: Instant Forwarding of NFT No Longer Works ❓ NEEDS CLARIFICATION
- **Function Exists**: `_forwardMessage()` exists in app.ts (line 1478)
- **Backend Exists**: `builder.forwardFungibleUtxo()` exists in tokenBuilder.ts (line 728)
- **UI Exists**: Forward button renders for fungible UTXOs with state data (line 615)
- **What's Different**: v05.24 adds `<details>` tags wrapping messages (collapsible sections)
- **Potential Issues**:
  - Are message UTXOs being detected correctly?
  - Is the state data being parsed correctly?
  - Is the button click firing?
- **NEED**: User to clarify: What error message do you see? Does the button not appear? Does it fail silently?

### Bug #4: Sending Fungible Token No Longer Works ❓ NEEDS CLARIFICATION
- **Function Exists**: `_transferFungible()` exists in app.ts (line 1423)
- **Logic Unchanged**: Function body is identical to v05.21
- **UI Unchanged**: Button and inputs appear identical to v05.21
- **Filtering Unchanged**: activeUtxos filter logic identical to v05.21
- **Potential Issues**:
  - Are fungible tokens being created properly?
  - Are activeUtxos empty when they shouldn't be?
  - Is the transferFungible() backend method broken?
  - Is there a data structure incompatibility?
- **NEED**: User to clarify: What error message? Does the button appear? Does it fail to build TX? Does it fail to broadcast?

---

## Questions for Clarification

For bugs #3 and #4, I need specific information:

**For Instant Forwarding:**
1. What is the exact error message (if any)?
2. Does the "Forward" button appear on message UTXOs?
3. Does clicking it do nothing, or show an error?
4. Does the same issue exist in v05.21?

**For Fungible Sending:**
1. What is the exact error message (if any)?
2. Does the "Send" button appear on the fungible token card?
3. Does clicking it do nothing, or show an error?
4. Can you create a test fungible token and try to send it?
5. Does the same issue exist in v05.21?

---

## Next Steps

1. Get user clarification on bugs #3 and #4
2. If bugs #3 and #4 also exist in v05.21: issue is data/environment, not code changes
3. If bugs #3 and #4 don't exist in v05.21: identify specific code change that broke them
4. Focus on bug #2 (verification) - likely needs verification logic improvement without breaking SPV

---

## Code Comparison Approach

When comparing v05.21 vs v05.24:
- ✅ Function signatures identical
- ✅ UI structure almost identical (minor styling differences)
- ⚠️ Data flow might have changed
- ⚠️ Status/state management might have changed
- ❓ Need to test with actual data to see what's happening
