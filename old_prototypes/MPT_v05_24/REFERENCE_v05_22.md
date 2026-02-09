# Reference: MPT v05.21 (Stable Baseline)

## Purpose

**v05.21 is the definitive stable baseline** - confirmed to be working correctly. Use this as the primary reference to identify what changed and broke in v05.22-v05.24.

Secondary reference: v05.22 (last version before flush feature introduction)

## Key Files to Compare

When debugging bugs in v05.24, compare these files between versions:

### 1. tokenBuilder.ts
**Critical sections to compare:**
- `checkIncomingTokens()` - Return-to-sender logic, token import
- `createTransfer()` - Token transfer creation
- `transferFungible()` - Fungible token transfer logic
- `verifyToken()` - Token verification

**Known issues in v05.23:**
- Return-to-sender logic was removed
- May have impact on instant forwarding

### 2. app.ts
**Critical sections to compare:**
- `handleTransfer()` - NFT transfer UI/logic
- `refreshTokenList()` - Token filtering and display
- Fungible token sending functions
- Instant forwarding/forwarding logic (if exists)

**Known issues in v05.23:**
- Fungible token sending may be broken
- Instant forwarding feature broken

### 3. tokenStore.ts
**Critical sections to compare:**
- Data structure changes (OwnedToken, FungibleToken, FungibleUtxo)
- New flush-related fields that might conflict

### 4. walletProvider.ts
**Check for:**
- Any changes to UTXO handling
- Block header fetching

## Comparison Commands

```bash
# PRIMARY: Compare against v05.21 (stable baseline)
diff prototypes/MPT_v05_21/src/tokenBuilder.ts prototypes/MPT_v05_24/src/tokenBuilder.ts

# View specific function changes (v05.21 vs v05.24)
diff -u <(grep -A 30 "async checkIncomingTokens" prototypes/MPT_v05_21/src/tokenBuilder.ts) \
         <(grep -A 30 "async checkIncomingTokens" prototypes/MPT_v05_24/src/tokenBuilder.ts)

# Check function in stable v05.21
grep -n "function\|async" prototypes/MPT_v05_21/src/app.ts | head -50

# Secondary: Compare v05.21 → v05.22 → v05.23/v05.24 to trace where issues started
diff prototypes/MPT_v05_21/src/app.ts prototypes/MPT_v05_22/src/app.ts | head -100
```

## Key Differences to Investigate

1. **Return-to-sender logic**: Check if it exists in v05.22 but was removed in v05.23
2. **Fungible token sending**: Compare the UI and transaction building logic
3. **Instant forwarding**: Check if this feature exists in v05.22
4. **Verification logic**: Check what changed in how tokens are verified
5. **Token filtering**: Compare the filter logic in refreshTokenList()

## How to Use This Reference

1. When encountering a bug in v05.24, identify the affected function
2. Compare the v05.22 version with v05.24 version
3. Look for code that was removed, changed, or added
4. Cherry-pick fixes from v05.22 or re-implement the correct logic
5. Test to ensure the fix doesn't break the flush feature

## Version Timeline

- **v05.21**: ✅ STABLE - All features working correctly (BASELINE)
- **v05.22**: ⚠️ Added consecutive transfer support (may have introduced issues)
- **v05.23**: ❌ Added flush feature but broke: transfers, verification, instant forwarding, fungible sends
- **v05.24**: 🔧 In progress - restoring v05.21 functionality + keeping flush feature

## How to Use v05.21 as Reference

When encountering a bug in v05.24:

1. **Find the broken function** in v05.24 (e.g., `handleTransfer()`)
2. **Compare to v05.21** working version:
   ```bash
   diff -u prototypes/MPT_v05_21/src/app.ts prototypes/MPT_v05_24/src/app.ts | grep -A 20 "handleTransfer"
   ```
3. **Identify what changed** between working (v05.21) and broken (v05.24)
4. **Cherry-pick the fix** from v05.21 logic, being careful to preserve flush feature additions
5. **Test thoroughly** to ensure flush feature still works

## Critical Implementation Differences to Watch

- Flush feature adds: `flushedAt` field, flush/recover UI, status filtering
- These should NOT affect: transfer logic, verification, forwarding, fungible sends
- Flush changes are primarily in tokenStore.ts and app.ts UI layer
- Core transfer logic in tokenBuilder.ts should remain mostly unchanged from v05.21
