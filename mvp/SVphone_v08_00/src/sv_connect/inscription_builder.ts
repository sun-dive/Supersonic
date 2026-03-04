/**
 * InscriptionBuilder - 1-sat ordinal inscription transactions for SVphone call signaling.
 *
 * Replaces the PPV (genesis + 10-min wait + transfer) call token flow with a single
 * 1-sat inscription sent directly to the callee. The inscription carries all WebRTC
 * call data (IP, port, SDP, codec, session key) in a standard 1sat ordinal envelope.
 *
 * Inscription locking script format:
 *   OP_FALSE OP_IF
 *     PUSH "ord"
 *     OP_1
 *     PUSH "application/json"
 *     OP_0
 *     PUSH <json call data>
 *   OP_ENDIF
 *   OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
 *
 * The OP_FALSE OP_IF block is never executed (always skips to OP_ENDIF), so the
 * inscription data is ignored by script evaluation. The P2PKH at the end handles
 * spending. This follows the 1satordinals.com standard.
 */
import { LockingScript, OP, P2PKH, Utils, Transaction, PrivateKey } from '@bsv/sdk'
import { WalletProvider } from '../token_protocol/walletProvider'

// ─── Constants ──────────────────────────────────────────────────────

const CONTENT_TYPE_JSON = 'application/json'
const ORD_MARKER = [0x6f, 0x72, 0x64]  // "ord"
const SVPHONE_PROTO = 'svphone'

const TX_OVERHEAD = 10
const BYTES_PER_INPUT = 148
const BYTES_PER_P2PKH_OUTPUT = 34
const FEE_PER_KB = 100

// ─── InscriptionBuilder ─────────────────────────────────────────────

export class InscriptionBuilder {

  // ── Script Building ───────────────────────────────────────────────

  /**
   * Build a 1sat ordinal inscription locking script.
   * Combines the OP_FALSE OP_IF inscription envelope with a P2PKH lock.
   */
  buildInscriptionLockingScript(jsonData: string, recipientAddress: string): LockingScript {
    const contentTypeBytes = Array.from(new TextEncoder().encode(CONTENT_TYPE_JSON))
    const dataBytes = Array.from(new TextEncoder().encode(jsonData))

    const chunks: Array<{ op: number; data?: number[] }> = [
      { op: OP.OP_FALSE },
      { op: OP.OP_IF },
      this.pushChunk(ORD_MARKER),
      { op: OP.OP_1 },
      this.pushChunk(contentTypeBytes),
      { op: OP.OP_0 },
      this.pushChunk(dataBytes),
      { op: OP.OP_ENDIF },
      ...new P2PKH().lock(recipientAddress).chunks,
    ]

    return new LockingScript(chunks)
  }

  /** Create a minimally-encoded PUSHDATA chunk for the given bytes */
  private pushChunk(data: number[]): { op: number; data?: number[] } {
    if (data.length <= 75) return { op: data.length, data }
    if (data.length <= 255) return { op: OP.OP_PUSHDATA1, data }
    if (data.length <= 65535) return { op: OP.OP_PUSHDATA2, data }
    return { op: 0x4e /* OP_PUSHDATA4 */, data }
  }

  // ── Transaction Building ──────────────────────────────────────────

  /**
   * Build, sign, and broadcast a 1-sat inscription to recipientAddress.
   * Uses walletProvider for UTXOs and broadcast (same pattern as tokenBuilder.ts).
   * Excludes 1-sat UTXOs from funding (they may hold tokens/ordinals).
   */
  async buildAndBroadcast(
    callData: object,
    recipientAddress: string,
    provider: WalletProvider,
    key: PrivateKey,
  ): Promise<{ txId: string }> {
    const jsonData = JSON.stringify(callData)
    const myAddress = key.toAddress()

    const allUtxos = await provider.getUtxos()
    const safeUtxos = allUtxos.filter(u => u.satoshis > 1)
    if (safeUtxos.length === 0) {
      throw new Error('No spendable UTXOs. Fund your wallet first (need > 1 sat UTXOs).')
    }

    const inscriptionScript = this.buildInscriptionLockingScript(jsonData, recipientAddress)
    const inscriptionScriptBytes = inscriptionScript.toBinary()

    // Calculate fee: 1 input + inscription output + change output
    const inscVarInt = inscriptionScriptBytes.length < 0xfd ? 1 : 3
    const inscOutputSize = 8 + inscVarInt + inscriptionScriptBytes.length
    const estimatedSize = TX_OVERHEAD + BYTES_PER_INPUT + inscOutputSize + BYTES_PER_P2PKH_OUTPUT
    const fee = Math.ceil(estimatedSize * FEE_PER_KB / 1000)

    // Try smallest UTXO that covers 1 sat + fee
    const sorted = [...safeUtxos].sort((a, b) => a.satoshis - b.satoshis)
    const utxo = sorted.find(u => u.satoshis >= 1 + fee)
    if (!utxo) {
      const best = sorted[sorted.length - 1]
      throw new Error(
        `Insufficient funds: need ${1 + fee} sats, best UTXO has ${best?.satoshis ?? 0} sats.`
      )
    }

    const sourceTx = await provider.getSourceTransaction(utxo.txId)
    const tx = new Transaction()

    tx.addInput({
      sourceTransaction: sourceTx,
      sourceOutputIndex: utxo.outputIndex,
      unlockingScriptTemplate: new P2PKH().unlock(key),
    })

    // Output 0: 1-sat inscription to callee
    tx.addOutput({
      lockingScript: inscriptionScript,
      satoshis: 1,
    })

    // Output 1: change back to caller
    const changeAmount = utxo.satoshis - 1 - fee
    tx.addOutput({
      lockingScript: new P2PKH().lock(myAddress),
      satoshis: changeAmount,
    })

    await tx.sign()
    const txId = tx.id('hex') as string
    await provider.broadcast(tx.toHex())

    provider.registerPendingTx(
      txId,
      [{ txId: utxo.txId, outputIndex: utxo.outputIndex }],
      changeAmount > 0 ? { outputIndex: 1, satoshis: changeAmount } : undefined,
    )

    return { txId }
  }

  // ── Inscription Parsing ───────────────────────────────────────────

  /**
   * Parse a 1sat ordinal inscription from a locking script hex string.
   * Returns the parsed SVphone call data object, or null if not a valid inscription.
   */
  parseInscription(scriptHex: string): Record<string, unknown> | null {
    const bytes = Utils.toArray(scriptHex, 'hex') as number[]

    // Scan for OP_FALSE(0x00) OP_IF(0x63) followed by PUSH[3]"ord"
    for (let i = 0; i < bytes.length - 10; i++) {
      if (
        bytes[i] === OP.OP_FALSE &&
        bytes[i + 1] === OP.OP_IF &&
        bytes[i + 2] === 0x03 &&   // PUSH 3 bytes
        bytes[i + 3] === 0x6f &&   // 'o'
        bytes[i + 4] === 0x72 &&   // 'r'
        bytes[i + 5] === 0x64      // 'd'
      ) {
        let pos = i + 6

        // Expect OP_1 (content-type field tag)
        if (bytes[pos] !== OP.OP_1) continue
        pos++

        // Read content-type value
        const [ctBytes, pos2] = this.readPush(bytes, pos)
        if (!ctBytes) continue
        pos = pos2

        // Expect OP_0 (body separator)
        if (bytes[pos] !== OP.OP_0) continue
        pos++

        // Read inscription body
        const [bodyBytes, _pos3] = this.readPush(bytes, pos)
        if (!bodyBytes) continue

        const contentType = new TextDecoder().decode(new Uint8Array(ctBytes))
        if (contentType !== CONTENT_TYPE_JSON) continue

        try {
          const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(bodyBytes)))
          if (parsed?.proto === SVPHONE_PROTO) {
            return parsed as Record<string, unknown>
          }
        } catch {
          // Not valid JSON — continue scanning
        }
      }
    }

    return null
  }

  /** Read a PUSHDATA chunk at pos, return [bytes, newPos] */
  private readPush(bytes: number[], pos: number): [number[] | null, number] {
    if (pos >= bytes.length) return [null, pos]
    const op = bytes[pos]
    if (op >= 1 && op <= 75) {
      return [Array.from(bytes.slice(pos + 1, pos + 1 + op)), pos + 1 + op]
    }
    if (op === OP.OP_PUSHDATA1) {
      const len = bytes[pos + 1]
      return [Array.from(bytes.slice(pos + 2, pos + 2 + len)), pos + 2 + len]
    }
    if (op === OP.OP_PUSHDATA2) {
      const len = bytes[pos + 1] | (bytes[pos + 2] << 8)
      return [Array.from(bytes.slice(pos + 3, pos + 3 + len)), pos + 3 + len]
    }
    if (op === 0x4e /* OP_PUSHDATA4 */) {
      const len = bytes[pos + 1] | (bytes[pos + 2] << 8) | (bytes[pos + 3] << 16) | (bytes[pos + 4] << 24)
      return [Array.from(bytes.slice(pos + 5, pos + 5 + len)), pos + 5 + len]
    }
    return [null, pos]
  }

  /**
   * Scan a Transaction for a SVphone call inscription addressed to myAddress.
   * Returns the call data object if found, or null.
   */
  scanTxForCallInscription(tx: Transaction, myAddress: string): Record<string, unknown> | null {
    for (const output of tx.outputs) {
      const scriptHex = output.lockingScript?.toHex() ?? ''
      if (!scriptHex) continue

      const inscription = this.parseInscription(scriptHex)
      if (!inscription) continue

      const type = inscription.type as string
      if (type === 'call' && inscription.callee === myAddress) return inscription
      if (type === 'answer' && inscription.caller === myAddress) return inscription
    }
    return null
  }
}

// ─── Export to window ────────────────────────────────────────────────

declare global {
  interface Window {
    InscriptionBuilder: typeof InscriptionBuilder
    inscriptionBuilder?: InscriptionBuilder
  }
}
