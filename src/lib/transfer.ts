import { MPT } from '../contracts/mpt'
import { PubKey, ByteString } from 'scrypt-ts'

/** Parameters for creating a transfer transaction. */
export interface TransferParams {
    /** The current MPT contract instance (from the UTXO being spent). */
    currentInstance: MPT
    /** Public key of the new owner (recipient). */
    newOwnerPubKey: PubKey
    /** Updated state data (pass current value to leave unchanged). */
    newStateData: ByteString
}

/**
 * Prepare the next MPT contract instance for a transfer output.
 *
 * This clones the current contract state, updates the mutable fields
 * (ownerPubKey, stateData), and returns the new instance. The caller
 * is responsible for:
 *   1. Building the BSV transaction with the token UTXO as input 0.
 *   2. Adding a funding UTXO as input 1.
 *   3. Setting output 0 to the new contract instance (1 sat).
 *   4. Adding a change output.
 *   5. Calling the `transfer` method on the current instance to unlock it.
 *
 * @returns The next MPT contract instance with updated mutable state.
 */
export function buildTransferOutput(params: TransferParams): MPT {
    const next = params.currentInstance.next()

    next.ownerPubKey = params.newOwnerPubKey
    next.stateData = params.newStateData

    return next as MPT
}
