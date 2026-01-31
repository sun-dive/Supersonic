import {
    verifyMerkleProof,
    verifyProofChain,
    extendProofChain,
    createProofChain,
    MerkleProofEntry,
} from '../src/lib/proofChain'
import { createHash } from 'crypto'

function doubleSha256(data: Buffer): Buffer {
    const first = createHash('sha256').update(data).digest()
    return createHash('sha256').update(first).digest()
}

/**
 * Build a simple 2-leaf Merkle tree and return the proof for leaf 0.
 */
function buildSimpleProof(txId: string, siblingTxId: string, blockHeight: number): MerkleProofEntry {
    const txBuf = Buffer.from(txId, 'hex')
    const sibBuf = Buffer.from(siblingTxId, 'hex')
    const root = doubleSha256(Buffer.concat([txBuf, sibBuf]))

    return {
        txId,
        blockHeight,
        merkleRoot: root.toString('hex'),
        path: [{ hash: siblingTxId, position: 'R' }],
    }
}

describe('verifyMerkleProof', () => {
    it('should verify a valid 2-leaf Merkle proof', () => {
        const txId = createHash('sha256').update('tx0').digest('hex')
        const sibId = createHash('sha256').update('tx1').digest('hex')
        const proof = buildSimpleProof(txId, sibId, 100)

        expect(verifyMerkleProof(proof)).toBe(true)
    })

    it('should reject a proof with wrong Merkle root', () => {
        const txId = createHash('sha256').update('tx0').digest('hex')
        const sibId = createHash('sha256').update('tx1').digest('hex')
        const proof = buildSimpleProof(txId, sibId, 100)
        proof.merkleRoot = 'ff'.repeat(32)

        expect(verifyMerkleProof(proof)).toBe(false)
    })

    it('should reject a proof with wrong sibling hash', () => {
        const txId = createHash('sha256').update('tx0').digest('hex')
        const sibId = createHash('sha256').update('tx1').digest('hex')
        const proof = buildSimpleProof(txId, sibId, 100)
        proof.path[0].hash = 'aa'.repeat(32)

        expect(verifyMerkleProof(proof)).toBe(false)
    })
})

describe('verifyProofChain', () => {
    const genesisTxId = createHash('sha256').update('genesis').digest('hex')
    const genesisSib = createHash('sha256').update('genesis-sib').digest('hex')
    const genesisProof = buildSimpleProof(genesisTxId, genesisSib, 100)

    const transferTxId = createHash('sha256').update('transfer1').digest('hex')
    const transferSib = createHash('sha256').update('transfer1-sib').digest('hex')
    const transferProof = buildSimpleProof(transferTxId, transferSib, 101)

    const alwaysValidHeader = () => true
    const alwaysInvalidHeader = () => false

    it('should verify a single-entry chain (genesis only)', () => {
        const chain = createProofChain(genesisTxId, genesisProof)
        expect(verifyProofChain(chain, alwaysValidHeader)).toBe(true)
    })

    it('should verify a multi-entry chain', () => {
        const chain = createProofChain(genesisTxId, genesisProof)
        const extended = extendProofChain(chain, transferProof)
        expect(verifyProofChain(extended, alwaysValidHeader)).toBe(true)
    })

    it('should reject if block header verification fails', () => {
        const chain = createProofChain(genesisTxId, genesisProof)
        expect(verifyProofChain(chain, alwaysInvalidHeader)).toBe(false)
    })

    it('should reject an empty chain', () => {
        const chain = { genesisTxId, entries: [] }
        expect(verifyProofChain(chain, alwaysValidHeader)).toBe(false)
    })

    it('should reject if chain does not terminate at genesis', () => {
        // Chain with only the transfer proof — genesis entry missing.
        const chain = {
            genesisTxId,
            entries: [transferProof],
        }
        expect(verifyProofChain(chain, alwaysValidHeader)).toBe(false)
    })
})

describe('extendProofChain', () => {
    it('should prepend the new entry', () => {
        const genesisTxId = createHash('sha256').update('g').digest('hex')
        const genesisSib = createHash('sha256').update('gs').digest('hex')
        const genesisProof = buildSimpleProof(genesisTxId, genesisSib, 1)

        const chain = createProofChain(genesisTxId, genesisProof)
        expect(chain.entries).toHaveLength(1)

        const newTxId = createHash('sha256').update('t1').digest('hex')
        const newSib = createHash('sha256').update('t1s').digest('hex')
        const newProof = buildSimpleProof(newTxId, newSib, 2)

        const extended = extendProofChain(chain, newProof)
        expect(extended.entries).toHaveLength(2)
        expect(extended.entries[0].txId).toBe(newTxId)
        expect(extended.entries[1].txId).toBe(genesisTxId)
        expect(extended.genesisTxId).toBe(genesisTxId)
    })
})
