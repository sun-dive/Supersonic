# MPT Prototype v04 -- Structure and Function

## Overview

The Merkle Proof Token (MPT) is a token protocol on BSV mainnet that uses P2PKH outputs for ownership and OP_RETURN outputs for metadata. Token validity is proven exclusively through Merkle proofs and block headers (SPV), with no dependency on UTXO lookups, indexers, or trusted third parties for verification.

Prototype v04 enforces a clean architectural separation between the pure SPV token protocol and the wallet layer that interacts with the blockchain.

**Network:** BSV Mainnet (real BSV)

---

## Token Design

An MPT token is a BSV transaction with a specific output structure. There is no custom locking script -- ownership uses standard P2PKH, and all token metadata lives in a separate OP_RETURN output.

## Token Data Fields

### Immutable Fields

All immutable fields are cryptographically bound to the Token ID. Tampering with any of them causes a Token ID mismatch -- instant verification failure. No additional checking logic needed for these fields; the existing `computeTokenId` check catches it.

**[Token ID]**
- `SHA-256(genesisTxId || outputIndex LE || opReturnChunks[4..6] raw bytes)`
- Deterministic, purely local computation. No network access required.
- `outputIndex` is the actual Bitcoin output index of the token's P2PKH in the genesis TX. Since Output 0 is the OP_RETURN, token indices start at 1. Single mint = 1, batch mint = 1..N.
- `opReturnChunks[4..6]` binds the shared collection identity (name, rules, attributes).

**[Token Name]**
- UTF-8 text string.
- Shared across all tokens in the genesis transaction. Identifies the NFT set.

**[Token Rules]**
- Structured data defining token behaviour:
  - **Supply:** Total number of tokens minted in this genesis transaction (uint16, max 65535).
  - **Divisibility:** 0 for NFTs (indivisible).
  - **Transfer Restrictions:** Unrestricted, whitelist, time-lock, or custom wallet-enforced conditions.
  - **Version:** Integer. Allows future rule extensions.

**[Token Attributes]** (optional)
- Immutable data shared by all tokens in the NFT set. Set at genesis. If unused, the chunk is a zero-length pushdata (the chunk must still be present for positional parsing).
- All tokens within a single genesis TX have identical attributes.
- For tokens with different attributes (e.g. different rarity tiers), use separate genesis TXs (separate NFT sets).
- Examples: rarity tier, trait set, content hash, collection metadata.

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

**Genesis TX (mint) -- batch (supply = N):**

```
Input 0:   Funding UTXO (signed by minter)
Output 0:  OP_RETURN with token metadata (0 sat) -- shared token data
Output 1:  P2PKH to minter's address (1 sat) -- token #0
Output 2:  P2PKH to minter's address (1 sat) -- token #1
...
Output N:  P2PKH to minter's address (1 sat) -- token #(N-1)
Output N+1: Change back to minter (if needed)
```

All tokens in a batch share a single OP_RETURN (Output 0) containing identical metadata. Each token is a separate 1-sat P2PKH output at indices 1 through N. The `outputIndex` used in the Token ID is the actual Bitcoin output index (1, 2, ..., N), not a zero-based token number. Token #0 in the set has `outputIndex = 1`.

**Transfer TX:**

```
Input 0:   Token UTXO from previous owner (signed by owner)
Input 1+:  Funding UTXOs for fees (signed by sender)
Output 0:  P2PKH to recipient's address (1 sat) -- new token UTXO
Output 1:  OP_RETURN with token metadata + proof chain (0 sat) -- updated token data
Output 2:  Change back to sender (if needed)
```

Transfer TXs always transfer a single token. The OP_RETURN includes the genesisTxId and proof chain so the recipient can verify the token's full history. Transfer TX output order (P2PKH at 0, OP_RETURN at 1) differs from genesis TX output order (OP_RETURN at 0, P2PKH outputs at 1+).

### NFT Sets and Collections

- An **NFT set** is all tokens from a single genesis TX. They share tokenName, tokenRules, and tokenAttributes. The only differentiator is `outputIndex`.
- A **collection** is multiple NFT sets that share the same tokenName but may have different tokenAttributes (e.g. different rarity tiers). Each variation requires a separate genesis TX.
- Example: A collection of 100 NFTs with 5 rarity tiers = 5 genesis TXs, each with supply = 20, each with different tokenAttributes describing that tier.

### On-Chain Fields (OP_RETURN)

The OP_RETURN contains these fields as separate pushdata chunks:

| Chunk | Field | Size | Description |
|-------|-------|------|-------------|
| 0 | `OP_0` | 1B | Standard OP_RETURN prefix |
| 1 | `OP_RETURN` | 1B | Marks output as unspendable |
| 2 | `"MPT"` | 3B | Protocol identifier |
| 3 | version | 1B | OP_RETURN format version (currently `0x01`). Determines how to parse chunks. Independent of the rules version in tokenRules bytes 6-7. |
| 4 | tokenName | variable | UTF-8 human-readable name |
| 5 | tokenRules | 8B | Packed rules: supply, divisibility, restrictions bitfield, version |
| 6 | tokenAttributes | variable | Immutable attributes shared by all tokens in the set (hex) |
| 7 | stateData | variable | Mutable application state (min 1 byte) |
| 8 | genesisTxId | 32B | *Transfer only:* raw genesis TX hash |
| 9 | proofChainBinary | variable | *Transfer only:* compact binary proof chain |

**Genesis TX OP_RETURN:** Chunks 0-7 (8 chunks). No genesisTxId (chunk 8) or proofChainBinary (chunk 9) -- not needed at mint time.

**Transfer TX OP_RETURN:** Chunks 0-9 (10 chunks). genesisTxId and proofChainBinary carry the token's verifiable history. Ownership is determined by the P2PKH output, not by any OP_RETURN field.

**Parsing rule:** The chunk count distinguishes genesis from transfer: 8 chunks = genesis, 10 chunks = transfer. stateData (chunk 7) is always present with a minimum of 1 byte to ensure consistent chunk counts.

### What Changes Between Transfers

| Field | Mutable? | Notes |
|-------|----------|-------|
| tokenName | Immutable | Set at genesis, bound to Token ID |
| tokenRules | Immutable | Set at genesis, bound to Token ID |
| tokenAttributes | Immutable | Set at genesis, bound to Token ID. Shared by all tokens in the set. |
| stateData | **Mutable** | Can be updated according to Token Rules |
| genesisTxId | Fixed | Always references the original mint TX |
| proofChainBinary | **Grows** | New Merkle proof entry prepended on each transfer |

### Encoding Format

MPT uses **raw pushdata chunks** in the OP_RETURN output. Each field is a separate pushdata element in the script, identified by position. This requires no external libraries, schemas, or deserializers -- any Bitcoin library that can parse standard scripts can decode MPT metadata.

Compared to other BSV token encodings:

| | MPT (Raw Pushdata) | 1Sat Ordinals (Content Blob) | RUN (CBOR) | STAS (Script Opcodes) | Tokenized (Protobuf) |
|---|---|---|---|---|---|
| Parse complexity | Trivial | Varies | Library needed | Script interpreter | Library + schema |
| External dependencies | None | Content decoders | CBOR library | Script engine | Protobuf runtime |
| Indexer required | **No** | Yes | Yes | Partial | Yes |
| Self-contained TX | **Yes** | Partial | No | No | No |

The zero-dependency parsing aligns with MPT's SPV-only philosophy. The protocol is simple enough that positional encoding isn't a burden.

### Token ID

```
Token ID = SHA-256(genesisTxId || outputIndex LE || opReturnChunks[4..6] raw bytes)
```

The Token ID is a deterministic, purely local computation. It binds the token's identity to its genesis transaction and all immutable metadata (tokenName, tokenRules, tokenAttributes). No network access is required to compute or verify it. Tampering with any immutable field causes a Token ID mismatch -- instant verification failure.

### Verification Model

Token validity is proven exclusively through Merkle proofs and block headers:

1. Token ID matches `SHA-256(genesisTxId || outputIndex LE || opReturnChunks[4..6] raw bytes)`
2. Every entry in the proof chain has a valid Merkle proof (double SHA-256)
3. Every Merkle root matches its block header at that height
4. The oldest entry's txId matches the genesis txId

The proof chain travels with the token. Any node with block headers can verify it without replaying history or querying an indexer.

### tokenRules Enforcement

`tokenRules` is an 8-byte packed field (4 x uint16 LE): supply, divisibility, restrictions (bitfield), and version. It is set at genesis and copied unchanged on every transfer.

**Application-level, not consensus-level:** MPT's OP_RETURN is unspendable -- miners don't execute logic on it. Rules cannot be enforced at the consensus layer. Instead, MPT **detects** rule violations during verification rather than **preventing** them.

**Enforcement as recipient validation:** When a recipient wallet receives a transfer, it walks the proof chain comparing each consecutive pair of OP_RETURN states. If a transfer violates a rule (e.g. changed `stateData` when rules say immutable), the recipient rejects that **transaction** -- not the token. The sender still holds the token and can try again with a rule-compliant transfer.

**Potential rule types** (restrictions bitfield):
- Transfers restricted to specific conditions

Each entry only needs to be compared against its immediate predecessor. The linear chain walk naturally handles this.

### Large Data Considerations

BSV has no OP_RETURN size limit (removed in the Genesis upgrade, February 2020). The practical limit is the max transaction size (up to 4GB at the consensus level).

The current design rewrites the full OP_RETURN on every transfer, including `stateData`. The proof chain does **not** contain `stateData` -- it only stores txId, blockHeight, merkleRoot, and Merkle path nodes. So large stateData does not bloat the proof chain, but it does increase the cost of every transfer TX.

For large stateData, the cleanest mitigation is **hash-only on-chain**: store `SHA-256(stateData)` in the OP_RETURN (32 bytes regardless of data size), and pass the actual data in the bundle or fetch it from the genesis TX.

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
| `opReturnCodec.ts` | Protocol | OP_RETURN script encoding/decoding. Binary proof chain codec. |
| `walletProvider.ts` | Wallet | WhatsOnChain API client. UTXOs, broadcast, raw TX, block headers, Merkle proofs, address history. |
| `tokenStore.ts` | Wallet | localStorage persistence for tokens and proof chains. |
| `tokenBuilder.ts` | Wallet | Token lifecycle: mint, transfer, verify, detect incoming. UTXO quarantine. |
| `app.ts` | UI | Browser entry point. DOM manipulation, event handlers, rendering. |
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

tokenBuilder.ts   -->  @bsv/sdk (Transaction, P2PKH, LockingScript)
                  -->  walletProvider.ts (WalletProvider, Utxo)
                  -->  tokenStore.ts (TokenStore, OwnedToken)
                  -->  tokenProtocol.ts (computeTokenId, createProofChain, extendProofChain,
                                         verifyProofChainAsync, ProofChain, BlockHeader,
                                         VerificationResult)
                  -->  opReturnCodec.ts (encodeOpReturn, decodeOpReturn, encodeTokenRules)

app.ts            -->  @bsv/sdk (PrivateKey)
                  -->  walletProvider.ts (WalletProvider)
                  -->  tokenBuilder.ts (TokenBuilder)
                  -->  tokenStore.ts (TokenStore, LocalStorageBackend, OwnedToken)
```

---

## Token Protocol (tokenProtocol.ts)

This is the core of the MPT system. It runs in any environment with zero network access.

### Token ID

```
Token ID = SHA-256(genesisTxId || outputIndex LE || opReturnChunks[4..6] raw bytes)
```

The token ID is deterministic and immutable. It is derived from the genesis transaction hash, the output index (the actual Bitcoin output index of the token's P2PKH in the genesis TX, starting at 1 since Output 0 is the OP_RETURN), and the raw immutable metadata chunks (tokenName, tokenRules, tokenAttributes). It never changes across transfers.

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

1. **Token ID matches genesis:** `SHA-256(genesisTxId || outputIndex LE || opReturnChunks[4..6] raw bytes) == tokenId`
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

Each field is a separate pushdata chunk:

```
Chunk 0:  OP_0
Chunk 1:  OP_RETURN
Chunk 2:  "MPT"           (3 bytes, protocol prefix)
Chunk 3:  0x01             (1 byte, version)
Chunk 4:  tokenName        (UTF-8, variable length)
Chunk 5:  tokenRules       (8 bytes, 4x uint16 LE)
Chunk 6:  tokenAttributes  (variable hex)
Chunk 7:  stateData        (variable hex, minimum 1 byte)
```

Transfer TXs append two additional chunks:

```
Chunk 8:  genesisTxId      (32 bytes, raw hash)
Chunk 9:  proofChainBinary (compact binary encoding)
```

Genesis OP_RETURN = 8 chunks (0-7). Transfer OP_RETURN = 10 chunks (0-9). The parser uses chunk count to distinguish them. `stateData` (chunk 7) must always be at least 1 byte to keep the count unambiguous.

### Token Rules (8 bytes)

```
Bytes 0-1: supply        (uint16 LE, max 65535 per genesis TX)
Bytes 2-3: divisibility  (uint16 LE, 0 = NFT)
Bytes 4-5: restrictions  (uint16 LE bitfield, 0 = none)
Bytes 6-7: version       (uint16 LE, rules schema version -- independent of chunk 3 protocol version)
```

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

No entry count prefix. The decoder reads entries sequentially until all bytes are consumed. Each entry is self-delimiting: 68 fixed bytes plus (path node count × 33) bytes.

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

The genesis TX creates a new token. Token ID is derived from this TX's hash and the outputIndex. The OP_RETURN does not include genesisTxId or proof chain fields (chunks 8-9 are absent).

### Transfer TX

```
Input 0:   P2PKH(sender)  -- the token UTXO (1 sat)
Input 1+:  P2PKH(sender)  -- funding UTXO(s)
Output 0:  P2PKH(recipient) -- 1 sat, new token UTXO
Output 1:  OP_RETURN        -- 0 sat, updated metadata + proof chain
Output 2:  P2PKH(sender)    -- change
```

The transfer TX spends the token UTXO as Input 0 and creates a new token UTXO for the recipient. The OP_RETURN includes the genesisTxId and the full proof chain in binary, so the recipient can verify the token's history from on-chain data alone.

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

When `getSafeUtxos()` encounters a quarantined 1-sat UTXO, it fires off `tryAutoImport()` in the background. This fetches the source TX, checks for a 1-sat P2PKH output paying to this wallet's address paired with an MPT OP_RETURN, and imports the token into the local store if found. The UTXO remains quarantined regardless of the auto-import result.

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

A 200ms minimum delay between API requests prevents HTTP 429 errors. Implemented via `throttledFetch()`.

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
| `genesisOutputIndex` | number | Output index of the token's P2PKH in the genesis TX. Starts at 1 (Output 0 is OP_RETURN). Single mint = 1, batch mint = 1..N. |
| `currentTxId` | string | Hash of the TX holding the current token UTXO |
| `currentOutputIndex` | number | Output index of the current token UTXO. Always 0 after a transfer (P2PKH is Output 0 in transfer TXs). Equals `genesisOutputIndex` at mint time. |
| `tokenName` | string | Human-readable name |
| `tokenRules` | string | 8-byte hex (supply, divisibility, restrictions, version) |
| `tokenAttributes` | string | Variable hex (e.g. serial number) |
| `stateData` | string | Variable hex, application-specific |
| `satoshis` | number | Always 1 (TOKEN_SATS) |
| `status` | TokenStatus | `'active'`, `'pending_transfer'`, or `'transferred'` |
| `createdAt` | string? | ISO timestamp |
| `feePaid` | number? | Fee in satoshis for the creating TX |
| `transferTxId` | string? | Set when status is `pending_transfer` |

### Token Status Lifecycle

```
Minted (createGenesis)
    |
    v
  active -----> pending_transfer -----> transferred
           createTransfer()        confirmTransfer()
```

The recipient receives the token as `active` via auto-import or manual "Check Incoming".

---

## Token Builder (tokenBuilder.ts)

Orchestrates all token operations. Coordinates between the wallet provider, token store, and token protocol.

### Operations

#### createGenesis(params)

1. Fetch safe UTXOs (quarantine applied)
2. Build OP_RETURN with token metadata
3. Construct TX: funding input -> OP_RETURN + token output(s) (1 sat each) + change
4. Sign and broadcast
5. Compute token ID from TX hash
6. Store token with empty proof chain
7. Return `{ txId, tokenId }`

#### createTransfer(tokenId, recipientAddress)

1. Load token from store, verify status is `active`
2. Load proof chain for the token
3. Fetch the source TX of the current token UTXO
4. Fetch safe UTXOs for funding (quarantine applied)
5. Construct TX: token UTXO as Input 0 + funding inputs -> recipient P2PKH (1 sat, locked to recipientAddress) + OP_RETURN (with genesisTxId + proof chain binary) + change
6. Sign and broadcast
7. Mark token as `pending_transfer` with `transferTxId`
8. Return `{ txId, tokenId }`

#### confirmTransfer(tokenId)

Marks a `pending_transfer` token as `transferred`.

#### sendSats(recipientAddress, amount)

Standard BSV payment using safe UTXOs only.

#### verifyToken(tokenId)

1. Load token and proof chain from store
2. If no proof chain, attempt to fetch Merkle proof from WoC on demand
3. Verify token ID matches genesis (pure computation)
4. Fetch block headers for each proof chain entry height
5. Delegate to `tokenProtocol.verifyProofChainAsync()` for cryptographic verification
6. Return `{ valid, reason }`

#### pollForProof(tokenId, txId)

Polls WoC for a Merkle proof every 15 seconds, up to 60 attempts. Once found, stores the proof chain. Used after minting to wait for block confirmation.

#### fetchMissingProofs()

Scans all stored tokens for missing proof chains and attempts to fetch them. Handles tokens that were minted or received but the page was closed before confirmation.

#### checkIncomingTokens()

1. Fetch address history + UTXOs (merged, deduplicated)
2. For each unknown TX, fetch raw hex and parse outputs
3. Scan all TX outputs for an OP_RETURN containing the MPT prefix (output index varies: genesis has OP_RETURN at Output 0, transfer has it at Output 1) paired with a 1-sat P2PKH output paying to this wallet's address
4. Extract genesisTxId and proof chain from on-chain binary data
5. Import new tokens into the store

### Fee Estimation

```
size = TX_OVERHEAD (10) + numInputs * BYTES_PER_INPUT (148)
     + sum(actual output script lengths + 9 bytes each)
     + BYTES_PER_P2PKH_OUTPUT (34) for the change output

fee = ceil(size * feePerKb / 1000)
```

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
| Mint Token | Create a new NFT with a name and optional attributes. |
| My Tokens | List of all tokens with status badges. Check Incoming button. |
| Transfer Token | Send a token to a recipient wallet address. |
| Verify Token | SPV verification of a token's proof chain against block headers. |

### Token Card Display

Each token card shows:
- Name with status badge (Active / Pending Transfer / Transferred)
- Token ID, Current TXID, Output index
- Satoshis, creation date, fee paid
- Transfer TXID (if pending)
- Action buttons: Select for Transfer, Verify, Confirm Sent, View TX links

### Background Operations (Page Load)

- `refreshBalance()` -- fetch balance from WoC
- `silentCheckIncoming()` -- scan for incoming tokens (no error display)
- `fetchMissingProofs()` -- fetch proofs for unconfirmed tokens

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
| `MIN_REQUEST_DELAY` | 200 | Milliseconds between WoC API calls |
| `MPT_PREFIX` | `[0x4d, 0x50, 0x54]` | "MPT" in ASCII |
| `MPT_VERSION` | `0x01` | Protocol version byte |

---

## localStorage Schema

| Key | Value | Purpose |
|-----|-------|---------|
| `mpt:wallet:wif` | WIF string | Private key persistence |
| `mpt:data:token:{tokenId}` | OwnedToken JSON | Token metadata |
| `mpt:data:proof:{tokenId}` | ProofChain JSON | Merkle proof chain |
