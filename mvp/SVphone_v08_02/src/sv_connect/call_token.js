/**
 * Call Token Manager (v08.02) - OP_RETURN Binary Format Implementation
 *
 * Uses the compact v07_00 binary format via P OP_RETURN in a single TX.
 * No genesis+transfer ceremony: signal goes directly from caller to callee.
 *
 * TX structure:
 *   Output 0: OP_RETURN (0 sats) — P v03 format
 *   Output 1: P2PKH 1-sat → callee (WoC address history indexing)
 *   Output 2: P2PKH change → caller
 *
 * Binary tokenAttributes format (v07_00 compatible):
 *   [1]     version = 0x01
 *   [4|16]  IP (MSB of first byte = IPv6 flag)
 *   [2]     port (big-endian)
 *   [1+N]   session key (1-byte length + N bytes)
 *   [1]     codec: 0=opus, 1=pcm, 2=aac
 *   [1]     quality: 0=sd, 1=hd, 2=vhd
 *   [1]     media bitmask: bit0=audio, bit1=video
 *   [2+N]   SDP (2-byte length + N bytes)
 *   [1+N]   caller address (1-byte length + N bytes UTF-8)
 *   [1+N]   callee address (1-byte length + N bytes UTF-8)
 */

const CODECS = { opus: 0, pcm: 1, aac: 2 }
const CODEC_IDS = ['opus', 'pcm', 'aac']
const QUALITIES = { sd: 0, hd: 1, vhd: 2 }
const QUALITY_IDS = ['sd', 'hd', 'vhd']

class CallTokenManager {
  constructor(uiLogger) {
    this.log = uiLogger
  }

  /**
   * Encode call attributes into binary format (~45 bytes overhead + SDP + addresses).
   * @param {Object} callToken - {senderIp, senderPort, sessionKey, codec, quality, mediaTypes, sdpOffer|sdpAnswer, caller, callee}
   * @returns {string} Hex-encoded binary
   */
  encodeCallAttributes(callToken) {
    try {
      const bytes = []

      // Version marker (0x01 = binary format v1)
      bytes.push(0x01)

      // IP address and port
      const ip = callToken.senderIp
      const port = callToken.senderPort
      const isIPv6 = ip.includes(':')
      const ipBits = isIPv6 ? 1 : 0

      if (!isIPv6) {
        const parts = ip.split('.').map(p => parseInt(p, 10))
        bytes.push((ipBits << 7) | (parts[0] & 0x7F))
        bytes.push(parts[1])
        bytes.push(parts[2])
        bytes.push(parts[3])
      } else {
        const ipv6Buf = this._ipv6ToBytes(ip)
        bytes.push((ipBits << 7) | (ipv6Buf[0] & 0x7F))
        bytes.push(...ipv6Buf.slice(1))
      }

      // Port (2 bytes, big-endian)
      bytes.push((port >> 8) & 0xFF)
      bytes.push(port & 0xFF)

      // Session key (1-byte length prefix + N bytes)
      const keyData = callToken.sessionKey
      const keyBuf = typeof keyData === 'string'
        ? new TextEncoder().encode(keyData)
        : keyData
      bytes.push(keyBuf.length)
      bytes.push(...keyBuf)

      // Codec (1 byte enum)
      bytes.push(CODECS[callToken.codec] ?? 0)

      // Quality (1 byte enum)
      bytes.push(QUALITIES[callToken.quality] ?? 1)

      // Media types (1 byte bitmask: bit0=audio, bit1=video)
      let mediaBitmask = 0
      if (callToken.mediaTypes?.includes('audio')) mediaBitmask |= 0x01
      if (callToken.mediaTypes?.includes('video')) mediaBitmask |= 0x02
      bytes.push(mediaBitmask)

      // SDP offer or answer (2-byte length prefix + N bytes)
      // sdpOffer/sdpAnswer may be an RTCSessionDescription object — extract the raw string
      let sdpData = callToken.sdpOffer || callToken.sdpAnswer || ''
      if (sdpData && typeof sdpData === 'object') sdpData = sdpData.sdp || ''
      const sdpBuf = new TextEncoder().encode(sdpData)
      bytes.push((sdpBuf.length >> 8) & 0xFF)
      bytes.push(sdpBuf.length & 0xFF)
      bytes.push(...sdpBuf)

      // Caller address (1-byte length prefix + N bytes UTF-8)
      const callerBuf = new TextEncoder().encode(callToken.caller || '')
      bytes.push(callerBuf.length)
      bytes.push(...callerBuf)

      // Callee address (1-byte length prefix + N bytes UTF-8)
      const calleeBuf = new TextEncoder().encode(callToken.callee || '')
      bytes.push(calleeBuf.length)
      bytes.push(...calleeBuf)

      // senderIp4 (1-byte length: 4=present, 0=absent + 0|4 bytes)
      const ip4 = callToken.senderIp4 || null
      if (ip4 && /^\d+\.\d+\.\d+\.\d+$/.test(ip4)) {
        bytes.push(4)
        bytes.push(...ip4.split('.').map(p => parseInt(p, 10)))
      } else {
        bytes.push(0)
      }

      // senderIp6 (1-byte length: 16=present, 0=absent + 0|16 bytes)
      const ip6 = callToken.senderIp6 || null
      if (ip6 && ip6.includes(':')) {
        bytes.push(16)
        bytes.push(...this._ipv6ToBytes(ip6))
      } else {
        bytes.push(0)
      }

      return bytes.map(b => ('0' + b.toString(16)).slice(-2)).join('')
    } catch (error) {
      console.error('[CallToken] Failed to encode attributes:', error)
      return '00'
    }
  }

  /**
   * Decode call attributes from binary hex string.
   * @param {string} hexStr - Hex-encoded binary tokenAttributes
   * @returns {Object} {senderIp, senderPort, sessionKey, codec, quality, mediaTypes, sdpOffer, caller, callee}
   */
  decodeCallAttributes(hexStr) {
    if (!hexStr || hexStr === '00') return null
    try {
      const bytes = []
      for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substring(i, i + 2), 16))
      }
      if (bytes.length < 10) return null

      let offset = 1 // Skip version byte

      // IP address
      const ipTypeByte = bytes[offset++]
      const isIPv6 = (ipTypeByte >> 7) & 1
      const firstByte = ipTypeByte & 0x7F
      let senderIp
      if (!isIPv6) {
        senderIp = `${firstByte}.${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}`
        offset += 3
      } else {
        const ipBytes = [firstByte, ...bytes.slice(offset, offset + 15)]
        senderIp = this._bytesToIPv6(ipBytes)
        offset += 15
      }

      // Port
      const senderPort = (bytes[offset] << 8) | bytes[offset + 1]
      offset += 2

      // Session key
      const keyLen = bytes[offset++]
      const keyBuf = bytes.slice(offset, offset + keyLen)
      const sessionKey = new TextDecoder().decode(new Uint8Array(keyBuf))
      offset += keyLen

      // Codec and Quality
      const codec = CODEC_IDS[bytes[offset++]] || 'opus'
      const quality = QUALITY_IDS[bytes[offset++]] || 'hd'

      // Media types
      const mediaBitmask = bytes[offset++]
      const mediaTypes = []
      if (mediaBitmask & 0x01) mediaTypes.push('audio')
      if (mediaBitmask & 0x02) mediaTypes.push('video')

      // SDP
      const sdpLen = (bytes[offset] << 8) | bytes[offset + 1]
      offset += 2
      const sdpBuf = bytes.slice(offset, offset + sdpLen)
      const sdpOffer = new TextDecoder().decode(new Uint8Array(sdpBuf))
      offset += sdpLen

      // Caller address
      let caller = ''
      if (offset < bytes.length) {
        const callerLen = bytes[offset++]
        const callerBuf = bytes.slice(offset, offset + callerLen)
        caller = new TextDecoder().decode(new Uint8Array(callerBuf))
        offset += callerLen
      }

      // Callee address
      let callee = ''
      if (offset < bytes.length) {
        const calleeLen = bytes[offset++]
        const calleeBuf = bytes.slice(offset, offset + calleeLen)
        callee = new TextDecoder().decode(new Uint8Array(calleeBuf))
        offset += calleeLen
      }

      // senderIp4 (1-byte len: 4=present, 0=absent)
      let senderIp4 = null
      if (offset < bytes.length) {
        const ip4Len = bytes[offset++]
        if (ip4Len === 4) {
          senderIp4 = `${bytes[offset]}.${bytes[offset+1]}.${bytes[offset+2]}.${bytes[offset+3]}`
          offset += 4
        }
      }

      // senderIp6 (1-byte len: 16=present, 0=absent)
      let senderIp6 = null
      if (offset < bytes.length) {
        const ip6Len = bytes[offset++]
        if (ip6Len === 16) {
          senderIp6 = this._bytesToIPv6(bytes.slice(offset, offset + 16))
          offset += 16
        }
      }

      return { senderIp, senderPort, sessionKey, codec, quality, mediaTypes, sdpOffer, caller, callee, senderIp4, senderIp6 }
    } catch (error) {
      console.error('[CallToken] Failed to decode attributes:', error)
      return null
    }
  }

  /**
   * Compute 32-bit truncated SHA256 hash of an address (returns 8 hex chars = 4 bytes).
   * @param {string} address - BSV address
   * @returns {Promise<string>} 8-character hex string
   */
  async hashAddress(address) {
    try {
      const data = new TextEncoder().encode(address)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => ('0' + b.toString(16)).slice(-2)).join('').substring(0, 8)
    } catch (error) {
      console.error('[CallToken] Failed to hash address:', error)
      return '00000000'
    }
  }

  /** @private Convert IPv6 string to 16-byte array */
  _ipv6ToBytes(ip) {
    const parts = ip.split(':').filter(p => p.length > 0)
    const bytes = new Uint8Array(16)
    let byteIndex = 0
    for (let i = 0; i < parts.length && byteIndex < 16; i++) {
      const val = parseInt(parts[i], 16) || 0
      bytes[byteIndex++] = (val >> 8) & 0xFF
      bytes[byteIndex++] = val & 0xFF
    }
    return Array.from(bytes)
  }

  /** @private Convert 16-byte array to IPv6 string */
  _bytesToIPv6(bytes) {
    const parts = []
    for (let i = 0; i < 16; i += 2) {
      parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16))
    }
    return parts.join(':')
  }

  /**
   * Create and broadcast a CALL signal to the callee.
   * Single TX: OP_RETURN (call data) + 1-sat to callee + change.
   * @param {Object} callToken - {caller, callee, senderIp, senderPort, sessionKey, codec, quality, mediaTypes, sdpOffer}
   * @returns {Promise<{txId: string}>}
   */
  async createAndBroadcastCallToken(callToken) {
    this.log(`Sending call signal to ${callToken.callee}`, 'info')
    try {
      const callerHash = await this.hashAddress(callToken.caller)
      const calleeHash = await this.hashAddress(callToken.callee)
      const attrs = this.encodeCallAttributes(callToken)
      const callerIdent = callToken.caller?.slice(0, 5) || 'unkn'

      const result = await window.tokenBuilder.createCallSignalTx(
        `CALL-${callerIdent}`,
        callerHash + calleeHash,
        attrs,
        callToken.callee,
      )

      this.log(`✓ Call signal sent: ${result.txId}`, 'success')
      this.log(`https://whatsonchain.com/tx/${result.txId}`, 'info')

      return { txId: result.txId, tokenId: result.txId }
    } catch (err) {
      this.log(`Call signal failed: ${err.message}`, 'error')
      throw err
    }
  }

  /**
   * Broadcast an ANS signal back to the caller.
   * Single TX: OP_RETURN (answer data) + 1-sat to caller + change.
   * @param {string} callerAddress - Caller's BSV address
   * @param {Object} answerData - {sdpAnswer, senderIp, senderPort, sessionKey, codec, quality, mediaTypes, callee}
   * @returns {Promise<{txId: string}>}
   */
  async broadcastCallAnswer(callerAddress, answerData) {
    this.log(`Sending answer signal to ${callerAddress}`, 'info')
    try {
      const calleeAddr = answerData.callee || window.myAddress || ''
      const callerHash = await this.hashAddress(callerAddress)
      const calleeHash = await this.hashAddress(calleeAddr)
      const calleeIdent = calleeAddr.slice(0, 5) || 'unkn'

      const answerToken = {
        senderIp: answerData.senderIp,
        senderPort: answerData.senderPort,
        sessionKey: answerData.sessionKey,
        codec: answerData.codec,
        quality: answerData.quality,
        mediaTypes: answerData.mediaTypes,
        sdpAnswer: answerData.sdpAnswer,
        caller: callerAddress,
        callee: calleeAddr,
      }
      const attrs = this.encodeCallAttributes(answerToken)

      const result = await window.tokenBuilder.createCallSignalTx(
        `ANS-${calleeIdent}`,
        callerHash + calleeHash,
        attrs,
        callerAddress,
      )

      this.log(`✓ Answer signal sent: ${result.txId}`, 'success')
      this.log(`https://whatsonchain.com/tx/${result.txId}`, 'info')

      return { txId: result.txId }
    } catch (err) {
      this.log(`Answer signal failed: ${err.message}`, 'error')
      throw err
    }
  }
}

// Export for browser
if (typeof window !== 'undefined') {
  window.CallTokenManager = CallTokenManager
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CallTokenManager
}
