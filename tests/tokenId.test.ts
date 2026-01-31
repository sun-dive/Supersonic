import { computeTokenId } from '../src/lib/tokenId'
import { createHash } from 'crypto'

describe('computeTokenId', () => {
    const genesisTxId =
        'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'

    it('should return a 64-character hex string', () => {
        const tokenId = computeTokenId(genesisTxId, 0)
        expect(tokenId).toHaveLength(64)
        expect(tokenId).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce different IDs for different output indices', () => {
        const id0 = computeTokenId(genesisTxId, 0)
        const id1 = computeTokenId(genesisTxId, 1)
        const id2 = computeTokenId(genesisTxId, 2)

        expect(id0).not.toBe(id1)
        expect(id1).not.toBe(id2)
        expect(id0).not.toBe(id2)
    })

    it('should produce different IDs for different TXIDs', () => {
        const otherTxId =
            'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2a1'
        const id1 = computeTokenId(genesisTxId, 0)
        const id2 = computeTokenId(otherTxId, 0)

        expect(id1).not.toBe(id2)
    })

    it('should be deterministic', () => {
        const id1 = computeTokenId(genesisTxId, 5)
        const id2 = computeTokenId(genesisTxId, 5)

        expect(id1).toBe(id2)
    })

    it('should match manual SHA-256 computation', () => {
        const txidBuf = Buffer.from(genesisTxId, 'hex')
        const indexBuf = Buffer.alloc(4)
        indexBuf.writeUInt32LE(3)
        const preimage = Buffer.concat([txidBuf, indexBuf])
        const expected = createHash('sha256').update(preimage).digest('hex')

        expect(computeTokenId(genesisTxId, 3)).toBe(expected)
    })
})
