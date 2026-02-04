/**
 * MPT Prototype Wallet v05 -- Browser entry point.
 *
 * v05 architecture:
 *   - Token protocol (tokenProtocol.ts) is pure SPV: Merkle proofs + block headers only
 *   - Wallet layer (walletProvider.ts) handles all network operations
 *   - Clean separation: verification works offline with pre-fetched headers
 *   - Ownership determined by P2PKH output, not OP_RETURN field
 *   - Address-based transfers (no public key exchange needed)
 *   - New: tokenScript field for consensus-level validation (OP_RETURN version 0x02)
 */
import { PrivateKey, Hash } from '@bsv/sdk'
import { WalletProvider } from './walletProvider'
import { TokenBuilder } from './tokenBuilder'
import { TokenStore, LocalStorageBackend, OwnedToken, FungibleToken } from './tokenStore'
import { decodeTokenRules } from './opReturnCodec'
import { FileCache } from './fileCache'

// ─── Globals ────────────────────────────────────────────────────────

let provider: WalletProvider
let builder: TokenBuilder
let store: TokenStore
let fileCache: FileCache
let fieldModes: Record<string, 'text' | 'hex'> = {
  name: 'text',
  attrs: 'text',
  state: 'text',
}
let mintMode: 'fungible' | 'nft' = 'fungible'

const WIF_KEY = 'mpt:wallet:wif'

/** Infer MIME type from file extension when the browser returns an empty string. */
function inferMimeType(fileName: string, browserType: string): string {
  if (browserType) return browserType
  const ext = fileName.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', json: 'text/json',
    csv: 'text/csv', xml: 'text/xml', html: 'text/html', htm: 'text/html',
    css: 'text/css', js: 'text/javascript', ts: 'text/typescript',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    bmp: 'image/bmp', ico: 'image/x-icon',
    pdf: 'application/pdf', zip: 'application/zip',
  }
  return (ext && map[ext]) || 'application/octet-stream'
}

// ─── Initialization ─────────────────────────────────────────────────

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
  const storage = new LocalStorageBackend('mpt:data:')
  store = new TokenStore(storage)
  builder = new TokenBuilder(provider, store, key)
  fileCache = new FileCache()

  setText('address', address)
  setText('pubkey', key.toPublicKey().toString())
  setText('privkey', key.toWif())

  on('btn-refresh', refreshBalance)
  on('btn-send', handleSend)
  on('btn-mint', handleMint)
  on('btn-transfer', handleTransfer)
  on('btn-verify', handleVerify)
  on('btn-new-wallet', handleNewWallet)
  on('btn-restore-wallet', handleRestoreWallet)
  on('btn-check-incoming', handleCheckIncoming)
  on('btn-name-mode', () => toggleFieldMode('name'))
  on('btn-attrs-mode', () => toggleFieldMode('attrs'))
  on('btn-state-mode', () => toggleFieldMode('state'))
  on('btn-mint-mode', toggleMintMode)

  // File upload handlers
  const fileInput = el('token-file') as HTMLInputElement
  const clearBtn = el('btn-clear-file')
  const fileInfo = el('file-info')
  const attrsInput = el('token-attrs') as HTMLInputElement

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (file) {
        if (attrsInput) attrsInput.disabled = true
        if (clearBtn) clearBtn.style.display = ''
        if (fileInfo) {
          fileInfo.style.display = ''
          fileInfo.textContent = `File: ${file.name} (${inferMimeType(file.name, file.type)}, ${(file.size / 1024).toFixed(1)} KB)`
          if (file.size > 250_000) {
            fileInfo.textContent += ' — WARNING: Large file, high fee cost'
          }
        }
      }
    })
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (fileInput) fileInput.value = ''
      if (attrsInput) attrsInput.disabled = false
      clearBtn.style.display = 'none'
      if (fileInfo) { fileInfo.style.display = 'none'; fileInfo.textContent = '' }
    })
  }

  refreshBalance()
  refreshTokenList()
  silentCheckIncoming()
  fetchMissingProofs()
  resumePendingTransferPolls()
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
  silentCheckIncoming()
}

async function fetchMissingProofs() {
  try {
    const count = await builder.fetchMissingProofs()
    if (count > 0) {
      setText('incoming-status', `Updated ${count} proof chain(s)`)
      await refreshTokenList()
    }
  } catch {
    // Silent
  }
}


const activePollTxIds = new Set<string>()

function pollTransferConfirmation(txId: string, tokenId: string) {
  if (activePollTxIds.has(txId)) return
  activePollTxIds.add(txId)

  setTimeout(() => {
    builder.pollForConfirmation(txId, (msg) => {
      console.debug(`[transfer-poll] ${tokenId.slice(0, 12)}...: ${msg}`)
    }).then(async (confirmed) => {
      if (confirmed) {
        try {
          await builder.confirmTransfer(tokenId)
          await refreshTokenList()
        } catch (e: any) {
          console.error(`[transfer-poll] confirmTransfer failed for ${tokenId}:`, e.message)
        }
      }
    }).catch((e: any) => {
      console.error(`[transfer-poll] poll error for ${txId}:`, e.message)
    }).finally(() => {
      activePollTxIds.delete(txId)
    })
  }, 1000)
}

async function resumePendingTransferPolls() {
  try {
    const tokens = await store.listTokens()
    for (const t of tokens) {
      if (t.status === 'pending_transfer' && t.transferTxId) {
        pollTransferConfirmation(t.transferTxId, t.tokenId)
      }
    }
  } catch {
    // Silent
  }
}

async function silentCheckIncoming() {
  try {
    const imported = await builder.checkIncomingTokens()
    if (imported.length > 0) {
      setText('incoming-status', `Auto-imported ${imported.length} token(s)`)
      await refreshTokenList()
    }
  } catch {
    // Silent
  }
}

async function refreshTokenList() {
  const tokens = (await store.listTokens()).sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return db - da
  })
  const fungibleTokens = (await store.listFungibleTokens()).sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return db - da
  })
  const container = el('token-list')
  if (!container) return

  if (tokens.length === 0 && fungibleTokens.length === 0) {
    container.innerHTML = '<p class="muted">No tokens yet. Mint one above.</p>'
    return
  }

  // Render fungible tokens first
  const fungibleHtml = fungibleTokens.map(ft => renderFungibleCard(ft)).join('')

  // Group tokens by genesis TXID
  const groups = new Map<string, OwnedToken[]>()
  for (const t of tokens) {
    const key = t.genesisTxId
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }
  // Sort each group by output index
  for (const group of groups.values()) {
    group.sort((a, b) => a.genesisOutputIndex - b.genesisOutputIndex)
  }

  const nftHtml = Array.from(groups.entries()).map(([genesisTxId, group]) => {
    if (group.length === 1) {
      return renderTokenCard(group[0])
    }
    const first = group[0]
    const rules = decodeTokenRules(first.tokenRules)

    // Divisible tokens (divisibility > 0): fragment collection view
    if (rules.divisibility > 0) {
      return renderFragmentCard(genesisTxId, group, rules)
    }

    // Non-divisible multi-token (divisibility === 0): NFT dropdown selector
    const selectId = `sel-${genesisTxId.slice(0, 12)}`
    const detailId = `detail-${genesisTxId.slice(0, 12)}`
    const options = group.map((t) =>
      `<option value="${t.tokenId}">NFT #${t.genesisOutputIndex} ${t.status !== 'active' ? '- ' + t.status : ''}</option>`
    ).join('')
    const activeCount = group.filter(t => t.status === 'active').length
    return `
    <div class="token-card">
      <div class="token-header">${escHtml(first.tokenName)} <span class="badge badge-active">${activeCount}/${group.length} active</span></div>
      <div class="token-field"><span class="label">Genesis TXID:</span> <code class="selectable">${genesisTxId}</code></div>
      <div class="token-field"><span class="label">Rules:</span> ${renderRules(first.tokenRules)}</div>
      <div class="token-field" style="margin-top:6px;">
        <span class="label">Select token:</span>
        <select id="${selectId}" onchange="window._selectGroupToken('${genesisTxId.slice(0, 12)}', this.value)" style="background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:4px 8px;border-radius:4px;">
          ${options}
        </select>
      </div>
      <div id="${detailId}">${renderTokenDetail(first)}</div>
    </div>`
  }).join('')

  container.innerHTML = fungibleHtml + nftHtml
}

/**
 * Map a 1-based fragment index to human-readable NFT/piece numbers.
 * Example: supply=2, divisibility=3 (6 total fragments)
 *   index=1 → NFT 1, piece 1/3
 *   index=4 → NFT 2, piece 1/3
 * For single-token divisibles, omits NFT number.
 */
function fragmentLabel(index: number, fragsPerWhole: number, wholeTokens: number): string {
  const nftNum = Math.ceil(index / fragsPerWhole)
  const pieceNum = ((index - 1) % fragsPerWhole) + 1
  if (wholeTokens === 1) return `Piece ${pieceNum}/${fragsPerWhole}`
  return `NFT ${nftNum}, piece ${pieceNum}/${fragsPerWhole}`
}

/**
 * Format a list of fragment indices for compact display, grouped by NFT number.
 * Handles both single-NFT and multi-NFT divisibles with smart compression.
 * Example: [1,2,3,7,8] with fragsPerWhole=3, wholeTokens=3 → "NFT 1 (complete) | NFT 3: 1/3, 2/3"
 */
function formatFragmentIndices(indices: number[], fragsPerWhole: number, wholeTokens: number): string {
  if (indices.length === 0) return '(none)'
  if (indices.length > 60) {
    return `${indices.length} pieces`
  }
  if (wholeTokens === 1) {
    // Single NFT: just list piece numbers
    return indices.map(i => `piece ${((i - 1) % fragsPerWhole) + 1}`).join(', ')
  }
  // Multi-NFT: group by NFT number and show piece breakdown
  const byNft = new Map<number, number[]>()
  for (const i of indices) {
    const nftNum = Math.ceil(i / fragsPerWhole)
    if (!byNft.has(nftNum)) byNft.set(nftNum, [])
    byNft.get(nftNum)!.push(((i - 1) % fragsPerWhole) + 1)
  }
  const parts: string[] = []
  for (const [nftNum, pieces] of byNft) {
    if (pieces.length === fragsPerWhole) {
      parts.push(`NFT ${nftNum} (complete)`)
    } else {
      parts.push(`NFT ${nftNum}: ${pieces.map(p => `${p}/${fragsPerWhole}`).join(', ')}`)
    }
  }
  return parts.join(' | ')
}

function renderFragmentCard(genesisTxId: string, group: OwnedToken[], rules: { supply: number; divisibility: number; restrictions: number; version: number }): string {
  const first = group[0]
  // Divisibility = fragments per whole token. Total fragments = supply * divisibility.
  const fragsPerWhole = rules.divisibility
  const totalFragments = rules.supply * fragsPerWhole
  const wholeTokens = rules.supply
  const activeFragments = group.filter(t => t.status === 'active')
  const pendingFragments = group.filter(t => t.status === 'pending_transfer')
  const transferredFragments = group.filter(t => t.status === 'transferred')
  const heldCount = activeFragments.length
  const heldWholes = Math.floor(heldCount / fragsPerWhole)
  const heldRemainder = heldCount % fragsPerWhole
  const heldDisplay = heldRemainder > 0
    ? `${heldWholes} ${heldRemainder}/${fragsPerWhole}`
    : `${heldWholes}`
  const pct = totalFragments > 0 ? Math.round((heldCount / totalFragments) * 100) : 0

  // Build held/missing piece numbers
  const heldIndices = activeFragments.map(t => t.genesisOutputIndex).sort((a, b) => a - b)
  // Missing = indices from 1..totalFragments that are not in any status in this wallet
  const ownedIndices = new Set(group.map(t => t.genesisOutputIndex))
  const missingIndices: number[] = []
  for (let i = 1; i <= totalFragments; i++) {
    if (!ownedIndices.has(i)) missingIndices.push(i)
  }

  const attrsDisplay = renderHexField(first.tokenAttributes, first)
  const genKey = genesisTxId.slice(0, 12)

  // Completion bar
  const barColor = pct === 100 ? '#238636' : pct > 0 ? '#d29922' : '#da3633'
  const completionBar = `<div style="background:#21262d;border-radius:3px;height:8px;margin:6px 0;overflow:hidden;"><div style="background:${barColor};height:100%;width:${pct}%;transition:width 0.3s;"></div></div>`

  return `
    <div class="token-card">
      <div class="token-header">${escHtml(first.tokenName)} <span class="badge ${pct === 100 ? 'badge-active' : 'badge-pending'}">${heldDisplay} / ${wholeTokens} whole</span></div>
      <div class="token-field"><span class="label">Genesis TXID:</span> <code class="selectable">${genesisTxId}</code></div>
      <div class="token-field"><span class="label">Type:</span> Divisible token (${wholeTokens} tokens × ${fragsPerWhole} fragments = ${totalFragments} total pieces)</div>
      <div class="token-field"><span class="label">Completion:</span> ${heldCount}/${totalFragments} pieces (${heldWholes} complete NFT${heldWholes !== 1 ? 's' : ''}${heldRemainder > 0 ? ` + ${heldRemainder}/${fragsPerWhole} pieces` : ''}) ${pct}%</div>
      ${completionBar}
      <div class="token-field"><span class="label">Held:</span> <span style="color:#3fb950;">${formatFragmentIndices(heldIndices, fragsPerWhole, wholeTokens)}</span></div>
      ${missingIndices.length > 0 ? `<div class="token-field"><span class="label">Missing:</span> <span class="muted">${formatFragmentIndices(missingIndices, fragsPerWhole, wholeTokens)}</span></div>` : ''}
      ${pendingFragments.length > 0 ? `<div class="token-field"><span class="label">Pending:</span> <span style="color:#d29922;">${formatFragmentIndices(pendingFragments.map(t => t.genesisOutputIndex).sort((a, b) => a - b), fragsPerWhole, wholeTokens)}</span></div>` : ''}
      ${transferredFragments.length > 0 ? `<div class="token-field"><span class="label">Sent:</span> <span class="muted">${formatFragmentIndices(transferredFragments.map(t => t.genesisOutputIndex).sort((a, b) => a - b), fragsPerWhole, wholeTokens)}</span></div>` : ''}
      <div class="token-field"><span class="label">Attributes:</span> ${attrsDisplay}</div>
      <div class="token-field"><span class="label">Rules:</span> ${renderRules(first.tokenRules)}</div>
      <div class="token-actions" style="flex-direction:column;align-items:stretch;">
        ${heldCount > 0 ? `
        <div class="row" style="gap:6px;">
          <input id="frag-amt-${genKey}" type="number" min="1" max="${heldCount}" value="1" style="width:80px;margin:0;" />
          <button onclick="window._transferFragments('${genesisTxId}', '${genKey}')">Transfer Fragments</button>
          <button onclick="window._verifyToken('${activeFragments[0].tokenId}')">Verify</button>
        </div>
        <span class="arch-note">Send 1-${heldCount} fragments to a recipient. Fragments are sent lowest-numbered first.</span>
        ` : ''}
        <div class="row" style="gap:6px;">
          <a href="https://whatsonchain.com/tx/${genesisTxId}" target="_blank" rel="noopener">View Genesis TX</a>
        </div>
      </div>
      <details style="margin-top:8px;" ontoggle="if(this.open){var s=document.getElementById('fsel-${genKey}');if(s){var i=document.getElementById('transfer-token-id');if(i){var o=s.querySelector('option:not([data-pending])');if(o)i.value=o.value;}}}"><summary class="muted" style="cursor:pointer;font-size:0.85em;">Show individual fragment details</summary>
        <div style="margin-top:6px;">
          <select id="fsel-${genKey}" onchange="window._selectGroupToken('fdet-${genKey}', this.value)" style="background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:4px 8px;border-radius:4px;width:100%;margin-bottom:6px;">
            ${group.map(t => `<option value="${t.tokenId}"${t.status !== 'active' ? ' data-pending' : ''}>Fragment #${t.genesisOutputIndex} (${fragmentLabel(t.genesisOutputIndex, fragsPerWhole, wholeTokens)}) ${t.status !== 'active' ? '- ' + t.status : ''}</option>`).join('')}
          </select>
          <div id="fdet-${genKey}">${renderTokenDetail(first)}</div>
        </div>
      </details>
    </div>`
}

function renderFungibleCard(ft: FungibleToken): string {
  const activeUtxos = ft.utxos.filter(u => u.status === 'active')
  const pendingUtxos = ft.utxos.filter(u => u.status === 'pending_transfer')
  const totalBalance = activeUtxos.reduce((sum, u) => sum + u.satoshis, 0)
  const pendingBalance = pendingUtxos.reduce((sum, u) => sum + u.satoshis, 0)
  const genKey = ft.genesisTxId.slice(0, 12)

  return `
    <div class="token-card" style="border-color:#238636;">
      <div class="token-header">${escHtml(ft.tokenName)} <span class="badge badge-active">Fungible</span></div>
      <div class="token-field"><span class="label">Token ID:</span> <code class="selectable">${ft.tokenId}</code></div>
      <div class="token-field"><span class="label">Genesis TXID:</span> <code class="selectable">${ft.genesisTxId}</code></div>
      <div class="token-field"><span class="label">Balance:</span> <strong style="color:#3fb950;font-size:1.1em;">${totalBalance.toLocaleString()} sats</strong></div>
      ${pendingBalance > 0 ? `<div class="token-field"><span class="label">Pending:</span> <span style="color:#d29922;">${pendingBalance.toLocaleString()} sats</span></div>` : ''}
      <div class="token-field"><span class="label">UTXOs:</span> ${activeUtxos.length} active${pendingUtxos.length > 0 ? `, ${pendingUtxos.length} pending` : ''}</div>
      ${ft.createdAt ? `<div class="token-field"><span class="label">Created:</span> ${formatDate(ft.createdAt)}</div>` : ''}
      ${ft.stateData ? `<div class="token-field"><span class="label">State Data:</span> <code class="selectable">${escHtml(tryDecodeHex(ft.stateData))}</code></div>` : ''}
      <div class="token-actions" style="flex-direction:column;align-items:stretch;">
        <div class="row" style="gap:6px;">
          <input id="fungible-send-${genKey}" type="number" min="1" max="${totalBalance}" value="${Math.min(100, totalBalance)}" placeholder="Amount" style="width:120px;margin:0;" />
          <button onclick="window._transferFungible('${ft.tokenId}', '${genKey}')">Send</button>
          <button onclick="window._verifyFungible('${ft.tokenId}')">Verify</button>
        </div>
        <div class="row" style="gap:6px; margin-top:4px;">
          <input id="fungible-state-${genKey}" type="text" placeholder="State data (mutable, optional)" value="${escHtml(tryDecodeHex(ft.stateData))}" style="flex:1;margin:0;" />
        </div>
        <span class="arch-note">Send sats to a recipient. State data is mutable and updates on transfer.</span>
        <div class="row" style="gap:6px; margin-top:6px;">
          <a href="https://whatsonchain.com/tx/${ft.genesisTxId}" target="_blank" rel="noopener">View Genesis TX</a>
        </div>
      </div>
      <details style="margin-top:8px;"><summary class="muted" style="cursor:pointer;font-size:0.85em;">Show UTXO details (${ft.utxos.length})</summary>
        <div style="margin-top:6px;font-size:0.85em;">
          ${ft.utxos.map(u => `
            <div style="padding:4px 0;border-bottom:1px solid #21262d;">
              <span class="badge ${u.status === 'active' ? 'badge-active' : u.status === 'pending_transfer' ? 'badge-pending' : 'badge-transferred'}">${u.status}</span>
              <strong>${u.satoshis.toLocaleString()} sats</strong>
              <br><code class="muted" style="font-size:0.8em;">${u.txId}:${u.outputIndex}</code>
            </div>
          `).join('')}
        </div>
      </details>
    </div>`
}

function renderTokenCard(t: OwnedToken): string {
  const statusBadge = renderStatusBadge(t.status)
  const actions = renderTokenActions(t)
  const rules = renderRules(t.tokenRules)
  const attrsDisplay = renderHexField(t.tokenAttributes, t)
  const stateDisplay = renderStateData(t.stateData)
  const r = decodeTokenRules(t.tokenRules)
  const isFragment = r.divisibility > 0 && r.supply > 0
  const totalFragments = isFragment ? r.supply * r.divisibility : r.supply
  const nftLabel = isFragment
    ? ` Fragment #${t.genesisOutputIndex} (${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)})`
    : (r.supply > 1 ? ` NFT #${t.genesisOutputIndex}` : '')
  const fragmentInfo = isFragment
    ? `<div class="token-field"><span class="label">Fragment:</span> ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)} -- piece #${t.genesisOutputIndex} of ${totalFragments} total</div>`
    : ''
  return `
    <div class="token-card ${t.status === 'transferred' ? 'token-transferred' : ''} ${t.status === 'pending_transfer' ? 'token-pending' : ''}">
      <div class="token-header">${escHtml(t.tokenName)}${nftLabel} ${statusBadge}</div>
      <div class="token-field"><span class="label">Token ID:</span> <code class="selectable">${t.tokenId}</code></div>
      ${fragmentInfo}
      ${t.tokenScript ? `<div class="token-field"><span class="label">Script:</span> <code class="muted" style="font-size:0.8em;">${escHtml(t.tokenScript)}</code></div>` : ''}
      <div class="token-field"><span class="label">Rules:</span> ${rules}</div>
      <div class="token-field"><span class="label">Attributes:</span> ${attrsDisplay}</div>
      <div class="token-field"><span class="label">State Data:</span> ${stateDisplay}</div>
      <div class="token-field"><span class="label">Current TXID:</span> <code class="selectable">${t.currentTxId}</code></div>
      <div class="token-field"><span class="label">Output:</span> ${t.currentOutputIndex}</div>
      <div class="token-field"><span class="label">Sats:</span> ${t.satoshis}</div>
      ${t.createdAt ? `<div class="token-field"><span class="label">Created:</span> ${formatDate(t.createdAt)}</div>` : ''}
      ${t.feePaid !== undefined ? `<div class="token-field"><span class="label">Fee:</span> ${t.feePaid} sats</div>` : ''}
      ${t.transferTxId ? `<div class="token-field"><span class="label">Transfer TXID:</span> <code class="selectable">${t.transferTxId}</code></div>` : ''}
      <div class="token-actions">${actions}</div>
    </div>`
}

function renderTokenDetail(t: OwnedToken): string {
  const statusBadge = renderStatusBadge(t.status)
  const actions = renderTokenActions(t)
  const attrsDisplay = renderHexField(t.tokenAttributes, t)
  const stateDisplay = renderStateData(t.stateData)
  const r = decodeTokenRules(t.tokenRules)
  const isFragment = r.divisibility > 0 && r.supply > 0
  const fragLine = isFragment
    ? `<div class="token-field"><span class="label">Fragment:</span> ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)}</div>`
    : (r.supply > 1 ? `<div class="token-field"><span class="label">NFT #:</span> ${t.genesisOutputIndex}</div>` : '')
  return `
    <div class="${t.status === 'transferred' ? 'token-transferred' : ''} ${t.status === 'pending_transfer' ? 'token-pending' : ''}">
      <div class="token-field"><span class="label">Status:</span> ${statusBadge}</div>
      ${fragLine}
      <div class="token-field"><span class="label">Token ID:</span> <code class="selectable">${t.tokenId}</code></div>
      ${t.tokenScript ? `<div class="token-field"><span class="label">Script:</span> <code class="muted" style="font-size:0.8em;">${escHtml(t.tokenScript)}</code></div>` : ''}
      <div class="token-field"><span class="label">Attributes:</span> ${attrsDisplay}</div>
      <div class="token-field"><span class="label">State Data:</span> ${stateDisplay}</div>
      <div class="token-field"><span class="label">Current TXID:</span> <code class="selectable">${t.currentTxId}</code></div>
      <div class="token-field"><span class="label">Output:</span> ${t.currentOutputIndex}</div>
      <div class="token-field"><span class="label">Sats:</span> ${t.satoshis}</div>
      ${t.transferTxId ? `<div class="token-field"><span class="label">Transfer TXID:</span> <code class="selectable">${t.transferTxId}</code></div>` : ''}
      <div class="token-actions">${actions}</div>
    </div>`
}

function renderStatusBadge(status: string): string {
  switch (status) {
    case 'active': return '<span class="badge badge-active">Active</span>'
    case 'pending_transfer': return '<span class="badge badge-pending">Pending Transfer</span>'
    case 'transferred': return '<span class="badge badge-transferred">Transferred</span>'
    default: return ''
  }
}

function renderTokenActions(t: OwnedToken): string {
  const parts: string[] = []
  const r = decodeTokenRules(t.tokenRules)
  const isFragment = r.divisibility > 0

  if (t.status === 'active') {
    parts.push(`<button onclick="window._selectForTransfer('${t.tokenId}')">Select for Transfer</button>`)
    if (isFragment) {
      parts.push(`<button onclick="window._sendSingleFragment('${t.tokenId}', ${t.genesisOutputIndex})">Send ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)}</button>`)
    }
    parts.push(`<button onclick="window._verifyToken('${t.tokenId}')">Verify</button>`)
  }

  if (t.status === 'pending_transfer') {
    parts.push(`<button onclick="window._confirmTransfer('${t.tokenId}')" class="btn-confirm">Confirm Sent</button>`)
  }

  if (t.currentTxId) {
    parts.push(`<a href="https://whatsonchain.com/tx/${t.currentTxId}" target="_blank" rel="noopener">View TX</a>`)
  }
  if (t.transferTxId && t.transferTxId !== t.currentTxId) {
    parts.push(`<a href="https://whatsonchain.com/tx/${t.transferTxId}" target="_blank" rel="noopener">View Transfer TX</a>`)
  }

  return parts.join('\n')
}

function renderRules(rulesHex: string): string {
  if (!rulesHex || rulesHex.length !== 16) return `<code>${escHtml(rulesHex || '(none)')}</code>`
  const r = decodeTokenRules(rulesHex)
  const divLabel = r.divisibility > 0
    ? `Divisibility=${r.divisibility} (${r.supply}×${r.divisibility}=${r.supply * r.divisibility} fragments)`
    : `Divisibility=0`
  return `Supply=${r.supply}, ${divLabel}, Restrictions=0x${r.restrictions.toString(16).padStart(4, '0')}, Version=${r.version}`
}

function renderHexField(hex: string, token?: OwnedToken): string {
  if (!hex || hex === '00') return '<span class="muted">(none)</span>'
  // 64 hex chars = 32 bytes = possible SHA-256 file hash
  if (hex.length === 64 && token) {
    return `<code class="muted">${escHtml(hex)}</code> <button onclick="window._viewFile('${token.genesisTxId}', '${hex}')" style="font-size:0.8em; padding:2px 8px; background:#30363d;">View File</button>`
  }
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (/^[\x20-\x7e\t\n\r]+$/.test(decoded)) {
      return `"${escHtml(decoded)}"<br><code class="muted">${escHtml(hex)}</code>`
    }
  } catch { /* not valid UTF-8 */ }
  return `<code>${escHtml(hex)}</code>`
}

function renderStateData(stateHex: string): string {
  if (!stateHex || stateHex === '00') return '<span class="muted">(empty)</span>'
  // Try to decode as UTF-8 text
  let textPreview = ''
  try {
    const bytes = new Uint8Array(stateHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (/^[\x20-\x7e\t\n\r]+$/.test(decoded)) {
      textPreview = `"${escHtml(decoded)}"<br>`
    }
  } catch { /* not valid UTF-8 */ }
  return `${textPreview}<code class="muted">${escHtml(stateHex)}</code>`
}

async function handleSend() {
  const address = inputVal('send-address')
  const amountStr = inputVal('send-amount')

  if (!address || !amountStr) {
    setResult('send-result', 'Enter both a recipient address and amount.')
    return
  }

  const amount = parseInt(amountStr, 10)
  if (!amount || amount < 1) {
    setResult('send-result', 'Amount must be at least 1 satoshi.')
    return
  }

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  setResult('send-result', 'Building transaction...')

  try {
    const result = await builder.sendSats(address, amount)
    setResult('send-result', [
      'Sent!',
      `TXID: ${result.txId}`,
      `Amount: ${amount} sats`,
      `Fee: ${result.fee} sats`,
      `View: https://whatsonchain.com/tx/${result.txId}`,
    ].join('\n'))
    await refreshBalance()
  } catch (e: any) {
    setResult('send-result', `Error: ${e.message}`)
  }
}

function toggleFieldMode(field: string) {
  fieldModes[field] = fieldModes[field] === 'text' ? 'hex' : 'text'
  const btn = el(`btn-${field}-mode`)
  if (btn) btn.textContent = fieldModes[field] === 'text' ? 'Text' : 'Hex'
  const hint = el('field-mode-hint')
  if (hint) hint.textContent = Object.values(fieldModes).every(m => m === 'text')
    ? 'Text mode: input is UTF-8 encoded to hex. Toggle individual fields for raw hex input.'
    : 'Some fields in hex mode: raw hex bytes expected. Toggle to switch back to text.'
}

function toggleMintMode() {
  mintMode = mintMode === 'fungible' ? 'nft' : 'fungible'
  const btn = el('btn-mint-mode')
  const hint = el('mint-mode-hint')
  const fungibleFields = el('fungible-fields')
  const nftFields = el('nft-fields')

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

function textToHex(text: string): string {
  return Array.from(new TextEncoder().encode(text))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Try to decode hex as UTF-8 text, return original hex if not valid text */
function tryDecodeHex(hex: string): string {
  if (!hex || hex === '00') return ''
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Only return decoded text if it's printable ASCII
    if (/^[\x20-\x7e\t\n\r]*$/.test(decoded)) return decoded
  } catch { /* not valid UTF-8 */ }
  return hex
}

async function handleMint() {
  const nameRaw = inputVal('token-name')

  if (!nameRaw) {
    setResult('mint-result', 'Enter a token name.')
    return
  }

  // Convert name based on text/hex mode
  const name = fieldModes.name === 'text' ? nameRaw : new TextDecoder().decode(new Uint8Array(nameRaw.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []))

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  // ─── Fungible Mode ───────────────────────────────────────────────
  if (mintMode === 'fungible') {
    const initialSupply = parseInt(inputVal('fungible-supply'), 10) || 1000
    if (initialSupply < 1) {
      setResult('mint-result', 'Initial supply must be at least 1 satoshi.')
      return
    }

    setResult('mint-result', `Minting fungible token with ${initialSupply} sats...`)

    try {
      const result = await builder.createFungibleGenesis({
        tokenName: name,
        initialSupply,
      })

      setResult('mint-result', [
        'Fungible token minted!',
        `TXID: ${result.txId}`,
        `Token ID: ${result.tokenId}`,
        `Initial supply: ${result.initialSupply} sats`,
        `View: https://whatsonchain.com/tx/${result.txId}`,
        '',
        'Polling for Merkle proof (may take ~10 min)...',
      ].join('\n'))

      await refreshTokenList()
      await refreshBalance()

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
    return
  }

  // ─── NFT Mode ────────────────────────────────────────────────────
  const scriptRaw = inputVal('token-script')
  const attrsRaw = inputVal('token-attrs')
  const stateRaw = inputVal('token-state')
  const supply = parseInt(inputVal('token-supply'), 10) || 1
  const divisibility = parseInt(inputVal('token-divisibility'), 10) || 0
  const restrictions = parseInt(inputVal('token-restrictions'), 10) || 0
  const rulesVersion = parseInt(inputVal('token-rules-version'), 10) || 1

  const attrs = attrsRaw ? (fieldModes.attrs === 'text' ? textToHex(attrsRaw) : attrsRaw) : '00'
  let stateData = ''
  if (stateRaw) {
    stateData = fieldModes.state === 'text' ? textToHex(stateRaw) : stateRaw
  }

  // Read file if one was selected
  const fileInput = el('token-file') as HTMLInputElement
  const selectedFile = fileInput?.files?.[0]
  let fileData: { bytes: Uint8Array; mimeType: string; fileName: string } | undefined

  if (selectedFile) {
    if (selectedFile.size > 250_000) {
      setResult('mint-result', 'File too large. Max ~250KB for on-chain storage.')
      return
    }
    const arrayBuf = await selectedFile.arrayBuffer()
    fileData = {
      bytes: new Uint8Array(arrayBuf),
      mimeType: inferMimeType(selectedFile.name, selectedFile.type),
      fileName: selectedFile.name,
    }
  }

  setResult('mint-result', fileData
    ? `Building genesis transaction with file (${(fileData.bytes.length / 1024).toFixed(1)} KB)...`
    : 'Building genesis transaction...')

  try {
    const result = await builder.createGenesis({
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
      const hashBytes = Hash.sha256(Array.from(fileData.bytes))
      const hash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      await fileCache.store(hash, fileData)
    }

    const count = result.tokenIds.length
    const idSummary = count === 1
      ? `Token ID: ${result.tokenIds[0]}`
      : `Minted ${count} tokens (first: ${result.tokenIds[0].slice(0, 16)}...)`

    setResult('mint-result', [
      'Genesis broadcast!',
      `TXID: ${result.txId}`,
      idSummary,
      `View: https://whatsonchain.com/tx/${result.txId}`,
      '',
      'Polling for Merkle proof (may take ~10 min)...',
    ].join('\n'))

    await refreshTokenList()
    await refreshBalance()

    builder.pollForProof(result.tokenIds[0], result.txId, (msg) => {
      setResult('mint-result', [
        `TXID: ${result.txId}`,
        idSummary,
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
    setResult('transfer-result', 'Enter both Token ID and recipient BSV address.')
    return
  }

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  setResult('transfer-result', 'Building transfer transaction...')

  try {
    const result = await builder.createTransfer(tokenId, recipient)

    setResult('transfer-result', [
      'Transfer broadcast!',
      `TXID: ${result.txId}`,
      `View: https://whatsonchain.com/tx/${result.txId}`,
      '',
      'Token data is encoded on-chain. The recipient can click',
      '"Check Incoming Tokens" to auto-import it.',
    ].join('\n'))

    await refreshTokenList()
    await refreshBalance()

    // Poll for on-chain confirmation, then auto-confirm transfer
    pollTransferConfirmation(result.txId, result.tokenId)

  } catch (e: any) {
    setResult('transfer-result', `Error: ${e.message}`)
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

async function handleCheckIncoming() {
  setText('incoming-status', 'Scanning blockchain...')
  try {
    const imported = await builder.checkIncomingTokens((msg) => {
      setText('incoming-status', msg)
    })
    if (imported.length > 0) {
      await refreshTokenList()
    }
  } catch (e: any) {
    setText('incoming-status', `Error: ${e.message}`)
  }
}

function handleNewWallet() {
  if (!confirm('This will generate a new key and clear all tokens. Continue?')) return
  localStorage.clear()
  location.reload()
}

function handleRestoreWallet() {
  const wif = inputVal('import-wif')
  if (!wif) {
    alert('Paste a WIF private key first.')
    return
  }

  try {
    const testKey = PrivateKey.fromWif(wif)
    testKey.toPublicKey()
  } catch {
    alert('Invalid WIF private key.')
    return
  }

  if (!confirm('This will replace the current wallet key and reload the page. Token data in storage will be preserved. Continue?')) return

  localStorage.setItem(WIF_KEY, wif)
  location.reload()
}

// ─── Window-exposed helpers for inline onclick handlers ─────────────

;(window as any)._selectGroupToken = async (genKey: string, tokenId: string) => {
  const token = await store.getToken(tokenId)
  if (!token) return
  // Works for both NFT dropdown (detail-*) and fragment dropdown (fdet-*)
  const detailEl = el(genKey.startsWith('fdet-') ? genKey : `detail-${genKey}`)
  if (detailEl) detailEl.innerHTML = renderTokenDetail(token)
  // Only populate the transfer input if the token is active (avoid pending/transferred)
  if (token.status === 'active') {
    const transferInput = el('transfer-token-id') as HTMLInputElement
    if (transferInput) transferInput.value = tokenId
  }
}

;(window as any)._selectForTransfer = (tokenId: string) => {
  const input = el('transfer-token-id') as HTMLInputElement
  if (input) input.value = tokenId
  el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

;(window as any)._transferFragments = async (genesisTxId: string, genKey: string) => {
  const amtInput = el(`frag-amt-${genKey}`) as HTMLInputElement
  const count = parseInt(amtInput?.value ?? '1', 10)
  if (!count || count < 1) {
    setResult('transfer-result', 'Enter a valid fragment count (minimum 1).')
    return
  }

  const recipient = inputVal('transfer-recipient')
  if (!recipient) {
    setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below.')
    el('transfer-recipient')?.focus()
    return
  }

  // Get active fragments for this genesis, sorted by output index (lowest first)
  const tokens = await store.listTokens()
  const activeFragments = tokens
    .filter(t => t.genesisTxId === genesisTxId && t.status === 'active')
    .sort((a, b) => a.genesisOutputIndex - b.genesisOutputIndex)

  if (count > activeFragments.length) {
    setResult('transfer-result', `Only ${activeFragments.length} active fragment(s) available.`)
    return
  }

  const toSend = activeFragments.slice(0, count)

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  setResult('transfer-result', `Transferring ${count} fragment(s) to ${recipient}...`)

  let sent = 0
  const errors: string[] = []
  for (const frag of toSend) {
    try {
      const result = await builder.createTransfer(frag.tokenId, recipient)
      sent++
      setResult('transfer-result', `Sent fragment #${frag.genesisOutputIndex} (${sent}/${count})...\nTXID: ${result.txId}`)
      pollTransferConfirmation(result.txId, result.tokenId)
    } catch (e: any) {
      errors.push(`#${frag.genesisOutputIndex}: ${e.message}`)
    }
  }

  const summary = [`Transferred ${sent}/${count} fragment(s) to ${recipient}`]
  if (errors.length > 0) {
    summary.push('', 'Errors:', ...errors)
  }
  setResult('transfer-result', summary.join('\n'))
  await refreshTokenList()
  await refreshBalance()
}

;(window as any)._sendSingleFragment = async (tokenId: string, fragIndex: number) => {
  const recipient = inputVal('transfer-recipient')
  if (!recipient) {
    setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below.')
    el('transfer-recipient')?.focus()
    return
  }

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  setResult('transfer-result', `Sending fragment #${fragIndex}...`)

  try {
    const result = await builder.createTransfer(tokenId, recipient)
    setResult('transfer-result', `Sent fragment #${fragIndex}\nTXID: ${result.txId}\nView: https://whatsonchain.com/tx/${result.txId}`)
    pollTransferConfirmation(result.txId, result.tokenId)
    await refreshTokenList()
    await refreshBalance()
  } catch (e: any) {
    setResult('transfer-result', `Error sending fragment #${fragIndex}: ${e.message}`)
  }
}

;(window as any)._verifyToken = (tokenId: string) => {
  const input = el('verify-token-id') as HTMLInputElement
  if (input) input.value = tokenId
  handleVerify().then(() => {
    el('verify-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

;(window as any)._transferFungible = async (tokenId: string, genKey: string) => {
  // Populate Token ID field for visibility
  const tokenIdInput = el('transfer-token-id') as HTMLInputElement
  if (tokenIdInput) tokenIdInput.value = tokenId

  const amtInput = el(`fungible-send-${genKey}`) as HTMLInputElement
  const amount = parseInt(amtInput?.value ?? '0', 10)
  if (!amount || amount < 1) {
    setResult('transfer-result', 'Enter a valid amount (minimum 1 sat).')
    el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  const recipient = inputVal('transfer-recipient')
  if (!recipient) {
    setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below.')
    el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el('transfer-recipient')?.focus()
    return
  }

  // Get state data from input (convert text to hex)
  const stateInput = el(`fungible-state-${genKey}`) as HTMLInputElement
  const stateText = stateInput?.value?.trim() ?? ''
  const newStateData = stateText ? textToHex(stateText) : undefined

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  setResult('transfer-result', `Transferring ${amount.toLocaleString()} sats of fungible token...`)

  try {
    const result = await builder.transferFungible(tokenId, recipient, amount, newStateData)
    setResult('transfer-result', [
      'Fungible transfer broadcast!',
      `TXID: ${result.txId}`,
      `Sent: ${result.amountSent.toLocaleString()} sats`,
      result.change > 0 ? `Change: ${result.change.toLocaleString()} sats` : '',
      `View: https://whatsonchain.com/tx/${result.txId}`,
    ].filter(Boolean).join('\n'))

    await refreshTokenList()
    await refreshBalance()
  } catch (e: any) {
    setResult('transfer-result', `Error: ${e.message}`)
  }
}

;(window as any)._verifyFungible = async (tokenId: string) => {
  const input = el('verify-token-id') as HTMLInputElement
  if (input) input.value = tokenId
  await handleVerify()
  el('verify-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

;(window as any)._confirmTransfer = async (tokenId: string) => {
  if (!confirm('Mark this token as transferred?')) return
  try {
    await builder.confirmTransfer(tokenId)
    await refreshTokenList()
  } catch (e: any) {
    alert(`Error: ${e.message}`)
  }
}

;(window as any)._viewFile = async (genesisTxId: string, hash: string) => {
  // 1. Check local IndexedDB cache
  let file = await fileCache.get(hash)

  // 2. Fetch from genesis TX
  if (!file) {
    try {
      const fetched = await builder.fetchFileFromGenesis(genesisTxId, hash)
      if (fetched) {
        file = { hash, ...fetched }
        await fileCache.store(hash, fetched)
      }
    } catch (e: any) {
      console.debug('fetchFileFromGenesis failed:', e.message)
    }
  }

  // 3. Pruning recovery: prompt user to provide original file
  if (!file) {
    promptFileRecovery(hash)
    return
  }

  displayFile(file)
}

function displayFile(file: { mimeType: string; fileName: string; bytes: Uint8Array }) {
  const blob = new Blob([file.bytes.buffer as ArrayBuffer], { type: file.mimeType })
  const url = URL.createObjectURL(blob)

  if (file.mimeType.startsWith('image/')) {
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(`<html><head><title>${file.fileName}</title></head><body style="margin:0;background:#111;display:flex;justify-content:center;align-items:center;min-height:100vh;"><img src="${url}" style="max-width:100%;max-height:100vh;" /></body></html>`)
    }
  } else if (file.mimeType.startsWith('text/')) {
    const text = new TextDecoder().decode(file.bytes)
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(`<html><head><title>${file.fileName}</title></head><body style="margin:20px;background:#0d1117;color:#c9d1d9;font-family:monospace;"><pre>${text.replace(/</g, '&lt;')}</pre></body></html>`)
    }
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = file.fileName
    a.click()
  }
}

function promptFileRecovery(expectedHash: string) {
  const msg = 'Genesis TX unavailable (possibly pruned). Upload the original file to verify and restore.'
  if (!confirm(msg)) return

  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    const arrayBuf = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuf)
    const hashBytes = Hash.sha256(Array.from(bytes))
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

    await fileCache.store(expectedHash, fileData)
    displayFile(fileData)
  }
  input.click()
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

// ─── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init)
