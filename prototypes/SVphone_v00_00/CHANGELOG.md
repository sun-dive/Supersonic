# P Token Protocol Prototype v05.24 - Changelog

## BREAKING CHANGE: MPT → P Protocol Refactor (v05.24)

This release refactors the protocol identity from "Merkle Proof Token" (MPT) to "Proof Token Protocol" (P token protocol).

### Protocol Changes

- **Protocol prefix**: Changed from `MPT` (3 bytes: 0x4d, 0x50, 0x54) to `P` (1 byte: 0x50)
- **Protocol version**: Bumped from 0x02 to 0x03 to signal breaking change
- **File marker**: Changed from `MPT-FILE` (8 bytes) to `P-FILE` (6 bytes)
- **Full name**: "Proof Token Protocol"
- **Short name**: "P token protocol"
- **Code identifier**: "P"

### Storage Changes

All localStorage keys migrated from `mpt:*` to `p:*` prefix:
- `mpt:wallet:wif` → `p:wallet:wif` (wallet private key)
- `mpt:fileMeta` → `p:fileMeta` (file metadata)
- `mpt:data:token:*` → `p:data:token:*` (token metadata)
- `mpt:data:proof:*` → `p:data:proof:*` (proof chains)
- `mpt:data:fungible:*` → `p:data:fungible:*` (fungible tokens)

IndexedDB database renamed from `mpt-files` to `p-files`.

### Migration

- Automatic one-time migration runs on first load after update
- Existing wallets and tokens are preserved
- Old `mpt:*` keys are kept for safety (can be manually deleted later)
- Migration is idempotent (safe to run multiple times)

### Backward Compatibility

**NONE** - This is a hard fork:
- P protocol wallets reject old MPT tokens (prefix/version mismatch)
- Old MPT wallets reject P tokens
- Users with old MPT tokens must re-mint as P tokens

---

# MPT Prototype v05.22 - Previous Changelog

## New Features

### Media File Enhancements

- **MIME type icons**: Files attached to tokens now display emoji icons based on their type:
  - Images: framed picture
  - Audio: musical note
  - Video: clapper board
  - Text: page facing up
  - PDF: bookmark tabs
  - ZIP: package
  - Other: paperclip (generic)

- **Inline media playback**: Media files now play in a modal overlay instead of opening new browser tabs. Click anywhere outside the modal or press Escape to close.

- **Media controls**: Audio and video playback includes:
  - Play / Pause / Stop buttons
  - Repeat (loop) toggle with visual indicator
  - Volume slider

### Transfer File Attachments

- **File attachments in NFT transfers**: When transferring an NFT, you can now attach a new file. The file is embedded on-chain in a separate OP_RETURN output, and its SHA-256 hash is stored in the token's stateData.

- **Combined message + file**: Transfers can now include both a text message AND a file attachment together. The stateData format is `message_hex + file_hash` (message bytes followed by 64-char hex hash).

- **File size limit increased**: Maximum file size raised from 10MB to 50MB.

### Import Improvements

- **File metadata extraction during import**: When importing tokens via "Check Incoming Tokens", any file OP_RETURNs in the transaction are automatically parsed. File metadata (mimeType, fileName) is stored in localStorage for UI display.

- **Improved stateData rendering**: The UI now detects combined message+file format even without pre-existing file metadata by:
  1. Checking if stateData ends with 64 hex characters (potential file hash)
  2. Attempting to decode the preceding portion as UTF-8 text
  3. Displaying both the message and a "View File" button if successful

## Bug Fixes

- **Fixed message loss in file transfers**: Previously, when transferring a token with both a message and file attachment, the message was being discarded. The `createTransfer` function now correctly preserves the `newStateData` parameter (which contains the combined message+hash format from the UI).

## Technical Details

### stateData Format

When a transfer includes both a message and file:
```
stateData = textToHex(message) + sha256(fileBytes).toHex()
```

Example for message "Hello" with a file:
```
stateData = "48656c6c6f" + "a1b2c3d4...64_char_hash..."
```

The rendering logic detects this by:
1. Checking if length > 64 characters
2. Verifying last 64 chars are valid hex
3. Attempting UTF-8 decode on the prefix

### File OP_RETURN Structure

File attachments use a separate OP_RETURN output with the structure defined by `buildFileOpReturn()` / `parseFileOpReturn()` in opReturnCodec.ts.

### localStorage Metadata

File metadata is stored under the key `p:fileMeta` as:
```json
{
  "<sha256_hash>": { "mimeType": "image/png", "fileName": "photo.png" }
}
```

This allows the UI to display file names and icons even before the file is fetched from chain.
