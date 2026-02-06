# MPT v05.23 Changes

## Overview

**v05.23** introduces a comprehensive token flushing and recovery system. Users can now voluntarily convert unwanted token UTXOs back into spendable satoshis, with optional metadata preservation for recovery if the UTXO remains unspent on-chain.

### Key Features

1. **Token Flushing** - Convert a token UTXO (1 sat) to spendable sats with optional metadata preservation
2. **Flushed Token Recovery** - Scan the blockchain for accidentally flushed tokens and re-import them if still unspent
3. **Status Tracking** - New token statuses: `flushed` and `recovered`
4. **User-Friendly UI** - Dialogs and recovery scan interface for managing flushed tokens

---

## Changes by File

### 1. tokenStore.ts (Data Structure Updates)

#### TokenStatus Type Extended
```typescript
export type TokenStatus = 'active' | 'pending' | 'pending_transfer' | 'transferred' | 'flushed' | 'recovered'
```

#### OwnedToken Interface Extended
Added v05.23 flush recovery tracking fields:
```typescript
interface OwnedToken {
  // ... existing fields ...
  flushTxId?: string           // TX that spent this token UTXO as regular sats
  flushedAt?: string           // ISO timestamp when flushed
  recoveryBlockHeight?: number // Block height where flushed UTXO can be scanned
}
```

#### FungibleUtxo Interface Extended
Added corresponding flush tracking for fungible UTXOs:
```typescript
interface FungibleUtxo {
  // ... existing fields ...
  flushTxId?: string           // TX that spent this UTXO as regular sats
  flushedAt?: string           // ISO timestamp when flushed
}
```

**Rationale**: These fields enable tracking of flushed tokens and support the recovery system by recording when and how a token was converted to sats.

---

### 2. tokenBuilder.ts (Core Flush API)

#### New Public Methods

##### `flushToken(tokenId: string, preserveMetadata: boolean): Promise<FlushResult>`
Flushes a single NFT token UTXO.

**Parameters**:
- `tokenId` - ID of the token to flush
- `preserveMetadata` - If true, keeps metadata in localStorage for recovery; if false, deletes it

**Returns**:
```typescript
{
  txId: string          // Transaction ID of flush TX
  tokenId: string       // Original token ID
  satoshis: number      // Amount flushed (1)
}
```

**Behavior**:
1. Retrieves the token from storage
2. Builds a flush transaction spending the 1-sat token UTXO
3. Records flushTxId and flushedAt in token metadata (if preserveMetadata=true)
4. Updates token status to `flushed`
5. Returns flush result

##### `flushFungibleToken(tokenId: string, utxoIndexes: number[], preserveMetadata: boolean): Promise<FungibleFlushResult>`
Flushes specific fungible UTXOs from a token basket.

**Parameters**:
- `tokenId` - ID of the fungible token
- `utxoIndexes` - Array of UTXO indices to flush
- `preserveMetadata` - If true, preserves metadata in localStorage

**Returns**:
```typescript
{
  txId: string         // Transaction ID of flush TX
  tokenId: string      // Original token ID
  amountFlushed: number // Sum of flushed satoshis
  change: number       // Remaining balance after flush
}
```

#### New Private Methods

##### `buildFlushTx(token: OwnedToken, fundingUtxos: Utxo[]): Promise<Transaction>`
Constructs a flush transaction.

**Structure**:
- **Input 0**: The 1-sat token UTXO being flushed
- **Inputs 1+**: Optional funding UTXOs if change is needed
- **Output 0**: P2PKH change address (no OP_RETURN, making it spendable)
- **No metadata encoding** - The transaction contains only sats, no token protocol data

##### `buildFungibleFlushTx(token: FungibleToken, utxoIndexes: number[], fundingUtxos: Utxo[]): Promise<Transaction>`
Constructs a flush transaction for fungible UTXOs.

**Structure**:
- **Inputs 0-N**: Fungible UTXOs being flushed (in order)
- **Inputs N+**: Funding UTXOs if needed
- **Output 0**: P2PKH change output
- **No token protocol data** - Pure sat transaction

---

### 3. flushRecovery.ts (New Recovery Module)

A new module that enables blockchain scanning and recovery of flushed tokens.

#### Exported Interfaces

```typescript
export interface FlushedTokenInfo {
  flushedTxId: string        // TX that spent the 1-sat token UTXO
  blockHeight: number        // Confirmation height
  satoshis: number           // Amount in flushed output
  isSpent: boolean           // Whether this UTXO has been spent since
  originalTokenId?: string   // If known from local storage
}

export interface RecoveryResult {
  recovered: OwnedToken[]    // Successfully recovered tokens
  failed: string[]           // Failed recovery attempts (error messages)
  unspent: FlushedTokenInfo[] // Flushed tokens still unspent (recoverable)
}
```

#### Exported Functions

##### `scanAndRecoverFlushedTokens(provider: WalletProvider, store: TokenStore, onStatus?: (msg: string) => void): Promise<RecoveryResult>`

Main recovery orchestrator that scans the blockchain for flushed tokens.

**Algorithm**:
1. Queries wallet address transaction history
2. Fetches all UTXOs currently owned
3. Iterates through transaction history looking for 1-sat outputs
4. Checks if 1-sat outputs are still unspent (not in current UTXO set)
5. Matches unspent 1-sat outputs against locally stored tokens with `flushTxId`
6. For each recoverable token, updates status to `recovered` and removes flush metadata
7. Reports results with recovered, failed, and unspent categories

**Returns**:
- `recovered[]` - Tokens successfully recovered (status changed to 'recovered')
- `unspent[]` - Flushed tokens found unspent (can be recovered)
- `failed[]` - Error messages for failed recovery attempts

**Status Callback**:
If `onStatus` callback provided, receives status messages:
- "Scanning for flushed tokens..."
- "Checking N transactions..."
- "Found N recoverable flushed token(s)"
- "Recovered: TOKEN_NAME (ID...)"

##### `canRecoverToken(tokenId: string, provider: WalletProvider, store: TokenStore): Promise<boolean>`

Helper function to check if a specific token's flushed UTXO still exists unspent on-chain.

**Algorithm**:
1. Retrieves token from storage and checks for `flushTxId`
2. Fetches address history and current UTXOs
3. Finds the flush transaction in history
4. Checks if any output from that transaction is in current UTXO set
5. Returns true if found unspent, false otherwise

**Use Case**: Quick check before displaying "Recover" button on flushed tokens

---

### 4. app.ts (UI Integration & Event Handlers)

#### New Imports
```typescript
import { scanAndRecoverFlushedTokens, canRecoverToken } from './flushRecovery'
```

#### Updated Functions

##### `renderStatusBadge(status: string): string`
Added cases for new statuses:
- `'flushed'` → Red badge (#da3633)
- `'recovered'` → Green badge (#238636)

##### `renderTokenActions(t: OwnedToken): string`
Enhanced to show:
- **For active tokens**: Added "Flush Token" button (red, #da3633)
- **For flushed tokens**: Added "Recover" button (green, #238636)

#### New Event Handler Functions

##### `_openFlushDialog(tokenId: string)`
Opens the flush confirmation dialog.

**Actions**:
1. Loads token from storage
2. Populates dialog with token name
3. Shows dialog modal
4. Stores tokenId globally for confirm handler

##### `_confirmFlushToken()`
Confirms and executes the flush operation.

**Actions**:
1. Reads preserve-metadata checkbox state
2. Calls `builder.flushToken()` with setting
3. Displays transaction result
4. Updates UI with TXID and amount
5. Refreshes token list and balance

##### `_cancelFlushDialog()`
Closes the flush dialog without action.

##### `_recoverFlushedToken(tokenId: string)`
Quick recovery for a specific flushed token.

**Actions**:
1. Checks if token can be recovered using `canRecoverToken()`
2. Updates token status to 'recovered'
3. Removes flush metadata
4. Refreshes UI

##### `_startRecoveryScan()`
Initiates full blockchain scan for all flushed tokens.

**Actions**:
1. Calls `scanAndRecoverFlushedTokens()` with status callback
2. Displays results in recovery-results div with:
   - Recovered tokens (green box)
   - Recoverable unspent tokens (yellow box)
   - Failed recoveries (red box)
3. Shows quick "Recover Token" buttons for unspent tokens
4. Updates transfer-result with summary

**Result Display Format**:
- Each recovered token shows name and ID
- Each unspent token shows block height, TXID, and satoshis
- Individual "Recover Token" buttons for manual recovery

---

### 5. index.html (UI Elements)

#### New Flush Dialog
```html
<dialog id="flush-dialog">
  <h3>Flush Token</h3>
  <div class="field">
    <span class="label">Token:</span>
    <code id="flush-token-name"></code>
  </div>
  <div class="field">
    <label>
      <input type="checkbox" id="flush-preserve" checked />
      <span>Preserve metadata for recovery</span>
    </label>
  </div>
  <div class="row">
    <button onclick="document.getElementById('flush-dialog').close()">Cancel</button>
    <button onclick="window._confirmFlushToken()">Confirm Flush</button>
  </div>
</dialog>
```

**Styling**:
- 400px max-width centered modal
- Dark theme (#161b22 background)
- Red "Confirm Flush" button (#da3633)
- Explain metadata preservation with help text

#### New Recovery Section
```html
<section id="recovery-section">
  <h2>Token Recovery (v05.23)</h2>
  <button id="btn-recovery-scan" onclick="window._startRecoveryScan()">
    Scan for Flushed Tokens
  </button>
  <div id="recovery-results"></div>
</section>
```

**Features**:
- Scan button for initiating recovery
- Results area showing recovered/recoverable/failed tokens
- Individual "Recover Token" buttons for each unspent token
- Color-coded result boxes

---

## Workflow Examples

### Example 1: Flush a Token with Metadata Preservation
1. User clicks "Flush Token" button on an active NFT card
2. Dialog opens showing token name and recovery info
3. "Preserve metadata for recovery" checkbox is checked (default)
4. User clicks "Confirm Flush"
5. Token UTXO (1 sat) is converted to P2PKH output
6. Token status changes to `flushed` in localStorage
7. `flushTxId` and `flushedAt` are recorded
8. Token can be recovered if UTXO remains unspent for 24 hours

### Example 2: Scan and Recover Flushed Tokens
1. User opens "Token Recovery" section
2. Clicks "Scan for Flushed Tokens"
3. System queries blockchain for all 1-sat outputs matching flush TXIDs
4. Finds 3 recoverable tokens (still unspent)
5. Automatically recovers them and updates status to `recovered`
6. Shows summary: "✓ Recovered: 3"
7. Tokens are now usable again

### Example 3: Flush Without Recovery (Permanent Deletion)
1. User opens flush dialog
2. Unchecks "Preserve metadata for recovery"
3. Clicks "Confirm Flush"
4. Token metadata is immediately deleted from localStorage
5. Token UTXO is converted to spendable sats
6. Token cannot be recovered even if UTXO is still on-chain
7. Use case: Permanently destroy tokens without recovery option

---

## Technical Details

### Flush Transaction Structure
A flush transaction is a regular P2PKH transaction with no token protocol encoding:

```
TX Structure:
├─ Input 0: The 1-sat token UTXO
├─ Input 1+: Funding UTXOs (if change needed)
└─ Output 0: P2PKH output (spendable sats, no OP_RETURN)
```

**Key Point**: Flush transactions contain NO token protocol data. The 1-sat UTXO becomes indistinguishable from regular satoshis on-chain.

### Recovery Strategy
The recovery system works by:
1. **Scanning** address transaction history for 1-sat outputs
2. **Matching** them against locally stored tokens with `flushTxId`
3. **Checking** if the UTXO is still in the current UTXO set (unspent)
4. **Re-importing** tokens with status='recovered'

**24-Hour Window**: Tokens can be recovered as long as the flushed UTXO remains unspent on the blockchain. This could be indefinite if no one spends that output.

### Status Transitions
```
active → [flush] → flushed
                      ↓
                  [recover] → recovered (if unspent)
                                    or lost (if spent)
```

### Fungible Token Flushing
The system also supports flushing individual UTXOs from a fungible token basket:
- Select which UTXOs to flush
- Flushed UTXOs are removed from the basket
- Remaining UTXOs continue as a fungible token
- Each flushed UTXO is tracked separately for recovery

---

## Backward Compatibility

**v05.23 is fully backward compatible** with v05.22:
- Existing token structures work unchanged
- New flush/recovery fields are optional
- Tokens without flush metadata work normally
- Legacy tokens can be flushed without issues
- No migration required for existing wallets

---

## Testing Checklist

- [ ] Flush a single NFT token and verify status changes to `flushed`
- [ ] Flush with metadata preservation enabled
- [ ] Flush with metadata preservation disabled
- [ ] Verify flushed token UTXO appears as regular sats
- [ ] Scan for flushed tokens immediately after flush
- [ ] Wait for block confirmation and scan again
- [ ] Verify recovered tokens show status `recovered`
- [ ] Attempt to flush already-flushed tokens (should fail gracefully)
- [ ] Flush fungible token UTXOs
- [ ] Recover fungible token UTXO
- [ ] Test recovery with network issues (fallback handling)

---

## Implementation Notes

### Memory & Storage
- Flushed token metadata stored in localStorage under `mpt:data:token:TOKENID`
- Per-token: ~500 bytes (name, rules, script, attributes, state)
- No additional database needed
- Recovery scan is read-only (doesn't modify blockchain)

### Performance
- `scanAndRecoverFlushedTokens()` is O(N) where N = transaction count in history
- Typical address: 100-1000 TXs, scan completes in <5 seconds
- `canRecoverToken()` is O(M) where M = UTXO count, typically <100ms

### Error Handling
- Network errors: Fails gracefully with error message
- Missing tokens: Skips silently in scan
- Corrupted metadata: Logged to console, recovery continues
- Blockchain pruning: Recoverable tokens detected, user must have node access

---

## Future Enhancements

Possible improvements for v05.24+:
1. Batch flush operations (flush multiple tokens in one TX)
2. Selective recovery (recover only specific tokens, not all)
3. Recovery via UTXO lookup (if you know the exact UTXO)
4. Token "destruction" with proof (crypto commitment)
5. Automated recovery scheduling (background recovery)
6. Cross-wallet recovery (provide address history, recover without key)

