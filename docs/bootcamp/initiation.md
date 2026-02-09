# Proof Token Protocol Project Onboarding

Before making any code changes, read and understand these files in order:

## 1. Bitcoin White Paper
Bitcoin SV (BSV) is the original Bitcoin and follows the original Bitcoin White Paper.
In particular, pay attention to section 8 which talks about SPV. Reply with the text from section 8.
docs\bitcoin.pdf

## 2. Core Documentation (read first)

Read these to understand the protocol design and architecture:

1. `docs\SVphone_fundamental_design_principles.md` — Token lifecycle, SPV verification, data fields, immutable vs mutable fields

Reply with a concise summary of what you read.


2. `docs\SVphone_structure_and_function.md` — Detailed structure and function documentation (note: covers v05 despite filename)

Reply with a concise summary of what you read.


## 3. Protocol Layer (pure SPV, no network dependencies)

Look at the lastest prototypes in this folder
3. `prototypes\`

Reply with a concise summary of the latest code base and design.

Reply with a concise summary of how close to the P_fundamental_design_principles.md document is the latest code and in which areas does it deviate.


## Key Concepts to Understand

- **Token ID**: SHA-256(genesisTxId || outputIndex_LE || tokenName || tokenScript || tokenRules || tokenAttributes)
- **SPV Verification**: Only the genesis TX requires block header confirmation; transfer TXs are validated by miners implicitly
- **Proof Chain**: Array of Merkle proof entries, newest-first, oldest entry = genesis TX
- **Immutable Fields**: tokenName, tokenScript, tokenRules, tokenAttributes — bound to Token ID
- **Mutable Fields**: stateData — can change on transfer

## Architecture Separation

- `tokenProtocol.ts` = ZERO network dependencies, runs anywhere (browser, Node, offline)
- `tokenBuilder.ts` = Wallet layer, requires network access via WalletProvider
