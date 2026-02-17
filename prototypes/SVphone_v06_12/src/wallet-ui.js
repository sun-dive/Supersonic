/**
 * Wallet UI Initialization (v06.12)
 *
 * Token rendering extracted from v06_00 and organized into clean architecture.
 * - Populates address from TokenBuilder
 * - Calculates and displays balance
 * - Loads and renders all tokens (OwnedToken + FungibleToken) with full details
 * - Syncs address to localStorage for other interfaces
 */

class WalletUI {
  constructor() {
    this.addressElement = document.getElementById('address');
    this.balanceElement = document.getElementById('balance');
    this.tokenListElement = document.getElementById('token-list');
  }

  /**
   * Initialize wallet UI when bundle.js is ready
   */
  async initialize() {
    try {
      // Check that bundle.js has initialized
      if (!window.builder || !window.store) {
        console.warn('[WalletUI] Bundle.js not yet ready, retrying...');
        setTimeout(() => this.initialize(), 500);
        return;
      }

      // Populate address
      this.populateAddress();

      // Populate balance
      await this.populateBalance();

      // Load and display tokens
      await this.loadTokens();

      // Wire up button handlers
      this.wireUpButtonHandlers();

      // Sync address to localStorage
      this.syncAddressToStorage();
      this.watchAddressChanges();

      console.log('[WalletUI] Initialization complete');
    } catch (error) {
      console.error('[WalletUI] Initialization failed:', error);
    }
  }

  /**
   * Populate wallet address
   */
  populateAddress() {
    if (this.addressElement && window.builder.myAddress) {
      this.addressElement.textContent = window.builder.myAddress;
      console.log('[WalletUI] Address populated:', window.builder.myAddress);
    }
  }

  /**
   * Calculate and display balance
   */
  async populateBalance() {
    if (!this.balanceElement || !window.builder) {
      return;
    }

    try {
      this.balanceElement.textContent = 'Loading...';
      const balance = await window.builder.getSpendableBalance();
      this.balanceElement.textContent = balance.toLocaleString() + ' sat';
      console.log('[WalletUI] Balance populated:', balance);
    } catch (err) {
      this.balanceElement.textContent = 'Error loading balance';
      console.error('[WalletUI] Error getting balance:', err);
    }
  }

  /**
   * Load tokens from store and display them (working version from v06_00)
   */
  async loadTokens() {
    try {
      if (!window.store) {
        console.warn('[WalletUI] TokenStore not available');
        return;
      }

      // Load tokens sorted by creation date (newest first)
      let tokens = (await window.store.listTokens()).sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });

      // Filter tokens: exclude transferred and flushed-without-recovery
      tokens = tokens.filter(t => {
        if (t.status === 'transferred') return false;
        if (t.status === 'flushed' && !t.flushedAt) return false;
        return true;
      });

      let fungibleTokens = (await window.store.listFungibleTokens()).sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });

      console.log('[WalletUI] Loaded tokens:', {
        owned: tokens.length,
        fungible: fungibleTokens.length,
        total: tokens.length + fungibleTokens.length
      });

      const container = this.tokenListElement;
      if (!container) return;

      if (tokens.length === 0 && fungibleTokens.length === 0) {
        container.innerHTML = '<p class="muted">No tokens yet. Mint a new token to get started.</p>';
        return;
      }

      // Render fungible tokens first
      const fungibleHtml = fungibleTokens.map(ft => renderFungibleCard(ft)).join('');

      // Group non-fungible tokens by genesis TXID
      const groups = new Map();
      for (const t of tokens) {
        const key = t.genesisTxId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      }
      // Sort each group by output index
      for (const group of groups.values()) {
        group.sort((a, b) => a.genesisOutputIndex - b.genesisOutputIndex);
      }

      const nftHtml = Array.from(groups.entries()).map(([genesisTxId, group]) => {
        if (group.length === 1) {
          return renderTokenCard(group[0]);
        }
        const first = group[0];
        const rules = window.decodeTokenRules(first.tokenRules);

        // Divisible tokens (divisibility > 0): fragment collection view
        if (rules.divisibility > 0) {
          return renderFragmentCard(genesisTxId, group, rules);
        }

        // Non-divisible multi-token (divisibility === 0): NFT dropdown selector
        const selectId = `sel-${genesisTxId.slice(0, 12)}`;
        const detailId = `detail-${genesisTxId.slice(0, 12)}`;
        const options = group.map((t) =>
          `<option value="${t.tokenId}">NFT #${t.genesisOutputIndex} ${t.status !== 'active' ? '- ' + t.status : ''}</option>`
        ).join('');
        const activeCount = group.filter(t => t.status === 'active').length;
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
    </details>`;
      }).join('');

      container.innerHTML = fungibleHtml + nftHtml;
    } catch (error) {
      console.error('[WalletUI] Error loading tokens:', error);
      if (this.tokenListElement) {
        this.tokenListElement.innerHTML = '<p style="color: #da3633;">Error loading tokens: ' + error.message + '</p>';
      }
    }
  }

  /**
   * Sync address to localStorage for other interfaces
   */
  syncAddressToStorage() {
    if (this.addressElement && this.addressElement.textContent && this.addressElement.textContent !== '...') {
      const addr = this.addressElement.textContent.trim();
      localStorage.setItem('svphone_wallet_address', addr);
      console.log('[WalletUI] Address synced to localStorage:', addr);
    }
  }

  /**
   * Watch for address changes and sync to localStorage
   */
  watchAddressChanges() {
    if (this.addressElement) {
      const observer = new MutationObserver(() => {
        this.syncAddressToStorage();
      });
      observer.observe(this.addressElement, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    // Periodic sync every 5 seconds
    setInterval(() => {
      if (window.builder && this.addressElement) {
        this.syncAddressToStorage();
      }
    }, 5000);
  }

  /**
   * Wire up event handlers for all buttons
   */
  wireUpButtonHandlers() {
    const handlers = new WalletHandlers(this);

    // Refresh Balance button
    const btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
      btnRefresh.onclick = () => handlers.refreshBalance();
    }

    // Restore Wallet button
    const btnRestore = document.getElementById('btn-restore-wallet');
    if (btnRestore) {
      btnRestore.onclick = () => handlers.restoreWallet();
    }

    // Send button
    const btnSend = document.getElementById('btn-send');
    if (btnSend) {
      btnSend.onclick = () => handlers.send();
    }

    // Mint Token button
    const btnMint = document.getElementById('btn-mint');
    if (btnMint) {
      btnMint.onclick = () => handlers.mintToken();
    }

    // Check Incoming Tokens button
    const btnCheckIncoming = document.getElementById('btn-check-incoming');
    if (btnCheckIncoming) {
      btnCheckIncoming.onclick = () => handlers.checkIncomingTokens();
    }

    // Transfer button
    const btnTransfer = document.getElementById('btn-transfer');
    if (btnTransfer) {
      btnTransfer.onclick = () => handlers.transfer();
    }

    // Verify Proof Chain button
    const btnVerify = document.getElementById('btn-verify');
    if (btnVerify) {
      btnVerify.onclick = () => handlers.verifyProofChain();
    }

    console.log('[WalletUI] Button handlers wired up');
  }

  /**
   * Refresh the balance display
   */
  async refreshBalance() {
    if (!this.balanceElement) return;

    try {
      this.balanceElement.textContent = 'Refreshing...';
      const balance = await window.builder.getSpendableBalance();
      this.balanceElement.textContent = balance.toLocaleString() + ' sat';
      console.log('[WalletUI] Balance refreshed:', balance);
    } catch (err) {
      this.balanceElement.textContent = 'Error';
      console.error('[WalletUI] Error refreshing balance:', err);
    }
  }

  /**
   * Refresh the token list
   */
  async refreshTokens() {
    try {
      await this.loadTokens();
      console.log('[WalletUI] Tokens refreshed');
    } catch (err) {
      console.error('[WalletUI] Error refreshing tokens:', err);
    }
  }
}

// ─── Token Rendering Functions (from v06_00) ────────────────────────

function getMimeTypeIcon(mimeType) {
  if (mimeType.startsWith('image/')) return '\u{1F5BC}';  // framed picture
  if (mimeType.startsWith('audio/')) return '\u{1F3B5}';  // musical note
  if (mimeType.startsWith('video/')) return '\u{1F3AC}';  // clapper board
  if (mimeType.startsWith('text/')) return '\u{1F4C4}';   // page facing up
  if (mimeType === 'application/pdf') return '\u{1F4D1}'; // bookmark tabs
  if (mimeType === 'application/zip') return '\u{1F4E6}'; // package
  return '\u{1F4CE}';  // paperclip (generic file)
}

const FILE_META_KEY = 'p:fileMeta';
function getFileMeta(hash) {
  try {
    const data = JSON.parse(localStorage.getItem(FILE_META_KEY) || '{}');
    return data[hash] || null;
  } catch { return null; }
}

function setFileMeta(hash, mimeType, fileName) {
  try {
    const data = JSON.parse(localStorage.getItem(FILE_META_KEY) || '{}');
    data[hash] = { mimeType, fileName };
    localStorage.setItem(FILE_META_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[WalletUI] Error setting file metadata:', e);
  }
}

function renderFungibleCard(ft) {
  const spendableUtxos = ft.utxos.filter(u => u.status === 'active' || u.status === 'pending');
  const pendingTransferUtxos = ft.utxos.filter(u => u.status === 'pending_transfer');
  const genKey = ft.genesisTxId.slice(0, 12);

  const regularUtxos = spendableUtxos.filter(u => {
    const decoded = u.stateData ? tryDecodeHex(u.stateData) : '';
    return !decoded || decoded === '00';
  });
  const messageUtxos = spendableUtxos.filter(u => {
    const decoded = u.stateData ? tryDecodeHex(u.stateData) : '';
    return decoded && decoded !== '00';
  });

  const regularBalance = regularUtxos.reduce((sum, u) => sum + u.satoshis, 0);
  const messageBalance = messageUtxos.reduce((sum, u) => sum + u.satoshis, 0);
  const totalBalance = regularBalance + messageBalance;
  const pendingTransferBalance = pendingTransferUtxos.reduce((sum, u) => sum + u.satoshis, 0);

  const messagesHtml = messageUtxos.length > 0 ? `
      <details style="margin-top:12px;padding-top:12px;border-top:1px solid #30363d;">
        <summary style="cursor:pointer;font-weight:bold;color:#58a6ff;margin-bottom:8px;">📨 Messages (${messageUtxos.length})</summary>
        ${messageUtxos.map(u => {
          const stateDecoded = tryDecodeHex(u.stateData);
          return `
          <div style="padding:10px;margin-bottom:8px;background:#161b22;border:1px solid #30363d;border-radius:6px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <strong style="color:#3fb950;">${u.satoshis.toLocaleString()} tokens</strong>
              ${u.receivedAt ? `<span class="muted" style="font-size:0.8em;">${formatDate(u.receivedAt)}</span>` : ''}
            </div>
            <pre style="margin:0 0 8px 0;padding:8px;background:#0d1117;border-radius:4px;white-space:pre-wrap;word-break:break-word;font-size:0.9em;color:#c9d1d9;">${escHtml(stateDecoded)}</pre>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <a href="https://whatsonchain.com/tx/${u.txId}" target="_blank" rel="noopener" style="font-size:0.8em;">View TX</a>
              <code class="muted" style="font-size:0.7em;">${u.txId.slice(0, 12)}...:${u.outputIndex}</code>
            </div>
          </div>`;
        }).join('')}
      </details>` : '';

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
            <a href="https://whatsonchain.com/tx/${ft.genesisTxId}" target="_blank" rel="noopener">View Genesis TX</a>
          </div>
        </div>
        ${messagesHtml}
      </div>
    </details>`;
}

function renderTokenCard(t) {
  const statusBadge = renderStatusBadge(t.status, t.confirmationStatus);
  const actions = renderTokenActions(t);
  const rules = renderRules(t.tokenRules);
  const attrsDisplay = renderHexField(t.tokenAttributes, t);
  const stateDisplay = renderStateData(t.stateData, t);
  const r = window.decodeTokenRules(t.tokenRules);
  const isFragment = r.divisibility > 0 && r.supply > 0;
  const totalFragments = isFragment ? r.supply * r.divisibility : r.supply;
  const nftLabel = isFragment
    ? ` Fragment #${t.genesisOutputIndex} (${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)})`
    : (r.supply > 1 ? ` NFT #${t.genesisOutputIndex}` : '');
  const fragmentInfo = isFragment
    ? `<div class="token-field"><span class="label">Fragment:</span> ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)} -- piece #${t.genesisOutputIndex} of ${totalFragments} total</div>`
    : '';

  let attrsIconHtml = '';
  if (t.tokenAttributes && t.tokenAttributes !== '00') {
    const meta = getFileMeta(t.tokenAttributes.length === 64 ? t.tokenAttributes : '');
    if (meta) {
      attrsIconHtml = `<span style="margin-left:8px;">${getMimeTypeIcon(meta.mimeType)}</span>`;
    }
  }

  const isFlushed = t.status === 'flushed';
  const bgColor = isFlushed ? '#1a0d0d' : '#0d1117';
  const borderColor = isFlushed ? '#663333' : '#30363d';
  const nameStyling = isFlushed ? 'opacity:0.6;' : '';
  const flushedNotice = isFlushed ? `<span style="font-size:0.7em;color:#da3633;font-weight:bold;margin-left:8px;">⚠ FLUSHED</span>` : '';

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
    </details>`;
}

function renderTokenDetail(t) {
  const statusBadge = renderStatusBadge(t.status, t.confirmationStatus);
  const actions = renderTokenActions(t);
  const attrsDisplay = renderHexField(t.tokenAttributes, t);
  const stateDisplay = renderStateData(t.stateData, t);
  const r = window.decodeTokenRules(t.tokenRules);
  const isFragment = r.divisibility > 0 && r.supply > 0;
  const fragLine = isFragment
    ? `<div class="token-field"><span class="label">Fragment:</span> ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)}</div>`
    : (r.supply > 1 ? `<div class="token-field"><span class="label">NFT #:</span> ${t.genesisOutputIndex}</div>` : '');
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
    </div>`;
}

function renderStatusBadge(status, confirmationStatus) {
  let badge = '';
  switch (status) {
    case 'active':
      if (confirmationStatus === 'unconfirmed') {
        badge = '<span class="badge badge-active">Active</span><span class="badge badge-unconfirmed" title="Transaction not yet confirmed">⏳ Unconfirmed</span>';
      } else {
        badge = '<span class="badge badge-active">Active</span>';
      }
      break;
    case 'pending_transfer':
      badge = '<span class="badge badge-pending">Pending Transfer</span>';
      break;
    case 'transferred':
      badge = '<span class="badge badge-transferred">Transferred</span>';
      break;
    case 'flushed':
      badge = '<span class="badge" style="background:#da3633;">Flushed</span>';
      break;
    case 'recovered':
      badge = '<span class="badge" style="background:#238636;">Recovered</span>';
      break;
    default:
      badge = '';
  }
  return badge;
}

function renderTokenActions(t) {
  const parts = [];
  const r = window.decodeTokenRules(t.tokenRules);
  const isFragment = r.divisibility > 0;

  if (t.status === 'active') {
    parts.push(`<button onclick="window._selectForTransfer('${t.tokenId}')">Select for Transfer</button>`);
    if (isFragment) {
      parts.push(`<button onclick="window._sendSingleFragment('${t.tokenId}', ${t.genesisOutputIndex})">Send ${fragmentLabel(t.genesisOutputIndex, r.divisibility, r.supply)}</button>`);
    }
    parts.push(`<button onclick="window._verifyToken('${t.tokenId}')">Verify</button>`);
  }

  if (t.status === 'active') {
    parts.push(`<button onclick="window._openFlushDialog('${t.tokenId}')" style="background:#da3633;">Flush Token</button>`);
  }

  if (t.status === 'flushed') {
    parts.push(`<button onclick="window._recoverFlushedToken('${t.tokenId}')" style="background:#238636;">Recover</button>`);
  }

  if (t.status === 'pending_transfer') {
    parts.push(`<button onclick="window._confirmTransfer('${t.tokenId}')" class="btn-confirm">Confirm Sent</button>`);
  }

  if (t.currentTxId) {
    parts.push(`<a href="https://whatsonchain.com/tx/${t.currentTxId}" target="_blank" rel="noopener">View TX</a>`);
  }
  if (t.transferTxId && t.transferTxId !== t.currentTxId) {
    parts.push(`<a href="https://whatsonchain.com/tx/${t.transferTxId}" target="_blank" rel="noopener">View Transfer TX</a>`);
  }

  return parts.join('\n');
}

function renderRules(rulesHex) {
  if (!rulesHex || rulesHex.length !== 16) return `<code>${escHtml(rulesHex || '(none)')}</code>`;
  const r = window.decodeTokenRules(rulesHex);
  const divLabel = r.divisibility > 0
    ? `Divisibility=${r.divisibility} (${r.supply}×${r.divisibility}=${r.supply * r.divisibility} fragments)`
    : `Divisibility=0`;
  return `Supply=${r.supply}, ${divLabel}, Restrictions=0x${r.restrictions.toString(16).padStart(4, '0')}, Version=${r.version}`;
}

function renderHexField(hex, token) {
  if (!hex || hex === '00') return '<span class="muted">(none)</span>';
  if (hex.length === 64 && token) {
    const meta = getFileMeta(hex);
    const icon = meta ? getMimeTypeIcon(meta.mimeType) : '\u{1F4CE}';
    const label = meta ? `${icon} ${meta.fileName}` : `${icon} View File`;
    return `<code class="muted">${escHtml(hex)}</code> <button onclick="window._viewFile('${token.genesisTxId}', '${hex}')" style="font-size:0.8em; padding:2px 8px; background:#30363d;">${label}</button>`;
  }
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/^[\x20-\x7e\t\n\r]+$/.test(decoded)) {
      return `"${escHtml(decoded)}"<br><code class="muted">${escHtml(hex)}</code>`;
    }
  } catch { /* not valid UTF-8 */ }
  return `<code>${escHtml(hex)}</code>`;
}

function renderStateData(stateHex, token) {
  if (!stateHex || stateHex === '00') return '<span class="muted">(empty)</span>';

  const { text, fileHash } = decodeStateData(stateHex);

  let html = '';

  if (text) {
    html += `"${escHtml(text)}"<br>`;
  }

  if (fileHash && token) {
    const meta = getFileMeta(fileHash);
    const icon = meta ? getMimeTypeIcon(meta.mimeType) : '\u{1F4CE}';
    const label = meta ? `${icon} ${meta.fileName}` : `${icon} View File`;
    html += `<button onclick="window._viewFile('${token.genesisTxId}', '${fileHash}', '${token.currentTxId}')" style="font-size:0.8em; padding:2px 8px; background:#30363d; margin-top:4px;">${label}</button><br>`;
  }

  html += `<code class="muted">${escHtml(stateHex)}</code>`;

  return html;
}

function fragmentLabel(index, fragsPerWhole, wholeTokens) {
  const nftNum = Math.ceil(index / fragsPerWhole);
  const pieceNum = ((index - 1) % fragsPerWhole) + 1;
  if (wholeTokens === 1) return `Piece ${pieceNum}/${fragsPerWhole}`;
  return `NFT ${nftNum}, piece ${pieceNum}/${fragsPerWhole}`;
}

function renderFragmentCard(genesisTxId, group, rules) {
  // Simplified for now - just render first fragment
  return renderTokenCard(group[0]);
}

function tryDecodeHex(hex) {
  if (!hex || hex === '00') return '';
  const { text } = decodeStateData(hex);
  return text || hex;
}

function decodeStateData(stateHex) {
  if (!stateHex || stateHex === '00') {
    return { text: '' };
  }

  const parts = stateHex.split(/(?<!7e)7c(?!7e)/);

  if (parts.length === 1) {
    try {
      const bytes = new Uint8Array(stateHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || []);
      let decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      decoded = decoded.replace(/~\|~/g, '|');
      return { text: decoded };
    } catch {
      return { text: '' };
    }
  }

  if (parts.length === 2) {
    const textHex = parts[0];
    const fileHash = parts[1];

    if (!/^[0-9a-f]{64}$/i.test(fileHash)) {
      try {
        const bytes = new Uint8Array(stateHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || []);
        let decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        decoded = decoded.replace(/~\|~/g, '|');
        return { text: decoded };
      } catch {
        return { text: '' };
      }
    }

    let text = '';
    if (textHex) {
      try {
        const bytes = new Uint8Array(textHex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || []);
        let decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        text = decoded.replace(/~\|~/g, '|');
      } catch {
        // Ignore decode errors
      }
    }

    return { text, fileHash };
  }

  return { text: '' };
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// ─── Global Token Selection Handlers ────────────────────────────────

window._selectGroupToken = (genesisTxIdPrefix, tokenId) => {
  const detailId = `detail-${genesisTxIdPrefix}`;
  const detailEl = document.getElementById(detailId);
  if (!detailEl || !window.store || !window.store.getToken) return;

  window.store.getToken(tokenId).then(token => {
    if (token && detailEl) {
      detailEl.innerHTML = renderTokenDetail(token);
    }
  });
};

// ─── Window Exports for Handlers ────────────────────────────────────

// Expose helper functions
window.el = (id) => document.getElementById(id);
window.setText = (id, text) => {
  const e = window.el(id);
  if (e) e.textContent = text;
};
window.setResult = (id, text) => {
  const e = window.el(id);
  if (e) e.textContent = text;
};
window.inputVal = (id) => {
  const e = window.el(id);
  return (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) ? (e?.value?.trim() ?? '') : '';
};
window.escHtml = escHtml;
window.formatDate = formatDate;
window.tryDecodeHex = tryDecodeHex;
window.decodeStateData = decodeStateData;

// Expose rendering functions
window.renderTokenCard = renderTokenCard;
window.renderFungibleCard = renderFungibleCard;
window.renderTokenDetail = renderTokenDetail;
window.renderStatusBadge = renderStatusBadge;
window.renderTokenActions = renderTokenActions;
window.renderRules = renderRules;
window.renderHexField = renderHexField;
window.renderStateData = renderStateData;
window.renderFragmentCard = renderFragmentCard;
window.fragmentLabel = fragmentLabel;

// Expose utility functions
window.getMimeTypeIcon = getMimeTypeIcon;
window.getFileMeta = getFileMeta;
window.setFileMeta = setFileMeta;
window.inferMimeType = inferMimeType;

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const walletUI = new WalletUI();
  window.walletUI = walletUI; // Expose for handlers and debugging

  // Create handlers instance and expose globally
  const handlers = new WalletHandlers(walletUI);
  window.walletHandlers = handlers;

  // Try immediate init, then retry after delays
  walletUI.initialize();
  setTimeout(() => walletUI.initialize(), 500);
  setTimeout(() => walletUI.initialize(), 1500);
});
