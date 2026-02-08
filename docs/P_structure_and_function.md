# Proof Token Protocol (P) Prototype v05.21 -- Structure and Function

Imagined and designed by Metro Gnome
Built by Metro and a team of Claudes
February 4th, 2026

## Overview

The Proof Token Protocol (P token protocol) is a token protocol on BSV mainnet that uses P2PKH outputs for ownership and OP_RETURN outputs for metadata. Token validity is proven exclusively through Merkle proofs and block headers (SPV), with no dependency on UTXO lookups, indexers, or trusted third parties for verification.

MPT supports two token modes:
- **NFT Mode**: Each 1-sat output has a unique Token ID based on its genesis output index. Suitable for non-fungible tokens, collectibles, and divisible token fragments.
- **Fungible Mode**: All UTXOs share a single Token ID (genesisOutputIndex fixed at 1). Each satoshi equals one token unit. Multiple UTXOs form a "basket" that can be split and merged through transfers.

Prototype v05 enforces a clean architectural separation between the pure SPV token protocol and the wallet layer that interacts with the blockchain. v05 adds a `tokenScript` field for optional consensus-level validation enforced by miners. v05.10 introduces fungible token support with per-UTXO state data. v05.21 removes redundant `genesisOutputIndex` from transfer OP_RETURN (now derived from Input 0 of the transfer TX).

**Network:** BSV Mainnet (real BSV)

---

## Token Design

An P token token is a BSV transaction with a specific output structure. Ownership uses standard P2PKH locking scripts for token UTXOs. All token metadata lives in a separate OP_RETURN output. When a `tokenScript` is defined (v05), the consensus script bytes are stored in the OP_RETURN and can be enforced by miners via techniques like OP_PUSH_TX; the P2PKH outputs themselves remain standard.

### Token Modes

MPT v05.10 supports two distinct token modes:

**NFT Mode (Original)**
- Each 1-sat P2PKH output is a unique token with its own Token ID
- Token ID = `SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)`
- Each output index (1, 2, ... N) produces a different Token ID
- Suitable for non-fungible tokens, collectibles, and divisible token fragments

**Fungible Mode (New in v05.10)**
- All UTXOs share a **single Token ID** (genesisOutputIndex fixed at 1)
- Each satoshi equals one token unit (satoshis ARE the token balance)
- Multiple UTXOs form a "basket" that can be split and merged
- Genesis mints a single UTXO with the total supply in satoshis
- Transfers can split/merge: spend multiple inputs, create multiple outputs
- Per-UTXO state data enables messages or metadata attached to individual UTXOs

**Token ID Computation:**
- NFT Mode: `SHA-256(genesisTxId || actualOutputIndex LE || immutableChunkBytes)`
- Fungible Mode: `SHA-256(genesisTxId || 1 LE || immutableChunkBytes)` — always uses index 1

**Satoshi Semantics:**
| Mode | Satoshi Value | Token Units |
|------|---------------|-------------|
| NFT Mode | Always 1 sat | 1 token per UTXO |
| Fungible Mode | Variable (≥546 dust limit) | Satoshis = token units |

## Token Data Fields

### Immutable Fields

All immutable fields are cryptographically bound to the Token ID. Tampering with any of them causes a Token ID mismatch -- instant verification failure. No additional checking logic needed for these fields; the existing `computeTokenId` check catches it.

**[Token ID]**
- `SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)` where `immutableChunkBytes = tokenName + tokenScript + tokenRules`
- Deterministic, purely local computation. No network access required.
- `outputIndex` is the actual Bitcoin output index of the token's P2PKH in the genesis TX. Since Output 0 is the OP_RETURN, token indices start at 1. Single mint = 1, batch mint = 1..N.
- `immutableChunkBytes` binds the immutable collection identity (name, script, rules). tokenAttributes is mutable and not bound to the Token ID.

**[Token Name]**
- UTF-8 text string.
- Shared across all tokens in the genesis transaction. Identifies the NFT set.

**[Token Script]** (new in v05)
- Raw Bitcoin Script bytes for consensus-level validation, enforced by miners.
- Empty (zero-length pushdata) = standard P2PKH ownership (functionally equivalent to v04).
- When non-empty, this script defines miner-enforced rules for the token (e.g. issuer co-sign, Merkle whitelist, time locks, state mutation constraints).
- Immutable after genesis. Included in Token ID computation.
- See `docs/consensus_level_scripts_research.md` for background on consensus-level enforcement patterns.

**[Token Rules]**
- Structured data defining token behaviour (application-level, wallet-enforced):
  - **Supply:** Total number of whole tokens minted in this genesis transaction (uint16, max 65535).
  - **Divisibility:** Number of fragments per whole token (uint16). 0 = NFT/indivisible. When > 0, the genesis TX mints `supply * divisibility` fragment UTXOs.
  - **Transfer Restrictions:** Unrestricted, whitelist, time-lock, or custom wallet-enforced conditions.
  - **Version:** Integer. Allows future rule extensions.

**[Token Attributes]** (optional, mutable)
- Data shared by all tokens in the NFT set. Set at genesis but can be updated on each transfer. If unused, the chunk is a zero-length pushdata (the chunk must still be present for positional parsing).
- All tokens within a single genesis TX have identical attributes initially.
- For tokens with different attributes (e.g. different rarity tiers), use separate genesis TXs (separate NFT sets), or update tokenAttributes in transfers.
- When a file is embedded, tokenAttributes contains the SHA-256 hash of the file (32 bytes). The full file data lives in a separate OP_RETURN output in the genesis TX only (see Embedded File Data section).
- Examples: rarity tier, trait set, content hash, collection metadata, SHA-256 file hash, IPFS CID, mutable state reference.
- **Important:** tokenAttributes is NOT bound to Token ID, so changes do not affect token identity.

### Mutable Fields

Checked by wallet application against Token Rules. Can be updated by the wallet app as well as on each transfer.

**[State Data]**
- Arbitrary bytes, minimum 1 byte. Usage defined by Token Rules.
- Always present (required for positional chunk parsing to distinguish genesis from transfer TXs).
- Examples: metadata hash, counter, status flag, IPFS CID.

### Transaction Structure

**Genesis TX (mint) -- single token (supply = 1):**

```
Input 0:   Funding UTXO (signed by minter)
Output 0:  OP_RETURN with token metadata (0 sat) -- shared token data
Output 1:  P2PKH to minter's address (1 sat) -- the token UTXO
Output 2:  Change back to minter (if needed)
```

**Genesis TX (mint) -- single token with embedded file:**

```
Input 0:   Funding UTXO (signed by minter)
Output 0:  OP_RETURN with token metadata (0 sat) -- shared token data (attrs = SHA-256 of file)
Output 1:  P2PKH to minter's address (1 sat) -- the token UTXO
Output 2:  OP_RETURN with MPT-FILE data (0 sat) -- embedded file (mimeType, fileName, bytes)
Output 3:  Change back to minter (if needed)
```

**Genesis TX (mint) -- batch (supply = N):**

```
Input 0:   Funding UTXO (signed by minter)
Output 0:  OP_RETURN with token metadata (0 sat) -- shared token data
Output 1:  P2PKH to minter's address (1 sat) -- token #0
Output 2:  P2PKH to minter's address (1 sat) -- token #1
...
Output N:  P2PKH to minter's address (1 sat) -- token #(N-1)
Output N+1: OP_RETURN with MPT-FILE data (0 sat) -- if file embedded
Output N+2: Change back to minter (if needed)
```

All tokens in a batch share a single OP_RETURN (Output 0) containing identical metadata. Each token is a separate 1-sat P2PKH output at indices 1 through N. The `outputIndex` used in the Token ID is the actual Bitcoin output index (1, 2, ..., N), not a zero-based token number. Token #0 in the set has `outputIndex = 1`. When a file is embedded, the MPT-FILE OP_RETURN is placed after the token P2PKH outputs and before the change output.

**Genesis TX (mint) -- divisible token (supply = S, divisibility = D):**

```
Input 0:   Funding UTXO (signed by minter)
Output 0:  OP_RETURN with token metadata (0 sat) -- shared token data
Output 1:  P2PKH to minter's address (1 sat) -- fragment #1 (NFT 1, piece 1/D)
Output 2:  P2PKH to minter's address (1 sat) -- fragment #2 (NFT 1, piece 2/D)
...
Output D:  P2PKH to minter's address (1 sat) -- fragment #D (NFT 1, piece D/D)
Output D+1: P2PKH to minter's address (1 sat) -- fragment #D+1 (NFT 2, piece 1/D)
...
Output S*D: P2PKH to minter's address (1 sat) -- fragment #S*D (NFT S, piece D/D)
Output S*D+1: OP_RETURN with MPT-FILE data (0 sat) -- if file embedded
Output S*D+2: Change back to minter (if needed)
```

When `divisibility > 0`, the genesis TX mints `supply * divisibility` fragment UTXOs instead of `supply` outputs. Each fragment is a distinct 1-sat P2PKH output with its own Token ID (derived from its unique `outputIndex`). See the Divisible Tokens / Fractional NFTs section for details.

**Transfer TX:**

```
Input 0:   Token UTXO from previous owner (signed by owner)
Input 1+:  Funding UTXOs for fees (signed by sender)
Output 0:  P2PKH to recipient's address (1 sat) -- new token UTXO
Output 1:  OP_RETURN with token metadata + proof chain (0 sat) -- updated token data
Output 2:  Change back to sender (if needed)
```

Transfer TXs always transfer a single token (or a single fragment). The OP_RETURN includes the genesisTxId and proof chain so the recipient can verify the token's full history. Transfer TX output order (P2PKH at 0, OP_RETURN at 1) differs from genesis TX output order (OP_RETURN at 0, P2PKH outputs at 1+).

**Fungible Genesis TX (mint):**

```
Input 0:   Funding UTXO (signed by minter)
Output 0:  OP_RETURN with token metadata (0 sat) -- shared token data
Output 1:  P2PKH to minter's address (N sats) -- the token UTXO (N = initial supply)
Output 2:  Change back to minter (if needed) -- NOT a token UTXO
```

Fungible genesis creates a single token UTXO at Output 1 where the satoshi value equals the token supply. Output 2+ are fee change outputs and must NOT be imported as token UTXOs. The genesisOutputIndex is always 1 for fungible tokens.

**Fungible Transfer TX:**

```
Input 0:   Token UTXO(s) from sender (signed by owner)
Input 1+:  Additional token UTXOs and/or funding UTXOs
Output 0:  P2PKH to recipient's address (transfer amount sats) -- recipient token UTXO
Output 1:  OP_RETURN with token metadata + proof chain (0 sat)
Output 2:  P2PKH to sender's address (remaining sats) -- token change UTXO (if any)
Output 3:  Change back to sender (if needed) -- fee change, NOT a token UTXO
```

**Valid Fungible Output Indices:**
| TX Type | Token UTXO Indices | Non-Token Indices |
|---------|-------------------|-------------------|
| Genesis | 1 only | 2+ (fee change) |
| Transfer | 0 (recipient), 2 (token change) | 3+ (fee change) |

Critical: Only specific output indices carry token value. Fee change outputs must NOT be imported into the token basket.

### NFT Sets and Collections

- An **NFT set** is all tokens from a single genesis TX. They share tokenName, tokenScript, tokenRules, and tokenAttributes. The only differentiator is `outputIndex`.
- A **collection** is multiple NFT sets that share the same tokenName but may have different tokenAttributes (e.g. different rarity tiers). Each variation requires a separate genesis TX.
- Example: A collection of 100 NFTs with 5 rarity tiers = 5 genesis TXs, each with supply = 20, each with different tokenAttributes describing that tier.

### On-Chain Fields (OP_RETURN)

The OP_RETURN contains these fields as separate pushdata chunks:

Chunk ordering follows enforcement level (highest authority first):

**Note on chunk indices:** The table below shows **data chunk indices as returned by the parser** (after OP_0 and OP_RETURN are skipped). In the encoder's raw LockingScript array, OP_0 and OP_RETURN occupy indices [0] and [1], so all data chunks are offset by 2. For example, `"P"` is at index [2] in the encoder but [0] in the parser.

| Data Chunk | Field | Size | Enforcement | Description |
|-------|-------|------|-------------|-------------|
| 0 | `"P"` | 3B | -- | Protocol identifier (encoder [2]) |
| 1 | version | 1B | -- | OP_RETURN format version (`0x02` for v05). Determines how to parse chunks. (encoder [3]) |
| 2 | tokenName | variable | Identity | UTF-8 human-readable name (encoder [4]) |
| 3 | tokenScript | variable | Consensus (miners) | Raw Bitcoin Script for miner-enforced rules. Empty = P2PKH. (encoder [5]) |
| 4 | tokenRules | 8B | Application (wallet) | Packed rules: supply, divisibility, restrictions bitfield, version (encoder [6]) |
| 5 | tokenAttributes | variable | User-level | Mutable attributes shared by all tokens in the set (hex). Not bound to Token ID. (encoder [7]) |
| 6 | stateData | variable | Mutable | Application state (min 1 byte) (encoder [8]) |
| 7 | genesisTxId | 32B | -- | *Transfer only:* raw genesis TX hash (encoder [9]) |
| 8 | proofChainBinary | variable | -- | *Transfer only:* compact binary proof chain (encoder [10]) |

*v05.21:* `genesisOutputIndex` removed from OP_RETURN. Derived from Input 0 of the transfer TX (see Genesis Output Index Derivation section).

**Genesis TX OP_RETURN:** Data chunks [0-6] (7 data chunks). No genesisTxId or proofChainBinary -- not needed at mint time. When a file is embedded, a separate OP_RETURN output with the `MPT-FILE` marker is added to the genesis TX (see Embedded File Data).

**Transfer TX OP_RETURN:** Data chunks [0-8] (9 data chunks). genesisTxId and proofChainBinary carry the token's verifiable history. Ownership is determined by the P2PKH output, not by any OP_RETURN field. No file data is included -- only the 32-byte hash in tokenAttributes. *v05.21:* genesisOutputIndex is derived from Input 0 of the transfer TX, not stored in the OP_RETURN.

**Parsing rule:** The chunk count distinguishes genesis from transfer: 7 data chunks = genesis, 9 data chunks = transfer (v05.21). stateData (data chunk [6]) is always present with a minimum of 1 byte to ensure consistent chunk counts. The version byte (`0x02`) signals v05 format with the tokenScript chunk.

**Empty tokenScript cost:** When tokenScript is empty (standard P2PKH behaviour), the chunk is a single `OP_0` byte -- adding only 1 byte to the transaction compared to v04.

### What Changes Between Transfers

| Field | Mutable? | Notes |
|-------|----------|-------|
| tokenName | Immutable | Set at genesis, bound to Token ID |
| tokenScript | Immutable | Set at genesis, bound to Token ID. Empty = P2PKH (no consensus rules). |
| tokenRules | Immutable | Set at genesis, bound to Token ID |
| tokenAttributes | **Mutable** | Set at genesis, shared by all tokens in the set. Not bound to Token ID. Can be updated on each transfer. |
| stateData | **Mutable** | Can be updated according to Token Rules |
| genesisTxId | Fixed | Always references the original mint TX |
| proofChainBinary | **Grows** | New Merkle proof entry prepended on each transfer |

### Encoding Format

MPT uses **raw pushdata chunks** in the OP_RETURN output. Each field is a separate pushdata element in the script, identified by position. This requires no external libraries, schemas, or deserializers -- any Bitcoin library that can parse standard scripts can decode P token metadata.

Compared to other BSV token encodings:

| | P token (Raw Pushdata) | 1Sat Ordinals (Content Blob) | RUN (CBOR) | STAS (Script Opcodes) | Tokenized (Protobuf) |
|---|---|---|---|---|---|
| Parse complexity | Trivial | Varies | Library needed | Script interpreter | Library + schema |
| External dependencies | None | Content decoders | CBOR library | Script engine | Protobuf runtime |
| Indexer required | **No** | Yes | Yes | Partial | Yes |
| Self-contained TX | **Yes** | Partial | No | No | No |

The zero-dependency parsing aligns with MPT's SPV-only philosophy. The protocol is simple enough that positional encoding isn't a burden.

### Token ID

```
Token ID = SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)
```

where `immutableChunkBytes = tokenName + tokenScript + tokenRules` (concatenated raw bytes of the immutable fields)

The Token ID is a deterministic, purely local computation. It binds the token's identity to its genesis transaction and the immutable consensus rules. No network access is required to compute or verify it. Tampering with any immutable field causes a Token ID mismatch, instant verification failure. tokenAttributes is mutable and not bound to the Token ID.

### Genesis Output Index Derivation (v05.21)

In v05.21, `genesisOutputIndex` is no longer encoded in the transfer OP_RETURN. Instead, it is derived from Input 0 of the transfer TX:

**Direct Transfer (genesis → recipient):**
- Input 0 of the transfer TX spends the genesis TX output directly
- `Input 0.sourceTXID` = genesisTxId
- `Input 0.sourceOutputIndex` = genesisOutputIndex
- No network fetch required

**Multi-hop Transfer (genesis → A → B → ...):**
- Input 0 of the transfer TX spends a previous transfer TX
- Trace Input 0 backwards through each TX until `sourceTXID` matches genesisTxId
- The `sourceOutputIndex` at that point is the genesisOutputIndex

This approach saves 5 bytes per transfer TX (4 bytes data + 1 byte pushdata opcode) while requiring zero additional network calls for direct transfers (the common case).

### Verification Model

Token validity is proven exclusively through Merkle proofs and block headers:

1. Token ID matches `SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)` where `immutableChunkBytes = tokenName + tokenScript + tokenRules`
2. Every entry in the proof chain has a valid Merkle proof (double SHA-256)
3. Every Merkle root matches its block header at that height
4. The oldest entry's txId matches the genesis txId

The proof chain travels with the token. Any node with block headers can verify it without replaying history or querying an indexer.

### tokenRules Enforcement

`tokenRules` is an 8-byte packed field (4 x uint16 LE): supply, divisibility, restrictions (bitfield), and version. It is set at genesis and copied unchanged on every transfer.

**Application-level, not consensus-level:** `tokenRules` lives in the OP_RETURN (unspendable) -- miners don't execute logic on it. Token rules cannot be enforced at the consensus layer. Instead, P token **detects** rule violations during verification rather than **preventing** them. For consensus-level enforcement, use the `tokenScript` field (see Token Script above).

**Enforcement as recipient validation:** When a recipient wallet receives a transfer, it walks the proof chain comparing each consecutive pair of OP_RETURN states. If a transfer violates a rule (e.g. changed `stateData` when rules say immutable), the recipient rejects that **transaction** -- not the token. The sender still holds the token and can try again with a rule-compliant transfer.

**Potential rule types** (restrictions bitfield):
- Transfers restricted to specific conditions

Each entry only needs to be compared against its immediate predecessor. The linear chain walk naturally handles this.

### Large Data Considerations

BSV has no OP_RETURN size limit (removed in the Genesis upgrade, February 2020). The practical limit is the max transaction size (up to 4GB at the consensus level).

The current design rewrites the full OP_RETURN on every transfer, including `stateData`. The proof chain does **not** contain `stateData` -- it only stores txId, blockHeight, merkleRoot, and Merkle path nodes. So large stateData does not bloat the proof chain, but it does increase the cost of every transfer TX.

For large stateData, the cleanest mitigation is **hash-only on-chain**: store `SHA-256(stateData)` in the OP_RETURN (32 bytes regardless of data size), and pass the actual data in the bundle or fetch it from the genesis TX.

### Embedded File Data

MPT supports embedding files (images, text documents, small media) directly in the genesis transaction. The approach is **hash-on-chain, data-in-genesis**:

- **tokenAttributes** stores `SHA-256(fileData)` (32 bytes / 64 hex chars) -- immutable, bound to Token ID.
- **Full file data** lives in a **second OP_RETURN output** in the genesis TX only, using the `MPT-FILE` format.
- **Transfer TXs** carry only the 32-byte hash in tokenAttributes -- no file bloat on transfers.

#### File OP_RETURN Format (MPT-FILE)

The second OP_RETURN output in a genesis TX with an embedded file:

```
Chunk 0:  OP_0
Chunk 1:  OP_RETURN
Chunk 2:  "MPT-FILE"       (8 bytes, marker to distinguish from main P token OP_RETURN)
Chunk 3:  mimeType          (UTF-8, e.g. "image/png")
Chunk 4:  fileName          (UTF-8, original file name)
Chunk 5:  fileBytes          (raw binary file data)
```

The `MPT-FILE` marker (ASCII `0x4d 0x50 0x54 0x2d 0x46 0x49 0x4c 0x45`) distinguishes this output from the main P token metadata OP_RETURN.

#### File Verification

To verify the embedded file matches the token:

1. Fetch the genesis TX (by `genesisTxId`)
2. Scan outputs for an OP_RETURN with the `MPT-FILE` marker
3. Parse the file data (mimeType, fileName, bytes)
4. Compute `SHA-256(bytes)` and compare to tokenAttributes
5. If the hash matches, the file is authentic and bound to the token's identity

Since tokenAttributes is part of the Token ID computation, any tampering with the file hash causes a Token ID mismatch.

#### Pruning and Recovery

OP_RETURN data is not part of the UTXO set and may be pruned by miners to save storage. To mitigate this:

1. **Local IndexedDB cache**: Files are cached locally in the browser's IndexedDB (`mpt-files` database) after first retrieval. This survives page reloads and avoids repeated genesis TX fetches.
2. **Genesis TX fetch**: If the cache misses, the wallet fetches the full genesis TX from WhatsOnChain and extracts the file.
3. **Manual recovery**: If the genesis TX has been pruned and is unavailable, the user can re-upload the original file. The wallet computes `SHA-256` of the provided file and compares it to the stored hash in tokenAttributes. If the hashes match, the file is accepted and cached locally.

#### Size Considerations

- BSV has no OP_RETURN size limit, so files of any size can technically be embedded.
- Practical limits: larger files increase the genesis TX fee proportionally. The UI enforces a 250KB hard limit as a reasonable default.
- Transfer TXs are unaffected by file size -- they only carry the 32-byte hash.

---

## Divisible Tokens / Fractional NFTs

MPT supports splitting whole tokens into numbered fragments via the **divisibility** field in tokenRules. This enables fractional ownership, collectible pieces, and multi-part NFTs.

### Terminology

| Term | Meaning |
|------|---------|
| **Supply** | Number of whole tokens minted in the genesis TX (uint16, max 65535) |
| **Divisibility** | Number of fragments per whole token (uint16). 0 = indivisible NFT. |
| **Fragment** | A single piece of a divisible token. Each fragment is a distinct 1-sat P2PKH UTXO with its own unique Token ID. |
| **Total fragments** | `supply * divisibility` -- the total number of fragment UTXOs minted in the genesis TX |

### How It Works

When `divisibility > 0`, the genesis TX mints `supply * divisibility` P2PKH outputs instead of `supply` outputs. Each fragment is a separate 1-sat UTXO at output indices 1 through `supply * divisibility`.

**Example:** `supply = 4, divisibility = 3` produces 12 fragment UTXOs:

| Output Index | Fragment # | NFT Number | Piece |
|-------------|-----------|------------|-------|
| 1 | 1 | NFT 1 | piece 1/3 |
| 2 | 2 | NFT 1 | piece 2/3 |
| 3 | 3 | NFT 1 | piece 3/3 |
| 4 | 4 | NFT 2 | piece 1/3 |
| 5 | 5 | NFT 2 | piece 2/3 |
| 6 | 6 | NFT 2 | piece 3/3 |
| 7 | 7 | NFT 3 | piece 1/3 |
| 8 | 8 | NFT 3 | piece 2/3 |
| 9 | 9 | NFT 3 | piece 3/3 |
| 10 | 10 | NFT 4 | piece 1/3 |
| 11 | 11 | NFT 4 | piece 2/3 |
| 12 | 12 | NFT 4 | piece 3/3 |

### Fragment-to-NFT Mapping

Given a fragment's `outputIndex` (1-based), the mapping to its whole NFT and piece number is:

```
NFT number  = ceil(outputIndex / divisibility)
Piece number = ((outputIndex - 1) % divisibility) + 1
```

For example, with `divisibility = 3`:
- Fragment at output index 5: `NFT = ceil(5/3) = 2`, `piece = ((5-1) % 3) + 1 = 2` → NFT 2, piece 2/3
- Fragment at output index 9: `NFT = ceil(9/3) = 3`, `piece = ((9-1) % 3) + 1 = 3` → NFT 3, piece 3/3

### Fragment Identity

Each fragment has its own unique Token ID:

```
Token ID = SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)
where immutableChunkBytes = tokenName + tokenScript + tokenRules
```

Since `outputIndex` differs for each fragment, every fragment in the set has a distinct Token ID, even though they share the same genesisTxId and the same immutable metadata (name, script, rules). tokenAttributes is mutable and shared across all fragments. This means:

- Fragments are **not fungible** -- each is uniquely identifiable.
- Fragments can be individually transferred, verified, and tracked.
- A fragment's position within its whole NFT is deterministic from its `outputIndex` and the `divisibility` value in tokenRules.

### Fragment Transfers

Fragments transfer exactly like regular tokens -- one at a time. Each transfer TX spends a single fragment UTXO and creates a new one for the recipient:

```
Input 0:   Fragment UTXO (1 sat, signed by current owner)
Input 1+:  Funding UTXOs
Output 0:  P2PKH to recipient (1 sat) -- new fragment UTXO
Output 1:  OP_RETURN with metadata + proof chain
Output 2:  Change
```

The OP_RETURN carries the same genesisTxId as all other fragments from the same genesis TX. The `genesisOutputIndex` that identifies this specific fragment is derived from Input 0 of the transfer TX (v05.21).

### Return-to-Sender

When a token or fragment is sent to a recipient and then returned to the original wallet:

1. The original wallet's `checkIncomingTokens` detects the incoming transfer TX.
2. SPV verification is performed (`verifyBeforeImport()`): Token ID derivation check, genesis TX Merkle proof, block header confirmation. If verification fails, the return is rejected.
3. If the token already exists in the store with status `transferred` or `pending_transfer`, it is reactivated:
   - Status set back to `active`
   - `currentTxId` and `currentOutputIndex` updated to the new UTXO
   - `transferTxId` cleared
4. The token appears active again in the wallet UI.

This works for both regular tokens and fragments.

### Wallet UI Display

The wallet groups all fragments from the same genesis TX into a single card with:

- **Completion bar:** Visual progress showing what percentage of all fragments the wallet holds.
- **Completion line:** e.g. "6/12 pieces (2 complete NFTs + 0/3 pieces) 50%"
- **Held/Missing/Pending/Sent breakdowns:** Grouped by NFT number.
  - Example held: "NFT 1 (complete) | NFT 2: 1/3, 2/3"
  - Example missing: "NFT 3 (complete) | NFT 4: 3/3"
- **Fragment dropdown:** Each option shows "Fragment #5 (NFT 2, piece 2/3)" with status indicator.
- **Individual fragment detail:** Expands to show full Token ID, current TXID, output index, and a "Send" button labeled with the fragment's NFT/piece identity (e.g. "Send NFT 2, piece 2/3").

When supply is 1 (a single whole token split into pieces), the NFT number is omitted from labels since there's only one: "Piece 2/3" instead of "NFT 1, piece 2/3".

### Divisibility vs. Batch Minting

| Feature | Batch (supply > 1, div = 0) | Divisible (div > 0) |
|---------|----------------------------|---------------------|
| Total outputs | `supply` | `supply * divisibility` |
| Fragment identity | Each is a whole NFT | Each is a piece of a whole NFT |
| Display | Individual token cards | Grouped card with completion tracking |
| NFT numbering | NFT #1, #2, ... #N | NFT 1 piece 1/D, NFT 1 piece 2/D, ... |
| Transfer | One whole token per TX | One fragment per TX |

Both produce multiple 1-sat P2PKH outputs in the genesis TX. The difference is in how the wallet interprets and displays them based on the `divisibility` field in tokenRules.

### Genesis TX Layout (Divisible)

```
Output 0:       OP_RETURN (metadata, tokenRules encodes supply=S, divisibility=D)
Output 1:       P2PKH (1 sat) -- fragment #1 (NFT 1, piece 1/D)
Output 2:       P2PKH (1 sat) -- fragment #2 (NFT 1, piece 2/D)
...
Output S*D:     P2PKH (1 sat) -- fragment #S*D (NFT S, piece D/D)
Output S*D+1:   OP_RETURN (MPT-FILE, if file embedded)
Output S*D+2:   P2PKH (change)
```

---

## Architecture

```
+------------------------------------------------------+
|                    Browser UI (app.ts)                |
+------------------------------------------------------+
         |                    |                |
         v                    v                v
+----------------+  +------------------+  +-----------+
| Token Builder  |  |  Token Store     |  |  Wallet   |
| (tokenBuilder) |  |  (tokenStore)    |  |  Provider |
|                |->|  localStorage    |  | (WoC API) |
+----------------+  +------------------+  +-----------+
         |                                     |
         v                                     |
+------------------------------------------------------+
|              Token Protocol (tokenProtocol.ts)        |
|         Pure SPV: Merkle proofs + block headers       |
|              ZERO network dependencies                |
+------------------------------------------------------+
         |
         v
+------------------------------------------------------+
|              OP_RETURN Codec (opReturnCodec.ts)       |
|         Encode/decode token metadata in script        |
+------------------------------------------------------+
```

**Key rule:** The token protocol layer never imports from the wallet layer. Verification can run offline with pre-fetched block headers.

---

## Module Inventory

| File | Layer | Purpose |
|------|-------|---------|
| `tokenProtocol.ts` | Protocol | Token ID, Merkle proof verification, proof chain validation. Only import: `@bsv/sdk` (Hash). |
| `opReturnCodec.ts` | Protocol | OP_RETURN script encoding/decoding. Binary proof chain codec. File OP_RETURN codec. |
| `walletProvider.ts` | Wallet | WhatsOnChain API client. UTXOs, broadcast, raw TX, block headers, Merkle proofs, address history. |
| `tokenStore.ts` | Wallet | localStorage persistence for tokens and proof chains. FungibleToken/FungibleUtxo basket storage (v05.10). |
| `tokenBuilder.ts` | Wallet | Token lifecycle: mint, transfer, verify, detect incoming. UTXO quarantine. SPV verification on import (genesis Merkle proof + block header). File fetch from genesis. Return-to-sender detection. Fungible operations: createFungibleGenesis, transferFungible, forwardFungibleUtxo, getSpendableBalance (v05.10). |
| `fileCache.ts` | Wallet | IndexedDB-backed file cache for embedded NFT file data. Pruning recovery store. |
| `app.ts` | UI | Browser entry point. DOM manipulation, event handlers, rendering. File upload, viewer, recovery. Fragment grouping/labeling via `formatFragmentIndices()`. Fungible token card display and mint mode toggle (v05.10). |
| `index.html` | UI | Single-page wallet interface. |
| `build.mjs` | Tooling | esbuild bundler: `src/app.ts` -> `bundle.js` (IIFE, browser). |
| `serve.mjs` | Tooling | Dev server with WoC reverse proxy to bypass CORS. |

---

## Dependency Graph

```
tokenProtocol.ts  -->  @bsv/sdk (Hash only)

opReturnCodec.ts  -->  @bsv/sdk (LockingScript, OP)
                  -->  tokenProtocol.ts (types: MerkleProofEntry, MerklePathNode)

walletProvider.ts -->  @bsv/sdk (Transaction)
                  -->  tokenProtocol.ts (types: MerkleProofEntry, MerklePathNode, BlockHeader)

tokenStore.ts     -->  tokenProtocol.ts (types: ProofChain)

tokenBuilder.ts   -->  @bsv/sdk (PrivateKey, Transaction, P2PKH, LockingScript, Hash)
                  -->  walletProvider.ts (WalletProvider, Utxo)
                  -->  tokenStore.ts (TokenStore, OwnedToken)
                  -->  tokenProtocol.ts (computeTokenId, createProofChain, extendProofChain,
                                         verifyMerkleProof, verifyProofChainAsync,
                                         MerkleProofEntry, ProofChain, VerificationResult)
                  -->  opReturnCodec.ts (encodeOpReturn, decodeOpReturn, TokenOpReturnData,
                                         encodeTokenRules, buildImmutableChunkBytes,
                                         buildFileOpReturn, parseFileOpReturn, FileOpReturnData)

fileCache.ts      -->  (no imports -- uses browser IndexedDB API only)

app.ts            -->  @bsv/sdk (PrivateKey, Hash)
                  -->  walletProvider.ts (WalletProvider)
                  -->  tokenBuilder.ts (TokenBuilder)
                  -->  tokenStore.ts (TokenStore, LocalStorageBackend, OwnedToken)
                  -->  opReturnCodec.ts (decodeTokenRules)
                  -->  fileCache.ts (FileCache)
```

---

## Token Protocol (tokenProtocol.ts)

This is the core of the P token system. It runs in any environment with zero network access.

### Token ID

```
Token ID = SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes)
where immutableChunkBytes = tokenName + tokenScript + tokenRules
```

The token ID is deterministic and immutable. It is derived from the genesis transaction hash, the output index (the actual Bitcoin output index of the token's P2PKH in the genesis TX, starting at 1 since Output 0 is the OP_RETURN), and the raw immutable metadata chunks (tokenName, tokenScript, tokenRules). It never changes across transfers. tokenAttributes is mutable and not included in Token ID computation.

### Proof Chain

A proof chain is an ordered list of Merkle proof entries, newest first:

```
ProofChain {
  genesisTxId: string          // the origin TX hash
  entries: MerkleProofEntry[]  // [newest transfer, ..., genesis]
}
```

Each entry contains:
- `txId` -- the transaction hash
- `blockHeight` -- the block it was mined in
- `merkleRoot` -- the claimed Merkle root of that block
- `path` -- array of `{ hash, position: 'L' | 'R' }` nodes from leaf to root

### Verification Algorithm

A token is valid if and only if all four conditions hold:

1. **Token ID matches genesis:** `SHA-256(genesisTxId || outputIndex LE || immutableChunkBytes) == tokenId` where `immutableChunkBytes = tokenName + tokenScript + tokenRules`
2. **Every Merkle proof is valid:** For each entry, hash the txId through the path using Bitcoin's double SHA-256 and confirm the computed root matches the claimed `merkleRoot`.
3. **Every Merkle root matches its block header:** The `merkleRoot` in each entry must match the `merkleRoot` field of the block header at that `blockHeight`.
4. **The oldest entry is the genesis TX:** `entries[last].txId == genesisTxId`

The protocol provides two verification functions:
- `verifyProofChain(chain, headers)` -- synchronous, takes a pre-populated `Map<height, BlockHeader>`
- `verifyProofChainAsync(chain, getBlockHeader)` -- fetches headers on demand via callback

The block header source is pluggable. It can be a local cache, a peer-to-peer connection, or an API. The verification logic itself never makes network calls.

### Merkle Proof Mechanics

Bitcoin Merkle trees use double SHA-256. At each level:
- If the sibling is on the **right** (`R`): `hash = dSHA256(current || sibling)`
- If the sibling is on the **left** (`L`): `hash = dSHA256(sibling || current)`

The final computed hash must equal the block's Merkle root.

---

## OP_RETURN Format (opReturnCodec.ts)

### Script Structure

Each field is a separate pushdata chunk, ordered by enforcement level (highest authority first):

**Note:** Indices shown are **parser indices** (data chunks only). The raw script also contains OP_0 [0] and OP_RETURN [1] which are stripped during parsing, so encoder indices are offset by 2.

```
Parser [0]:  "P"             (3 bytes, protocol prefix -- encoder [2])
Parser [1]:  0x02              (1 byte, version -- v05 -- encoder [3])
Parser [2]:  tokenName         (UTF-8, variable length -- encoder [4])
Parser [3]:  tokenScript       (variable hex, consensus script -- empty = P2PKH -- encoder [5])
Parser [4]:  tokenRules        (8 bytes, 4x uint16 LE -- encoder [6])
Parser [5]:  tokenAttributes   (variable hex -- encoder [7])
Parser [6]:  stateData         (variable hex, minimum 1 byte -- encoder [8])
```

Transfer TXs append two additional chunks (v05.21):

```
Parser [7]:  genesisTxId          (32 bytes, raw hash -- encoder [9])
Parser [8]:  proofChainBinary     (compact binary encoding -- encoder [10])
```

*v05.21:* `genesisOutputIndex` removed. Derived from Input 0 of the transfer TX.

**Genesis OP_RETURN:** 7 data chunks (parser [0-6]). No genesisTxId or proofChainBinary.
**Transfer OP_RETURN:** 9 data chunks (parser [0-8]). The parser uses chunk count to distinguish them. `stateData` (parser [6]) must always be at least 1 byte to keep the count unambiguous. The version byte (`0x02`) signals the v05 format with the tokenScript chunk.

### Token Rules (8 bytes)

```
Bytes 0-1: supply        (uint16 LE, max 65535 per genesis TX)
Bytes 2-3: divisibility  (uint16 LE, 0 = NFT/indivisible, >0 = fragments per whole token)
Bytes 4-5: restrictions  (uint16 LE bitfield, 0 = none)
Bytes 6-7: version       (uint16 LE, rules schema version -- independent of chunk 3 protocol version)
```

When `divisibility > 0`, the genesis TX mints `supply * divisibility` fragment UTXOs. Each fragment is a piece of one of the `supply` whole tokens. The mapping from fragment index to whole NFT is deterministic: `NFT number = ceil(outputIndex / divisibility)`.

### Proof Chain Binary Encoding

```
Per entry (repeat until data exhausted):
  [32 bytes] txId
  [4 bytes]  blockHeight (uint32 LE)
  [32 bytes] merkleRoot
  [1 byte]   path node count
  Per node:
    [32 bytes] hash
    [1 byte]   position (0 = L, 1 = R)
```

No entry count prefix. The decoder reads entries sequentially until all bytes are consumed. Each entry is self-delimiting: 68 fixed bytes plus (path node count x 33) bytes.

### Pushdata Encoding

Data length determines the opcode:
- 1-75 bytes: opcode = length (direct push)
- 76-255 bytes: OP_PUSHDATA1 (0x4c), 1-byte length
- 256-65535 bytes: OP_PUSHDATA2 (0x4d), 2-byte length LE
- Larger: OP_PUSHDATA4 (0x4e), 4-byte length LE

---

## Transaction Structures

### Genesis TX (Mint)

```
Input 0:   P2PKH(owner)  -- funding UTXO
Output 0:  OP_RETURN      -- 0 sat, token metadata (no proof chain yet)
Output 1:  P2PKH(owner)  -- 1 sat, the token UTXO (token #0)
Output 2:  P2PKH(owner)  -- change (or token #1 if batch minting)
```

The genesis TX creates a new token. Token ID is derived from this TX's hash and the outputIndex. The OP_RETURN does not include genesisTxId or proof chain fields (chunks 7-8 are absent).

For divisible tokens (`divisibility > 0`), outputs 1 through `supply * divisibility` are all fragment P2PKH UTXOs (1 sat each).

### Transfer TX

```
Input 0:   P2PKH(sender)  -- the token UTXO (1 sat)
Input 1+:  P2PKH(sender)  -- funding UTXO(s)
Output 0:  P2PKH(recipient) -- 1 sat, new token UTXO
Output 1:  OP_RETURN        -- 0 sat, updated metadata + proof chain
Output 2:  P2PKH(sender)    -- change
```

The transfer TX spends the token UTXO as Input 0 and creates a new token UTXO for the recipient. The OP_RETURN includes the genesisTxId and the full proof chain in binary, so the recipient can verify the token's history from on-chain data alone. Fragment transfers are identical -- each fragment transfers individually.

### Send BSV TX (Plain Transfer)

```
Input(s):  P2PKH(sender)    -- funding UTXO(s)
Output 0:  P2PKH(recipient) -- amount in sats
Output 1:  P2PKH(sender)    -- change
```

Standard BSV payment. Token UTXOs are excluded from input selection.

---

## UTXO Quarantine System

All UTXOs with value <= 1 sat are permanently quarantined and never used as funding inputs. This protects:

- **MPT tokens** (1-sat P2PKH outputs with OP_RETURN metadata)
- **Ordinals** (1-sat inscription outputs)
- **1Sat Ordinals** and other token protocols that use 1-sat UTXOs
- **Any unknown token type** that may arrive at the wallet address

The quarantine is unconditional. There is no "cleared" list or override mechanism.

### The Only Exception

`createTransfer()` is the sole code path that spends a 1-sat UTXO. It does so as Input 0, spending a specific token that the user explicitly selected for transfer. This is an intentional, user-initiated action on a known token.

### Auto-Import on Quarantine

When `getSafeUtxos()` encounters a quarantined 1-sat UTXO, it fires off `tryAutoImport()` in the background. This fetches the source TX, checks for a 1-sat P2PKH output paying to this wallet's address paired with an P token OP_RETURN, and -- if found -- performs SPV verification before importing. The verification gate (`verifyBeforeImport()`) checks Token ID derivation, then verifies the genesis TX's Merkle proof against its block header. Only tokens that pass verification are imported into the local store. Unconfirmed TXs (no Merkle proof available) and tokens with invalid proofs remain in quarantine. The UTXO remains quarantined regardless of the auto-import result.

### Fungible Token Protection (New in v05.10)

The 1-sat quarantine protects NFT tokens, but fungible token UTXOs have values > 1 sat and would pass the quarantine filter. Additional protection is required:

**`getSpendableBalance()` excludes fungible token UTXOs:**
1. Fetch all wallet UTXOs from the provider
2. Apply 1-sat quarantine (removes potential NFTs)
3. Query the token store for all known fungible token UTXOs
4. Exclude any UTXO that matches a fungible token basket entry
5. Return the remaining balance as "spendable"

**UI enforcement:**
- The displayed "Balance" uses `getSpendableBalance()`, not raw UTXO total
- Regular "Send BSV" operations cannot access fungible token UTXOs
- Fungible token transfers must use the dedicated "Send" button in the token card

**Edge case:** If a fungible token UTXO is not yet imported (e.g., just received, not yet scanned), it could theoretically be spent as regular BSV. The `checkIncomingTokens()` scan runs automatically on page load and balance refresh to minimize this window.

### Funding UTXO Selection

All three spending operations use `getSafeUtxos()`:
- `createGenesis()` -- mint a new token
- `createTransfer()` -- fund the transfer TX (separate from the token UTXO)
- `sendSats()` -- plain BSV payment

UTXO combinations are tried in order: singles (sorted by value ascending), then pairs, then triples. The cheapest combination that covers the outputs plus fee is selected.

---

## Wallet Provider (walletProvider.ts)

All network operations are isolated in the WalletProvider class. It communicates with the WhatsOnChain API.

### API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/address/{addr}/unspent` | GET | Fetch UTXOs for the wallet |
| `/address/{addr}/history` | GET | Fetch TX history for incoming detection |
| `/tx/{txId}/hex` | GET | Fetch raw transaction hex |
| `/tx/{txId}/proof/tsc` | GET | Fetch Merkle proof (TSC format) |
| `/block/height/{height}` | GET | Get block hash from height |
| `/block/{hash}/header` | GET | Get block header (merkleRoot, time, etc.) |
| `/tx/raw` | POST | Broadcast signed transaction |

### Rate Limiting

A 350ms minimum delay between API requests prevents HTTP 429 errors. All requests are serialized through a single `queuedFetch()` Promise chain -- no concurrent requests are possible. `fetchWithRetry()` wraps `queuedFetch()` to automatically retry on HTTP 429 responses with exponential backoff (500ms, 1000ms, 1500ms, up to 3 retries).

### TX Cache

Raw transaction hex is cached in-memory (`Map<txId, hex>`) to avoid re-fetching the same TX.

### CORS Proxy

When running on `localhost`, requests are routed through `/woc/v1/bsv/main` which the dev server (`serve.mjs`) proxies to `api.whatsonchain.com`. This avoids CORS errors that occur when the browser fetches from a different origin.

### TSC Merkle Proof Parsing

WhatsOnChain returns proofs in TSC format:
```json
[{ "index": N, "txOrId": "...", "target": "blockhash", "nodes": ["hash", "*", ...] }]
```

The response is an array (the first element is used). The `index` determines left/right positioning at each tree level:
- Even index: sibling is on the right
- Odd index: sibling is on the left
- `"*"` entries (duplicate pairs) are skipped

The block header is fetched separately using the `target` (block hash) to obtain the Merkle root.

---

## Token Store (tokenStore.ts)

Persists tokens and proof chains in localStorage via a pluggable `StorageBackend` interface.

### Storage Keys

All keys are prefixed with `mpt:data:` (configured at initialization):

| Key Pattern | Value |
|-------------|-------|
| `mpt:data:token:{tokenId}` | OwnedToken JSON |
| `mpt:data:proof:{tokenId}` | ProofChain JSON |

### OwnedToken Fields

| Field | Type | Description |
|-------|------|-------------|
| `tokenId` | string | SHA-256 hash, permanent identifier |
| `genesisTxId` | string | Hash of the genesis transaction |
| `genesisOutputIndex` | number | Output index of the token's P2PKH in the genesis TX. Starts at 1 (Output 0 is OP_RETURN). Single mint = 1, batch mint = 1..N, divisible = 1..S*D. Never changes across transfers. |
| `currentTxId` | string | Hash of the TX holding the current token UTXO |
| `currentOutputIndex` | number | Output index of the current token UTXO. For genesis TXs: equals `genesisOutputIndex`. After first transfer: always 0 (P2PKH is Output 0 in transfer TXs). |
| `tokenName` | string | Human-readable name |
| `tokenScript` | string | Variable hex, consensus script (empty = P2PKH) |
| `tokenRules` | string | 8-byte hex (supply, divisibility, restrictions, version) |
| `tokenAttributes` | string | Variable hex (e.g. serial number, file hash) |
| `stateData` | string | Variable hex, application-specific |
| `satoshis` | number | Always 1 (TOKEN_SATS) |
| `status` | TokenStatus | `'active'`, `'pending_transfer'`, or `'transferred'` |
| `createdAt` | string? | ISO timestamp |
| `feePaid` | number? | Fee in satoshis for the creating TX |
| `transferTxId` | string? | Set when status is `pending_transfer` |

### FungibleToken Fields (New in v05.10)

| Field | Type | Description |
|-------|------|-------------|
| `tokenId` | string | SHA-256 hash, shared by all UTXOs in the basket |
| `genesisTxId` | string | Hash of the genesis transaction |
| `tokenName` | string | Human-readable name |
| `tokenScript` | string | Variable hex, consensus script (empty = P2PKH) |
| `tokenRules` | string | 8-byte hex (supply, divisibility, restrictions, version) |
| `tokenAttributes` | string | Variable hex (mutable attributes) |
| `stateData` | string? | Token-level state data (deprecated, use per-UTXO stateData) |
| `utxos` | FungibleUtxo[] | The basket of UTXOs belonging to this token |
| `createdAt` | string? | ISO timestamp |

### FungibleUtxo Fields

| Field | Type | Description |
|-------|------|-------------|
| `txId` | string | Hash of the TX holding this UTXO |
| `outputIndex` | number | Output index of this UTXO in its TX |
| `satoshis` | number | Token amount (1 sat = 1 token unit) |
| `status` | TokenStatus | `'active'`, `'pending_transfer'`, or `'transferred'` |
| `stateData` | string? | Per-UTXO state data (e.g., message text as hex) |
| `receivedAt` | string? | ISO timestamp when this UTXO was received |

### Storage Keys (Fungible)

| Key Pattern | Value |
|-------------|-------|
| `mpt:data:fungible:{tokenId}` | FungibleToken JSON |
| `mpt:data:proof:{tokenId}` | ProofChain JSON (shared with NFT tokens) |

### Token Status Lifecycle

```
Minted (createGenesis)
    |
    v
  active -----> pending_transfer -----> transferred
           createTransfer()        confirmTransfer()
                                          |
                                          v
                                    (return-to-sender)
                                          |
                                          v
                                       active
```

The recipient receives the token as `active` via auto-import or manual "Check Incoming", but only after SPV verification passes (genesis TX Merkle proof + block header check). If a transferred or pending token is detected coming back to the original wallet, it is reactivated as `active` with updated UTXO details (same verification gate applies).

### Token Lookup

The store provides two lookup methods:

- **`getToken(tokenId)`** -- exact key lookup by Token ID. Safe for all operations, including fragment transfers.
- **`findToken(query)`** -- searches by Token ID first, then falls back to searching by `genesisTxId` or `currentTxId`. The genesisTxId fallback is dangerous for fragment tokens because all fragments share the same genesis TX -- it may return the wrong fragment. `createTransfer()` uses `getToken()` exclusively to avoid this issue.

---

## Token Builder (tokenBuilder.ts)

Orchestrates all token operations. Coordinates between the wallet provider, token store, and token protocol.

### Operations

#### createGenesis(params)

1. Fetch safe UTXOs (quarantine applied)
2. If `fileData` is provided: compute `SHA-256(fileData.bytes)` and use as tokenAttributes; build MPT-FILE OP_RETURN
3. Build main OP_RETURN with token metadata
4. Compute total outputs: `divisibility > 0 ? supply * divisibility : supply`
5. Construct TX: funding input -> OP_RETURN + token/fragment outputs (1 sat each) + [MPT-FILE OP_RETURN if file] + change
6. Sign and broadcast
7. Compute token ID from TX hash for each output (1 through totalOutputs)
8. Store each token/fragment with empty proof chain
9. Return `{ txId, tokenIds }` (array of token IDs, one per output)

#### createTransfer(tokenId, recipientAddress)

1. Load token from store via `getToken()` (exact match -- safe for fragments)
2. Verify status is `active`
3. Load proof chain for the token
4. Fetch the source TX of the current token UTXO
5. Fetch safe UTXOs for funding (quarantine applied)
6. Construct TX: token UTXO as Input 0 + funding inputs -> recipient P2PKH (1 sat, locked to recipientAddress) + OP_RETURN (with genesisTxId + proof chain binary) + change
7. Sign and broadcast
8. Mark token as `pending_transfer` with `transferTxId`
9. Return `{ txId, tokenId }`

#### createFungibleGenesis(params) (New in v05.10)

1. Fetch safe UTXOs (quarantine applied)
2. Build OP_RETURN with token metadata (supply/divisibility/restrictions = 0, tokenScript empty)
3. Compute Token ID using genesisOutputIndex = 1 (fixed for fungible)
4. Construct TX: funding input → OP_RETURN + token UTXO (initialSupply sats, Output 1) + change
5. Sign and broadcast
6. Store as FungibleToken with single UTXO in basket
7. Return `{ txId, tokenId, initialSupply }`

#### transferFungible(tokenId, recipientAddress, amount, stateData?) (New in v05.10)

1. Load FungibleToken from store
2. Select active UTXOs to cover the requested amount (greedy selection)
3. Load proof chain for the token
4. Fetch safe UTXOs for fee funding (quarantine applied)
5. Construct TX:
   - Inputs: selected token UTXOs + funding UTXOs
   - Output 0: recipient P2PKH (amount sats)
   - Output 1: OP_RETURN (metadata + proof chain)
   - Output 2: token change P2PKH (remaining sats, if any)
   - Output 3+: fee change
6. Sign and broadcast
7. Update basket: mark spent UTXOs as `pending_transfer`, add recipient UTXO (for sender's records)
8. Return `{ txId, amountSent, change }`

#### forwardFungibleUtxo(tokenId, utxoTxId, utxoOutputIndex, recipientAddress) (New in v05.10)

Forwards a specific UTXO (typically a "message" UTXO with state data) to another address, preserving its state data.

1. Load FungibleToken and locate the specific UTXO
2. Load proof chain
3. Fetch safe UTXOs for fee funding
4. Construct TX: UTXO as Input 0 → recipient P2PKH (full satoshi amount) + OP_RETURN (same stateData)
5. Sign and broadcast
6. Update basket: mark UTXO as `pending_transfer`
7. Return `{ txId, amountSent }`

#### getSpendableBalance() (New in v05.10)

Returns the wallet's spendable BSV balance, excluding:
- All 1-sat UTXOs (quarantined as potential NFTs)
- All known fungible token UTXOs (tracked in token store)

This prevents accidental spending of token UTXOs as regular BSV.

#### confirmTransfer(tokenId)

Marks a `pending_transfer` token as `transferred`. Called automatically by the transfer confirmation polling system (see `pollForConfirmation`).

#### sendSats(recipientAddress, amount)

Standard BSV payment using safe UTXOs only.

#### verifyToken(tokenId)

Full proof chain verification (manual "Verify" button). Checks **all** entries in the proof chain.

1. Load token and proof chain from store
2. If no proof chain, attempt to fetch Merkle proof from WoC on demand
3. Verify token ID matches genesis (pure computation)
4. Fetch block headers for each proof chain entry height
5. Delegate to `tokenProtocol.verifyProofChainAsync()` for cryptographic verification
6. Return `{ valid, reason }`

#### verifyBeforeImport(tokenId, genesisTxId, genesisOutputIndex, immutableBytes, proofChainEntries, currentTxId) *(private)*

SPV verification gate for token import. Called by both `tryAutoImport()` and `checkIncomingTokens()` before storing any incoming token. Only checks the **genesis entry** (not the full chain).

1. Verify Token ID = `computeTokenId(genesisTxId, genesisOutputIndex, immutableBytes)` matches `tokenId`
2. Build proof chain from entries; if empty, fetch Merkle proof for `currentTxId` on demand
3. Find the genesis entry (last in chain, `entry.txId === genesisTxId`)
4. Verify genesis entry's Merkle proof using `verifyMerkleProof()` (pure crypto, double SHA-256)
5. Fetch block header at genesis entry's height, confirm `header.merkleRoot === genesisEntry.merkleRoot`
6. Return `{ valid, chain, reason? }` — callers use the returned chain for storage

Only the genesis TX's block header is required. This proves the token was legitimately created and mined. Transfer TXs are already validated by miners when spent, so their block inclusion is an implicit guarantee.

#### pollForProof(tokenId, txId)

Polls WoC for a Merkle proof every 15 seconds, up to 60 attempts. Once found, stores the proof chain. Used after minting to wait for block confirmation.

#### pollForConfirmation(txId)

Polls WoC for a Merkle proof on a transfer TX. Uses 60-second intervals (after an initial 1-second delay managed by the UI layer), up to 60 attempts. Unlike `pollForProof`, this does **not** modify proof chains -- it only checks whether the TX has been mined. Returns `true` once confirmed. Used by the auto-confirmation system to automatically transition tokens from `pending_transfer` to `transferred`.

#### fetchFileFromGenesis(genesisTxId, expectedHash)

Fetches the full genesis TX, scans outputs for an MPT-FILE OP_RETURN, extracts the file data, and verifies `SHA-256(bytes) === expectedHash`. Returns `{ mimeType, fileName, bytes }` or `null` if not found or hash mismatch.

#### fetchMissingProofs()

Scans all stored tokens for missing proof chains and attempts to fetch them. Handles tokens that were minted or received but the page was closed before confirmation.

#### checkIncomingTokens()

1. Fetch address history + UTXOs (merged, deduplicated)
2. For each unknown TX, fetch raw hex and parse outputs
3. Scan all TX outputs for an OP_RETURN containing the P token prefix (output index varies: genesis has OP_RETURN at Output 0, transfer has it at Output 1) paired with a 1-sat P2PKH output paying to this wallet's address
4. Extract genesisTxId and proof chain from on-chain binary data
5. **SPV verification gate:** Call `verifyBeforeImport()` to check Token ID derivation and verify the genesis TX's Merkle proof against its block header. Tokens that fail verification are rejected with a status message. For genesis TXs with multiple outputs, verification is performed once (all fragments share the same genesis TX).
6. Import verified tokens into the store
7. **Return-to-sender:** If a token already exists with status `transferred` or `pending_transfer`, reactivate it with the new UTXO details (verification still applies)

### Fee Estimation

```
size = TX_OVERHEAD (10) + numInputs * BYTES_PER_INPUT (148)
     + sum(8 bytes value + varint(scriptLen) + scriptLen per output)
     + BYTES_PER_P2PKH_OUTPUT (34) for the change output

fee = ceil(size * feePerKb / 1000)
```

The varint size for output scripts is computed correctly for large scripts (e.g. embedded file OP_RETURNs): 1 byte for lengths < 253, 3 bytes for < 65536, 5 bytes for larger.

Default fee rate: 150 sats/KB.

---

## Browser UI (app.ts + index.html)

### Initialization

1. Load or generate a private key (stored as WIF in `mpt:wallet:wif`)
2. Create WalletProvider, TokenStore, TokenBuilder
3. Display address, public key, WIF
4. Bind button handlers
5. Refresh balance, token list
6. Run `silentCheckIncoming()` and `fetchMissingProofs()` in background

### UI Sections

| Section | Purpose |
|---------|---------|
| Wallet | Address, public key, WIF, balance. Refresh, new wallet, restore from WIF. |
| Send BSV | Plain satoshi transfer to an address. |
| Mint Token | Create a new NFT with name, optional consensus script, optional attributes, and optional file embed. Per-field text/hex toggle. Supply, divisibility, restrictions, rules version. |
| My Tokens | List of all tokens with status badges. Check Incoming button. View File for tokens with embedded files. Grouped display for divisible tokens. |
| Transfer Token | Send a token to a recipient wallet address. Auto-confirmation polling. |
| Verify Token | SPV verification of a token's proof chain against block headers. |

### Token Card Display

**Regular tokens (divisibility = 0):**

Each token card shows:
- Name with status badge (Active / Pending Transfer / Transferred)
- Token ID, Current TXID, Output index
- Satoshis, creation date, fee paid
- Transfer TXID (if pending)
- Action buttons: Select for Transfer, Verify, View TX links
- View File button (for tokens with 64-hex-char attributes indicating an embedded file hash)

**Divisible tokens (divisibility > 0):**

All fragments from the same genesis TX are grouped into a single card showing:
- Token name with completion badge (e.g. "3 / 4 whole")
- Genesis TXID
- Type description (e.g. "Divisible token (4 tokens x 3 fragments = 12 total pieces)")
- Completion line with progress bar (e.g. "6/12 pieces (2 complete NFTs + 0/3 pieces) 50%")
- Held/Missing/Pending/Sent fragment breakdowns grouped by NFT number
- Fragment dropdown selector showing "Fragment #5 (NFT 2, piece 2/3)" for each fragment
- Expandable detail view for the selected fragment
- Individual "Send" buttons labeled with fragment identity (e.g. "Send NFT 2, piece 2/3")

When supply is 1 (a single whole token split into pieces), the NFT number is omitted from labels since there's only one: "Piece 2/3" instead of "NFT 1, piece 2/3".

**Fungible tokens (New in v05.10):**

Fungible tokens display as a dedicated card with:

- Token name with "Fungible" badge (green border)
- Token ID and Genesis TXID
- Total token balance (sum of all active UTXOs)
- Balance breakdown: Available (no state data) + In messages (with state data)
- Pending balance (UTXOs in pending_transfer status)
- Send form: amount input + state data textarea + Send button
- Verify button for SPV proof chain verification
- Messages section: displays UTXOs with non-empty state data, each showing:
  - Token amount and received timestamp
  - Message content (decoded from hex to UTF-8 if valid text)
  - Forward button (sends entire UTXO to another address preserving state data)
  - View TX link
- Expandable UTXO details: shows all UTXOs in the basket with status, amount, and state data

**Mint form (v05.10):**

The mint form includes a mode toggle button:
- **Fungible mode** (default, green): Shows initial supply field only. Creates a single token UTXO where satoshis = token units.
- **NFT mode** (purple): Shows full NFT fields (consensus script, attributes, file upload, supply, divisibility, restrictions, rules version).

The mode toggle switches between `fungible-fields` and `nft-fields` divs in the HTML.

### File Embed (Mint Form)

- File input allows selecting any file type
- When a file is selected: shows filename and size, disables the text attributes input
- Hard limit of 250KB enforced in the UI
- The file's SHA-256 hash becomes the tokenAttributes; the file data is embedded in a second OP_RETURN output
- After minting, the file is cached in IndexedDB for local retrieval
- **MIME type inference**: Browsers may return an empty `file.type` for some extensions (e.g. `.md`, `.ts`, `.csv`). The wallet uses `inferMimeType(fileName, browserType)` which falls back to an extension-based lookup table when the browser provides no MIME type. This ensures correct display mode (inline text vs image vs download) when viewing the file later. Covered extensions include common text formats (`.md`, `.txt`, `.json`, `.csv`, `.xml`, `.html`, `.css`, `.js`, `.ts`), image formats (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.bmp`), and others (`.pdf`, `.zip`). Unrecognized extensions fall back to `application/octet-stream`.

### File Viewer

When "View File" is clicked on a token card:

1. **IndexedDB cache check** -- returns instantly if cached
2. **Genesis TX fetch** -- fetches the full genesis TX from WoC, scans for the MPT-FILE OP_RETURN, verifies the hash
3. **Pruning recovery prompt** -- if the genesis TX is unavailable, prompts the user to upload the original file; computes SHA-256 and compares to the stored hash; caches on match

Display modes:
- Images (`image/*`): rendered inline as `<img>` with max-width constraint
- Text files (`text/*`): displayed in a `<pre>` block
- Other types: download link

### Transfer Auto-Confirmation

After a transfer is broadcast, the wallet automatically polls for on-chain confirmation:

1. A 1-second delay after broadcast, then 60-second polling intervals
2. Uses `pollForConfirmation()` which checks for a Merkle proof via the serialized fetch queue
3. Once confirmed, automatically calls `confirmTransfer()` to mark the token as `transferred`
4. Polling survives page refreshes: `resumePendingTransferPolls()` runs on page load, scanning all `pending_transfer` tokens and restarting their polls
5. Deduplication via `activePollTxIds` Set prevents multiple polls for the same TX

### Background Operations (Page Load)

- `refreshBalance()` -- fetch balance from WoC
- `silentCheckIncoming()` -- scan for incoming tokens (no error display)
- `fetchMissingProofs()` -- fetch proofs for unconfirmed tokens
- `resumePendingTransferPolls()` -- restart confirmation polling for all `pending_transfer` tokens

---

## Dev Server (serve.mjs)

1. Runs esbuild to compile `src/app.ts` -> `bundle.js`
2. Starts HTTP server on port 3000
3. Routes `/woc/*` requests to `api.whatsonchain.com` (HTTPS proxy with `Access-Control-Allow-Origin: *`)
4. Serves static files (index.html, bundle.js, source maps)

Usage: `node serve.mjs` then open `http://localhost:3000`

---

## Constants

| Constant | Value | Used In |
|----------|-------|---------|
| `TOKEN_SATS` | 1 | Token UTXO value, quarantine threshold |
| `DEFAULT_FEE_PER_KB` | 150 | Fee estimation |
| `BYTES_PER_INPUT` | 148 | P2PKH input with signature |
| `BYTES_PER_P2PKH_OUTPUT` | 34 | P2PKH output (value + script) |
| `TX_OVERHEAD` | 10 | Version + locktime + varint |
| `MIN_REQUEST_DELAY` | 350 | Milliseconds between WoC API calls |
| `MPT_PREFIX` | `[0x4d, 0x50, 0x54]` | "P" in ASCII |
| `MPT_VERSION` | `0x02` | Protocol version byte (v05) |
| `MPT_FILE_MARKER` | `[0x4d, 0x50, 0x54, 0x2d, 0x46, 0x49, 0x4c, 0x45]` | "MPT-FILE" in ASCII, marks file OP_RETURN outputs |

---

## localStorage Schema

| Key | Value | Purpose |
|-----|-------|---------|
| `mpt:wallet:wif` | WIF string | Private key persistence |
| `mpt:data:token:{tokenId}` | OwnedToken JSON | Token metadata |
| `mpt:data:proof:{tokenId}` | ProofChain JSON | Merkle proof chain |

## IndexedDB Schema (File Cache)

Embedded file data is cached in IndexedDB (separate from localStorage) for larger storage capacity and binary data support.

| Database | Object Store | Key | Fields |
|----------|-------------|-----|--------|
| `mpt-files` | `files` | `hash` (SHA-256 hex, keyPath) | `hash`, `mimeType`, `fileName`, `bytes` (Uint8Array) |

The file cache serves three purposes:
1. **Performance** -- avoids re-fetching the genesis TX every time the user views a file
2. **Pruning recovery** -- if the genesis TX is pruned from the network, the local cache still has the file
3. **Manual recovery** -- if both the network and cache are unavailable, the user can re-upload the original file, verified by SHA-256 hash match against tokenAttributes



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