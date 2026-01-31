## Merkle Proof Token (MPT) v4

## Overview

A UTXO-based token on the Bitcoin SV blockchain. Token identity is tied to a specific UTXO, with provenance verified through a chain of Merkle proofs — no indexer required.

Genesis is a single transaction. A fixed number of NFTs can be declared in one genesis transaction using multiple outputs. Token ID is a computed property derived from the genesis TXID and output index.

---

## Token Identity

**Token ID** is not stored in the token data. It is computed by any verifier:

```
Token ID = SHA-256(Genesis TXID || Output Index)
```

Each output in the genesis transaction produces a unique Token ID. The total number of token outputs defines the fixed supply of the collection.

---

## Token Data Fields

### Immutable Fields
Set at genesis, enforced by script on every spend. Must be byte-identical across all transfers.

**[Token Name]**
- UTF-8 text string.
- Shared across all outputs in the genesis transaction. Identifies the collection.

**[Token Rules]**
- Structured data defining token behaviour:
  - **Supply:** Total number of NFTs in this genesis transaction.
  - **Divisibility:** 0 for NFTs (indivisible).
  - **Transfer Restrictions:** Unrestricted, whitelist, time-lock, or custom script conditions.
  - **Version:** Integer. Allows future rule extensions.

**[Token Attributes]** (optional)
- Per-NFT immutable data set at genesis.
- Examples: sequence number, rarity tier, unique name, trait set, content hash.

### Mutable Fields
Updated on each transfer. Validated by script according to Token Rules.

**[Owner ID]**
- Public key of the current token holder.

**[State Data]** (optional)
- Arbitrary bytes. Usage defined by Token Rules.
- Examples: metadata hash, counter, status flag, IPFS CID.

---

## Script Structure

The token UTXO output script follows this template:

```
<immutable_fields> OP_DROP <mutable_fields> OP_DROP <locking_script>
```

**Immutable fields:** Token Name, Token Rules, Token Attributes — serialised and pushed as a single data blob.

**Mutable fields:** Owner ID, State Data — serialised and pushed as a single data blob.

**Locking script** enforces:
1. Signature verification against the current Owner ID.
2. Sighash preimage introspection to read the output script of the spending TX.
3. Byte comparison: immutable field segment in the new output must exactly match the current output.
4. Mutable field validation per Token Rules.

---

## Genesis

A single transaction creates the entire NFT collection:

- **Input:** A funding UTXO with enough satoshis to cover fees and 1 sat per NFT output.
- **Output 0:** NFT #0 — immutable fields (shared Token Name, Token Rules, unique Token Attributes) + mutable fields (Owner ID set to creator's public key).
- **Output 1:** NFT #1 — same structure, unique Token Attributes.
- **...**
- **Output N-1:** NFT #(N-1) — same structure, unique Token Attributes.
- **Output N:** Fee change returned to the creator (non-token UTXO).

The transaction is broadcast and mined. Once confirmed:
- The genesis TXID is known.
- Each NFT's Token ID is computable: SHA-256(Genesis TXID || Output Index).
- The collection supply is fixed — the number of token outputs in the genesis TX is immutable on-chain.
- No second transaction required.

---

## Transfers

### Wallet A transfers an NFT to Wallet B

Wallet A creates a transaction:
- **Input 0:** The token UTXO being transferred.
- **Input 1:** A funding UTXO for fees (separate from the token UTXO).
- **Output 0 (Token):** New token UTXO with:
  - All immutable fields unchanged (enforced by script).
  - Owner ID set to Wallet B's public key.
  - State Data updated if applicable per Token Rules.
- **Output 1 (Change):** Fee change returned to Wallet A.

Wallet A provides Wallet B with the **proof chain**:
- The chain of Merkle proofs from genesis to the current transfer.
- Each proof links a transaction to a block header.

### Wallet B verifies the token

1. Start from the most recent Merkle proof, verify it against the corresponding block header.
2. Walk backward through each prior transfer's Merkle proof, verifying each against its block header.
3. Confirm the chain terminates at the genesis TX.
4. Compute Token ID = SHA-256(Genesis TXID || Output Index) and confirm it matches the expected identity.
5. Confirm immutable fields are consistent across every transaction in the chain.
6. Count the token outputs in the genesis TX to verify the declared supply.
7. Broadcast the transfer TX to transaction processors for inclusion in the next block.

Wallet B now holds the token UTXO and the full proof chain, which it will extend and pass on in any future transfer.

---

## Collections

All token outputs in a single genesis TX form a collection:
- Identified by the shared Token Name and genesis TXID.
- Fixed supply — the number of token outputs is immutable once mined.
- Each NFT is independently transferable with its own UTXO and proof chain.
- Each NFT has a unique computed Token ID derived from its output index.
- Each NFT may carry unique Token Attributes set at genesis.

### Large Collections

For collections exceeding practical single-transaction size, multiple genesis transactions can share a Token Name. Each genesis TX defines a batch. Verifiers identify the full collection by Token Name across batches. Each batch has its own provably fixed supply.

---

## Fee Handling

Token UTXOs carry exactly 1 satoshi — the minimum for a valid UTXO. Transaction fees are always paid by a **separate funding UTXO** provided as an additional input. This keeps the token UTXO clean and avoids mixing fee funds with token state.
