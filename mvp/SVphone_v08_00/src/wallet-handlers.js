/**
 * Wallet Event Handlers (v06.12)
 *
 * Complete wallet functionality extracted and reorganized from v06.00.
 * Handles: Minting, transfers, verification, balance refresh, token management
 */

// ─── Global State ────────────────────────────────────────────────────────

let flushingTokenId = null
const fieldModes = { name: 'text', script: 'text', attrs: 'text', state: 'text' }
let mintMode = 'fungible'
let lastProofFetchTime = 0
let proofPollTimeoutId = null
const activePollTxIds = new Set()

// ─── Main Handlers ──────────────────────────────────────────────────────

class WalletHandlers {
  constructor(walletUI) {
    this.walletUI = walletUI
  }

  /**
   * Handle Refresh Balance button click
   */
  async refreshBalance() {
    try {
      window.setText('balance', 'loading...')
      const bal = await window.builder.getSpendableBalance()
      window.setText('balance', `${bal} sats`)
    } catch (e) {
      window.setText('balance', `error: ${e.message}`)
    }
    await this.silentCheckIncoming()
  }

  /**
   * Handle Restore Wallet button click
   */
  restoreWallet() {
    const wif = window.inputVal('import-wif')
    if (!wif) {
      alert('Paste a WIF private key first.')
      return
    }

    try {
      // Validate WIF format
      const testKey = window.bitcoin.PrivateKey.fromWif(wif)
      testKey.toPublicKey()
    } catch {
      alert('Invalid WIF private key.')
      return
    }

    if (!confirm('This will replace the current wallet key and reload the page. Token data in storage will be preserved. Continue?')) return

    localStorage.setItem('p:wallet:wif', wif)
    location.reload()
  }

  /**
   * Handle Send button click
   */
  async send() {
    const address = window.inputVal('send-address')
    const amountStr = window.inputVal('send-amount')

    if (!address || !amountStr) {
      window.setResult('send-result', 'Enter both a recipient address and amount.')
      return
    }

    const amount = parseInt(amountStr, 10)
    if (!amount || amount < 1) {
      window.setResult('send-result', 'Amount must be at least 1 satoshi.')
      return
    }

    const feeRate = parseInt(window.inputVal('fee-rate'), 10)
    if (feeRate > 0) window.builder.feePerKb = feeRate

    window.setResult('send-result', 'Building transaction...')

    try {
      const result = await window.builder.sendSats(address, amount)
      window.setResult('send-result', [
        'Sent!',
        `TXID: ${result.txId}`,
        `Amount: ${amount} sats`,
        `Fee: ${result.fee} sats`,
        `View: https://whatsonchain.com/tx/${result.txId}`,
      ].join('\n'))
      await this.refreshBalance()
    } catch (e) {
      window.setResult('send-result', `Error: ${e.message}`)
    }
  }

  /**
   * Handle Mint Token button click
   */
  async mintToken() {
    const nameRaw = window.inputVal('token-name')

    if (!nameRaw) {
      window.setResult('mint-result', 'Enter a token name.')
      return
    }

    // Convert name based on text/hex mode
    const name = fieldModes.name === 'text'
      ? nameRaw
      : new TextDecoder().decode(new Uint8Array(nameRaw.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []))

    const feeRate = parseInt(window.inputVal('fee-rate'), 10)
    if (feeRate > 0) window.builder.feePerKb = feeRate

    // ─── Fungible Mode ───────────────────────────────────────────────────
    if (mintMode === 'fungible') {
      const initialSupply = parseInt(window.inputVal('fungible-supply'), 10) || 1000
      if (initialSupply < 1) {
        window.setResult('mint-result', 'Initial supply must be at least 1 satoshi.')
        return
      }

      window.setResult('mint-result', `Minting fungible token with ${initialSupply} tokens...`)

      try {
        const result = await window.builder.createFungibleGenesis({
          tokenName: name,
          initialSupply,
        })

        window.setResult('mint-result', [
          'Fungible token minted!',
          `TXID: ${result.txId}`,
          `Token ID: ${result.tokenId}`,
          `Initial supply: ${result.initialSupply} tokens`,
          `View: https://whatsonchain.com/tx/${result.txId}`,
          '',
          'Polling for Merkle proof (may take ~10 min)...',
        ].join('\n'))

        await this.walletUI.loadTokens()
        await this.refreshBalance()

        window.builder.pollForProof(result.tokenId, result.txId, (msg) => {
          window.setResult('mint-result', [
            `TXID: ${result.txId}`,
            `Token ID: ${result.tokenId}`,
            msg,
          ].join('\n'))
        }).then(found => {
          if (found) this.walletUI.loadTokens()
        })

      } catch (e) {
        window.setResult('mint-result', `Error: ${e.message}`)
      }
      return
    }

    // ─── NFT Mode ────────────────────────────────────────────────────
    const scriptRaw = window.inputVal('token-script')
    const attrsRaw = window.inputVal('token-attrs')
    const stateRaw = window.inputVal('token-state')
    const supply = parseInt(window.inputVal('token-supply'), 10) || 1
    const divisibility = parseInt(window.inputVal('token-divisibility'), 10) || 0
    const restrictions = parseInt(window.inputVal('token-restrictions'), 10) || 0
    const rulesVersion = parseInt(window.inputVal('token-rules-version'), 10) || 1

    const attrs = attrsRaw ? (fieldModes.attrs === 'text' ? textToHex(attrsRaw) : attrsRaw) : '00'
    let stateData = ''
    if (stateRaw) {
      stateData = fieldModes.state === 'text' ? textToHex(stateRaw) : stateRaw
    }

    // Read file if one was selected
    const fileInput = window.el('token-file')
    const selectedFile = fileInput?.files?.[0]
    let fileData = undefined

    if (selectedFile) {
      if (selectedFile.size > 50_000_000) {
        window.setResult('mint-result', 'File too large. Max 50MB for on-chain storage.')
        return
      }
      const arrayBuf = await selectedFile.arrayBuffer()
      fileData = {
        bytes: new Uint8Array(arrayBuf),
        mimeType: window.inferMimeType(selectedFile.name, selectedFile.type),
        fileName: selectedFile.name,
      }
    }

    window.setResult('mint-result', fileData
      ? `Building genesis transaction with file (${(fileData.bytes.length / 1024).toFixed(1)} KB)...`
      : 'Building genesis transaction...')

    try {
      const result = await window.builder.createGenesis({
        tokenName: name,
        tokenScript: scriptRaw || '',
        attributes: fileData ? undefined : attrs,
        supply,
        divisibility,
        restrictions,
        rulesVersion,
        stateData,
        fileData,
      })

      // Cache file locally for pruning recovery
      if (fileData) {
        const hashBytes = window.bitcoin.Hash.sha256(Array.from(fileData.bytes))
        const hash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
        await window.fileCache.store(hash, fileData)
        window.setFileMeta(hash, fileData.mimeType, fileData.fileName)
      }

      const count = result.tokenIds.length
      const idSummary = count === 1
        ? `Token ID: ${result.tokenIds[0]}`
        : `Minted ${count} tokens (first: ${result.tokenIds[0].slice(0, 16)}...)`

      window.setResult('mint-result', [
        'Genesis broadcast!',
        `TXID: ${result.txId}`,
        idSummary,
        `View: https://whatsonchain.com/tx/${result.txId}`,
        '',
        'Polling for Merkle proof (may take ~10 min)...',
      ].join('\n'))

      await this.walletUI.loadTokens()
      await this.refreshBalance()

      window.builder.pollForProof(result.tokenIds[0], result.txId, (msg) => {
        window.setResult('mint-result', [
          `TXID: ${result.txId}`,
          idSummary,
          msg,
        ].join('\n'))
      }).then(found => {
        if (found) this.walletUI.loadTokens()
      })

    } catch (e) {
      window.setResult('mint-result', `Error: ${e.message}`)
    }
  }

  /**
   * Handle Check Incoming Tokens button click
   */
  async checkIncomingTokens() {
    const btn = window.el('btn-check-incoming')
    if (btn) btn.disabled = true

    try {
      await this.walletUI.refreshTokens()
      console.log('[WalletHandlers] Tokens checked')
    } catch (err) {
      console.error('[WalletHandlers] Error checking incoming tokens:', err)
    }

    if (btn) btn.disabled = false
  }

  /**
   * Handle Transfer button click
   */
  async transfer() {
    const tokenId = window.inputVal('transfer-token-id')
    const recipient = window.inputVal('transfer-recipient')
    const messageText = window.inputVal('transfer-message')

    // DEBUG: Log message being sent
    if (messageText) {
      const messageHex = Array.from(new TextEncoder().encode(messageText)).map(b => b.toString(16).padStart(2, '0')).join('')
      console.debug(`transfer: Sending message "${messageText}" (${messageText.length} chars, ${messageHex.length} hex chars)`)
    }

    if (!tokenId || !recipient) {
      window.setResult('transfer-result', 'Enter both Token ID and recipient BSV address.')
      return
    }

    const feeRate = parseInt(window.inputVal('fee-rate'), 10)
    if (feeRate > 0) window.builder.feePerKb = feeRate

    // Check for file attachment
    const transferFileInput = window.el('transfer-file')
    const selectedFile = transferFileInput?.files?.[0]
    let fileData = undefined

    if (selectedFile) {
      if (selectedFile.size > 50_000_000) {
        window.setResult('transfer-result', 'File too large. Max 50MB for on-chain storage.')
        return
      }
      const arrayBuf = await selectedFile.arrayBuffer()
      fileData = {
        bytes: new Uint8Array(arrayBuf),
        mimeType: window.inferMimeType(selectedFile.name, selectedFile.type),
        fileName: selectedFile.name,
      }
    }

    window.setResult('transfer-result', fileData
      ? `Building transfer transaction with file (${(fileData.bytes.length / 1024).toFixed(1)} KB)...`
      : 'Building transfer transaction...')

    try {
      // Check if this is a fungible token
      const fungible = await window.store.getFungibleToken(tokenId)
      if (fungible) {
        window.setResult('transfer-result', [
          'This is a fungible token. Use the "Send" button in the token card above.',
          '',
          `Token: ${fungible.tokenName}`,
          `Balance: ${fungible.utxos.filter(u => u.status === 'active').reduce((s, u) => s + u.satoshis, 0).toLocaleString()} tokens`,
        ].join('\n'))
        return
      }

      // Build stateData with pipe delimiter between message and file hash
      let newStateData = undefined
      if (fileData) {
        const hashBytes = window.bitcoin.Hash.sha256(Array.from(fileData.bytes))
        const fileHash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
        newStateData = encodeStateData(messageText || '', fileHash)
      } else if (messageText) {
        newStateData = encodeStateData(messageText)
      }

      const includeStateData = (window.el('transfer-include-state'))?.checked ?? false
      const result = await window.builder.createTransfer(tokenId, recipient, newStateData, fileData, includeStateData)

      // Verify token status was updated in storage
      const updatedToken = await window.store.getToken(tokenId)
      console.debug(`transfer: Token ${tokenId.slice(0, 12)} status after createTransfer:`, updatedToken?.status)

      // Cache file locally if attached
      if (fileData) {
        const hashBytes = window.bitcoin.Hash.sha256(Array.from(fileData.bytes))
        const hash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
        await window.fileCache.store(hash, fileData)
        window.setFileMeta(hash, fileData.mimeType, fileData.fileName)
      }

      window.setResult('transfer-result', [
        'Transfer broadcast!',
        `TXID: ${result.txId}`,
        fileData ? `File attached: ${fileData.fileName}` : '',
        `View: https://whatsonchain.com/tx/${result.txId}`,
        '',
        'Token data is encoded on-chain. The recipient can click',
        '"Check Incoming Tokens" to auto-import it.',
      ].filter(Boolean).join('\n'))

      // Clear the file input after successful transfer
      if (transferFileInput) transferFileInput.value = ''
      const transferClearBtn = window.el('btn-clear-transfer-file')
      const transferFileInfo = window.el('transfer-file-info')
      const transferMsgInput = window.el('transfer-message')
      if (transferClearBtn) transferClearBtn.style.display = 'none'
      if (transferFileInfo) { transferFileInfo.style.display = 'none'; transferFileInfo.textContent = '' }
      if (transferMsgInput) transferMsgInput.disabled = false

      await this.walletUI.loadTokens()
      await this.refreshBalance()

      // Poll for on-chain confirmation, then auto-confirm transfer
      pollTransferConfirmation(result.txId, result.tokenId, this.walletUI)

    } catch (e) {
      window.setResult('transfer-result', `Error: ${e.message}`)
    }
  }

  /**
   * Handle Verify Proof Chain button click
   */
  async verifyProofChain() {
    const tokenId = window.inputVal('verify-token-id')
    if (!tokenId) {
      window.setResult('verify-result', 'Enter a Token ID.')
      return
    }

    window.setResult('verify-result', 'Verifying...')

    try {
      // Check token status first
      const token = await window.store.getToken(tokenId)
      const fungible = token ? null : await window.store.getFungibleToken(tokenId)

      if (token && token.status === 'transferred') {
        window.setResult('verify-result', [
          `Valid: false`,
          `Reason: This token has been transferred away from your wallet and is no longer in your possession.`,
        ].join('\n'))
        return
      }

      if (fungible && fungible.utxos.every(u => u.status === 'transferred')) {
        window.setResult('verify-result', [
          `Valid: false`,
          `Reason: All UTXOs of this fungible token have been transferred away.`,
        ].join('\n'))
        return
      }

      const result = await window.builder.verifyToken(tokenId)
      window.setResult('verify-result', [
        `Valid: ${result.valid}`,
        `Reason: ${result.reason}`,
      ].join('\n'))
    } catch (e) {
      window.setResult('verify-result', `Error: ${e.message}`)
    }
  }

  /**
   * Silent check for incoming tokens
   */
  async silentCheckIncoming() {
    try {
      const imported = await window.builder.checkIncomingTokens()
      if (imported.length > 0) {
        window.setText('incoming-status', `Auto-imported ${imported.length} token(s)`)
        await this.walletUI.loadTokens()
        // Restart proof polling: new tokens may have arrived and need proofs
        if (proofPollTimeoutId) clearTimeout(proofPollTimeoutId)
        startProofPolling(this.walletUI)
      }
    } catch {
      // Silent
    }
  }

  /**
   * Start proof polling
   */
  startProofPolling() {
    lastProofFetchTime = Date.now()
    fetchMissingProofs(this.walletUI).then(() => scheduleNextProofPoll(this.walletUI))
  }

  /**
   * New wallet (generate new key)
   */
  newWallet() {
    if (!confirm('This will generate a new key and clear all tokens. Continue?')) return
    localStorage.clear()
    location.reload()
  }
}

// ─── Toggle Functions ──────────────────────────────────────────────────

function toggleFieldMode(field) {
  fieldModes[field] = fieldModes[field] === 'text' ? 'hex' : 'text'
  const btn = window.el(`btn-${field}-mode`)
  if (btn) btn.textContent = fieldModes[field] === 'text' ? 'Text' : 'Hex'
  const hint = window.el('field-mode-hint')
  if (hint) hint.textContent = Object.values(fieldModes).every(m => m === 'text')
    ? 'Text mode: input is UTF-8 encoded to hex. Toggle individual fields for raw hex input.'
    : 'Some fields in hex mode: raw hex bytes expected. Toggle to switch back to text.'
}

function toggleMintMode() {
  mintMode = mintMode === 'fungible' ? 'nft' : 'fungible'
  const btn = window.el('btn-mint-mode')
  const hint = window.el('mint-mode-hint')
  const fungibleFields = window.el('fungible-fields')
  const nftFields = window.el('nft-fields')

  if (mintMode === 'fungible') {
    if (btn) { btn.textContent = 'Fungible'; btn.style.background = '#238636' }
    if (hint) hint.textContent = 'Fungible: amount = satoshis, all UTXOs share same Token ID'
    if (fungibleFields) fungibleFields.style.display = ''
    if (nftFields) nftFields.style.display = 'none'
  } else {
    if (btn) { btn.textContent = 'NFT'; btn.style.background = '#6e40c9' }
    if (hint) hint.textContent = 'NFT: unique Token IDs, supports supply/divisibility/file attachments'
    if (fungibleFields) fungibleFields.style.display = 'none'
    if (nftFields) nftFields.style.display = ''
  }
}

// ─── Encoding/Decoding Helpers ──────────────────────────────────────────

function textToHex(text) {
  return Array.from(new TextEncoder().encode(text))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Encode stateData with pipe delimiter between text and file hash.
 * Format: <text>7c<fileHash> or 7c<fileHash> or <text> (where 7c = hex for |)
 * Escapes | in text as ~|~
 */
function encodeStateData(text, fileHash) {
  // Escape all pipes in text
  const escapedText = text.replace(/\|/g, '~|~')
  const encodedText = escapedText ? textToHex(escapedText) : ''

  if (fileHash) {
    // Both text and file, or file only - use hex-encoded pipe (7c)
    return encodedText ? `${encodedText}7c${fileHash}` : `7c${fileHash}`
  }

  // Text only (no pipe)
  return encodedText
}

/**
 * Decode stateData with hex-encoded pipe delimiter (7c = 0x7C = |).
 * Returns { text, fileHash? } where text is unescaped UTF-8
 */
function decodeStateData(stateHex) {
  if (!stateHex || stateHex === '00') {
    return { text: '' }
  }

  // Split at first unescaped hex-encoded pipe (7c not preceded or followed by 7e7c7e)
  // In hex: 7e = ~, 7c = |, so escaped pipe is 7e7c7e (~|~)
  // Pattern: 7c not surrounded by 7e
  const parts = stateHex.split(/(?<!7e)7c(?!7e)/)

  if (parts.length === 1) {
    // No hex-pipe found - text only
    try {
      const bytes = new Uint8Array(stateHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || [])
      let decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      // Unescape ~|~ (hex: 7e7c7e) back to | (hex: 7c)
      decoded = decoded.replace(/~\|~/g, '|')
      return { text: decoded }
    } catch {
      return { text: '' }
    }
  }

  if (parts.length === 2) {
    // Found hex-delimiter: parts[0] = text hex (may be empty), parts[1] = file hash hex
    const textHex = parts[0]
    const fileHash = parts[1]

    // Validate file hash (must be 64 hex chars)
    if (!/^[0-9a-f]{64}$/i.test(fileHash)) {
      // Invalid hash format, treat entire string as text
      try {
        const bytes = new Uint8Array(stateHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || [])
        let decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        decoded = decoded.replace(/~\|~/g, '|')
        return { text: decoded }
      } catch {
        return { text: '' }
      }
    }

    // Decode text portion (if any)
    let text = ''
    if (textHex) {
      try {
        const bytes = new Uint8Array(textHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || [])
        let decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        // Unescape ~|~ back to |
        text = decoded.replace(/~\|~/g, '|')
      } catch {
        // Ignore decode errors for text portion
      }
    }

    return { text, fileHash }
  }

  // Multiple hex-pipes found (shouldn't happen), treat as text only
  try {
    const bytes = new Uint8Array(stateHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || [])
    let decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    decoded = decoded.replace(/~\|~/g, '|')
    return { text: decoded }
  } catch {
    return { text: '' }
  }
}

// ─── Proof Polling ──────────────────────────────────────────────────────

async function fetchMissingProofs(walletUI) {
  try {
    const count = await window.builder.fetchMissingProofs()
    if (count > 0) {
      window.setText('incoming-status', `Updated ${count} proof chain(s)`)
      await walletUI.loadTokens()
    }
  } catch {
    // Silent
  }
}

function scheduleNextProofPoll(walletUI) {
  if (proofPollTimeoutId) clearTimeout(proofPollTimeoutId)

  const now = Date.now()
  const elapsedMs = now - lastProofFetchTime
  const elapsedMin = elapsedMs / (1000 * 60)

  let nextPollMs
  let statusMsg

  if (elapsedMin < 60) {
    // Within first hour: poll every 1 minute
    nextPollMs = 60 * 1000
    statusMsg = `🔄 Polling for proofs every 1 min (${Math.round(elapsedMin)}/${60} min)`
  } else if (elapsedMin < 1440) {
    // Between 1-24 hours: poll every 1 hour
    nextPollMs = 60 * 60 * 1000
    statusMsg = `🔄 Polling for proofs every 1 hour (${Math.round(elapsedMin)}/${1440} min)`
  } else {
    // After 24 hours: stop polling
    window.setText('incoming-status', `⏹️ Proof polling stopped (24h elapsed)`)
    return
  }

  window.setText('incoming-status', statusMsg)

  proofPollTimeoutId = setTimeout(async () => {
    lastProofFetchTime = Date.now()
    await fetchMissingProofs(walletUI)
    scheduleNextProofPoll(walletUI)
  }, nextPollMs)
}

function startProofPolling(walletUI) {
  lastProofFetchTime = Date.now()
  fetchMissingProofs(walletUI).then(() => scheduleNextProofPoll(walletUI))
}

function pollTransferConfirmation(txId, tokenId, walletUI) {
  if (activePollTxIds.has(txId)) return
  activePollTxIds.add(txId)

  setTimeout(() => {
    window.builder.pollForConfirmation(txId, (msg) => {
      console.debug(`[transfer-poll] ${tokenId.slice(0, 12)}...: ${msg}`)
    }).then(async (confirmed) => {
      if (confirmed) {
        try {
          await window.builder.confirmTransfer(tokenId)
          await walletUI.loadTokens()
        } catch (e) {
          console.error(`[transfer-poll] confirmTransfer failed for ${tokenId}:`, e.message)
        }
      }
    }).catch((e) => {
      console.error(`[transfer-poll] poll error for ${txId}:`, e.message)
    }).finally(() => {
      activePollTxIds.delete(txId)
    })
  }, 1000)
}

// ─── Window-Exposed Helpers for Inline Onclick Handlers ─────────────────

window._selectGroupToken = async (genKey, tokenId) => {
  const token = await window.store.getToken(tokenId)
  if (!token) return
  // Works for both NFT dropdown (detail-*) and fragment dropdown (fdet-*)
  const detailEl = window.el(genKey.startsWith('fdet-') ? genKey : `detail-${genKey}`)
  if (detailEl) detailEl.innerHTML = window.renderTokenDetail(token)
  // Only populate the transfer input if the token is active
  if (token.status === 'active') {
    const transferInput = window.el('transfer-token-id')
    if (transferInput) transferInput.value = tokenId
  }
}

window._selectForTransfer = (tokenId) => {
  const input = window.el('transfer-token-id')
  if (input) input.value = tokenId
  window.el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

window._transferFragments = async (genesisTxId, genKey) => {
  const amtInput = window.el(`frag-amt-${genKey}`)
  const count = parseInt(amtInput?.value ?? '1', 10)
  if (!count || count < 1) {
    window.setResult('transfer-result', 'Enter a valid fragment count (minimum 1).')
    return
  }

  const recipient = window.inputVal('transfer-recipient')
  if (!recipient) {
    window.setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below.')
    window.el('transfer-recipient')?.focus()
    return
  }

  // Get active fragments for this genesis, sorted by output index (lowest first)
  const tokens = await window.store.listTokens()
  const activeFragments = tokens
    .filter(t => t.genesisTxId === genesisTxId && t.status === 'active')
    .sort((a, b) => a.genesisOutputIndex - b.genesisOutputIndex)

  if (count > activeFragments.length) {
    window.setResult('transfer-result', `Only ${activeFragments.length} active fragment(s) available.`)
    return
  }

  const toSend = activeFragments.slice(0, count)

  const feeRate = parseInt(window.inputVal('fee-rate'), 10)
  if (feeRate > 0) window.builder.feePerKb = feeRate

  window.setResult('transfer-result', `Transferring ${count} fragment(s) to ${recipient}...`)

  let sent = 0
  const errors = []
  for (const frag of toSend) {
    try {
      const result = await window.builder.createTransfer(frag.tokenId, recipient)
      sent++
      window.setResult('transfer-result', `Sent fragment #${frag.genesisOutputIndex} (${sent}/${count})...\nTXID: ${result.txId}`)
      pollTransferConfirmation(result.txId, result.tokenId, window.walletUI)
    } catch (e) {
      errors.push(`#${frag.genesisOutputIndex}: ${e.message}`)
    }
  }

  const summary = [`Transferred ${sent}/${count} fragment(s) to ${recipient}`]
  if (errors.length > 0) {
    summary.push('', 'Errors:', ...errors)
  }
  window.setResult('transfer-result', summary.join('\n'))
  await window.walletUI.loadTokens()
  await window.walletUI.refreshBalance()
}

window._sendSingleFragment = async (tokenId, fragIndex) => {
  const recipient = window.inputVal('transfer-recipient')
  if (!recipient) {
    window.setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below.')
    window.el('transfer-recipient')?.focus()
    return
  }

  const feeRate = parseInt(window.inputVal('fee-rate'), 10)
  if (feeRate > 0) window.builder.feePerKb = feeRate

  window.setResult('transfer-result', `Sending fragment #${fragIndex}...`)

  try {
    const result = await window.builder.createTransfer(tokenId, recipient)
    window.setResult('transfer-result', `Sent fragment #${fragIndex}\nTXID: ${result.txId}\nView: https://whatsonchain.com/tx/${result.txId}`)
    pollTransferConfirmation(result.txId, result.tokenId, window.walletUI)
    await window.walletUI.loadTokens()
    await window.walletUI.refreshBalance()
  } catch (e) {
    window.setResult('transfer-result', `Error sending fragment #${fragIndex}: ${e.message}`)
  }
}

window._verifyToken = (tokenId) => {
  const input = window.el('verify-token-id')
  if (input) input.value = tokenId
  window.walletHandlers.verifyProofChain().then(() => {
    window.el('verify-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

window._transferFungible = async (tokenId, genKey) => {
  const tokenIdInput = window.el('transfer-token-id')
  if (tokenIdInput) tokenIdInput.value = tokenId

  const amtInput = window.el(`fungible-send-${genKey}`)
  const amount = parseInt(amtInput?.value ?? '0', 10)
  if (!amount || amount < 1) {
    window.setResult('transfer-result', 'Enter a valid amount (minimum 1 sat).')
    window.el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  const recipient = window.inputVal('transfer-recipient')
  if (!recipient) {
    window.setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below.')
    window.el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.el('transfer-recipient')?.focus()
    return
  }

  // Get state data from input
  const stateInput = window.el(`fungible-state-${genKey}`)
  const stateText = stateInput?.value?.trim() ?? ''
  const newStateData = stateText ? encodeStateData(stateText) : undefined

  const feeRate = parseInt(window.inputVal('fee-rate'), 10)
  if (feeRate > 0) window.builder.feePerKb = feeRate

  window.setResult('transfer-result', `Transferring ${amount.toLocaleString()} tokens...`)

  try {
    const result = await window.builder.transferFungible(tokenId, recipient, amount, newStateData)
    window.setResult('transfer-result', [
      'Fungible transfer broadcast!',
      `TXID: ${result.txId}`,
      `Sent: ${result.amountSent.toLocaleString()} tokens`,
      result.change > 0 ? `Change: ${result.change.toLocaleString()} tokens` : '',
      `View: https://whatsonchain.com/tx/${result.txId}`,
    ].filter(Boolean).join('\n'))

    await window.walletUI.loadTokens()
    await window.walletUI.refreshBalance()
  } catch (e) {
    window.setResult('transfer-result', `Error: ${e.message}`)
  }
}

window._verifyFungible = async (tokenId) => {
  const input = window.el('verify-token-id')
  if (input) input.value = tokenId
  await window.walletHandlers.verifyProofChain()
  window.el('verify-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

window._forwardMessage = async (tokenId, utxoTxId, utxoOutputIndex) => {
  const recipient = window.inputVal('transfer-recipient')
  if (!recipient) {
    window.setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below to forward this message.')
    window.el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.el('transfer-recipient')?.focus()
    return
  }

  const feeRate = parseInt(window.inputVal('fee-rate'), 10)
  if (feeRate > 0) window.builder.feePerKb = feeRate

  window.setResult('transfer-result', 'Forwarding message UTXO...')

  try {
    const result = await window.builder.forwardFungibleUtxo(tokenId, utxoTxId, utxoOutputIndex, recipient)
    window.setResult('transfer-result', [
      'Message forwarded!',
      `TXID: ${result.txId}`,
      `Sent: ${result.amountSent.toLocaleString()} tokens`,
      `View: https://whatsonchain.com/tx/${result.txId}`,
    ].join('\n'))

    await window.walletUI.loadTokens()
    await window.walletUI.refreshBalance()
  } catch (e) {
    window.setResult('transfer-result', `Error: ${e.message}`)
  }
}

window._removeUtxo = async (tokenId, utxoTxId, utxoOutputIndex) => {
  if (!confirm(`Remove UTXO ${utxoTxId.slice(0, 12)}...:${utxoOutputIndex} from this token's basket?\n\nThis only removes it from local storage, not from the blockchain.`)) {
    return
  }

  try {
    const token = await window.store.getFungibleToken(tokenId)
    if (!token) {
      alert('Token not found')
      return
    }

    const idx = token.utxos.findIndex(u => u.txId === utxoTxId && u.outputIndex === utxoOutputIndex)
    if (idx === -1) {
      alert('UTXO not found in basket')
      return
    }

    token.utxos.splice(idx, 1)
    await window.store.updateFungibleToken(token)
    await window.walletUI.loadTokens()
  } catch (e) {
    alert(`Error: ${e.message}`)
  }
}

window._confirmTransfer = async (tokenId) => {
  if (!confirm('Mark this token as transferred?')) return
  try {
    await window.builder.confirmTransfer(tokenId)
    await window.walletUI.loadTokens()
  } catch (e) {
    alert(`Error: ${e.message}`)
  }
}

window._viewFile = async (genesisTxId, hash, currentTxId) => {
  // 1. Check local IndexedDB cache
  let file = await window.fileCache.get(hash)

  // Sync metadata to localStorage if we have a cached file but no metadata
  if (file && !window.getFileMeta(hash)) {
    window.setFileMeta(hash, file.mimeType, file.fileName)
  }

  // 2. Fetch from genesis TX
  if (!file) {
    try {
      const fetched = await window.builder.fetchFileFromGenesis(genesisTxId, hash)
      if (fetched) {
        file = { hash, ...fetched }
        await window.fileCache.store(hash, fetched)
        window.setFileMeta(hash, fetched.mimeType, fetched.fileName)
      }
    } catch (e) {
      console.debug('fetchFileFromGenesis failed:', e.message)
    }
  }

  // 3. Try current TX (for files attached during transfer)
  if (!file && currentTxId && currentTxId !== genesisTxId) {
    try {
      const fetched = await window.builder.fetchFileFromGenesis(currentTxId, hash)
      if (fetched) {
        file = { hash, ...fetched }
        await window.fileCache.store(hash, fetched)
        window.setFileMeta(hash, fetched.mimeType, fetched.fileName)
      }
    } catch (e) {
      console.debug('fetchFileFromTransfer failed:', e.message)
    }
  }

  // 4. Pruning recovery: prompt user to provide original file
  if (!file) {
    promptFileRecovery(hash)
    return
  }

  displayFile(file)
}

function displayFile(file) {
  const blob = new Blob([file.bytes.buffer], { type: file.mimeType })
  const url = URL.createObjectURL(blob)

  const modal = window.el('media-modal')
  const filenameEl = window.el('media-filename')
  const contentEl = window.el('media-content')
  if (!modal || !filenameEl || !contentEl) {
    // Fallback to download if modal not found
    const a = document.createElement('a')
    a.href = url
    a.download = file.fileName
    a.click()
    return
  }

  filenameEl.textContent = file.fileName
  let html = ''

  const controlsEl = window.el('media-controls')
  const isMedia = file.mimeType.startsWith('audio/') || file.mimeType.startsWith('video/')

  if (file.mimeType.startsWith('image/')) {
    html = `<img src="${url}" alt="${window.escHtml(file.fileName)}" />`
  } else if (file.mimeType.startsWith('audio/')) {
    html = `<audio id="media-player" src="${url}" autoplay></audio>`
  } else if (file.mimeType.startsWith('video/')) {
    html = `<video id="media-player" src="${url}" controls autoplay></video>`
  } else if (file.mimeType.startsWith('text/')) {
    const text = new TextDecoder().decode(file.bytes)
    html = `<pre>${text.replace(/</g, '&lt;')}</pre>`
  } else {
    // Unknown type: download instead
    const a = document.createElement('a')
    a.href = url
    a.download = file.fileName
    a.click()
    return
  }

  contentEl.innerHTML = html
  modal.classList.add('show')

  // Show/hide media controls and reset loop button state
  if (controlsEl) {
    controlsEl.style.display = isMedia ? 'flex' : 'none'
    const loopBtn = window.el('mc-loop')
    if (loopBtn) loopBtn.classList.remove('active')
  }

  // Close on Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') closeMediaModal()
  }
  document.addEventListener('keydown', escHandler)
  modal._escHandler = escHandler

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) closeMediaModal()
  }
}

function closeMediaModal() {
  const modal = window.el('media-modal')
  const contentEl = window.el('media-content')
  if (modal) {
    modal.classList.remove('show')
    // Remove Escape key handler
    if (modal._escHandler) {
      document.removeEventListener('keydown', modal._escHandler)
    }
  }
  // Stop any playing media and clear content
  if (contentEl) {
    const video = contentEl.querySelector('video')
    const audio = contentEl.querySelector('audio')
    if (video) video.pause()
    if (audio) audio.pause()
    contentEl.innerHTML = ''
  }
}

window._closeMediaModal = closeMediaModal

// Media control handlers
function getMediaPlayer() {
  return document.getElementById('media-player')
}

window._mediaPlay = () => {
  const player = getMediaPlayer()
  if (player) player.play()
}

window._mediaPause = () => {
  const player = getMediaPlayer()
  if (player) player.pause()
}

window._mediaStop = () => {
  const player = getMediaPlayer()
  if (player) {
    player.pause()
    player.currentTime = 0
  }
}

window._mediaLoop = () => {
  const player = getMediaPlayer()
  const loopBtn = window.el('mc-loop')
  if (player && loopBtn) {
    player.loop = !player.loop
    loopBtn.classList.toggle('active', player.loop)
  }
}

window._mediaVolume = (value) => {
  const player = getMediaPlayer()
  if (player) player.volume = parseInt(value, 10) / 100
}

function promptFileRecovery(expectedHash) {
  const msg = 'Genesis TX unavailable (possibly pruned). Upload the original file to verify and restore.'
  if (!confirm(msg)) return

  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    const arrayBuf = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuf)
    const hashBytes = window.bitcoin.Hash.sha256(Array.from(bytes))
    const computedHash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')

    if (computedHash !== expectedHash) {
      alert('Hash mismatch. This is not the original file embedded in this NFT.')
      return
    }

    const fileData = {
      mimeType: file.type || 'application/octet-stream',
      fileName: file.name,
      bytes,
    }

    await window.fileCache.store(expectedHash, fileData)
    window.setFileMeta(expectedHash, fileData.mimeType, fileData.fileName)
    displayFile(fileData)
  }
  input.click()
}

// ─── Flush & Recovery Functions ──────────────────────────────────────────

window._openFlushDialog = async (tokenId) => {
  const token = await window.store.getToken(tokenId)
  if (!token) {
    alert('Token not found')
    return
  }

  flushingTokenId = tokenId
  const dialog = window.el('flush-dialog')
  const tokenNameEl = window.el('flush-token-name')

  if (!dialog) return

  if (tokenNameEl) {
    tokenNameEl.textContent = token.tokenName
  }

  dialog.showModal()
}

window._confirmFlushToken = async () => {
  if (!flushingTokenId) return

  const dialog = window.el('flush-dialog')
  const preserveCheckbox = window.el('flush-preserve')
  const preserveMetadata = preserveCheckbox?.checked ?? true

  if (!dialog) return

  dialog.close()

  try {
    window.setText('transfer-result', `Flushing token ${flushingTokenId.slice(0, 12)}...`)

    const result = await window.builder.flushToken(flushingTokenId, preserveMetadata)

    window.setResult('transfer-result', [
      'Token flushed!',
      `Token ID: ${result.tokenId}`,
      `Flushed at: ${result.flushedAt}`,
      '',
      preserveMetadata
        ? 'Metadata preserved. Token can be recovered if needed.'
        : 'Metadata not preserved. Token removed permanently.',
    ].join('\n'))

    await window.walletUI.loadTokens()
    await window.walletUI.refreshBalance()
  } catch (e) {
    window.setResult('transfer-result', `Error flushing token: ${e.message}`)
  }

  flushingTokenId = null
}

window._cancelFlushDialog = () => {
  const dialog = window.el('flush-dialog')
  if (dialog) dialog.close()
  flushingTokenId = null
}

window._recoverFlushedToken = async (tokenId) => {
  try {
    const token = await window.store.getToken(tokenId)
    if (!token) {
      window.setResult('transfer-result', 'Token not found in storage')
      return
    }

    if (token.status !== 'flushed') {
      window.setResult('transfer-result', `Token is not in flushed state (current status: ${token.status})`)
      return
    }

    window.setText('transfer-result', `Un-flushing token ${tokenId.slice(0, 12)}...`)

    // Restore token to active status
    token.status = 'active'
    token.flushedAt = undefined
    await window.store.updateToken(token)

    window.setResult('transfer-result', [
      'Token restored!',
      `Token: ${token.tokenName} (${tokenId.slice(0, 12)}...)`,
      `Status: Active`,
      'Token has been restored from flushed state.',
    ].join('\n'))

    await window.walletUI.loadTokens()
  } catch (e) {
    window.setResult('transfer-result', `Error recovering token: ${e.message}`)
  }
}

window._startRecoveryScan = async () => {
  const resultsDiv = window.el('recovery-results')
  if (!resultsDiv) return

  try {
    const tokens = await window.store.listTokens()
    const flushedTokens = tokens.filter(t => t.status === 'flushed')

    let html = `<div style="margin-top:12px;border-top:1px solid #30363d;padding-top:12px;">`

    if (flushedTokens.length > 0) {
      html += `<div style="margin-bottom:12px;padding:12px;background:#3d2d0d;border-left:4px solid #d29922;border-radius:4px;">
        <strong style="color:#d29922;">⚠ Flushed Tokens: ${flushedTokens.length}</strong><br>
        <span style="font-size:0.9em;color:#c9d1d9;">These tokens are flushed and can be restored:</span>
        ${flushedTokens.map(t => `
          <div style="margin-top:6px;font-size:0.85em;">
            <span style="color:#c9d1d9;">${window.escHtml(t.tokenName)}</span>
            <code class="muted" style="font-size:0.8em;display:block;">${t.tokenId.slice(0, 20)}...</code>
            <button onclick="window._recoverFlushedToken('${t.tokenId}')" style="margin-top:4px;font-size:0.75em;background:#238636;">Restore Token</button>
          </div>
        `).join('')}
      </div>`
    } else {
      html += `<div style="padding:12px;background:#161b22;border-radius:4px;color:#c9d1d9;">
        No flushed tokens found.
      </div>`
    }

    html += `</div>`
    resultsDiv.innerHTML = html
  } catch (e) {
    alert(`Error: ${e.message}`)
  }
}

// ─── Export for use ─────────────────────────────────────────────────────

window.WalletHandlers = WalletHandlers
window.toggleFieldMode = toggleFieldMode
window.toggleMintMode = toggleMintMode
