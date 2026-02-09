# Token Recovery System (v05.25)

## Problem Solved

When tokens were lost during migration from v05.24 (MPT) to v05.25 (P protocol), they couldn't be recovered because:

1. **Storage loss**: Migration process deleted old MPT keys without properly backing them up
2. **Format incompatibility**: Old tokens had MPT prefix (3 bytes) and version 0x02, but v05.25 wallet only accepted P prefix (1 byte) and version 0x03
3. **No recovery mechanism**: Wallet had no way to reconstruct tokens from blockchain

## Solution: Dual-Format Decoder + Auto-Recovery

### 1. Dual-Format OP_RETURN Decoder

The wallet now supports both MPT and P token formats:

```typescript
// Supports both:
// - P protocol: 1-byte prefix [0x50], version 0x03 (new)
// - MPT protocol: 3-byte prefix [0x4d, 0x50, 0x54], version 0x02 (legacy)
```

This allows the wallet to:
- Read old tokens directly from blockchain transactions
- Automatically upgrade them to P protocol on import
- No protocol version conflict

### 2. Auto-Recovery on Startup

When you load the wallet, it:

1. **Check storage**: Look for tokens in localStorage/IndexedDB
2. **If found**: Use those tokens (normal case)
3. **If not found but UTXOs exist**: Automatically scan blockchain
4. **Recover tokens**: Re-import tokens from their OP_RETURN data on-chain
5. **Update to P protocol**: Legacy MPT tokens are seamlessly converted

This happens automatically during startup with status messages like:
- "Recovering tokens from blockchain..."
- "Recovered N token(s) from blockchain"

## How Token Recovery Works

### The Merkle Path Scan

When recovery is triggered, the wallet:

1. **Fetches all wallet UTXOs** from the blockchain
2. **For each UTXO**: Retrieves the transaction that created it
3. **Parses OP_RETURN**: Extracts token metadata from the transaction
4. **SPV Verification**: Verifies token authenticity using Merkle proofs
5. **Imports token**: Stores in wallet with full proof chain

Example flow:
```
UTXO on blockchain
  ↓
Fetch TX that created it
  ↓
Find OP_RETURN with token metadata (MPT or P format)
  ↓
Verify using block headers + Merkle proofs
  ↓
Import as P protocol token
  ↓
Store in localStorage + IndexedDB
```

### What Gets Recovered

✅ **Recoverable**:
- NFT tokens (any genesis TX with OP_RETURN)
- Fungible tokens (with multiple UTXOs)
- Tokens with state data, attributes, custom scripts
- Files attached to tokens (file metadata)

❌ **Not recoverable**:
- Tokens that were already transferred away
- Burned tokens (deleted/spent without transfer)
- Transactions that don't match your wallet address

## Use Cases

### 1. Storage Corruption (Current Issue)

**Scenario**: Migration deleted tokens but they're still on blockchain

**Solution**:
- Just reload the wallet
- Auto-recovery scans blockchain and re-imports
- No manual action needed

### 2. New Device / Browser Switch

**Scenario**: User moves WIF to new device, wants tokens back

**Solution**:
- Paste WIF in "Restore Wallet" field
- Click restore
- Wallet auto-recovers all tokens from blockchain
- Full wallet state reconstructed

### 3. Lost Storage Data

**Scenario**: Browser clears localStorage/IndexedDB

**Solution**:
- Wallet still works (has WIF)
- On next load, auto-recovery triggers
- All tokens re-imported from blockchain
- Proof chains rebuilt from Merkle proofs

## How to Manually Trigger Recovery

If auto-recovery doesn't trigger or you want to explicitly recover:

1. **Refresh the page** - Auto-recovery checks on every load
2. **Click "Check Incoming Tokens"** button - Manually scans blockchain
3. **Open browser console** (F12):
   ```javascript
   // Manually trigger recovery in console
   await autoRecoverTokens()
   ```

## Technical Details

### Modified Files

1. **opReturnCodec.ts**
   - Added MPT_PREFIX and MPT_VERSION constants
   - Modified decodeOpReturn() to accept both formats
   - Logs "Found legacy MPT token" when importing old tokens

2. **app.ts**
   - Added autoRecoverTokens() function
   - Checks if no tokens exist but UTXOs exist
   - Calls checkIncomingTokens() for blockchain scan
   - Shows status messages during recovery

### Verification Process

Recovered tokens are verified using SPV (Simple Payment Verification):

1. **Genesis TX verification**:
   - Get block header for genesis TX's block
   - Verify Merkle proof includes TX in block
   - Confirm block follows Bitcoin consensus rules

2. **Transfer TX verification**:
   - Verify input correctly spends previous output
   - Verify token metadata matches immutable fields

3. **Proof chain validation**:
   - Ensure chain is ordered newest-first
   - Verify each Merkle proof links to next entry
   - Confirm ownership via P2PKH script

## Troubleshooting

### Recovery Not Triggering

If auto-recovery doesn't run:

1. **Check console** (F12) for errors
2. **Verify UTXOs exist**:
   ```javascript
   // In browser console:
   const utxos = await provider.getUtxos()
   console.log(`UTXOs found: ${utxos.length}`)
   ```
3. **Manually trigger**: Click "Check Incoming Tokens" button

### Tokens Found but Status Wrong

Recovered tokens should show as "active". If showing "pending" or "transferred":

1. **Pending**: Transaction not yet confirmed - wait for block
2. **Transferred**: Token was sent away and returned - update status
3. **Flushed**: Token was spent as regular sats - may not be recoverable

### Still Not Working?

Recovery requires:
- ✅ Valid WIF (wallet private key)
- ✅ UTXOs on blockchain for wallet address
- ✅ Original OP_RETURN data still on chain
- ✅ Network connectivity to blockchain

If all above are true but recovery fails:
1. Check browser console for error messages
2. Verify blockchain connection (check balance shows correct sats)
3. Contact support with error message

## Migration Improvements (v05.25+)

The next update will improve the migration process:

1. **Better error handling** - Don't delete keys if migration fails
2. **Verification** - Confirm token data was migrated before deletion
3. **Logging** - Detailed console output of what was migrated
4. **Backup** - Optional export of tokens before migration

## Summary

**v05.25 makes token loss recoverable:**

- ✅ Dual-format decoder (MPT + P protocol)
- ✅ Auto-recovery on startup
- ✅ Blockchain-based token reconstruction
- ✅ SPV verification of recovered tokens
- ✅ Manual recovery button
- ✅ Works across devices/browsers

**Your tokens are safe** - they're on the blockchain and can always be recovered from there.

