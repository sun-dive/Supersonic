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
    wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
    flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    pdf: 'application/pdf', zip: 'application/zip',
  }
  return (ext && map[ext]) || 'application/octet-stream'
}

/** Get an icon character for a MIME type */
function getMimeTypeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '\u{1F5BC}'  // framed picture
  if (mimeType.startsWith('audio/')) return '\u{1F3B5}'  // musical note
  if (mimeType.startsWith('video/')) return '\u{1F3AC}'  // clapper board
  if (mimeType.startsWith('text/')) return '\u{1F4C4}'   // page facing up
  if (mimeType === 'application/pdf') return '\u{1F4D1}' // bookmark tabs
  if (mimeType === 'application/zip') return '\u{1F4E6}' // package
  return '\u{1F4CE}'  // paperclip (generic file)
}

/** Store/retrieve file metadata in localStorage for sync icon display */
const FILE_META_KEY = 'mpt:fileMeta'
function getFileMeta(hash: string): { mimeType: string; fileName: string } | null {
  try {
    const data = JSON.parse(localStorage.getItem(FILE_META_KEY) || '{}')
    return data[hash] || null
  } catch { return null }
}
function setFileMeta(hash: string, mimeType: string, fileName: string): void {
  try {
    const data = JSON.parse(localStorage.getItem(FILE_META_KEY) || '{}')
    data[hash] = { mimeType, fileName }
    localStorage.setItem(FILE_META_KEY, JSON.stringify(data))
  } catch { /* ignore */ }
}

// ─── Initialization ─────────────────────────────────────────────────

/**
 * Migration: Copy token-level stateData to UTXOs that don't have per-UTXO stateData.
 * This ensures old tokens imported before the per-UTXO state feature show messages correctly.
 */
async function migrateFungibleStateData() {
  try {
    const tokens = await store.listFungibleTokens()
    for (const token of tokens) {
      if (!token.stateData || token.stateData === '00') continue

      // Check if any UTXO already has stateData
      const hasUtxoStateData = token.utxos.some(u => u.stateData && u.stateData !== '00')
      if (hasUtxoStateData) continue

      // Find the most recently received active UTXO (or first active if no receivedAt)
      const activeUtxos = token.utxos.filter(u => u.status === 'active')
      if (activeUtxos.length === 0) continue

      // Sort by receivedAt descending, then assign stateData to the most recent
      activeUtxos.sort((a, b) => {
        if (!a.receivedAt && !b.receivedAt) return 0
        if (!a.receivedAt) return 1
        if (!b.receivedAt) return -1
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
      })

      // Assign token-level stateData to the most recent UTXO
      activeUtxos[0].stateData = token.stateData
      activeUtxos[0].receivedAt = activeUtxos[0].receivedAt || token.createdAt

      await store.updateFungibleToken(token)
      console.debug(`Migrated stateData for token ${token.tokenName} to UTXO ${activeUtxos[0].txId.slice(0, 12)}...`)
    }
  } catch (e) {
    console.warn('Migration error:', e)
  }
}

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

  // Migrate: copy token-level stateData to UTXOs that don't have it
  migrateFungibleStateData()

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
          if (file.size > 1_000_000) {
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

  // Transfer file upload handlers
  const transferFileInput = el('transfer-file') as HTMLInputElement
  const transferClearBtn = el('btn-clear-transfer-file')
  const transferFileInfo = el('transfer-file-info')
  const transferMsgInput = el('transfer-message') as HTMLTextAreaElement

  if (transferFileInput) {
    transferFileInput.addEventListener('change', () => {
      const file = transferFileInput.files?.[0]
      if (file) {
        // Don't disable message - allow both message and file
        if (transferClearBtn) transferClearBtn.style.display = ''
        if (transferFileInfo) {
          transferFileInfo.style.display = ''
          transferFileInfo.textContent = `File: ${file.name} (${inferMimeType(file.name, file.type)}, ${(file.size / 1024).toFixed(1)} KB)`
          if (file.size > 1_000_000) {
            transferFileInfo.textContent += ' — WARNING: Large file, high fee cost'
          }
        }
      }
    })
  }
  if (transferClearBtn) {
    transferClearBtn.addEventListener('click', () => {
      if (transferFileInput) transferFileInput.value = ''
      transferClearBtn.style.display = 'none'
      if (transferFileInfo) { transferFileInfo.style.display = 'none'; transferFileInfo.textContent = '' }
    })
  }

  refreshBalance()
  refreshTokenList()
  silentCheckIncoming()
  startProofPolling()
  resumePendingTransferPolls()
}

// ─── Actions ────────────────────────────────────────────────────────

async function refreshBalance() {
  try {
    setText('balance', 'loading...')
    // Use spendable balance (excludes sats locked in token UTXOs)
    const bal = await builder.getSpendableBalance()
    setText('balance', `${bal} sats`)
  } catch (e: any) {
    setText('balance', `error: ${e.message}`)
  }
  silentCheckIncoming()
}

// ── Adaptive Proof Polling ──────────────────────────────────────
// Track proof fetch attempts: key = "proofPoll", value = last attempt time
let lastProofFetchTime = 0
let proofPollTimeoutId: ReturnType<typeof setTimeout> | null = null

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

function scheduleNextProofPoll() {
  if (proofPollTimeoutId) clearTimeout(proofPollTimeoutId)

  const now = Date.now()
  const elapsedMs = now - lastProofFetchTime
  const elapsedMin = elapsedMs / (1000 * 60)

  let nextPollMs: number
  let statusMsg: string

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
    setText('incoming-status', `⏹️ Proof polling stopped (24h elapsed)`)
    return
  }

  setText('incoming-status', statusMsg)

  proofPollTimeoutId = setTimeout(async () => {
    lastProofFetchTime = Date.now()
    await fetchMissingProofs()
    scheduleNextProofPoll()
  }, nextPollMs)
}

function startProofPolling() {
  lastProofFetchTime = Date.now()
  fetchMissingProofs().then(() => scheduleNextProofPoll())
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
      // Restart proof polling: new tokens may have arrived and need proofs
      if (proofPollTimeoutId) clearTimeout(proofPollTimeoutId)
      startProofPolling()
    }
  } catch {
    // Silent
  }
}

async function refreshTokenList() {
  let tokens = (await store.listTokens()).sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return db - da
  })

  // Filter tokens: exclude transferred and flushed-without-recovery
  // Keep active, pending, pending_transfer, recovered, flushed (with metadata for recovery)
  tokens = tokens.filter(t => {
    // Exclude transferred tokens (already sent away)
    if (t.status === 'transferred') return false
    // Exclude flushed tokens without metadata (no recovery possible)
    // flushedAt is set when token is marked as flushed with preserveMetadata=true
    if (t.status === 'flushed' && !t.flushedAt) return false
    // Keep everything else
    return true
  })

  let fungibleTokens = (await store.listFungibleTokens()).sort((a, b) => {
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
    <details class="token-card" style="border:1px solid #30363d;border-radius:6px;padding:0;margin-bottom:8px;">
      <summary style="cursor:pointer;padding:12px;background:#0d1117;border-radius:6px;display:flex;align-items:center;gap:8px;user-select:none;list-style:none;border-bottom:1px solid #30363d;">
        <span style="font-weight:bold;flex:1;">${escHtml(first.tokenName)}</span>
        <span class="badge badge-active">${activeCount}/${group.length}</span>
        <span style="font-size:0.8em;color:#8b949e;margin-left:auto;">▼</span>
      </summary>
      <div style="padding:12px;">
        <div class="token-field"><span class="label">Genesis TXID:</span> <code class="selectable">${genesisTxId}</code></div>
        <div class="token-field"><span class="label">Rules:</span> ${renderRules(first.tokenRules)}</div>
        <div class="token-field" style="margin-top:6px;">
          <span class="label">Select token:</span>
          <select id="${selectId}" onchange="window._selectGroupToken('${genesisTxId.slice(0, 12)}', this.value)" style="background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:4px 8px;border-radius:4px;width:100%;">
            ${options}
          </select>
        </div>
        <div id="${detailId}" style="margin-top:12px;">${renderTokenDetail(first)}</div>
      </div>
    </details>`
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

  // Special styling for flushed tokens
  const isFlushed = first.status === 'flushed'
  const bgColor = isFlushed ? '#1a0d0d' : '#0d1117'
  const borderColor = isFlushed ? '#663333' : '#30363d'
  const flushedNotice = isFlushed ? `<span style="font-size:0.7em;color:#da3633;font-weight:bold;margin-left:8px;">⚠ FLUSHED</span>` : ''

  return `
    <details class="token-card" style="border:1px solid ${borderColor};border-radius:6px;padding:0;margin-bottom:8px;${isFlushed ? 'opacity:0.75;' : ''}">
      <summary style="cursor:pointer;padding:12px;background:${bgColor};border-radius:6px;display:flex;align-items:center;gap:12px;user-select:none;list-style:none;border-bottom:1px solid ${borderColor};">
        <span style="font-weight:bold;flex:1;${isFlushed ? 'opacity:0.6;' : ''}">${escHtml(first.tokenName)}</span>
        ${flushedNotice}
        <span class="badge ${pct === 100 ? 'badge-active' : 'badge-pending'}">${heldDisplay} / ${wholeTokens}</span>
        <div style="width:80px;height:6px;background:#21262d;border-radius:3px;overflow:hidden;">
          <div style="background:${barColor};height:100%;width:${pct}%;transition:width 0.3s;"></div>
        </div>
        <span style="font-size:0.8em;color:#8b949e;margin-left:auto;">▼</span>
      </summary>
      <div style="padding:12px;border-top:1px solid ${borderColor};">
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
        ${isFlushed ? `<div class="token-field"><span class="label">Flushed:</span> <span style="color:#da3633;">${first.flushedAt ? formatDate(first.flushedAt) : 'Yes'}</span></div>` : ''}
        <div class="token-actions" style="flex-direction:column;align-items:stretch;margin-top:12px;${isFlushed ? 'opacity:0.6;' : ''}">
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
        <details style="margin-top:12px;" ontoggle="if(this.open){var s=document.getElementById('fsel-${genKey}');if(s){var i=document.getElementById('transfer-token-id');if(i){var o=s.querySelector('option:not([data-pending])');if(o)i.value=o.value;}}}"><summary class="muted" style="cursor:pointer;font-size:0.85em;">Show individual fragment details</summary>
          <div style="margin-top:6px;">
            <select id="fsel-${genKey}" onchange="window._selectGroupToken('fdet-${genKey}', this.value)" style="background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:4px 8px;border-radius:4px;width:100%;margin-bottom:6px;">
              ${group.map(t => `<option value="${t.tokenId}"${t.status !== 'active' ? ' data-pending' : ''}>Fragment #${t.genesisOutputIndex} (${fragmentLabel(t.genesisOutputIndex, fragsPerWhole, wholeTokens)}) ${t.status !== 'active' ? '- ' + t.status : ''}</option>`).join('')}
            </select>
            <div id="fdet-${genKey}">${renderTokenDetail(first)}</div>
          </div>
        </details>
      </div>
    </details>`
}

function renderFungibleCard(ft: FungibleToken): string {
  // Include both active and pending UTXOs (SPV: allow instant forwarding of unconfirmed UTXOs)
  const spendableUtxos = ft.utxos.filter(u => u.status === 'active' || u.status === 'pending')
  const pendingTransferUtxos = ft.utxos.filter(u => u.status === 'pending_transfer')
  const genKey = ft.genesisTxId.slice(0, 12)

  // Split spendable UTXOs into regular (no state data) and messages (with state data)
  const regularUtxos = spendableUtxos.filter(u => {
    const decoded = u.stateData ? tryDecodeHex(u.stateData) : ''
    return !decoded || decoded === '00'
  })
  const messageUtxos = spendableUtxos.filter(u => {
    const decoded = u.stateData ? tryDecodeHex(u.stateData) : ''
    return decoded && decoded !== '00'
  })

  const regularBalance = regularUtxos.reduce((sum, u) => sum + u.satoshis, 0)
  const messageBalance = messageUtxos.reduce((sum, u) => sum + u.satoshis, 0)
  const totalBalance = regularBalance + messageBalance
  const pendingTransferBalance = pendingTransferUtxos.reduce((sum, u) => sum + u.satoshis, 0)

  // Render messages section (collapsible)
  const messagesHtml = messageUtxos.length > 0 ? `
      <details style="margin-top:12px;padding-top:12px;border-top:1px solid #30363d;">
        <summary style="cursor:pointer;font-weight:bold;color:#58a6ff;margin-bottom:8px;">📨 Messages (${messageUtxos.length})</summary>
        ${messageUtxos.map(u => {
          const stateDecoded = tryDecodeHex(u.stateData!)
          return `
          <div style="padding:10px;margin-bottom:8px;background:#161b22;border:1px solid #30363d;border-radius:6px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <strong style="color:#3fb950;">${u.satoshis.toLocaleString()} tokens</strong>
              ${u.receivedAt ? `<span class="muted" style="font-size:0.8em;">${formatDate(u.receivedAt)}</span>` : ''}
            </div>
            <pre style="margin:0 0 8px 0;padding:8px;background:#0d1117;border-radius:4px;white-space:pre-wrap;word-break:break-word;font-size:0.9em;color:#c9d1d9;">${escHtml(stateDecoded)}</pre>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <button onclick="window._forwardMessage('${ft.tokenId}', '${u.txId}', ${u.outputIndex})" style="font-size:0.85em;">Forward</button>
              <a href="https://whatsonchain.com/tx/${u.txId}" target="_blank" rel="noopener" style="font-size:0.8em;">View TX</a>
              <code class="muted" style="font-size:0.7em;">${u.txId.slice(0, 12)}...:${u.outputIndex}</code>
            </div>
          </div>`
        }).join('')}
      </details>` : ''

  return `
    <details class="token-card" style="border-color:#238636;border:1px solid #238636;border-radius:6px;padding:0;margin-bottom:8px;">
      <summary style="cursor:pointer;padding:12px;background:rgba(35,134,54,0.1);border-radius:6px;display:flex;align-items:center;gap:8px;user-select:none;list-style:none;border-bottom:1px solid #238636;">
        <span style="font-weight:bold;flex:1;">${escHtml(ft.tokenName)}</span>
        <span class="badge badge-active">Fungible</span>
        <span style="color:#3fb950;font-weight:bold;">${totalBalance.toLocaleString()} 🪙</span>
        <span style="font-size:0.8em;color:#8b949e;margin-left:auto;">▼</span>
      </summary>
      <div style="padding:12px;">
        <div class="token-field"><span class="label">Token ID:</span> <code class="selectable">${ft.tokenId}</code></div>
        <div class="token-field"><span class="label">Genesis TXID:</span> <code class="selectable">${ft.genesisTxId}</code></div>
        <div class="token-field"><span class="label">Total tokens:</span> <strong style="color:#3fb950;font-size:1.1em;">${totalBalance.toLocaleString()}</strong></div>
        <div class="token-field"><span class="label">├ Available:</span> ${regularBalance.toLocaleString()}</div>
        <div class="token-field"><span class="label">└ In messages:</span> ${messageBalance.toLocaleString()}${messageUtxos.length > 0 ? ` (${messageUtxos.length})` : ''}</div>
        ${pendingTransferBalance > 0 ? `<div class="token-field"><span class="label">Pending Transfer:</span> <span style="color:#d29922;">${pendingTransferBalance.toLocaleString()} tokens</span></div>` : ''}
        ${ft.createdAt ? `<div class="token-field"><span class="label">Created:</span> ${formatDate(ft.createdAt)}</div>` : ''}
        <div class="token-actions" style="flex-direction:column;align-items:stretch;margin-top:12px;">
          <div class="row" style="gap:6px;">
            <input id="fungible-send-${genKey}" type="number" min="1" max="${regularBalance}" value="${Math.min(100, regularBalance)}" placeholder="Amount" style="width:120px;margin:0;" />
            <button onclick="window._transferFungible('${ft.tokenId}', '${genKey}')"${regularBalance === 0 ? ' disabled title="No regular balance available"' : ''}>Send</button>
            <button onclick="window._verifyFungible('${ft.tokenId}')">Verify</button>
          </div>
          <div class="row" style="gap:6px; margin-top:4px;">
            <textarea id="fungible-state-${genKey}" placeholder="State data (mutable, optional)" rows="3" style="flex:1;margin:0;resize:vertical;"></textarea>
          </div>
          <span class="arch-note">Send from available balance. To send a message UTXO, use "Forward" below.</span>
          <div class="row" style="gap:6px; margin-top:6px;">
            <a href="https://whatsonchain.com/tx/${ft.genesisTxId}" target="_blank" rel="noopener">View Genesis TX</a>
          </div>
        </div>
        ${messagesHtml}
        <details style="margin-top:12px;"><summary class="muted" style="cursor:pointer;font-size:0.85em;">Show all UTXO details (${ft.utxos.length})</summary>
          <div style="margin-top:6px;font-size:0.85em;">
            ${ft.utxos.map(u => {
              const stateDecoded = u.stateData ? tryDecodeHex(u.stateData) : ''
              const hasStateData = stateDecoded && stateDecoded !== '00'
              return `
              <div style="padding:8px 0;border-bottom:1px solid #21262d;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <span class="badge ${u.status === 'active' ? 'badge-active' : u.status === 'pending' ? 'badge-unconfirmed' : u.status === 'pending_transfer' ? 'badge-pending' : 'badge-transferred'}">${u.status === 'pending' ? 'unconfirmed' : u.status}</span>
                  <strong>${u.satoshis.toLocaleString()} tokens</strong>
                  ${u.receivedAt ? `<span class="muted" style="font-size:0.8em;">${formatDate(u.receivedAt)}</span>` : ''}
                  <button onclick="window._removeUtxo('${ft.tokenId}', '${u.txId}', ${u.outputIndex})" style="margin-left:auto;font-size:0.7em;padding:2px 6px;background:#da3633;" title="Remove this UTXO from basket">×</button>
                </div>
                <code class="muted" style="font-size:0.8em;display:block;margin-top:4px;">${u.txId}:${u.outputIndex}</code>
                ${hasStateData ? `
                <div style="margin-top:6px;padding:6px;background:#161b22;border:1px solid #30363d;border-radius:4px;">
                  <span class="muted" style="font-size:0.75em;">State Data:</span>
                  <pre style="margin:4px 0 0 0;white-space:pre-wrap;word-break:break-word;font-size:0.85em;color:#c9d1d9;">${escHtml(stateDecoded)}</pre>
                </div>` : ''}
              </div>`
            }).join('')}
          </div>
        </details>
      </div>
    </details>`
}

function renderTokenCard(t: OwnedToken): string {
  const statusBadge = renderStatusBadge(t.status)
  const actions = renderTokenActions(t)
  const rules = renderRules(t.tokenRules)
  const attrsDisplay = renderHexField(t.tokenAttributes, t)
  const stateDisplay = renderStateData(t.stateData, t)
  const r = decodeTokenRules(t.tokenRules)
  const isFragment = r.divisibility > 0 && r.supply > 0
  const totalFragments = isFragment ? r.supply * r.divisibility : r.supply
  const nftLabel = isFragment
    ? ` Fragment #${t.genesisOutputIndex} (${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)})`
    : (r.supply > 1 ? ` NFT #${t.genesisOutputIndex}` : '')
  const fragmentInfo = isFragment
    ? `<div class="token-field"><span class="label">Fragment:</span> ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)} -- piece #${t.genesisOutputIndex} of ${totalFragments} total</div>`
    : ''

  // Extract attribute icon if it's media (for collapsed summary)
  let attrsIconHtml = ''
  if (t.tokenAttributes && t.tokenAttributes !== '00') {
    const meta = getFileMeta(t.tokenAttributes.length === 64 ? t.tokenAttributes : '')
    if (meta) {
      attrsIconHtml = `<span style="margin-left:8px;">${getMimeTypeIcon(meta.mimeType)}</span>`
    }
  }

  // Special styling for flushed tokens
  const isFlushed = t.status === 'flushed'
  const bgColor = isFlushed ? '#1a0d0d' : '#0d1117'
  const borderColor = isFlushed ? '#663333' : '#30363d'
  const nameStyling = isFlushed ? 'opacity:0.6;' : ''
  const flushedNotice = isFlushed ? `<span style="font-size:0.7em;color:#da3633;font-weight:bold;margin-left:8px;">⚠ FLUSHED</span>` : ''

  return `
    <details class="token-card ${t.status === 'transferred' ? 'token-transferred' : ''} ${t.status === 'pending_transfer' ? 'token-pending' : ''}" style="border:1px solid ${borderColor};border-radius:6px;padding:0;margin-bottom:8px;${isFlushed ? 'opacity:0.75;' : ''}">
      <summary style="cursor:pointer;padding:12px;background:${bgColor};border-radius:6px;display:flex;align-items:center;gap:8px;user-select:none;list-style:none;border-bottom:1px solid ${borderColor};">
        <span style="font-weight:bold;flex:1;${nameStyling}">${escHtml(t.tokenName)}${nftLabel}</span>
        ${statusBadge}
        ${flushedNotice}
        ${attrsIconHtml}
        <span style="font-size:0.8em;color:#8b949e;margin-left:auto;">▼</span>
      </summary>
      <div style="padding:12px;border-top:1px solid ${borderColor};">
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
        ${isFlushed ? `<div class="token-field"><span class="label">Flushed:</span> <span style="color:#da3633;">${t.flushedAt ? formatDate(t.flushedAt) : 'Yes'}</span></div>` : ''}
        <div class="token-actions" ${isFlushed ? 'style="opacity:0.6;"' : ''}>${actions}</div>
      </div>
    </details>`
}

function renderTokenDetail(t: OwnedToken): string {
  const statusBadge = renderStatusBadge(t.status)
  const actions = renderTokenActions(t)
  const attrsDisplay = renderHexField(t.tokenAttributes, t)
  const stateDisplay = renderStateData(t.stateData, t)
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
    case 'pending': return '<span class="badge badge-unconfirmed">Unconfirmed</span>'
    case 'pending_transfer': return '<span class="badge badge-pending">Pending Transfer</span>'
    case 'transferred': return '<span class="badge badge-transferred">Transferred</span>'
    case 'flushed': return '<span class="badge" style="background:#da3633;">Flushed</span>'
    case 'recovered': return '<span class="badge" style="background:#238636;">Recovered</span>'
    default: return ''
  }
}

function renderTokenActions(t: OwnedToken): string {
  const parts: string[] = []
  const r = decodeTokenRules(t.tokenRules)
  const isFragment = r.divisibility > 0

  // Allow transfers for both active and pending tokens (SPV: instant forwarding capability)
  if (t.status === 'active' || t.status === 'pending') {
    parts.push(`<button onclick="window._selectForTransfer('${t.tokenId}')">Select for Transfer</button>`)
    if (isFragment) {
      parts.push(`<button onclick="window._sendSingleFragment('${t.tokenId}', ${t.genesisOutputIndex})">Send ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)}</button>`)
    }
    parts.push(`<button onclick="window._verifyToken('${t.tokenId}')">Verify</button>`)
  }

  if (t.status === 'active') {
    parts.push(`<button onclick="window._openFlushDialog('${t.tokenId}')" style="background:#da3633;">Flush Token</button>`)
  }

  if (t.status === 'flushed') {
    parts.push(`<button onclick="window._recoverFlushedToken('${t.tokenId}')" style="background:#238636;">Recover</button>`)
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
    const meta = getFileMeta(hex)
    const icon = meta ? getMimeTypeIcon(meta.mimeType) : '\u{1F4CE}' // paperclip default
    const label = meta ? `${icon} ${meta.fileName}` : `${icon} View File`
    return `<code class="muted">${escHtml(hex)}</code> <button onclick="window._viewFile('${token.genesisTxId}', '${hex}')" style="font-size:0.8em; padding:2px 8px; background:#30363d;">${label}</button>`
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

function renderStateData(stateHex: string, token?: OwnedToken): string {
  if (!stateHex || stateHex === '00') return '<span class="muted">(empty)</span>'

  // Check for combined message+file format: message_hex + file_hash (64 chars)
  // If stateHex > 64 chars, try to detect combined format (with or without metadata)
  if (stateHex.length > 64 && token) {
    const possibleHash = stateHex.slice(-64)
    const possibleMsgHex = stateHex.slice(0, -64)

    // Check if last 64 chars look like valid hex (potential file hash)
    const looksLikeHash = /^[0-9a-f]{64}$/i.test(possibleHash)

    if (looksLikeHash) {
      // Try to decode the message portion as UTF-8
      let msgPreview = ''
      let msgDecoded = false
      try {
        const bytes = new Uint8Array(possibleMsgHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (/^[\x20-\x7e\t\n\r]+$/.test(decoded)) {
          msgPreview = `"${escHtml(decoded)}"<br>`
          msgDecoded = true
        }
      } catch { /* not valid UTF-8 */ }

      // If message decoded successfully, this is likely combined format
      if (msgDecoded) {
        const meta = getFileMeta(possibleHash)
        const icon = meta ? getMimeTypeIcon(meta.mimeType) : '\u{1F4CE}'
        const label = meta ? `${icon} ${meta.fileName}` : `${icon} View File`
        return `${msgPreview}<code class="muted">${escHtml(possibleMsgHex)}</code><br><button onclick="window._viewFile('${token.genesisTxId}', '${possibleHash}', '${token.currentTxId}')" style="font-size:0.8em; padding:2px 8px; background:#30363d; margin-top:4px;">${label}</button>`
      }
    }
  }

  // 64 hex chars = 32 bytes = possible SHA-256 file hash (from transfer with file only)
  if (stateHex.length === 64 && token) {
    const meta = getFileMeta(stateHex)
    if (meta) {
      const icon = getMimeTypeIcon(meta.mimeType)
      const label = `${icon} ${meta.fileName}`
      return `<code class="muted">${escHtml(stateHex)}</code> <button onclick="window._viewFile('${token.genesisTxId}', '${stateHex}', '${token.currentTxId}')" style="font-size:0.8em; padding:2px 8px; background:#30363d;">${label}</button>`
    }
    // 64 chars but no metadata - might still be a file hash, show generic button
    return `<code class="muted">${escHtml(stateHex)}</code> <button onclick="window._viewFile('${token.genesisTxId}', '${stateHex}', '${token.currentTxId}')" style="font-size:0.8em; padding:2px 8px; background:#30363d;">\u{1F4CE} View File</button>`
  }

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

    setResult('mint-result', `Minting fungible token with ${initialSupply} tokens...`)

    try {
      const result = await builder.createFungibleGenesis({
        tokenName: name,
        initialSupply,
      })

      setResult('mint-result', [
        'Fungible token minted!',
        `TXID: ${result.txId}`,
        `Token ID: ${result.tokenId}`,
        `Initial supply: ${result.initialSupply} tokens`,
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
    if (selectedFile.size > 50_000_000) {
      setResult('mint-result', 'File too large. Max 50MB for on-chain storage.')
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
      setFileMeta(hash, fileData.mimeType, fileData.fileName)
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
  const messageText = inputVal('transfer-message')

  if (!tokenId || !recipient) {
    setResult('transfer-result', 'Enter both Token ID and recipient BSV address.')
    return
  }

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  // Check for file attachment
  const transferFileInput = el('transfer-file') as HTMLInputElement
  const selectedFile = transferFileInput?.files?.[0]
  let fileData: { bytes: Uint8Array; mimeType: string; fileName: string } | undefined

  if (selectedFile) {
    if (selectedFile.size > 50_000_000) {
      setResult('transfer-result', 'File too large. Max 50MB for on-chain storage.')
      return
    }
    const arrayBuf = await selectedFile.arrayBuffer()
    fileData = {
      bytes: new Uint8Array(arrayBuf),
      mimeType: inferMimeType(selectedFile.name, selectedFile.type),
      fileName: selectedFile.name,
    }
  }

  setResult('transfer-result', fileData
    ? `Building transfer transaction with file (${(fileData.bytes.length / 1024).toFixed(1)} KB)...`
    : 'Building transfer transaction...')

  try {
    // Check if this is a fungible token - if so, redirect user to use the fungible Send button
    const fungible = await store.getFungibleToken(tokenId)
    if (fungible) {
      setResult('transfer-result', [
        'This is a fungible token. Use the "Send" button in the token card above.',
        '',
        `Token: ${fungible.tokenName}`,
        `Balance: ${fungible.utxos.filter(u => u.status === 'active').reduce((s, u) => s + u.satoshis, 0).toLocaleString()} tokens`,
      ].join('\n'))
      return
    }

    // Build stateData: can have message, file hash, or both
    // Format: message_hex + file_hash (64 chars) when both present
    let newStateData: string | undefined
    if (fileData) {
      const hashBytes = Hash.sha256(Array.from(fileData.bytes))
      const fileHash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      if (messageText) {
        // Both message and file: message bytes followed by file hash
        newStateData = textToHex(messageText) + fileHash
      } else {
        // File only: just the hash
        newStateData = fileHash
      }
    } else if (messageText) {
      // Message only
      newStateData = textToHex(messageText)
    }
    const result = await builder.createTransfer(tokenId, recipient, newStateData, fileData)

    // Verify token status was updated in storage
    const updatedToken = await store.getToken(tokenId)
    console.debug(`handleTransfer: Token ${tokenId.slice(0,12)} status after createTransfer:`, updatedToken?.status)

    // Cache file locally if attached
    if (fileData) {
      const hashBytes = Hash.sha256(Array.from(fileData.bytes))
      const hash = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      await fileCache.store(hash, fileData)
      setFileMeta(hash, fileData.mimeType, fileData.fileName)
    }

    setResult('transfer-result', [
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
    const transferClearBtn = el('btn-clear-transfer-file')
    const transferFileInfo = el('transfer-file-info')
    const transferMsgInput = el('transfer-message') as HTMLTextAreaElement
    if (transferClearBtn) transferClearBtn.style.display = 'none'
    if (transferFileInfo) { transferFileInfo.style.display = 'none'; transferFileInfo.textContent = '' }
    if (transferMsgInput) transferMsgInput.disabled = false

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
    // Check token status first
    const token = await store.getToken(tokenId)
    const fungible = token ? null : await store.getFungibleToken(tokenId)

    if (token && token.status === 'transferred') {
      setResult('verify-result', [
        `Valid: false`,
        `Reason: This token has been transferred away from your wallet and is no longer in your possession.`,
      ].join('\n'))
      return
    }

    if (fungible && fungible.utxos.every(u => u.status === 'transferred')) {
      setResult('verify-result', [
        `Valid: false`,
        `Reason: All UTXOs of this fungible token have been transferred away.`,
      ].join('\n'))
      return
    }

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

  setResult('transfer-result', `Transferring ${amount.toLocaleString()} tokens...`)

  try {
    const result = await builder.transferFungible(tokenId, recipient, amount, newStateData)
    setResult('transfer-result', [
      'Fungible transfer broadcast!',
      `TXID: ${result.txId}`,
      `Sent: ${result.amountSent.toLocaleString()} tokens`,
      result.change > 0 ? `Change: ${result.change.toLocaleString()} tokens` : '',
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

;(window as any)._forwardMessage = async (tokenId: string, utxoTxId: string, utxoOutputIndex: number) => {
  const recipient = inputVal('transfer-recipient')
  if (!recipient) {
    setResult('transfer-result', 'Enter a recipient BSV address in the Transfer Token section below to forward this message.')
    el('transfer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el('transfer-recipient')?.focus()
    return
  }

  const feeRate = parseInt(inputVal('fee-rate'), 10)
  if (feeRate > 0) builder.feePerKb = feeRate

  setResult('transfer-result', 'Forwarding message UTXO...')

  try {
    const result = await builder.forwardFungibleUtxo(tokenId, utxoTxId, utxoOutputIndex, recipient)
    setResult('transfer-result', [
      'Message forwarded!',
      `TXID: ${result.txId}`,
      `Sent: ${result.amountSent.toLocaleString()} tokens`,
      `View: https://whatsonchain.com/tx/${result.txId}`,
    ].join('\n'))

    await refreshTokenList()
    await refreshBalance()
  } catch (e: any) {
    setResult('transfer-result', `Error: ${e.message}`)
  }
}

;(window as any)._removeUtxo = async (tokenId: string, utxoTxId: string, utxoOutputIndex: number) => {
  if (!confirm(`Remove UTXO ${utxoTxId.slice(0, 12)}...:${utxoOutputIndex} from this token's basket?\n\nThis only removes it from local storage, not from the blockchain.`)) {
    return
  }

  try {
    const token = await store.getFungibleToken(tokenId)
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
    await store.updateFungibleToken(token)
    await refreshTokenList()
  } catch (e: any) {
    alert(`Error: ${e.message}`)
  }
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

;(window as any)._viewFile = async (genesisTxId: string, hash: string, currentTxId?: string) => {
  // 1. Check local IndexedDB cache
  let file = await fileCache.get(hash)

  // Sync metadata to localStorage if we have a cached file but no metadata
  if (file && !getFileMeta(hash)) {
    setFileMeta(hash, file.mimeType, file.fileName)
  }

  // 2. Fetch from genesis TX
  if (!file) {
    try {
      const fetched = await builder.fetchFileFromGenesis(genesisTxId, hash)
      if (fetched) {
        file = { hash, ...fetched }
        await fileCache.store(hash, fetched)
        setFileMeta(hash, fetched.mimeType, fetched.fileName)
      }
    } catch (e: any) {
      console.debug('fetchFileFromGenesis failed:', e.message)
    }
  }

  // 3. Try current TX (for files attached during transfer)
  if (!file && currentTxId && currentTxId !== genesisTxId) {
    try {
      const fetched = await builder.fetchFileFromGenesis(currentTxId, hash)
      if (fetched) {
        file = { hash, ...fetched }
        await fileCache.store(hash, fetched)
        setFileMeta(hash, fetched.mimeType, fetched.fileName)
      }
    } catch (e: any) {
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

function displayFile(file: { mimeType: string; fileName: string; bytes: Uint8Array }) {
  const blob = new Blob([file.bytes.buffer as ArrayBuffer], { type: file.mimeType })
  const url = URL.createObjectURL(blob)

  const modal = el('media-modal')
  const filenameEl = el('media-filename')
  const contentEl = el('media-content')
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

  const controlsEl = el('media-controls')
  const isMedia = file.mimeType.startsWith('audio/') || file.mimeType.startsWith('video/')

  if (file.mimeType.startsWith('image/')) {
    html = `<img src="${url}" alt="${escHtml(file.fileName)}" />`
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
    const loopBtn = el('mc-loop')
    if (loopBtn) loopBtn.classList.remove('active')
  }

  // Close on Escape key
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeMediaModal()
  }
  document.addEventListener('keydown', escHandler)
  ;(modal as any)._escHandler = escHandler

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) closeMediaModal()
  }
}

function closeMediaModal() {
  const modal = el('media-modal')
  const contentEl = el('media-content')
  if (modal) {
    modal.classList.remove('show')
    // Remove Escape key handler
    if ((modal as any)._escHandler) {
      document.removeEventListener('keydown', (modal as any)._escHandler)
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

;(window as any)._closeMediaModal = closeMediaModal

// Media control handlers
function getMediaPlayer(): HTMLMediaElement | null {
  return document.getElementById('media-player') as HTMLMediaElement | null
}

;(window as any)._mediaPlay = () => {
  const player = getMediaPlayer()
  if (player) player.play()
}

;(window as any)._mediaPause = () => {
  const player = getMediaPlayer()
  if (player) player.pause()
}

;(window as any)._mediaStop = () => {
  const player = getMediaPlayer()
  if (player) {
    player.pause()
    player.currentTime = 0
  }
}

;(window as any)._mediaLoop = () => {
  const player = getMediaPlayer()
  const loopBtn = el('mc-loop')
  if (player && loopBtn) {
    player.loop = !player.loop
    loopBtn.classList.toggle('active', player.loop)
  }
}

;(window as any)._mediaVolume = (value: string) => {
  const player = getMediaPlayer()
  if (player) player.volume = parseInt(value, 10) / 100
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
    setFileMeta(expectedHash, fileData.mimeType, fileData.fileName)
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

// ─── Token Flush & Recovery (v05.23) ────────────────────────────────

// Store the token ID being flushed for use in confirm handler
let flushingTokenId: string | null = null

;(window as any)._openFlushDialog = async (tokenId: string) => {
  const token = await store.getToken(tokenId)
  if (!token) {
    alert('Token not found')
    return
  }

  flushingTokenId = tokenId
  const dialog = el('flush-dialog') as HTMLDialogElement | null
  const tokenNameEl = el('flush-token-name')

  if (!dialog) return

  if (tokenNameEl) {
    tokenNameEl.textContent = token.tokenName
  }

  dialog.showModal()
}

;(window as any)._confirmFlushToken = async () => {
  if (!flushingTokenId) return

  const dialog = el('flush-dialog') as HTMLDialogElement | null
  const preserveCheckbox = el('flush-preserve') as HTMLInputElement | null
  const preserveMetadata = preserveCheckbox?.checked ?? true

  if (!dialog) return

  dialog.close()

  try {
    setText('transfer-result', `Flushing token ${flushingTokenId.slice(0, 12)}...`)

    const result = await builder.flushToken(flushingTokenId, preserveMetadata)

    setResult('transfer-result', [
      'Token flushed!',
      `Token ID: ${result.tokenId}`,
      `Flushed at: ${result.flushedAt}`,
      '',
      preserveMetadata
        ? 'Metadata preserved. Token can be recovered if needed.'
        : 'Metadata not preserved. Token removed permanently.',
    ].join('\n'))

    await refreshTokenList()
    await refreshBalance()
  } catch (e: any) {
    setResult('transfer-result', `Error flushing token: ${e.message}`)
  }

  flushingTokenId = null
}

;(window as any)._cancelFlushDialog = () => {
  const dialog = el('flush-dialog') as HTMLDialogElement | null
  if (dialog) dialog.close()
  flushingTokenId = null
}

;(window as any)._recoverFlushedToken = async (tokenId: string) => {
  try {
    const token = await store.getToken(tokenId)
    if (!token) {
      setResult('transfer-result', 'Token not found in storage')
      return
    }

    if (token.status !== 'flushed') {
      setResult('transfer-result', `Token is not in flushed state (current status: ${token.status})`)
      return
    }

    setText('transfer-result', `Un-flushing token ${tokenId.slice(0, 12)}...`)

    // Restore token to active status
    token.status = 'active'
    token.flushedAt = undefined
    await store.updateToken(token)

    setResult('transfer-result', [
      'Token restored!',
      `Token: ${token.tokenName} (${tokenId.slice(0, 12)}...)`,
      `Status: Active`,
      'Token has been restored from flushed state.',
    ].join('\n'))

    await refreshTokenList()
  } catch (e: any) {
    setResult('transfer-result', `Error recovering token: ${e.message}`)
  }
}

;(window as any)._startRecoveryScan = async () => {
  // v05.23: Flushing is now internal-only (no blockchain transactions)
  // This button is kept for backward compatibility but now shows flushed tokens that can be restored
  const resultsDiv = el('recovery-results')
  if (!resultsDiv) return

  try {
    const tokens = await store.listTokens()
    const flushedTokens = tokens.filter(t => t.status === 'flushed')

    let html = `<div style="margin-top:12px;border-top:1px solid #30363d;padding-top:12px;">`

    if (flushedTokens.length > 0) {
      html += `<div style="margin-bottom:12px;padding:12px;background:#3d2d0d;border-left:4px solid #d29922;border-radius:4px;">
        <strong style="color:#d29922;">⚠ Flushed Tokens: ${flushedTokens.length}</strong><br>
        <span style="font-size:0.9em;color:#c9d1d9;">These tokens are flushed and can be restored:</span>
        ${flushedTokens.map(t => `
          <div style="margin-top:6px;font-size:0.85em;">
            <span style="color:#c9d1d9;">${escHtml(t.tokenName)}</span>
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

    setResult('transfer-result', [
      'Flushed tokens scan complete!',
      `Found: ${flushedTokens.length}`,
      'Click "Restore Token" to un-flush any token.',
    ].join('\n'))
  } catch (e: any) {
    setResult('transfer-result', `Error scanning for flushed tokens: ${e.message}`)
  }
}

// ─── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init)

/*
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Open BSV License Version 5 – granted by BSV Association, Grafenauweg 6, 6300
 * Zug, Switzerland (CHE-427.008.338) ("Licensor"), to you as a user (henceforth
 * "You", "User" or "Licensee").
 *
 * For the purposes of this license, the definitions below have the following
 * meanings:
 *
 * "Bitcoin Protocol" means the protocol implementation, cryptographic rules,
 * network protocols, and consensus mechanisms in the Bitcoin White Paper as
 * described here https://protocol.bsvblockchain.org.
 *
 * "Bitcoin White Paper" means the paper entitled 'Bitcoin: A Peer-to-Peer
 * Electronic Cash System' published by 'Satoshi Nakamoto' in October 2008.
 *
 * "BSV Blockchains" means:
 *   (a) the Bitcoin blockchain containing block height #556767 with the hash
 *       "000000000000000001d956714215d96ffc00e0afda4cd0a96c96f8d802b1662b" and
 *       that contains the longest honest persistent chain of blocks which has been
 *       produced in a manner which is consistent with the rules set forth in the
 *       Network Access Rules; and
 *   (b) the test blockchains that contain the longest honest persistent chains of
 *       blocks which has been produced in a manner which is consistent with the
 *       rules set forth in the Network Access Rules.
 *
 * "Network Access Rules" or "Rules" means the set of rules regulating the
 * relationship between BSV Association and the nodes on BSV based on the Bitcoin
 * Protocol rules and those set out in the Bitcoin White Paper, and available here
 * https://bsvblockchain.org/network-access-rules.
 *
 * "Software" means the software the subject of this licence, including any/all
 * intellectual property rights therein and associated documentation files.
 *
 * BSV Association grants permission, free of charge and on a non-exclusive and
 * revocable basis, to any person obtaining a copy of the Software to deal in the
 * Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
 * Software, and to permit persons to whom the Software is furnished to do so,
 * subject to and conditioned upon the following conditions:
 *
 * 1 - The text "© BSV Association," and this license shall be included in all
 * copies or substantial portions of the Software.
 * 2 - The Software, and any software that is derived from the Software or parts
 * thereof, must only be used on the BSV Blockchains.
 *
 * For the avoidance of doubt, this license is granted subject to and conditioned
 * upon your compliance with these terms only. In the event of non-compliance, the
 * license shall extinguish and you can be enjoined from violating BSV's
 * intellectual property rights (incl. damages and similar related claims).
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES REGARDING ENTITLEMENT,
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS THEREOF BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 *
 * Version 0.1.1 of the Bitcoin SV software, and prior versions of software upon
 * which it was based, were licensed under the MIT License, which is included below.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2009-2010 Satoshi Nakamoto
 * Copyright (c) 2009-2015 Bitcoin Developers
 * Copyright (c) 2009-2017 The Bitcoin Core developers
 * Copyright (c) 2017 The Bitcoin ABC developers
 * Copyright (c) 2018 Bitcoin Association for BSV
 * Copyright (c) 2023 BSV Association
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
