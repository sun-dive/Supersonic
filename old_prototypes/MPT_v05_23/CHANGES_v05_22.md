# MPT v05.22 Changes

## Summary

Added local pending UTXO tracking to enable consecutive fragment/token transfers without waiting for confirmation.

## Problem

When sending fragment A, the change output from that TX isn't visible in WoC's UTXO list until the TX is confirmed. When you try to send fragment B immediately, the wallet can't find any funding UTXOs and fails with "No funding UTXOs available".

## Solution

Track pending UTXOs locally in the wallet provider:

1. **Pending UTXOs**: When we broadcast a TX, track the change output as a pending UTXO
2. **Spent Outpoints**: Mark inputs we've spent so they're excluded from available UTXOs
3. **Auto-cleanup**: When a pending UTXO appears in confirmed UTXOs, remove it from tracking

## Code Changes

### walletProvider.ts

Added two tracking structures:
```typescript
private pendingUtxos = new Map<string, Utxo>()  // key: "txId:outputIndex"
private spentOutpoints = new Set<string>()       // key: "txId:outputIndex"
```

Updated `getUtxos()`:
- Fetches confirmed UTXOs from WoC
- Filters out locally-spent outpoints
- Adds pending UTXOs (unconfirmed change outputs)
- Auto-cleans pending UTXOs when they appear confirmed

Added `registerPendingTx(txId, spentInputs, changeOutput)`:
- Called after broadcast
- Marks spent inputs in `spentOutpoints`
- Tracks change output in `pendingUtxos`

Added `clearConfirmedSpends(spentInputs)`:
- Cleans up `spentOutpoints` when a TX is confirmed

### tokenBuilder.ts

Updated build functions to return spent inputs and change output info:
- `buildFundedTx()` - returns `spentInputs` and `changeOutput`
- `buildFundedTransferTx()` - returns `spentInputs` and `changeOutput`
- `buildFundedFungibleTransferTx()` - returns `spentInputs` and `changeOutput`

Updated all broadcast call sites to register pending TXs:
- `createGenesis()`
- `createFungibleGenesis()`
- `createTransfer()`
- `transferFungibleTokens()`
- `transferFungibleUtxo()`
- `sendSats()`

## Usage Example

```
// Before v05.22:
Transfer fragment 1 -> success
Transfer fragment 2 -> ERROR: No funding UTXOs available
(wait for block confirmation)
Transfer fragment 2 -> success

// After v05.22:
Transfer fragment 1 -> success (change tracked locally)
Transfer fragment 2 -> success (uses pending change UTXO)
Transfer fragment 3 -> success (uses pending change UTXO)
...
```

## Backwards Compatibility

This is a wallet-layer change only. No protocol changes. v05.22 wallets can interact with v05.21 tokens without issues.

## Benefits

- Send multiple fragments/tokens consecutively without waiting for confirmation
- Better UX for batch operations
- Automatic cleanup when TXs confirm
