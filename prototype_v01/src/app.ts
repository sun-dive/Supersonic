/**
 * MPT Prototype Wallet -- Browser entry point.
 *
 * Manages key persistence, UI state, and wires user actions
 * to the P2PKH token builder.
 */
import { PrivateKey } from '@bsv/sdk'
import { WocProvider } from './wocProvider'
import {
  P2pkhTokenBuilder,
  TokenStore,
  LocalStorageBackend,
  OwnedToken,
} from './p2pkhTokenBuilder'

// ─── Globals ────────────────────────────────────────────────────────

let provider: WocProvider
let builder: P2pkhTokenBuilder
let store: TokenStore

const WIF_KEY = 'mpt:wallet:wif'

// ─── Initialization ─────────────────────────────────────────────────

function init() {
  // Load or create key
  let wif = localStorage.getItem(WIF_KEY)
  let key: PrivateKey

  if (wif) {
    try {
      key = PrivateKey.fromWif(wif)
    } catch {
      // Corrupted WIF, regenerate
      key = PrivateKey.fromRandom()
      localStorage.setItem(WIF_KEY, key.toWif())
    }
  } else {
    key = PrivateKey.fromRandom()
    wif = key.toWif()
    localStorage.setItem(WIF_KEY, wif)
  }

  provider = new WocProvider(key)
  const storage = new LocalStorageBackend('mpt:data:')
  store = new TokenStore(storage)
  builder = new P2pkhTokenBuilder(provider, store)

  // Display wallet info
  setText('address', provider.getAddress())
  setText('pubkey', provider.getPublicKeyHex())
  setText('privkey', key.toWif())

  // Bind buttons
  on('btn-refresh', refreshBalance)
  on('btn-mint', handleMint)
  on('btn-transfer', handleTransfer)
  on('btn-import', handleImport)
  on('btn-verify', handleVerify)
  on('btn-new-wallet', handleNewWallet)

  // Initial refresh
  refreshBalance()
  refreshTokenList()
}

// ─── Actions ────────────────────────────────────────────────────────

async function refreshBalance() {
  try {
    setText('balance', 'loading...')
    const bal = await provider.getBalance()
    setText('balance', `${bal} sats`)
  } catch (e: any) {
    setText('balance', `error: ${e.message}`)
  }
}

async function refreshTokenList() {
  const tokens = await store.listTokens()
  const container = el('token-list')
  if (!container) return

  if (tokens.length === 0) {
    container.innerHTML = '<p class="muted">No tokens yet. Mint one above.</p>'
    return
  }

  container.innerHTML = tokens.map(t => `
    <div class="token-card">
      <div class="token-header">${escHtml(t.tokenName)}</div>
      <div class="token-field"><span class="label">Token ID:</span> <code class="selectable">${t.tokenId}</code></div>
      <div class="token-field"><span class="label">Current TXID:</span> <code class="selectable">${t.currentTxId}</code></div>
      <div class="token-field"><span class="label">Output:</span> ${t.currentOutputIndex}</div>
      <div class="token-field"><span class="label">Owner:</span> <code class="selectable">${t.ownerPubKey.slice(0, 16)}...</code></div>
      <div class="token-field"><span class="label">Sats:</span> ${t.satoshis}</div>
      <div class="token-actions">
        <button onclick="window._selectForTransfer('${t.tokenId}')">Select for Transfer</button>
        <button onclick="window._verifyToken('${t.tokenId}')">Verify</button>
        <a href="https://testnet.bitcoincloud.net/tx/${t.currentTxId}" target="_blank" rel="noopener">View on WoC</a>
      </div>
    </div>
  `).join('')
}

async function handleMint() {
  const name = inputVal('token-name')
  const attrs = inputVal('token-attrs') || '00'

  if (!name) {
    setResult('mint-result', 'Enter a token name.')
    return
  }

  setResult('mint-result', 'Building genesis transaction...')

  try {
    const result = await builder.createGenesis({
      tokenName: name,
      attributes: attrs,
    })

    setResult('mint-result', [
      'Genesis broadcast!',
      `TXID: ${result.txId}`,
      `Token ID: ${result.tokenId}`,
      `View: https://testnet.bitcoincloud.net/tx/${result.txId}`,
      '',
      'Polling for Merkle proof (may take ~10 min)...',
    ].join('\n'))

    await refreshTokenList()
    await refreshBalance()

    // Start polling for proof in background
    builder.pollForProof(result.tokenId, result.txId, (msg) => {
      setResult('mint-result', [
        `TXID: ${result.txId}`,
        `Token ID: ${result.tokenId}`,
        msg,
      ].join('\n'))
    }).then(found => {
      if (found) refreshTokenList()
    })

  } catch (e: any) {
    setResult('mint-result', `Error: ${e.message}`)
  }
}

async function handleTransfer() {
  const tokenId = inputVal('transfer-token-id')
  const recipient = inputVal('transfer-recipient')

  if (!tokenId || !recipient) {
    setResult('transfer-result', 'Enter both Token ID and recipient public key.')
    return
  }

  setResult('transfer-result', 'Building transfer transaction...')

  try {
    const result = await builder.createTransfer(tokenId, recipient)

    setResult('transfer-result', [
      'Transfer broadcast!',
      `TXID: ${result.txId}`,
      `View: https://testnet.bitcoincloud.net/tx/${result.txId}`,
      '',
      'Send this bundle to the recipient:',
      result.bundleJson,
    ].join('\n'))

    await refreshTokenList()
    await refreshBalance()

  } catch (e: any) {
    setResult('transfer-result', `Error: ${e.message}`)
  }
}

async function handleImport() {
  const bundleJson = inputVal('import-bundle')
  if (!bundleJson) {
    setResult('import-result', 'Paste a token bundle JSON.')
    return
  }

  try {
    const token = await builder.importBundle(bundleJson)
    setResult('import-result', [
      'Token imported!',
      `Name: ${token.tokenName}`,
      `Token ID: ${token.tokenId}`,
      `Owner: ${token.ownerPubKey.slice(0, 20)}...`,
    ].join('\n'))

    await refreshTokenList()

  } catch (e: any) {
    setResult('import-result', `Error: ${e.message}`)
  }
}

async function handleVerify() {
  const tokenId = inputVal('verify-token-id')
  if (!tokenId) {
    setResult('verify-result', 'Enter a Token ID.')
    return
  }

  setResult('verify-result', 'Verifying...')

  try {
    const result = await builder.verifyToken(tokenId)
    setResult('verify-result', [
      `Valid: ${result.valid}`,
      `Reason: ${result.reason}`,
    ].join('\n'))
  } catch (e: any) {
    setResult('verify-result', `Error: ${e.message}`)
  }
}

function handleNewWallet() {
  if (!confirm('This will generate a new key and clear all tokens. Continue?')) return
  localStorage.clear()
  location.reload()
}

// ─── Window-exposed helpers for inline onclick handlers ─────────────

(window as any)._selectForTransfer = (tokenId: string) => {
  const input = el('transfer-token-id') as HTMLInputElement
  if (input) input.value = tokenId
}

;(window as any)._verifyToken = (tokenId: string) => {
  const input = el('verify-token-id') as HTMLInputElement
  if (input) input.value = tokenId
  handleVerify()
}

// ─── DOM Helpers ────────────────────────────────────────────────────

function el(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function setText(id: string, text: string) {
  const e = el(id)
  if (e) e.textContent = text
}

function setResult(id: string, text: string) {
  const e = el(id)
  if (e) e.textContent = text
}

function inputVal(id: string): string {
  const e = el(id) as HTMLInputElement | HTMLTextAreaElement | null
  return e?.value?.trim() ?? ''
}

function on(id: string, handler: () => void) {
  el(id)?.addEventListener('click', handler)
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init)
