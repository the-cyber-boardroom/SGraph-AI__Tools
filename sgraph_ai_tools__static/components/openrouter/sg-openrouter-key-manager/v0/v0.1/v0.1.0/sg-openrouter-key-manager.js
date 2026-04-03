/**
 * sg-openrouter-key-manager — Admin panel for OpenRouter provisioned keys.
 *
 * Requires a *management key* (obtained from openrouter.ai/settings/management-keys),
 * which is distinct from a user API key. Management keys can CRUD sub-keys but
 * cannot make chat completion requests.
 *
 * Features:
 *  - Management key input with localStorage persistence
 *  - List all provisioned keys (paginated, max 100 per page)
 *  - Create a new key (name, optional credit limit, optional limit reset period)
 *  - Inline edit per key: rename, change limit, enable/disable
 *  - Delete key (with confirmation)
 *  - Usage bar per key (limit_remaining / limit)
 *
 * API endpoints used (all require Management key):
 *   GET    /api/v1/keys                   — list all keys
 *   POST   /api/v1/keys                   — create key
 *   GET    /api/v1/keys/{hash}            — get single key
 *   PATCH  /api/v1/keys/{hash}            — update key
 *   DELETE /api/v1/keys/{hash}            — delete key
 *
 * Note: This component does NOT consume any llm:* bus events — it operates
 * independently with its own management key. The management key is stored in
 * localStorage under 'sg-openrouter-mgmt-key'. It is NEVER sent to *.sgraph.ai.
 *
 * Attributes:
 *   (none)
 *
 * Public API:
 *   manager.refresh()   → re-fetch key list
 *
 * @module sg-openrouter-key-manager
 * @version 0.1.0
 */

const BASE_URL    = 'https://openrouter.ai/api/v1/keys';
const STORAGE_KEY = 'sg-openrouter-mgmt-key';

const CSS = `
:host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: monospace;
    font-size: 12px;
    background: #0d0d1a;
    color: #c8d0e0;
}

/* ── Auth bar ─────────────────────────────────────────── */
.km-auth {
    display: flex;
    gap: 6px;
    padding: 8px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    align-items: center;
}
.km-auth-input {
    flex: 1;
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #c8d0e0;
    padding: 4px 8px;
    font-family: monospace;
    font-size: 12px;
}
.km-auth-input:focus { outline: none; border-color: #3b82f6; }
.km-auth-input::placeholder { color: #374151; }
.km-auth-input.connected { border-color: #166534; }
.km-btn {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #c8d0e0;
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    padding: 4px 10px;
    white-space: nowrap;
}
.km-btn:hover { border-color: #3b82f6; color: #60a5fa; }
.km-btn.primary { background: #1e3a6e; border-color: #3b82f6; color: #93c5fd; }
.km-btn.primary:hover { background: #2a4d8e; }
.km-btn.danger  { border-color: #7f1d1d; color: #f87171; }
.km-btn.danger:hover  { background: #3d0a0a; }
.km-btn.small   { padding: 2px 6px; font-size: 10px; }

/* ── Toolbar ──────────────────────────────────────────── */
.km-toolbar {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    align-items: center;
}
.km-toolbar-right { margin-left: auto; display: flex; gap: 6px; }
.km-status { color: #374151; font-size: 10px; }
.km-status.ok  { color: #4ade80; }
.km-status.err { color: #f87171; }

/* ── Scroll table ─────────────────────────────────────── */
.km-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
}
.km-scroll::-webkit-scrollbar { width: 6px; }
.km-scroll::-webkit-scrollbar-track { background: #0d0d1a; }
.km-scroll::-webkit-scrollbar-thumb { background: #1e2035; border-radius: 3px; }

table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { position: sticky; top: 0; background: #0d0d1a; z-index: 1; }
th {
    padding: 5px 8px;
    border-bottom: 1px solid #1e2035;
    color: #374151;
    font-size: 10px;
    text-align: left;
    white-space: nowrap;
}
td {
    padding: 5px 8px;
    border-bottom: 1px solid #10101f;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
}
col.col-name    { width: 26%; }
col.col-limit   { width: 14%; }
col.col-used    { width: 13%; }
col.col-remain  { width: 13%; }
col.col-reset   { width: 10%; }
col.col-status  { width: 10%; }
col.col-actions { width: 14%; }

tr.km-row:hover { background: #12122a; }
tr.km-row.disabled-row td { opacity: 0.4; }
tr.km-row.disabled-row td:last-child { opacity: 1; }

.key-name { color: #c8d0e0; }
.key-hash  { color: #374151; font-size: 9px; display: block; }
.badge-disabled { color: #ef4444; }
.badge-ok       { color: #4ade80; }
.val-unlimited  { color: #1e3a6e; }

/* inline usage bar */
.km-mini-bar {
    height: 3px;
    background: #1e2035;
    border-radius: 2px;
    margin-top: 3px;
    overflow: hidden;
}
.km-mini-fill {
    height: 100%;
    border-radius: 2px;
    background: #3b82f6;
}
.km-mini-fill.warn { background: #f59e0b; }
.km-mini-fill.crit { background: #ef4444; }

/* ── Create form ──────────────────────────────────────── */
.km-create {
    border-top: 1px solid #1e2035;
    padding: 8px;
    flex-shrink: 0;
    display: none;
}
.km-create.open { display: block; }
.km-create-title {
    color: #64748b;
    font-size: 10px;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
}
.km-form-row {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
}
.km-form-input {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #c8d0e0;
    padding: 4px 8px;
    font-family: monospace;
    font-size: 11px;
    min-width: 0;
}
.km-form-input:focus { outline: none; border-color: #3b82f6; }
.km-form-input::placeholder { color: #374151; }
.km-form-name   { flex: 2; }
.km-form-limit  { width: 80px; }
.km-form-select {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 4px;
    color: #64748b;
    padding: 4px 6px;
    font-family: monospace;
    font-size: 11px;
}

/* ── Edit row ─────────────────────────────────────────── */
.km-edit-row td {
    background: #12122a;
    border-bottom: 2px solid #3b82f6;
}
.km-edit-form {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    padding: 2px 0;
}

/* ── States ───────────────────────────────────────────── */
.km-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e2035;
    font-size: 11px;
    padding: 30px;
    text-align: center;
}
.km-spinner {
    display: inline-block;
    width: 10px; height: 10px;
    border: 1px solid #374151;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin-right: 6px;
    vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── New-key reveal ───────────────────────────────────── */
.km-new-key-banner {
    background: #0a1228;
    border: 1px solid #3b82f6;
    border-radius: 4px;
    padding: 8px 10px;
    margin: 8px;
    font-size: 11px;
    flex-shrink: 0;
}
.km-new-key-title { color: #60a5fa; margin-bottom: 4px; font-size: 10px; }
.km-new-key-value {
    color: #c8d0e0;
    word-break: break-all;
    font-size: 11px;
    font-family: monospace;
    background: #12122a;
    padding: 4px 6px;
    border-radius: 3px;
    display: block;
    margin-bottom: 6px;
}
.km-new-key-warn { color: #374151; font-size: 10px; }
.km-new-key-warn em { color: #f87171; font-style: normal; }
`;

export class SgOpenrouterKeyManager extends HTMLElement {

    constructor() {
        super();
        this._mgmtKey    = '';
        this._keys       = [];
        this._editHash   = null;   // hash of row currently being edited
        this._newKeyValue= null;   // newly-created key string (shown once)
        this._createOpen = false;
        this._loading    = false;
        this._status     = { text: '', type: '' };
        this._shadow     = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._mgmtKey = localStorage.getItem(STORAGE_KEY) || '';
        this._renderShell();
        if (this._mgmtKey) this._fetch();
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /** Re-fetch the key list. */
    refresh() {
        if (this._mgmtKey) this._fetch();
    }

    // ── Fetch ──────────────────────────────────────────────────────────────

    async _fetch() {
        this._setStatus('Loading…', '');
        this._loading = true;
        this._renderTable();
        try {
            const res = await fetch(BASE_URL, {
                headers: { Authorization: `Bearer ${this._mgmtKey}` },
            });
            if (res.status === 403) throw new Error('Invalid management key (403)');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._keys = json.data ?? [];
            this._setStatus(`${this._keys.length} keys`, 'ok');
        } catch (err) {
            console.warn('[sg-openrouter-key-manager] list error:', err.message);
            this._setStatus(err.message, 'err');
            this._keys = [];
        } finally {
            this._loading = false;
            this._renderTable();
        }
    }

    async _createKey(name, limit, limitReset) {
        const body = { name };
        if (limit !== null) body.limit = limit;
        if (limitReset) body.limit_reset = limitReset;

        try {
            const res = await fetch(BASE_URL, {
                method:  'POST',
                headers: {
                    Authorization:  `Bearer ${this._mgmtKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            this._newKeyValue = json.key ?? null;
            this._createOpen  = false;
            await this._fetch();
            if (this._newKeyValue) this._renderNewKeyBanner();
        } catch (err) {
            console.warn('[sg-openrouter-key-manager] create error:', err.message);
            this._setStatus(`Create failed: ${err.message}`, 'err');
        }
    }

    async _patchKey(hash, fields) {
        try {
            const res = await fetch(`${BASE_URL}/${hash}`, {
                method:  'PATCH',
                headers: {
                    Authorization:  `Bearer ${this._mgmtKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(fields),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this._editHash = null;
            await this._fetch();
        } catch (err) {
            console.warn('[sg-openrouter-key-manager] patch error:', err.message);
            this._setStatus(`Update failed: ${err.message}`, 'err');
        }
    }

    async _deleteKey(hash, name) {
        if (!confirm(`Delete key "${name}"?\nThis cannot be undone.`)) return;
        try {
            const res = await fetch(`${BASE_URL}/${hash}`, {
                method:  'DELETE',
                headers: { Authorization: `Bearer ${this._mgmtKey}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await this._fetch();
        } catch (err) {
            console.warn('[sg-openrouter-key-manager] delete error:', err.message);
            this._setStatus(`Delete failed: ${err.message}`, 'err');
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _renderShell() {
        this._shadow.innerHTML = `<style>${CSS}</style>
<div class="km-auth">
    <input class="km-auth-input${this._mgmtKey ? ' connected' : ''}" type="password"
        placeholder="sk-or-v1-mgmt-… (management key)"
        value="${_escape(this._mgmtKey)}" autocomplete="off" spellcheck="false">
    <button class="km-btn primary" id="km-connect-btn">Connect</button>
</div>
<div class="km-toolbar">
    <span class="km-status ${this._status.type}" id="km-status">${_escape(this._status.text)}</span>
    <div class="km-toolbar-right">
        <button class="km-btn small" id="km-create-toggle">+ New Key</button>
        <button class="km-btn small" id="km-refresh-btn">↺</button>
    </div>
</div>
<div id="km-new-key-slot"></div>
<div class="km-scroll" id="km-scroll">
    <div class="km-state">Enter a management key to begin</div>
</div>
<div class="km-create${this._createOpen ? ' open' : ''}" id="km-create-panel">
    <div class="km-create-title">NEW KEY</div>
    <div class="km-form-row">
        <input class="km-form-input km-form-name" id="km-new-name" placeholder="Key name" spellcheck="false">
        <input class="km-form-input km-form-limit" id="km-new-limit" type="number" min="0" step="0.01" placeholder="Limit $">
        <select class="km-form-select" id="km-new-reset">
            <option value="">no reset</option>
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
        </select>
        <button class="km-btn primary small" id="km-create-btn">Create</button>
        <button class="km-btn small" id="km-create-cancel">Cancel</button>
    </div>
</div>`;

        // Auth
        const authInput = this._shadow.querySelector('.km-auth-input');
        const connectBtn = this._shadow.querySelector('#km-connect-btn');
        connectBtn.addEventListener('click', () => {
            const key = authInput.value.trim();
            this._mgmtKey = key;
            if (key) localStorage.setItem(STORAGE_KEY, key);
            else localStorage.removeItem(STORAGE_KEY);
            authInput.classList.toggle('connected', !!key);
            if (key) this._fetch();
        });
        authInput.addEventListener('keydown', e => { if (e.key === 'Enter') connectBtn.click(); });

        // Toolbar
        this._shadow.querySelector('#km-refresh-btn').addEventListener('click', () => this.refresh());
        this._shadow.querySelector('#km-create-toggle').addEventListener('click', () => {
            this._createOpen = !this._createOpen;
            this._shadow.querySelector('#km-create-panel').classList.toggle('open', this._createOpen);
        });

        // Create form
        this._shadow.querySelector('#km-create-cancel').addEventListener('click', () => {
            this._createOpen = false;
            this._shadow.querySelector('#km-create-panel').classList.remove('open');
        });
        this._shadow.querySelector('#km-create-btn').addEventListener('click', () => {
            const name  = this._shadow.querySelector('#km-new-name').value.trim();
            const limStr= this._shadow.querySelector('#km-new-limit').value.trim();
            const reset = this._shadow.querySelector('#km-new-reset').value;
            if (!name) { this._setStatus('Name is required', 'err'); return; }
            const limit = limStr ? parseFloat(limStr) : null;
            if (limStr && isNaN(limit)) { this._setStatus('Invalid limit', 'err'); return; }
            this._createKey(name, limit, reset || null);
        });

        if (this._mgmtKey) this._renderTable();
    }

    _renderTable() {
        const scroll = this._shadow.querySelector('#km-scroll');
        if (!scroll) return;

        if (this._loading) {
            scroll.innerHTML = '<div class="km-state"><span class="km-spinner"></span> Loading…</div>';
            return;
        }
        if (!this._mgmtKey) {
            scroll.innerHTML = '<div class="km-state">Enter a management key to begin</div>';
            return;
        }
        if (!this._keys.length) {
            scroll.innerHTML = '<div class="km-state">No provisioned keys</div>';
            return;
        }

        scroll.innerHTML = `
<table>
    <colgroup>
        <col class="col-name">
        <col class="col-limit">
        <col class="col-used">
        <col class="col-remain">
        <col class="col-reset">
        <col class="col-status">
        <col class="col-actions">
    </colgroup>
    <thead>
        <tr>
            <th>Name</th>
            <th>Limit</th>
            <th>Used</th>
            <th>Remaining</th>
            <th>Reset</th>
            <th>Status</th>
            <th></th>
        </tr>
    </thead>
    <tbody id="km-tbody"></tbody>
</table>`;

        const tbody = scroll.querySelector('#km-tbody');
        for (const key of this._keys) {
            const isEditing = key.hash === this._editHash;
            tbody.insertAdjacentHTML('beforeend',
                isEditing ? this._editRowHtml(key) : this._keyRowHtml(key));
        }

        // Bind row actions
        tbody.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                const action = btn.dataset.action;
                const hash   = btn.dataset.hash;
                const name   = btn.dataset.name ?? '';
                if      (action === 'edit')   this._startEdit(hash);
                else if (action === 'cancel') { this._editHash = null; this._renderTable(); }
                else if (action === 'save')   this._saveEdit(hash);
                else if (action === 'toggle') this._toggleDisabled(hash, btn.dataset.disabled === 'true');
                else if (action === 'delete') this._deleteKey(hash, name);
            });
        });
    }

    _keyRowHtml(key) {
        const {
            hash, name = '', label = '', disabled = false,
            limit = null, limit_remaining = null, usage = 0,
            limit_reset = null, usage_monthly = 0,
        } = key;

        const remaining = limit_remaining !== null ? limit_remaining
            : (limit !== null ? limit - usage : null);
        const pct = limit ? Math.min(1, usage / limit) : null;
        const barState = pct === null ? '' : pct >= 0.95 ? 'crit' : pct >= 0.80 ? 'warn' : '';
        const barWidth = pct !== null ? `${(pct * 100).toFixed(1)}%` : '0%';

        return `
<tr class="km-row${disabled ? ' disabled-row' : ''}" data-hash="${_escape(hash)}">
    <td>
        <span class="key-name">${_escape(name || label || 'Unnamed')}</span>
        <span class="key-hash">${_escape(hash.slice(0, 12))}…</span>
    </td>
    <td>${limit !== null ? `$${_fmtUsd(limit)}` : '<span class="val-unlimited">∞</span>'}</td>
    <td>$${_fmtUsd(usage)}</td>
    <td>
        ${remaining !== null ? `$${_fmtUsd(remaining)}` : '<span class="val-unlimited">∞</span>'}
        ${pct !== null ? `<div class="km-mini-bar"><div class="km-mini-fill ${barState}" style="width:${barWidth}"></div></div>` : ''}
    </td>
    <td>${limit_reset ?? '—'}</td>
    <td><span class="${disabled ? 'badge-disabled' : 'badge-ok'}">${disabled ? 'off' : 'on'}</span></td>
    <td>
        <button class="km-btn small" data-action="edit"   data-hash="${_escape(hash)}" title="Edit">✎</button>
        <button class="km-btn small" data-action="toggle" data-hash="${_escape(hash)}" data-disabled="${disabled}" title="${disabled ? 'Enable' : 'Disable'}">${disabled ? '▶' : '⏸'}</button>
        <button class="km-btn small danger" data-action="delete" data-hash="${_escape(hash)}" data-name="${_escape(name)}" title="Delete">✕</button>
    </td>
</tr>`;
    }

    _editRowHtml(key) {
        const { hash, name = '', limit = null, limit_reset = null } = key;
        return `
<tr class="km-edit-row" data-hash="${_escape(hash)}">
    <td colspan="7">
        <div class="km-edit-form">
            <input class="km-form-input km-form-name" id="km-edit-name-${_escape(hash)}" value="${_escape(name)}" placeholder="Name" spellcheck="false">
            <input class="km-form-input km-form-limit" id="km-edit-limit-${_escape(hash)}" type="number" min="0" step="0.01" value="${limit !== null ? limit : ''}" placeholder="Limit $">
            <select class="km-form-select" id="km-edit-reset-${_escape(hash)}">
                <option value=""${!limit_reset ? ' selected' : ''}>no reset</option>
                <option value="daily"${limit_reset === 'daily' ? ' selected' : ''}>daily</option>
                <option value="weekly"${limit_reset === 'weekly' ? ' selected' : ''}>weekly</option>
                <option value="monthly"${limit_reset === 'monthly' ? ' selected' : ''}>monthly</option>
            </select>
            <button class="km-btn primary small" data-action="save"   data-hash="${_escape(hash)}">Save</button>
            <button class="km-btn small"         data-action="cancel" data-hash="${_escape(hash)}">Cancel</button>
        </div>
    </td>
</tr>`;
    }

    _renderNewKeyBanner() {
        const slot = this._shadow.querySelector('#km-new-key-slot');
        if (!slot || !this._newKeyValue) return;
        slot.innerHTML = `
<div class="km-new-key-banner">
    <div class="km-new-key-title">NEW KEY — copy now, shown once only</div>
    <code class="km-new-key-value">${_escape(this._newKeyValue)}</code>
    <div class="km-new-key-warn"><em>This key will NOT be shown again.</em> Save it now.</div>
    <button class="km-btn small" id="km-copy-new-key">Copy</button>
    <button class="km-btn small" style="margin-left:4px" id="km-dismiss-banner">Dismiss</button>
</div>`;
        slot.querySelector('#km-copy-new-key').addEventListener('click', () => {
            navigator.clipboard.writeText(this._newKeyValue).catch(() => {});
        });
        slot.querySelector('#km-dismiss-banner').addEventListener('click', () => {
            this._newKeyValue = null;
            slot.innerHTML = '';
        });
    }

    // ── Inline edit helpers ────────────────────────────────────────────────

    _startEdit(hash) {
        this._editHash = hash;
        this._renderTable();
    }

    _saveEdit(hash) {
        const nameEl  = this._shadow.querySelector(`#km-edit-name-${hash}`);
        const limitEl = this._shadow.querySelector(`#km-edit-limit-${hash}`);
        const resetEl = this._shadow.querySelector(`#km-edit-reset-${hash}`);
        if (!nameEl) return;

        const fields = {};
        const newName = nameEl.value.trim();
        if (newName) fields.name = newName;

        const limStr = limitEl.value.trim();
        if (limStr === '') fields.limit = null;
        else {
            const n = parseFloat(limStr);
            if (!isNaN(n)) fields.limit = n;
        }

        fields.limit_reset = resetEl.value || null;

        this._patchKey(hash, fields);
    }

    _toggleDisabled(hash, currentlyDisabled) {
        this._patchKey(hash, { disabled: !currentlyDisabled });
    }

    // ── Status ─────────────────────────────────────────────────────────────

    _setStatus(text, type) {
        this._status = { text, type };
        const el = this._shadow.querySelector('#km-status');
        if (el) { el.textContent = text; el.className = `km-status ${type}`; }
    }
}

function _fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    const s = n.toFixed(4);
    return s.replace(/(\.\d{2})\d*0+$/, '$1').replace(/(\.\d{2,})0+$/, '$1');
}

function _escape(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('sg-openrouter-key-manager', SgOpenrouterKeyManager);
window.SgOpenrouterKeyManager = SgOpenrouterKeyManager;
