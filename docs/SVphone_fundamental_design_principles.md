## Proof Token (P)
Feb 4, 2026

##### Introduction by Metro Gnome
#### The simple idea
There needs to be a token that lives within the native Bitcoin architecture, enabling all the advantages of SPV, while removing all the overhead of managing the token itself.

Every token set begins with a genesis mint transaction. Once mined into a block, this becomes the immutable anchor for all the tokens in that mint. The chain is "the single source of truth" and SPV, the supersonic highway back to genesis.

### Use cases

#### SVphone
The simplest and most useful application of the Proof token is to enable a server-less internet phone network, with call initiation transparently and immutably anchored to the blockchain. Providing a safer, cheaper and more private phone architecture than what currently exists today.

#### Blockchain gaming
Tokens can be used in a multiplayer blockchain game. If NFTs were considered to be keys, then these "keys" could be used to unlock "doors" within the game.

#### Content delivery
Books, music, films can be locked within or behind and NFT. Ensuring that only the legitimate owner of the NTF can access the contents.

#### Retail transactions
Both the fungible and non fungible form of P enables invoices, receipts or documents to be attached to a token.

#### NFT coupons
NFT coupons can be created by a retailer and sent to their customers. Coupons can be programmed to be non transferable or only valid within a certain time window.

#### Loyalty cards
A transparent and tamper proof loyalty point card could be minted by a retailer and distributed to customers.

## Overview

The Proof Token (P) is a token protocol on BSV mainnet that uses P2PKH outputs for ownership and OP_RETURN outputs for metadata. Token validity is proven exclusively through Merkle proofs and block headers (SPV), with no dependency on UTXO lookups, indexers, or trusted third parties for verification.

P supports two token modes:
- **NFT Mode**: Each 1-sat output has a unique Token ID based on its genesis output index. Suitable for non-fungible tokens, collectibles, and divisible token fragments.
- **Fungible Mode**: All UTXOs share a single Token ID (genesisOutputIndex fixed at 1). Each satoshi equals one token unit. Multiple UTXOs form a "basket" that can be split and merged through transfers.

## SPV Token Verification

A P token is verified in two steps: **Token ID** (local computation) and **Merkle proof verification** (network-based SPV).

### Token ID Derivation (Local)

The Token ID is a single SHA-256 hash:

```
Token ID = SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)
where immutableChunkBytes = tokenName + tokenScript + tokenRules
```

- `genesisTxId`: 32 bytes, the hash of the genesis transaction
- `outputIndex LE`: 4 bytes little-endian, the P2PKH output index in the genesis TX (starts at 1; output 0 is OP_RETURN)
- `immutableChunkBytes`: The raw pushdata bytes of tokenName, tokenScript, and tokenRules concatenated in order
- **Important:** tokenAttributes is **mutable** and NOT included in the Token ID. This allows tokenAttributes to be updated on each transfer without affecting token identity.

This is a purely local SHA-256 computation. If any immutable field has been tampered with, the recomputed Token ID will not match the claimed one.

### Technical Note on Chunk Indices

The OP_RETURN script contains OP_0 and OP_RETURN opcodes at positions [0] and [1]. When parsing the OP_RETURN data, these opcodes are stripped, creating an index offset:
- Encoder perspective: chunks [2], [3], [4], [5] contain the token data
- Parser perspective: chunks [0], [1], [2], [3] contain the same token data (offset by 2)

This distinction is critical for understanding the codec implementation and how token data is serialized and deserialized.

### Merkle Proof Verification

Given a transaction ID, the verifier obtains its Merkle proof -- an ordered list of sibling hashes that, combined with the transaction hash, reproduce the block's Merkle root.

Verification proceeds bottom-up: starting from the double-SHA-256 of the transaction ID, the verifier concatenates each sibling hash (left or right, as indicated by the proof path) and double-SHA-256s the pair at each level. The final output is the computed Merkle root.

### Block Header Confirmation

The computed Merkle root is compared against the `hashMerkleRoot` field in the block header at the transaction's block height. A match proves the transaction was included in that block. The block header itself is an 80-byte structure whose validity is established by its proof-of-work -- it must hash below the difficulty target for that height.

### Unconfirmed Token Acceptance (Ancestor Proof)

When a token arrives in an unconfirmed transfer transaction, it can be accepted immediately using **ancestor proof verification**:

1. Verify Token ID locally (as above)
2. Get the unconfirmed TX's **Input 0** (references last confirmed TX)
3. Fetch and verify the Merkle proof for that ancestor transaction
4. Retrieve genesis blockHeight from token record or genesis proof
5. Fetch and verify genesis block header
6. Accept token as `active` without waiting for current TX to confirm

This enables **instant token acceptance**. The ancestor proof proves the funding input is real and confirmed, while the genesis block header proves the token originated legitimately.

### Why Only Genesis and Ancestor

Transfer transactions themselves do not require independent block header verification (except the ancestor for unconfirmed tokens). Each transfer spends the previous token UTXO as an input; miners validate that the input exists and is unspent before accepting the transaction into a block. A transfer transaction that references a non-existent or already-spent UTXO is rejected by the network. This is the Bitcoin UTXO model's built-in guarantee -- once a transfer is mined, its validity is implicit.

The genesis transaction is the only one that creates value from nothing (from the token protocol's perspective). Proving it was mined is sufficient to establish that the token's origin is legitimate and that all subsequent transfers were validated by miners through normal transaction processing.

## Token Lifecycle

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                     P TOKEN LIFECYCLE DIAGRAM                                ║
╚══════════════════════════════════════════════════════════════════════════════╝


  ┌─────────────────────────────────────────────────────────────────────────┐
  │                        1. GENESIS (MINT)                                │
  │                        Wallet A creates tokens                          │
  └────────────────────────────────┬────────────────────────────────────────┘
                                   │
                                   ▼
                  ┌───────────────────────────────────┐
                  │         Genesis Transaction       │
                  │                                   │
                  │  Input 0: Funding UTXO(s)         │
                  │          (Wallet A's BSV)         │
                  │                                   │
                  │  Output 0: OP_RETURN (0 sats)     │
                  │    ┌───────────────────────┐      │
                  │    │ "P" | version         │      │
                  │    │ tokenName             │      │
                  │    │ tokenScript           │      │
                  │    │ tokenRules            │      │
                  │    │ tokenAttributes       │      │
                  │    │ stateData             │      │
                  │    └───────────────────────┘      │
                  │                                   │
                  │  Output 1: P2PKH → Wallet A (1sat)│─── Token #1
                  │  Output 2: P2PKH → Wallet A (1sat)│─── Token #2
                  │  Output 3: P2PKH → Wallet A (1sat)│─── Token #3
                  │  ...                              │
                  │  Output N: P2PKH → Wallet A (1sat)│─── Token #N
                  │                                   │
                  │  [Optional: File OP_RETURN]       │
                  │  Output N+1: Change → Wallet A    │
                  └─────────────────┬─────────────────┘
                                    │
                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                  2. RETURN TO MINTER'S WALLET                           │
  │                                                                         │
  │  Token ID = SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)│
  │  where immutableChunkBytes = tokenName + tokenScript + tokenRules      │
  │                                                                         │
  │  Each token is stored with:                                             │
  │    • tokenId (derived, immutable)                                       │
  │    • genesisTxId + genesisOutputIndex (origin reference)                │
  │    • currentTxId + currentOutputIndex (spendable UTXO)                  │
  │    • All metadata fields (name, script, rules, attrs, state)            │
  │    • Proof chain: empty at genesis (no Merkle proof yet)                │
  │    • Status: "active"                                                   │
  └────────────────────────────┬────────────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
  │  Transfer #1    │  │  Transfer #2    │  │  Transfer #N    │
  │  Token #1       │  │  Token #2       │  │  Token #N       │
  │  → Wallet B     │  │  → Wallet C     │  │  → Wallet D     │
  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
           │                    │                     │
           ▼                    ▼                     ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                     3. TRANSFER TRANSACTION                             │
  │                     (one per token)                                     │
  │                                                                         │
  │  Input 0: Token UTXO (1 sat P2PKH, signed by Wallet A)                  │
  │  Input 1+: Funding UTXO(s) (Wallet A's BSV for miner fee)               │
  │                                                                         │
  │  Output 0: P2PKH → Recipient address (1 sat)  ← new token UTXO          │
  │  Output 1: OP_RETURN (0 sats)                                           │
  │    ┌───────────────────────────────────────┐                            │
  │    │ "P" | version                         │                            │
  │    │ tokenName                             │                            │
  │    │ tokenScript                           │                            │
  │    │ tokenRules                            │                            │
  │    │ tokenAttributes (mutable)             │                            │
  │    │ stateData (mutable)                   │                            │
  │    │ ─── transfer-only fields ───          │                            │
  │    │ genesisTxId (32 bytes)                │                            │
  │    │ proofChain (binary bundle)            │                            │
  │    └───────────────────────────────────────┘                            │
  │  Output 2: Change → Wallet A                                            │
  │                                                                         │
  │  Wallet A status: "pending_transfer" → "transferred"                    │
  └────────────────────────────┬────────────────────────────────────────────┘
                               │
                               │  Transaction broadcast to BSV network
                               │  Miners validate and include in block
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                   4. RECIPIENT WALLET DETECTION                         │
  │                                                                         │
  │  Recipient wallet sees a 1-sat UTXO arrive                              │
  │                                                                         │
  │           ┌──────────────────────────────┐                              │
  │           │   1-sat UTXO quarantine zone │                              │
  │           │                              │                              │
  │           │  All 1-sat UTXOs land here   │                              │
  │           │  (could be tokens or dust)   │                              │
  │           └──────────────┬───────────────┘                              │
  │                          │                                              │
  │           Two detection paths:                                          │
  │           • Auto-import (fire-and-forget from quarantine)               │
  │           • Manual scan ("Check Incoming Tokens" button)                │
  │                          │                                              │
  │           ┌──────────────▼────────────────┐                             │
  │           │  Fetch TX, decode OP_RETURN   │                             │
  │           │  Check for "P" + v0x03        │                             │
  │           │  Check P2PKH pays to us       │                             │
  │           └──────────────┬────────────────┘                             │
  │                          │                                              │
  │                    Is it a valid P token?                               │
  │                     NO → skip (stays in quarantine)                     │
  │                     YES ↓                                               │
  └──────────────────────────┬──────────────────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                 5. SPV VERIFICATION GATE                                │
  │                 (before any token is accepted)                          │
  │                                                                         │
  │  Step 1: Recompute Token ID                                             │
  │    Token ID = SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)
  │    where immutableChunkBytes = tokenName + tokenScript + tokenRules    │
  │    Computed ID must match claimed ID                                    │
  │    ✗ Mismatch → REJECT                                                  │
  │                                                                         │
  │  Step 2: Verify provenance (confirmed or unconfirmed)                   │
  │    If confirmed: proof chain in OP_RETURN or fetch from network         │
  │    If unconfirmed: fetch ancestor proof (Input 0, last confirmed TX)    │
  │    ✗ No proof available → REJECT                                        │
  │                                                                         │
  │  Step 3: Verify Merkle proofs                                           │
  │    For confirmed: Hash genesis txId through proof path → Merkle root    │
  │    For unconfirmed: Verify ancestor proof + genesis block header        │
  │    (Bitcoin double SHA-256 at each level)                               │
  │    ✗ Invalid proof → REJECT                                             │
  │                                                                         │
  │  Step 4: Confirm against block header                                   │
  │    Fetch block header(s): genesis (always), ancestor (if unconfirmed)   │
  │    Block header's Merkle root must match computed root                  │
  │    ✗ Mismatch → REJECT                                                  │
  │                                                                         │
  │  ✓ ALL CHECKS PASS → token accepted into wallet as "active"             │
  │                                                                         │
  │  ┌───────────────────────────────────────────────────────────────┐      │
  │  │ NOTE: Genesis block header is always checked. For unconfirmed │      │
  │  │ tokens, ancestor block header is also verified. Transfer TXs  │      │
  │  │ are validated by miners when spent — their block inclusion    │      │
  │  │ is an implicit guarantee.                                     │      │
  │  └───────────────────────────────────────────────────────────────┘      │
  └────────────────────────────┬────────────────────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │               6. TOKEN NOW ACTIVE IN RECIPIENT WALLET                   │
  │                                                                         │
  │  Stored with updated proof chain (includes all prior transfers)         │
  │  currentTxId points to the transfer TX (the spendable UTXO)             │
  │  genesisTxId still points to the original mint                          │
  │                                                                         │
  │  The recipient can now:                                                 │
  │    • Hold the token                                                     │
  │    • Transfer it to another wallet (cycle repeats from step 3)          │
  │    • Run "Verify" (retries genesis verification if incomplete)          │
  │    • Transfer it back to the original minter (return-to-sender)         │
  └────────────────────────────┬────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                 │
              ▼                ▼                 ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │  Transfer onward │ │  Return to       │ │  Manual Verify   │
    │  → Wallet E      │ │  Wallet A        │ │  (retry)         │
    │  (repeat step 3) │ │  (repeat step 3) │ │                  │
    │                  │ │                  │ │  Refreshes the   │
    │  Proof chain     │ │  Wallet A sees   │ │  same genesis    │
    │  grows by one    │ │  token return,   │ │  verification    │
    │  entry per       │ │  re-verifies,    │ │  when auto-check │
    │  transfer        │ │  status → active │ │  was incomplete  │
    └──────────────────┘ └──────────────────┘ └──────────────────┘


  ┌─────────────────────────────────────────────────────────────────────────┐
  │                     PROOF CHAIN GROWTH                                  │
  │                                                                         │
  │  Genesis (mint)     chain: []  (empty, proof fetched on demand)         │
  │       │                                                                 │
  │       ▼                                                                 │
  │  Transfer A→B       chain: [{ txId_A, block, root, path }]              │
  │       │                                                                 │
  │       ▼                                                                 │
  │  Transfer B→C       chain: [{ txId_B, ... }, { txId_A, ... }]           │
  │       │                      ▲ newest-first                             │
  │       ▼                                                                 │
  │  Transfer C→D       chain: [{ txId_C }, { txId_B }, { txId_A }]         │
  │                                                                         │
  │  Each transfer adds one entry. The oldest entry (last in array)         │
  │  always corresponds to the genesis TX.                                  │
  │                                                                         │
  │  Important: The proof chain is embedded in each transfer TX's OP_RETURN │
  │  as binary data. This means the complete verification history travels  │
  │  with the token. The recipient can verify the entire chain from        │
  │  on-chain data alone without any indexer or API.                       │
  └─────────────────────────────────────────────────────────────────────────┘
```

**Network:** BSV Mainnet

---

## Token Design

A P token is a BSV transaction with a specific output structure. Ownership uses standard P2PKH locking scripts for token UTXOs. All token metadata lives in a separate OP_RETURN output. When a `tokenScript` is defined, the consensus script bytes are stored in the OP_RETURN and can be enforced by miners via techniques like OP_PUSH_TX; the P2PKH outputs themselves remain standard.

## Fungible Token Mode

P v05.24 introduces a fungible token mode where satoshis represent token units. Unlike NFT mode where each 1-sat output is a distinct token, fungible mode uses any satoshi value where each sat equals one token unit.

### Key Differences from NFT Mode

| Aspect | NFT Mode | Fungible Mode |
|--------|----------|---------------|
| Token Unit | 1-sat output = 1 unique token | 1 satoshi = 1 token unit |
| Token ID | Unique per output (based on genesisOutputIndex) | Shared (genesisOutputIndex always = 1) |
| UTXO Value | Always 1 sat | Any value > 1 sat |
| Storage Model | One token record per UTXO | One "basket" with multiple UTXOs |
| Split/Merge | Not applicable | Supported via multiple outputs |

### Basket Model

Fungible tokens use a "basket" data structure that groups multiple UTXOs under a single Token ID:

```
FungibleToken {
  tokenId: string           // Shared by all UTXOs in basket
  genesisTxId: string       // Genesis transaction
  tokenName: string         // Token name
  tokenScript: string       // Consensus rules
  tokenRules: string        // Application rules
  tokenAttributes: string   // Mutable attributes
  utxos: [                  // The basket
    { txId, outputIndex, satoshis, status, stateData },
    { txId, outputIndex, satoshis, status, stateData },
    ...
  ]
}
```

Each UTXO in the basket can carry its own `stateData` (e.g., a text message), while sharing the token identity.

### Per-UTXO State Data

In fungible mode, each UTXO in the basket can carry its own `stateData` field. This enables "message" functionality where tokens can be sent with attached text or data.

**Use Cases:**
- Send tokens with a text message (e.g., "Payment for invoice #123")
- Attach metadata to specific UTXOs
- Track provenance of individual token batches

**UI Distinction:**
- **Regular UTXOs**: No state data (or empty `00`). Displayed in "Available" balance.
- **Message UTXOs**: Non-empty state data. Displayed separately with the message content.

**Message Forwarding:**
Message UTXOs can be forwarded to another address while preserving the state data. The "Forward" action sends the entire UTXO (all its satoshis) to the recipient with the same state data.

**Important:** State data is mutable and NOT part of the Token ID. Each transfer can set new state data for the recipient's UTXO.

### Transaction Structure

**Genesis (Fungible):**
- Output 0: OP_RETURN (metadata)
- Output 1: Token UTXO (P2PKH, sats = token units)
- Output 2+: Fee change (NOT token UTXOs)

**Transfer (Fungible):**
- Output 0: Recipient UTXO (P2PKH, transfer amount)
- Output 1: OP_RETURN (metadata + proof chain)
- Output 2: Token change UTXO (P2PKH, remaining tokens)
- Output 3+: Fee change (NOT token UTXOs)

Critical: Only specific output indices carry token value. Fee change outputs (index 2+ for genesis, 3+ for transfer) must NOT be imported as token UTXOs.

### Wallet UTXO Quarantine

To prevent accidental spending of token UTXOs as regular BSV, the wallet implements a quarantine mechanism:

**Safe UTXO Filter (`getSafeUtxos`):**
- UTXOs with `satoshis <= TOKEN_SATS` (currently 1 sat) are quarantined
- These UTXOs are excluded from the spendable balance
- Only "safe" UTXOs (satoshis > TOKEN_SATS) can be used for fees or BSV sends

**Fungible Mode Consideration:**
In fungible mode, token UTXOs have satoshis > 1, so the 1-sat quarantine doesn't protect them. Instead:
- The wallet tracks known fungible token UTXOs in the token store
- `getSpendableBalance()` excludes both NFT UTXOs (1-sat) and known fungible token UTXOs
- Users must explicitly use "Send" from the token card to spend fungible tokens

**Detection Flow:**
1. New UTXOs arrive at the wallet address
2. 1-sat UTXOs → quarantine zone (potential NFTs)
3. Larger UTXOs → check transaction history for P OP_RETURN
4. If valid P token found → import to appropriate token basket
5. If not P token → available as regular BSV (unless already tracked as token)

## Token Verification Flow

A token is accepted into the wallet only after passing SPV verification. This applies to all incoming tokens — whether detected automatically from quarantined UTXOs, found during a manual scan, or returning from a previous transfer.

### On Import (automatic gate)

When the wallet encounters an incoming token:

1. **Token identity check:** Recompute the Token ID from the claimed genesis transaction, output index, and immutable metadata fields (name, script, rules). If the computed ID doesn't match the claimed ID, the token is rejected. Note: tokenAttributes is **mutable** and not part of the Token ID check.

2. **For confirmed tokens:** The proof chain is embedded in OP_RETURN (transfers) or fetched from network (genesis). Verify genesis Merkle proof against block header.

3. **For unconfirmed tokens:** Fetch ancestor proof (from Input 0, the last confirmed TX), verify it, retrieve genesis blockHeight, and verify genesis block header. Accept token as `active` immediately without waiting for current TX to confirm.

3. **Verify the genesis transaction was mined:** Using the Merkle proof for the genesis transaction, the wallet computes the Merkle root by hashing from the transaction ID up through the proof path using Bitcoin's double SHA-256. The computed root must match the root claimed in the proof entry.

4. **Confirm against the block header:** The wallet fetches the block header at the genesis transaction's block height and confirms that the block's Merkle root matches the one computed from the proof. This proves the genesis transaction was included in an actual mined block.

Only the genesis transaction's block header is required. Transfer transactions are already validated by miners when they are spent, so their inclusion in a block is an implicit guarantee.

### On Manual Verify (retry)

When the user clicks "Verify," the wallet refreshes the same genesis-only verification procedure. This is used when the automated import could not complete verification (e.g. transaction not yet confirmed, network timeout, or time budget exceeded). The manual action queues the token for another verification pass using the same steps described above.

## Token Data Fields

### Immutable Fields

All immutable fields are cryptographically bound to the Token ID. Tampering with any of them causes a Token ID mismatch -- instant verification failure. No additional checking logic needed for these fields; the existing `computeTokenId` check catches it.

**[Token ID]**
- `SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)` where `immutableChunkBytes = tokenName + tokenScript + tokenRules`
- Deterministic, purely local computation. No network access required.
- `outputIndex` is the actual Bitcoin output index of the token's P2PKH in the genesis TX. Since Output 0 is the OP_RETURN, token indices start at 1. Single mint = 1, batch mint = 1..N.
- `immutableChunkBytes` binds the shared collection identity (name, script, rules). **Important:** tokenAttributes is NOT included in this computation.

**[Token Name]**
- UTF-8 text string.
- Shared across all tokens in the genesis transaction. Identifies the NFT set.
- Immutable after genesis. Included in Token ID computation.

**[Token Script]** (default: empty)
- Optional field for additional miner-enforced consensus rules.
- Empty (zero-length pushdata) = no additional consensus rules; token ownership is enforced solely by the P2PKH output's standard 25-byte locking script (`OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG`).
- When non-empty, contains raw Bitcoin Script bytes defining extra validation constraints (e.g. issuer co-sign, Merkle whitelist, time locks, state mutation constraints).
- Immutable after genesis. Included in Token ID computation.

**[Token Rules]**
- Arbitrary structured data defining token behaviour (application-level, wallet-enforced).
- The protocol does not prescribe a specific format — this field is flexible and can contain any binary data meaningful to the issuing application.
- Immutable after genesis. Included in Token ID computation.

**Example implementation (v05 prototype):** 8 bytes encoding supply, divisibility, restrictions, and version (v05.24):
  - **Supply** (uint16): Total number of whole tokens minted in this genesis transaction (max 65535).
  - **Divisibility** (uint16): Number of fragments per whole token. 0 = NFT/indivisible. When > 0, the genesis TX mints supply × divisibility fragment UTXOs.
  - **Transfer Restrictions** (uint16): Unrestricted, whitelist, time-lock, or custom wallet-enforced conditions.
  - **Version** (uint16): Integer. Allows future rule extensions.

**Note on Divisible Tokens:**
When divisibility > 0, each output index (1 through supply × divisibility) represents a fragment with its own unique Token ID. Example: supply=3, divisibility=2 creates 6 fragment UTXOs:
  - Output 1 = NFT 1, piece 1/2
  - Output 2 = NFT 1, piece 2/2
  - Output 3 = NFT 2, piece 1/2
  - Output 4 = NFT 2, piece 2/2
  - Output 5 = NFT 3, piece 1/2
  - Output 6 = NFT 3, piece 2/2

Each fragment can be transferred independently and is tracked with its own Token ID based on its genesisOutputIndex.

### Mutable Fields

Checked by wallet application against Token Rules. Can be updated by the wallet app as well as on each transfer.

**[Token Attributes]** (default: empty)
- **Mutable** data shared by all tokens in the NFT set. **NOT part of the Token ID computation**, allowing it to be updated on each transfer without affecting token identity.
- When unused, must still be present as zero-length pushdata (for positional parsing).
- All tokens within a single genesis TX share the same attributes value (though each transfer can update it independently).
- For tokens with different attributes (e.g. different rarity tiers), use separate genesis TXs (separate NFT sets).
- When a file is embedded, tokenAttributes contains the SHA-256 hash of the file (32 bytes). The full file data lives in a separate OP_RETURN output in the genesis TX only. File verification: compute SHA-256(file bytes) and compare to stored hash. This design allows file size to not increase transfer TX costs.
- Examples: rarity tier, trait set, content hash, collection metadata, SHA-256 file hash.

**[State Data]** (default: 0x00)
- Arbitrary bytes, minimum 1 byte. Usage defined by Token Rules.
- Always present (required for positional chunk parsing to distinguish genesis from transfer TXs).
- Examples: metadata hash, counter, status flag, IPFS CID.

### Output Index Clarification

Understanding the distinction between genesisOutputIndex and currentOutputIndex is important for implementing transfers correctly:

**genesisOutputIndex**: The P2PKH output index in the genesis TX.
- **NFT Mode**: 1-based, never changes. For batch/divisible tokens: 1..N or 1..S×D (where S = supply, D = divisibility). This value is embedded in each transfer's OP_RETURN to identify which specific fragment is being transferred.
- **Fungible Mode**: Always 1. All UTXOs share the same Token ID regardless of their actual output index.

**currentOutputIndex**: The current UTXO's output index.
- **NFT Mode**: In genesis TXs equals genesisOutputIndex. After first transfer: always 0 (P2PKH outputs in transfer TXs are always Output 0).
- **Fungible Mode**: In genesis TXs: 1. After transfers: 0 (recipient) or 2 (change). Fee change outputs at index 2+ (genesis) or 3+ (transfer) are NOT token UTXOs.

This distinction is critical for NFT mode because fragments from divisible tokens cannot be distinguished after the first transfer without carrying genesisOutputIndex in the OP_RETURN. For fungible mode, the distinction ensures only valid token outputs are imported into the basket.

-------------------------------------------------------------------------------


Open BSV License Version 5 – granted by BSV Association, Grafenauweg 6, 6300
Zug, Switzerland (CHE-427.008.338) ("Licensor"), to you as a user (henceforth
"You", "User" or "Licensee").

For the purposes of this license, the definitions below have the following
meanings:

"Bitcoin Protocol" means the protocol implementation, cryptographic rules,
network protocols, and consensus mechanisms in the Bitcoin White Paper as
described here https://protocol.bsvblockchain.org.

"Bitcoin White Paper" means the paper entitled 'Bitcoin: A Peer-to-Peer
Electronic Cash System' published by 'Satoshi Nakamoto' in October 2008.

"BSV Blockchains" means:
  (a) the Bitcoin blockchain containing block height #556767 with the hash
      "000000000000000001d956714215d96ffc00e0afda4cd0a96c96f8d802b1662b" and
      that contains the longest honest persistent chain of blocks which has been
      produced in a manner which is consistent with the rules set forth in the
      Network Access Rules; and
  (b) the test blockchains that contain the longest honest persistent chains of
      blocks which has been produced in a manner which is consistent with the
      rules set forth in the Network Access Rules.

"Network Access Rules" or "Rules" means the set of rules regulating the
relationship between BSV Association and the nodes on BSV based on the Bitcoin
Protocol rules and those set out in the Bitcoin White Paper, and available here
https://bsvblockchain.org/network-access-rules.

"Software" means the software the subject of this licence, including any/all
intellectual property rights therein and associated documentation files.

BSV Association grants permission, free of charge and on a non-exclusive and
revocable basis, to any person obtaining a copy of the Software to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to and conditioned upon the following conditions:

1 - The text "© BSV Association," and this license shall be included in all
copies or substantial portions of the Software.
2 - The Software, and any software that is derived from the Software or parts
thereof, must only be used on the BSV Blockchains.

For the avoidance of doubt, this license is granted subject to and conditioned
upon your compliance with these terms only. In the event of non-compliance, the
license shall extinguish and you can be enjoined from violating BSV's
intellectual property rights (incl. damages and similar related claims).

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES REGARDING ENTITLEMENT,
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS THEREOF BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.


Version 0.1.1 of the Bitcoin SV software, and prior versions of software upon
which it was based, were licensed under the MIT License, which is included below.

The MIT License (MIT)

Copyright (c) 2009-2010 Satoshi Nakamoto
Copyright (c) 2009-2015 Bitcoin Developers
Copyright (c) 2009-2017 The Bitcoin Core developers
Copyright (c) 2017 The Bitcoin ABC developers
Copyright (c) 2018 Bitcoin Association for BSV
Copyright (c) 2023 BSV Association

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


-------------------------------------------------------------------------------
