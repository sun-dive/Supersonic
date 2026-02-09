# MPT v05.21 Changes

## Summary

Removed redundant `genesisOutputIndex` field from transfer TX OP_RETURN. This value is now derived from Input 0 of the transfer TX.

## Rationale

The transfer TX we receive already contains all the information needed:
- **Input 0** of the transfer TX spends the previous token UTXO
- Input 0's `sourceTXID` tells us which TX the token came from
- Input 0's `sourceOutputIndex` tells us which output was spent

For a **direct transfer** (genesis → recipient), Input 0 points directly to the genesis TX. The `sourceOutputIndex` IS the genesisOutputIndex - no network fetch required.

For a **multi-hop transfer** (genesis → A → B → ...), we trace Input 0 backwards through each TX until we find one that references the genesis TX.

Encoding `genesisOutputIndex` in every transfer OP_RETURN was redundant - it added 5 bytes (4 data + 1 pushdata opcode) per transfer with no benefit.

## OP_RETURN Format Changes

### Genesis TX (unchanged - 7 data chunks)

| Parser Index | Field | Size | Description |
|-------------|-------|------|-------------|
| 0 | MPT prefix | 3B | "MPT" (0x4d5054) |
| 1 | version | 1B | 0x02 for v05 |
| 2 | tokenName | variable | UTF-8 |
| 3 | tokenScript | variable | Consensus script (empty = P2PKH) |
| 4 | tokenRules | 8B | supply, divisibility, restrictions, version |
| 5 | tokenAttributes | variable | User-level data |
| 6 | stateData | variable | Mutable state (min 1 byte) |

### Transfer TX (v05.21 - 9 data chunks, was 10)

| Parser Index | Field | Size | Description |
|-------------|-------|------|-------------|
| 0-6 | (same as genesis) | | |
| 7 | genesisTxId | 32B | Genesis TX hash |
| 8 | proofChainBinary | variable | Compact binary proof chain |
| ~~9~~ | ~~genesisOutputIndex~~ | ~~4B~~ | **REMOVED in v05.21** |

## Code Changes

### opReturnCodec.ts

- `TokenOpReturnData` interface: removed `genesisOutputIndex` field
- `encodeOpReturn()`: no longer encodes genesisOutputIndex
- `decodeOpReturn()`: detection changed from `chunks.length >= 10` to `>= 9`

### tokenBuilder.ts

- Added `deriveGenesisOutputIndex(transferTx, genesisTxId)` method that takes the TX object (not TX ID)
- `tryAutoImport()`: passes already-fetched TX to `deriveGenesisOutputIndex()` for transfer TXs
- `checkIncomingTokens()`: passes already-fetched TX to `deriveGenesisOutputIndex()` for transfer TXs
- `createTransfer()`: no longer passes genesisOutputIndex to OP_RETURN encoder

## Derivation Algorithm

```
deriveGenesisOutputIndex(transferTx, genesisTxId):
  // Read Input 0 from the TX we already have (no fetch needed)
  input0 = transferTx.inputs[0]  // Token UTXO is always Input 0
  prevTxId = input0.sourceTXID
  prevOutputIndex = input0.sourceOutputIndex

  // Direct transfer: genesis → recipient
  if prevTxId === genesisTxId:
    return prevOutputIndex  // This IS the genesisOutputIndex

  // Multi-hop transfer: trace back through chain
  txId = prevTxId
  while true:
    tx = fetchTransaction(txId)
    input0 = tx.inputs[0]
    prevTxId = input0.sourceTXID
    prevOutputIndex = input0.sourceOutputIndex
    if prevTxId === genesisTxId:
      return prevOutputIndex
    txId = prevTxId
```

The token UTXO is always spent as Input 0 in transfer TXs. For most transfers (direct), Input 0 of the transfer TX we already have points straight to genesis - no additional network fetch needed.

## Backwards Compatibility

**v05.21 wallets cannot import tokens from v05.20 transfer TXs** because:
- v05.20 transfer TXs have 10 chunks
- v05.21 expects 9 chunks for transfer detection

**v05.20 wallets cannot import tokens from v05.21 transfer TXs** because:
- v05.21 transfer TXs have 9 chunks
- v05.20 expects 10 chunks and reads genesisOutputIndex from chunk[9]

This is a breaking protocol change. Tokens must be transferred between wallets running the same version.

## Benefits

- 5 bytes smaller per transfer TX (4 bytes data + 1 byte pushdata opcode)
- Cleaner protocol: no redundant data
- For direct transfers (the common case): genesisOutputIndex is read from Input 0 with zero network calls
- For multi-hop transfers: derives from chain traversal using same Input 0 pattern
