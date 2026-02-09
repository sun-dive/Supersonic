# MPT v05.23 Changes (CORRECTED)

## Overview

**v05.23** introduces a comprehensive token flushing and recovery system **using internal-only state management**. Users can now mark unwanted token UTXOs as flushed locally, keeping the UTXO unspent on-chain, with optional recovery to restore them to active status.

### Key Features

1. **Token Flushing** - Mark a token as flushed locally (internal state only, instant, no fees, no blockchain transaction)
2. **Flushed Token Recovery** - Restore a flushed token back to active status (local state change only)
3. **Status Tracking** - New token statuses: `flushed` and `recovered`
4. **User-Friendly UI** - Dialogs and recovery UI for managing flushed tokens

---

## Core Concept

Flushing is a **purely local operation**:
- The token UTXO remains unspent on-chain
- The wallet marks it as "flushed" in localStorage only
- The UTXO is no longer treated as a token by the wallet
- Recovery: simply change the status back to "active"
- **No blockchain transactions. No fees. No network calls.**

This allows users to temporarily or permanently hide unwanted tokens from their wallet interface without losing the ability to restore them later (as long as the local metadata is preserved).

---

## Changes by File

### 1. tokenStore.ts (Data Structure Updates)

#### TokenStatus Type Extended
```typescript
export type TokenStatus = 'active' | 'pending' | 'pending_transfer' | 'transferred' | 'flushed' | 'recovered'
```

#### OwnedToken Interface Extended
Added v05.23 flush tracking fields:
```typescript
interface OwnedToken {
  // ... existing fields ...
  flushedAt?: string           // ISO timestamp when marked as flushed (local)
}
```

Note: `flushTxId` is NOT used (flushing creates no blockchain transaction).

#### FungibleUtxo Interface Extended
Added corresponding flush tracking for fungible UTXOs:
```typescript
interface FungibleUtxo {
  // ... existing fields ...
  flushedAt?: string           // ISO timestamp when marked as flushed (local)
}
```

**Rationale**: These fields enable tracking when a token was locally flushed for UI purposes.

---

### 2. tokenBuilder.ts (Core Flush API)

#### Existing Methods (Unchanged)

##### `flushToken(tokenId: string, preserveMetadata: boolean): Promise<FlushResult>`
Marks a single NFT token as flushed locally.

**Parameters**:
- `tokenId` - ID of the token to flush
- `preserveMetadata` - If true, keeps metadata in localStorage for recovery; if false, deletes it

**Returns**:
```typescript
{
  tokenId: string    // Original token ID
  flushedAt: string  // ISO timestamp
}
```

**Behavior** (Internal-only, no blockchain transaction):
1. Retrieves the token from storage
2. Updates token status to `flushed` (localStorage only)
3. Records `flushedAt` timestamp
4. If preserveMetadata=false, deletes token from storage
5. Returns result

##### `flushFungibleToken(tokenId: string, utxoIndexes: number[], preserveMetadata: boolean): Promise<FungibleFlushResult>`
Marks specific fungible UTXOs as flushed locally.

**Parameters**:
- `tokenId` - ID of the fungible token
- `utxoIndexes` - Array of UTXO indices to flush
- `preserveMetadata` - If true, preserves metadata in localStorage

**Returns**:
```typescript
{
  tokenId: string     // Original token ID
  amountFlushed: number // Sum of flushed satoshis
  flushedAt: string   // ISO timestamp
}
```

#### New Methods (v05.23)

##### `recoverToken(tokenId: string): Promise<{ tokenId: string; status: string }>`
Restores a flushed token back to active status (internal-only).

**Behavior**:
1. Loads token from storage
2. Verifies status is `flushed`
3. Changes status to `active`
4. Clears `flushedAt` timestamp
5. Saves to storage
6. Returns success

**No blockchain transaction. Instant.**

##### `recoverFungibleUtxo(tokenId: string, utxoIndex: number): Promise<{ tokenId: string; utxoIndex: number }>`
Restores a specific flushed fungible UTXO back to active status (internal-only).

**Behavior**:
1. Loads fungible token from storage
2. Locates the specific UTXO
3. Verifies status is `flushed`
4. Changes status to `active`
5. Clears `flushedAt` timestamp
6. Saves to storage
7. Returns success

**No blockchain transaction. Instant.**

---

### 3. app.ts (UI Integration & Event Handlers)

#### Updated Functions

##### `renderStatusBadge(status: string): string`
Added cases for new statuses:
- `'flushed'` → Red badge (#da3633)
- `'recovered'` → Green badge (#238636)

##### `renderTokenActions(t: OwnedToken): string`
Enhanced to show:
- **For active tokens**: Added "Flush Token" button (red, #da3633)
- **For flushed tokens**: Added "Recover" button (green, #238636)

#### Event Handler Functions

##### `_openFlushDialog(tokenId: string)`
Opens the flush confirmation dialog.

**Actions**:
1. Loads token from storage
2. Populates dialog with token name
3. Shows dialog modal
4. Stores tokenId globally for confirm handler

##### `_confirmFlushToken()`
Confirms and executes the flush operation (local state change only).

**Actions**:
1. Reads preserve-metadata checkbox state
2. Calls `builder.flushToken()` (internal-only)
3. Displays result message
4. Refreshes token list and balance

##### `_cancelFlushDialog()`
Closes the flush dialog without action.

##### `_recoverFlushedToken(tokenId: string)`
Recovery for a specific flushed token (local state change only).

**Actions**:
1. Loads token from storage
2. Verifies status is `flushed`
3. Calls `builder.recoverToken()` (internal-only)
4. Updates token status to 'active' in display
5. Refreshes UI

##### `_startRecoveryScan()`
Scans local storage for flushed tokens.

**Actions**:
1. Lists all tokens from localStorage
2. Filters for status='flushed'
3. Displays results in recovery-results div with:
   - Count of flushed tokens
   - List of each flushed token with "Restore Token" button
4. Shows summary

**No blockchain scan. Local storage only.**

---

## Workflow Examples

### Example 1: Flush a Token with Metadata Preservation

1. User clicks "Flush Token" button on an active NFT card
2. Dialog opens showing token name and recovery info
3. "Preserve metadata for recovery" checkbox is checked (default)
4. User clicks "Confirm Flush"
5. Token status changes to `flushed` in localStorage (instant, no fee)
6. UTXO remains unspent on-chain
7. Token can be recovered anytime by changing status back to `active`

### Example 2: Restore a Flushed Token

1. User opens "Token Recovery" section
2. Clicks "Scan for Flushed Tokens"
3. System scans localStorage and lists flushed tokens
4. User clicks "Restore Token" on any flushed token
5. Token status changes from `flushed` to `active` (instant)
6. Token reappears in wallet as active

### Example 3: Permanently Delete a Token

1. User opens flush dialog
2. Unchecks "Preserve metadata for recovery"
3. Clicks "Confirm Flush"
4. Token metadata is immediately deleted from localStorage
5. Token cannot be recovered (metadata gone)
6. UTXO becomes a regular 1-sat satoshi on-chain (unused)

---

## Technical Details

### No Blockchain Transactions

Flushing creates **no blockchain transaction**:
- No spending of the token UTXO
- No transaction fees
- No mining confirmation needed
- No recovery scanning of the blockchain

### Recovery Strategy

The recovery system works by:
1. **Scanning** localStorage for tokens with status='flushed'
2. **Displaying** each flushed token with restore button
3. **Restoring** by changing status from 'flushed' to 'active'

### Status Transitions

```
active → [flush] → flushed
                      ↓
                  [recover] → active (if metadata preserved)
                                or permanently deleted (if not preserved)
```

### UTXO Lifecycle During Flush

```
UTXO on-chain: [unspent 1-sat token UTXO]
                        ↓ flush (local only)
Wallet storage: [token with status='flushed']
                        ↓ recover (local only)
Wallet storage: [token with status='active']

UTXO on-chain: [still unspent 1-sat token UTXO]
```

The UTXO never changes on-chain. Only the wallet's local interpretation changes.

---

## Storage Model

- **Token Metadata:** localStorage with prefix `mpt:data:token:TOKENID`
- **Flushed Timestamp:** Stored in token's `flushedAt` field
- **No blockchain data:** No `flushTxId` or recovery scanning

---

## Backward Compatibility

**v05.23 is fully backward compatible** with v05.22:
- Existing token structures work unchanged
- New flush/recovery fields are optional
- Tokens without flush metadata work normally
- No migration required for existing wallets

---

## Implementation Summary

| Aspect | v05.22 | v05.23 |
|--------|--------|--------|
| Flushing | N/A | Internal-only status change |
| Recovery | N/A | Status change from 'flushed' to 'active' |
| Blockchain transaction | N/A | None |
| Fees | N/A | None |
| Speed | N/A | Instant |
| UI | N/A | Flush/Recover buttons and dialog |

---

## Known Bugs in v05.23 (To Be Fixed in v05.24)

Critical issues introduced during flush feature implementation:

1. **Transferred tokens still appear in sender's wallet**
   - After transferring NFT from Wallet A to Wallet B and confirming on-chain, Wallet A still displays the token
   - Root cause: Return-to-sender logic was removed from `checkIncomingTokens()`
   - Impact: User confusion about token ownership

2. **Verification shows "Valid: true" for transferred tokens**
   - When sender verifies a transferred token, it incorrectly shows "Valid: true"
   - Should show "Valid: false" since token UTXO is no longer in sender's possession
   - Impact: SPV verification integrity compromised

3. **Instant forwarding of NFT no longer works**
   - Key SPV feature broken: ability to instantly forward received tokens
   - Impact: Wallet cannot perform rapid token transfers, affecting workflow
   - Status: CRITICAL - core SPV functionality

4. **Sending fungible token no longer works**
   - Fungible token transfers fail (likely interface issue)
   - May be related to UI changes or state management changes
   - Impact: Cannot transfer fungible tokens at all
   - Status: CRITICAL - basic token functionality broken

---

## Future Enhancements

Possible improvements for v05.24+:
1. Batch flush operations (flush multiple tokens in one action)
2. Selective recovery (recover only specific tokens, not all)
3. Automated "Hide" filters (hide flushed tokens from main view)
4. Metadata-only storage (save token attributes separately for recovery)
5. Unknown token standard support (store and forward non-MPT tokens)

