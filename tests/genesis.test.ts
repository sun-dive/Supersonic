import { encodeTokenRules } from '../src/lib/genesis'

describe('encodeTokenRules', () => {
    it('should encode rules into an 8-byte hex string', () => {
        const rules = encodeTokenRules(10, 0, 0, 1)
        // 8 bytes = 16 hex chars
        expect(rules).toHaveLength(16)
    })

    it('should encode supply as 4-byte LE at offset 0', () => {
        const rules = encodeTokenRules(256, 0, 0, 1)
        const buf = Buffer.from(rules, 'hex')
        expect(buf.readUInt32LE(0)).toBe(256)
    })

    it('should encode divisibility at offset 4', () => {
        const rules = encodeTokenRules(1, 8, 0, 1)
        const buf = Buffer.from(rules, 'hex')
        expect(buf.readUInt8(4)).toBe(8)
    })

    it('should encode restrictions at offset 5', () => {
        const rules = encodeTokenRules(1, 0, 2, 1)
        const buf = Buffer.from(rules, 'hex')
        expect(buf.readUInt8(5)).toBe(2)
    })

    it('should encode version as 2-byte LE at offset 6', () => {
        const rules = encodeTokenRules(1, 0, 0, 3)
        const buf = Buffer.from(rules, 'hex')
        expect(buf.readUInt16LE(6)).toBe(3)
    })

    it('should produce different encodings for different inputs', () => {
        const r1 = encodeTokenRules(10, 0, 0, 1)
        const r2 = encodeTokenRules(20, 0, 0, 1)
        expect(r1).not.toBe(r2)
    })
})
