/**
 * Call Token Manager (v08.00) - 1-sat Ordinal Inscription Implementation
 *
 * Replaces the PPV (genesis + 10-min confirmation + transfer) flow with a single
 * 1-sat ordinal inscription sent directly to the callee. All WebRTC call data
 * (IP, port, SDP, codec, session key) is inscribed in the standard 1sat ordinal
 * envelope as JSON.
 *
 * Flow:
 *   Caller: buildAndBroadcast(callData, calleeAddress) → 1-sat inscription in mempool (~instant)
 *   Callee: polls address history → scans TXs → finds inscription → call:incoming
 *   Callee: buildAndBroadcast(answerData, callerAddress) → answer inscription in mempool
 *   Caller: polls → finds answer inscription → call:answered → WebRTC connect
 */

class CallTokenManager {
  constructor(uiLogger) {
    this.log = uiLogger
  }

  /**
   * Create and broadcast a call inscription to the callee.
   * @param {Object} callToken - {caller, callee, senderIp, senderPort, sessionKey, codec, quality, mediaTypes, sdpOffer}
   * @returns {Promise<{txId: string}>}
   */
  async createAndBroadcastCallToken(callToken) {
    this.log(`Sending call inscription to ${callToken.callee}`, 'info')

    const callData = {
      v: 1,
      proto: 'svphone',
      type: 'call',
      caller: callToken.caller,
      callee: callToken.callee,
      ip: callToken.senderIp,
      port: callToken.senderPort,
      key: callToken.sessionKey,
      codec: callToken.codec ?? 'opus',
      quality: callToken.quality ?? 'hd',
      media: callToken.mediaTypes ?? ['audio'],
      sdp: callToken.sdpOffer ?? '',
    }

    try {
      const result = await window.inscriptionBuilder.buildAndBroadcast(
        callData,
        callToken.callee,
        window.provider,
        window.myKey,
      )

      this.log(`✓ Call inscription sent: ${result.txId}`, 'success')
      this.log(`https://whatsonchain.com/tx/${result.txId}`, 'info')

      return { txId: result.txId }
    } catch (err) {
      this.log(`Call inscription failed: ${err.message}`, 'error')
      throw err
    }
  }

  /**
   * Broadcast an answer inscription back to the caller.
   * @param {string} callerAddress - Caller's BSV address
   * @param {Object} answerData - {sdpAnswer, senderIp, senderPort, sessionKey, codec, quality, mediaTypes, caller, callee}
   * @returns {Promise<{txId: string}>}
   */
  async broadcastCallAnswer(callerAddress, answerData) {
    this.log(`Sending answer inscription to ${callerAddress}`, 'info')

    const answerPayload = {
      v: 1,
      proto: 'svphone',
      type: 'answer',
      caller: answerData.caller,
      callee: answerData.callee,
      ip: answerData.senderIp,
      port: answerData.senderPort,
      key: answerData.sessionKey,
      codec: answerData.codec ?? 'opus',
      quality: answerData.quality ?? 'hd',
      media: answerData.mediaTypes ?? ['audio'],
      sdp: answerData.sdpAnswer ?? '',
    }

    try {
      const result = await window.inscriptionBuilder.buildAndBroadcast(
        answerPayload,
        callerAddress,
        window.provider,
        window.myKey,
      )

      this.log(`✓ Answer inscription sent: ${result.txId}`, 'success')
      this.log(`https://whatsonchain.com/tx/${result.txId}`, 'info')

      return { txId: result.txId }
    } catch (err) {
      this.log(`Answer inscription failed: ${err.message}`, 'error')
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
