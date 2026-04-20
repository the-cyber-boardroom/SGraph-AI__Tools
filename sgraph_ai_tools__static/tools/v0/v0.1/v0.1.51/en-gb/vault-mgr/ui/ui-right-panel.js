/**
 * Vault Manager — right panel: Vault detail, master key, file browser.
 * @module ui-right-panel
 * @version 0.1.51
 */

const _CSS = `
* { box-sizing: border-box; }
.panel { height: 100%; overflow-y: auto; background: #080812; font-family: system-ui, sans-serif; padding: 16px; }

/* Empty state */
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center;
         height: 100%; text-align: center; color: #2d3748; }
.empty-icon { font-size: 40px; margin-bottom: 14px; opacity: .5; }
.empty-text { font-size: 14px; }
.empty-hint { font-size: 12px; margin-top: 6px; }

/* Header */
.vault-hdr { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #0d0d1a; }
.vault-hdr-icon { font-size: 28px; flex-shrink: 0; margin-top: 2px; }
.vault-hdr-info { flex: 1; min-width: 0; }
.vault-hdr-name { font-size: 18px; font-weight: 700; color: #e2e8f0; }
.vault-hdr-url  { font-size: 12px; color: #4a5568; margin-top: 2px; font-family: "SF Mono", Monaco, monospace; }
.vault-hdr-meta { font-size: 10px; color: #2d3748; margin-top: 4px; }
.btn-danger { font-size: 10px; padding: 4px 10px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #4a5568; cursor: pointer; font-family: inherit; white-space: nowrap; flex-shrink: 0; margin-top: 4px; }
.btn-danger:hover { border-color: #fc8181; color: #fc8181; }

/* Section */
.section { margin-bottom: 20px; }
.section-title { font-size: 10px; font-weight: 700; color: #4a5568; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }

/* Key */
.key-box { background: #0a0a18; border: 1px solid #1a1a3a; border-radius: 5px; padding: 10px 12px; }
.key-row { display: flex; align-items: center; gap: 8px; }
.key-val { flex: 1; font-size: 12px; font-family: "SF Mono", Monaco, monospace; color: #e2e8f0; word-break: break-all; line-height: 1.5; min-width: 0; }
.key-val.masked { letter-spacing: 3px; color: #4a5568; font-size: 16px; }
.key-btns { display: flex; gap: 4px; flex-shrink: 0; }
.key-note { font-size: 10px; color: #4ecdc4; margin-top: 6px; }

/* Vault connect */
.connect-wrap { background: #0a0a18; border: 1px solid #1a1a3a; border-radius: 5px; overflow: hidden; }
sg-vault-connect { display: block; }
sg-vault-tree { display: block; margin-top: 12px; }

/* Buttons */
.btn { font-size: 11px; padding: 5px 10px; border-radius: 4px; border: 1px solid #2d3748; background: none; color: #718096; cursor: pointer; font-family: inherit; }
.btn:hover { border-color: #4ecdc4; color: #4ecdc4; }
.btn-sm { font-size: 10px; padding: 3px 8px; }
.btn-primary { border-color: #4ecdc4; color: #4ecdc4; }

/* Confirm overlay */
.confirm-bar { display: none; margin-top: 8px; padding: 8px 10px; background: rgba(252,129,129,.08); border: 1px solid rgba(252,129,129,.2); border-radius: 4px; font-size: 11px; color: #fc8181; gap: 8px; align-items: center; }
.confirm-bar.visible { display: flex; }
`;

export function buildRightPanel(el, state, cb) {
    el.innerHTML = `<style>${_CSS}</style><div class="panel" id="right-panel"></div>`;
    const panel = el.querySelector('#right-panel');

    if (!state.selectedId || !state.store) {
        panel.innerHTML = `
            <div class="empty">
                <div class="empty-icon">🏛</div>
                <div class="empty-text">${state.store ? 'Select a vault' : 'Connect Drive first'}</div>
                <div class="empty-hint">${state.store ? 'Choose from the list or create a new vault' : 'Use the left panel to connect your Google Drive'}</div>
            </div>`;
        return;
    }

    const vault = state.store.get(state.selectedId);
    if (!vault) return;

    panel.appendChild(_vaultHeader(vault));
    panel.appendChild(_masterKeySection(vault));
    panel.appendChild(_connectSection(vault));

    _bindEvents(el, vault, state, cb);
}

// ── Sections ──────────────────────────────────────────────────────────────────

function _vaultHeader(vault) {
    const div = document.createElement('div');
    div.className = 'vault-hdr';
    const created = vault.createdAt
        ? new Date(vault.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';
    const lastUsed = vault.lastUsed
        ? new Date(vault.lastUsed).toLocaleTimeString('en-GB', { hour12: false })
        : 'never';
    div.innerHTML = `
        <div class="vault-hdr-icon">🏛</div>
        <div class="vault-hdr-info">
            <div class="vault-hdr-name">${vault.displayName}</div>
            <div class="vault-hdr-url">${vault.apiBaseUrl}</div>
            <div class="vault-hdr-meta">Created ${created} · Last used: ${lastUsed}</div>
        </div>
        <button class="btn-danger" id="delete-btn">✕ Delete</button>`;
    return div;
}

function _masterKeySection(vault) {
    const div = document.createElement('div');
    div.className = 'section';
    div.innerHTML = `
        <div class="section-title">Master Key</div>
        <div class="key-box">
            <div class="key-row">
                <div class="key-val masked" id="key-display">••••••••••••••••••••••••••••</div>
                <div class="key-btns">
                    <button class="btn btn-sm" id="key-toggle">Show</button>
                    <button class="btn btn-sm" id="key-copy">Copy</button>
                </div>
            </div>
            <div class="key-note">✓ Stored in Google Drive App Data — private to your account</div>
        </div>
        <div class="confirm-bar" id="delete-confirm">
            Delete <strong>${vault.displayName}</strong>? This removes it from Drive App Data.
            <button class="btn btn-sm" id="delete-confirm-yes" style="border-color:#fc8181;color:#fc8181;">Delete</button>
            <button class="btn btn-sm" id="delete-confirm-no">Cancel</button>
        </div>`;
    div._vault = vault;
    return div;
}

function _connectSection(vault) {
    const div = document.createElement('div');
    div.className = 'section';
    div.innerHTML = `
        <div class="section-title">Vault Files</div>
        <div class="connect-wrap" data-vault-bus>
            <sg-vault-connect></sg-vault-connect>
            <sg-vault-tree style="display:none;"></sg-vault-tree>
        </div>`;

    // Pre-fill sg-vault-connect localStorage hints so it auto-populates
    localStorage.setItem('sg-vault:last-api', vault.apiBaseUrl);
    localStorage.setItem('sg-vault:last-key', vault.vaultKey);

    // Show tree when connected, hide when disconnected
    requestAnimationFrame(() => {
        const bus  = div.querySelector('[data-vault-bus]');
        const tree = div.querySelector('sg-vault-tree');
        if (!bus || !tree) return;

        bus.addEventListener('vault:connected', () => {
            tree.style.display = 'block';
        });
        bus.addEventListener('vault:disconnected', () => {
            tree.style.display = 'none';
        });
    });

    return div;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function _bindEvents(el, vault, state, cb) {
    // Show/hide master key
    let keyVisible = false;
    el.querySelector('#key-toggle')?.addEventListener('click', () => {
        keyVisible = !keyVisible;
        const display = el.querySelector('#key-display');
        const btn     = el.querySelector('#key-toggle');
        if (!display || !btn) return;
        if (keyVisible) {
            display.textContent = vault.vaultKey;
            display.className   = 'key-val';
            btn.textContent     = 'Hide';
        } else {
            display.textContent = '••••••••••••••••••••••••••••';
            display.className   = 'key-val masked';
            btn.textContent     = 'Show';
        }
    });

    // Copy key
    el.querySelector('#key-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(vault.vaultKey).then(() => {
            const btn = el.querySelector('#key-copy');
            if (!btn) return;
            btn.textContent = '✓ Copied';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
    });

    // Delete flow
    el.querySelector('#delete-btn')?.addEventListener('click', () => {
        el.querySelector('#delete-confirm')?.classList.add('visible');
    });
    el.querySelector('#delete-confirm-no')?.addEventListener('click', () => {
        el.querySelector('#delete-confirm')?.classList.remove('visible');
    });
    el.querySelector('#delete-confirm-yes')?.addEventListener('click', () => {
        cb.deleteVault(vault.vaultId);
    });
}
