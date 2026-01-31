import { createHash } from 'crypto'

/**
 * Compute the Token ID for an MPT token.
 *
 * Token ID = SHA-256(Genesis TXID bytes || Output Index as 4-byte LE)
 *
 * This is a derived property — never stored on-chain. Any party can
 * independently compute it from the genesis transaction.
 *
 * @param genesisTxId   - The TXID of the genesis transaction (64-char hex string).
 * @param outputIndex   - The output index within the genesis TX (0-based).
 * @returns The Token ID as a 64-character hex string.
 */
export function computeTokenId(genesisTxId: string, outputIndex: number): string {
    // TXID hex → bytes (TXIDs are displayed in reverse byte order in Bitcoin,
    // but we hash the raw bytes as-is from the hex representation for simplicity
    // and determinism — all parties use the same convention).
    const txidBuf = Buffer.from(genesisTxId, 'hex')

    // Output index as 4-byte little-endian.
    const indexBuf = Buffer.alloc(4)
    indexBuf.writeUInt32LE(outputIndex)

    const preimage = Buffer.concat([txidBuf, indexBuf])
    return createHash('sha256').update(preimage).digest('hex')
}
