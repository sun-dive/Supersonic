import {
    SmartContract,
    method,
    prop,
    assert,
    ByteString,
    PubKey,
    Sig,
    hash256,
    SigHash,
} from 'scrypt-ts'

/**
 * Merkle Proof Token (MPT) — on-chain smart contract.
 *
 * Immutable fields (@prop) are fixed at genesis and enforced by sCrypt
 * on every spend — the code part of the script (which includes immutable
 * props) must remain identical for the output to be accepted.
 *
 * Mutable fields (@prop(true)) can change between spends, subject to
 * the validation logic in the public methods.
 */
export class MPT extends SmartContract {
    // ── Immutable fields ────────────────────────────────────────────
    // Set at genesis, cannot change. sCrypt enforces this automatically
    // because they are part of the contract code.

    /** Human-readable token/collection name (UTF-8 encoded). */
    @prop()
    tokenName: ByteString

    /**
     * Serialised token rules:
     *   - supply (total NFT count in this genesis TX)
     *   - divisibility (0 for NFTs)
     *   - transfer restrictions
     *   - version
     */
    @prop()
    tokenRules: ByteString

    /** Per-NFT unique attributes (sequence number, traits, content hash, etc.). */
    @prop()
    tokenAttributes: ByteString

    // ── Mutable fields ──────────────────────────────────────────────
    // Updated on each transfer, validated by contract logic.

    /** Public key of the current token holder. */
    @prop(true)
    ownerPubKey: PubKey

    /** Optional arbitrary state data (metadata hash, counter, status, etc.). */
    @prop(true)
    stateData: ByteString

    constructor(
        tokenName: ByteString,
        tokenRules: ByteString,
        tokenAttributes: ByteString,
        ownerPubKey: PubKey,
        stateData: ByteString
    ) {
        super(...arguments)
        this.tokenName = tokenName
        this.tokenRules = tokenRules
        this.tokenAttributes = tokenAttributes
        this.ownerPubKey = ownerPubKey
        this.stateData = stateData
    }

    /**
     * Transfer the token to a new owner.
     *
     * @param sig         - Signature from the current owner authorising the transfer.
     * @param newOwner    - Public key of the recipient.
     * @param newStateData - Updated state data (or same value to leave unchanged).
     */
    @method(SigHash.ANYONECANPAY_SINGLE)
    public transfer(sig: Sig, newOwner: PubKey, newStateData: ByteString) {
        // 1. Verify current owner authorises this spend.
        assert(this.checkSig(sig, this.ownerPubKey), 'invalid owner signature')

        // 2. Update mutable state.
        this.ownerPubKey = newOwner
        this.stateData = newStateData

        // 3. Propagate the contract to the output.
        //    sCrypt ensures immutable @prop() fields are unchanged because
        //    they are part of the code portion of the script.
        //    buildStateOutput creates a new UTXO carrying 1 satoshi.
        const output = this.buildStateOutput(1n)
        assert(
            this.ctx.hashOutputs === hash256(output),
            'hashOutputs mismatch'
        )
    }
}
