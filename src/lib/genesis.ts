import { MPT } from '../contracts/mpt'
import { PubKey, toByteString, ByteString } from 'scrypt-ts'

/** Parameters for a single NFT within a genesis batch. */
export interface NftDefinition {
    /** Per-NFT unique attributes (hex-encoded ByteString). */
    tokenAttributes: ByteString
}

/** Parameters for creating a genesis transaction. */
export interface GenesisParams {
    /** Human-readable collection name. */
    tokenName: string
    /**
     * Serialised token rules (hex-encoded ByteString).
     * Should encode: supply count, divisibility, transfer restrictions, version.
     */
    tokenRules: ByteString
    /** Array of NFT definitions — one output per entry. */
    nfts: NftDefinition[]
    /** Creator's public key (will be the initial owner of all NFTs). */
    creatorPubKey: PubKey
    /** Optional initial state data (defaults to empty). */
    initialStateData?: ByteString
}

/**
 * Build an array of MPT contract instances for a genesis transaction.
 *
 * Each instance becomes one output in the genesis TX. The caller is
 * responsible for constructing the actual BSV transaction, adding a
 * funding input, and broadcasting.
 *
 * @returns An array of MPT contract instances, one per NFT.
 */
export function buildGenesisOutputs(params: GenesisParams): MPT[] {
    const tokenNameHex = toByteString(params.tokenName, true)
    const stateData = params.initialStateData ?? toByteString('', true)

    return params.nfts.map((nft) => {
        return new MPT(
            tokenNameHex,
            params.tokenRules,
            nft.tokenAttributes,
            params.creatorPubKey,
            stateData
        )
    })
}

/**
 * Encode token rules into a ByteString.
 *
 * This is a convenience helper for constructing the tokenRules field.
 * The encoding is a simple concatenation of fixed-width fields:
 *   - supply:       4 bytes LE (uint32)
 *   - divisibility: 1 byte
 *   - restrictions: 1 byte (0 = unrestricted, 1 = whitelist, 2 = time-lock)
 *   - version:      2 bytes LE (uint16)
 */
export function encodeTokenRules(
    supply: number,
    divisibility: number,
    restrictions: number,
    version: number
): ByteString {
    const buf = Buffer.alloc(8)
    buf.writeUInt32LE(supply, 0)
    buf.writeUInt8(divisibility, 4)
    buf.writeUInt8(restrictions, 5)
    buf.writeUInt16LE(version, 6)
    return buf.toString('hex') as ByteString
}
