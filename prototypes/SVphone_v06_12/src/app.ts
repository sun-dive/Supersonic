/**
 * SVphone v06.12 - Browser entry point
 *
 * Exports all core classes to window for use in HTML interfaces:
 * - TokenBuilder, TokenStore, WalletProvider (token protocol)
 * - CallSignaling, PeerConnection, CallManager (WebRTC signaling)
 * - All supporting utilities
 */

import { PrivateKey, Hash } from '@bsv/sdk'
import { WalletProvider } from './token_protocol/walletProvider'
import { TokenBuilder } from './token_protocol/tokenBuilder'
import { TokenStore, LocalStorageBackend } from './token_protocol/tokenStore'
import { decodeTokenRules } from './token_protocol/opReturnCodec'
import { FileCache } from './fileCache'

// ─── Global instances for browser access ────────────────────────────

let provider: WalletProvider
let builder: TokenBuilder
let store: TokenStore
let fileCache: FileCache

const WIF_KEY = 'p:wallet:wif'

function init() {
  let wif = localStorage.getItem(WIF_KEY)
  let key: PrivateKey

  if (wif) {
    try {
      key = PrivateKey.fromWif(wif)
    } catch {
      key = PrivateKey.fromRandom()
      localStorage.setItem(WIF_KEY, key.toWif())
    }
  } else {
    key = PrivateKey.fromRandom()
    wif = key.toWif()
    localStorage.setItem(WIF_KEY, wif)
  }

  const address = key.toAddress()
  provider = new WalletProvider(address)
  const storage = new LocalStorageBackend('p:data:')
  store = new TokenStore(storage)
  fileCache = new FileCache()
  builder = new TokenBuilder(provider, store, key)

  console.log('[SVphone v06.12] Initialized')
  console.log('[SVphone v06.12] Address:', address)
  console.log('[SVphone v06.12] TokenBuilder available:', !!builder)
}

// ─── Export to window for HTML access ────────────────────────────────

declare global {
  interface Window {
    TokenBuilder: typeof TokenBuilder
    TokenStore: typeof TokenStore
    WalletProvider: typeof WalletProvider
    builder?: TokenBuilder
    tokenBuilder?: TokenBuilder  // Alias for compatibility with phone_interface.html
    store?: TokenStore
    tokenStore?: TokenStore  // Alias for phone_interface.html
    provider?: WalletProvider
    fileCache?: FileCache
    initWallet?: typeof init
    decodeTokenRules?: typeof decodeTokenRules
    bitcoin?: {
      PrivateKey: typeof PrivateKey
      Hash: typeof Hash
    }
  }
}

window.TokenBuilder = TokenBuilder
window.TokenStore = TokenStore
window.WalletProvider = WalletProvider
window.initWallet = init
window.decodeTokenRules = decodeTokenRules
window.bitcoin = {
  PrivateKey,
  Hash,
}

// Initialize and expose instances to window
function initAndExpose() {
  init()
  // Expose instances to window so they're accessible by name
  window.builder = builder
  window.tokenBuilder = builder  // Also expose as tokenBuilder (expected by phone_interface.html)
  window.store = store
  window.tokenStore = store  // Alias for phone_interface.html
  window.provider = provider
  window.fileCache = fileCache
}

// Auto-initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAndExpose)
} else {
  initAndExpose()
}
