/**
 * Send / Receive — reference tool orchestrator.
 *
 * Layout (sg-layout row, 2 columns):
 *   Left  45%: [📤 Send] [📋 History] tabs
 *   Right 55%: [📥 Receive] tab
 *
 * JS API (window.__tool):
 *   sendFile(file, opts?)    → Promise<{ token, transferId, url }>
 *   sendText(text, opts?)    → Promise<{ token, transferId, url }>
 *   sendFolder(files, opts?) → Promise<{ token, transferId, url }>
 *   receiveFile(token)       → Promise<{ filename, blob, objectUrl }>
 *   receiveText(token)       → Promise<string>
 *   receiveFolder(token)     → Promise<{ files: [{filename, blob}] }>
 *   getHistory()             → Array
 *   clearHistory()           → void
 *   getState()               → object
 *   setToken(token)          → void
 *   setAccessToken(token)    → void
 *
 * @version 0.1.49
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SgToolApi }  from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGA_TOOL }   from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api-events.js';
import {
    isFriendlyToken,
    deriveTransferId,
    deriveKey,
} from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js';
import { uploadFile } from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-upload.js';

import '/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js';
import '/components/send-receive/v0/v0.1/v0.1.0/sg-send-receive.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';
import '/components/site-header/v1/v1.0/v1.0.1/sg-site-header.js';

import { buildDevPanel } from './dev-panel.js';

// ── Environment ───────────────────────────────────────────────────────────────

function detectSendUrl() {
    const host = location.hostname;
    if (host.startsWith('dev.'))  return 'https://dev.send.sgraph.ai';
    if (host.startsWith('main.')) return 'https://main.send.sgraph.ai';
    if (host === 'localhost' || host === '127.0.0.1') return 'https://dev.send.sgraph.ai';
    return 'https://send.sgraph.ai';
}

const SEND_URL = detectSendUrl();

// ── SGMETA helpers (receive path) ─────────────────────────────────────────────

const SGMETA_MAGIC = new Uint8Array([0x53, 0x47, 0x4D, 0x45, 0x54, 0x41]);

async function _decryptBytes(ciphertext, key) {
    const b = new Uint8Array(ciphertext);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
    return new Uint8Array(plain);
}

function _parseSgmeta(plaintext) {
    for (let i = 0; i < 6; i++) {
        if (plaintext[i] !== SGMETA_MAGIC[i]) throw new Error('Invalid SGMETA — wrong token?');
    }
    const view    = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
    const metaLen = view.getUint32(6, false);
    const meta    = JSON.parse(new TextDecoder().decode(plaintext.slice(10, 10 + metaLen)));
    return { filename: meta.filename ?? 'received-file', fileBytes: plaintext.slice(10 + metaLen) };
}

// ── Token history (localStorage) ─────────────────────────────────────────────

const HISTORY_KEY = 'sg-send-receive-history';
const HISTORY_MAX = 50;

function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function _addHistory(entry) {
    const items = loadHistory();
    items.unshift({ ...entry, timestamp: Date.now() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
}

// ── Access token ──────────────────────────────────────────────────────────────

let _accessToken = localStorage.getItem('sgraph-send-token') || '';

function _setAccessToken(token) {
    _accessToken = token;
    localStorage.setItem('sgraph-send-token', token);
    // Update any sg-send-drop instances
    document.querySelectorAll('sg-send-drop').forEach(el => el.setAccessToken?.(token));
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const layoutWrap = document.getElementById('layout-wrap');

// ── Main flex-column wrapper ──────────────────────────────────────────────────
layoutWrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

const toolArea = document.createElement('div');
toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
layoutWrap.appendChild(toolArea);

buildDevPanel(layoutWrap);

// ── sg-layout ─────────────────────────────────────────────────────────────────

const layout = document.createElement('sg-layout');
layout.style.cssText = 'width:100%;height:100%;display:block;';
toolArea.appendChild(layout);

await new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));

layout.setLayout({
    type: 'row', id: 'main', sizes: [0.45, 0.55],
    children: [
        {
            type: 'stack', id: 's-left', activeTab: 0,
            tabs: [
                { type: 'tab', id: 't-send',    title: '📤 Send',    tag: 'div', locked: true, closable: false },
                { type: 'tab', id: 't-history', title: '📋 History', tag: 'div', locked: true, closable: false },
            ],
        },
        {
            type: 'stack', id: 's-right', activeTab: 0,
            tabs: [
                { type: 'tab', id: 't-receive', title: '📥 Receive', tag: 'div', locked: true, closable: false },
            ],
        },
    ],
});

await new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));

const sendPanel    = layout.getPanelElement('t-send');
const historyPanel = layout.getPanelElement('t-history');
const receivePanel = layout.getPanelElement('t-receive');

// ── Shared panel styles ───────────────────────────────────────────────────────

[sendPanel, historyPanel, receivePanel].forEach(p => {
    p.style.cssText = 'height:100%;overflow-y:auto;background:#0a0a18;box-sizing:border-box;';
});

// ── SEND PANEL ────────────────────────────────────────────────────────────────

sendPanel.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px;font-family:system-ui,sans-serif;">

        <!-- Access token row -->
        <div style="display:flex;flex-direction:column;gap:6px;">
            <label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">
                SG/Send Access Token
            </label>
            <div style="display:flex;gap:6px;">
                <input id="sr-access-token" type="password"
                       placeholder="Your access token"
                       value=""
                       style="flex:1;background:#111120;border:1px solid #1a1a3a;border-radius:6px;padding:6px 10px;color:#e2e8f0;font-family:'Courier New',monospace;font-size:12px;">
                <button id="sr-save-token"
                        style="padding:6px 12px;background:#1a1a3a;border:1px solid #2d3748;border-radius:6px;color:#a0aec0;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:system-ui,sans-serif;">
                    Save
                </button>
            </div>
            <div id="sr-token-status" style="font-size:11px;color:#4a5568;"></div>
        </div>

        <!-- sg-send-drop component -->
        <sg-send-drop
            id="sr-send-drop"
            label="📤 Drop a file here to share"
            style="display:block;">
        </sg-send-drop>

        <!-- File picker fallback -->
        <div style="text-align:center;">
            <button id="sr-pick-file"
                    style="padding:6px 16px;background:#111120;border:1px solid #1a1a3a;border-radius:16px;color:#a0aec0;font-size:12px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">
                Choose File…
            </button>
            <input id="sr-file-input" type="file" style="display:none;">
        </div>

        <!-- Target URL info -->
        <div style="font-size:11px;color:#2d3748;text-align:center;">
            Sending to <span style="color:#4a5568;" id="sr-send-url-display"></span>
        </div>
    </div>
`;

// Wire up send panel
{
    const tokenInput  = sendPanel.querySelector('#sr-access-token');
    const saveBtn     = sendPanel.querySelector('#sr-save-token');
    const statusEl    = sendPanel.querySelector('#sr-token-status');
    const sendDrop    = sendPanel.querySelector('#sr-send-drop');
    const pickBtn     = sendPanel.querySelector('#sr-pick-file');
    const fileInput   = sendPanel.querySelector('#sr-file-input');
    const urlDisplay  = sendPanel.querySelector('#sr-send-url-display');

    if (urlDisplay) urlDisplay.textContent = SEND_URL.replace('https://', '');

    // Restore saved token
    if (_accessToken) {
        tokenInput.value = _accessToken;
        statusEl.textContent = 'Token loaded from storage';
        statusEl.style.color = '#48bb78';
        sendDrop.setAccessToken(_accessToken);
    }

    saveBtn.addEventListener('click', () => {
        const t = tokenInput.value.trim();
        if (!t) return;
        _setAccessToken(t);
        saveBtn.textContent   = '✓ Saved';
        statusEl.textContent  = 'Token saved';
        statusEl.style.color  = '#48bb78';
        setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
    });

    tokenInput.addEventListener('change', () => {
        sendDrop.setAccessToken?.(tokenInput.value.trim());
    });

    // File picker
    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
            sendDrop.setAccessToken?.(_accessToken || tokenInput.value.trim());
            sendDrop.offerFile(file, file.name);
        }
    });

    // Capture sg-send-complete → add to history, dispatch tool event
    sendPanel.addEventListener('sg-send-complete', (e) => {
        const { token, transferId, url } = e.detail;
        _addHistory({ type: 'sent', token, transferId, url, filename: sendDrop._pendingFilename || '' });
        window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_COMPLETE, {
            detail: { instanceId: 'sg-send-receive:root', token, transferId, url },
        }));
        _renderHistory();
    });
}

// ── RECEIVE PANEL ─────────────────────────────────────────────────────────────

receivePanel.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px;font-family:system-ui,sans-serif;height:100%;">
        <div style="font-size:13px;color:#64748b;line-height:1.5;">
            Paste a token from SG/Send to receive and decrypt the file.
        </div>
        <sg-send-receive id="sr-receive" style="display:block;"></sg-send-receive>
    </div>
`;

{
    const receiveEl = receivePanel.querySelector('#sr-receive');

    receiveEl.addEventListener('sg-receive-complete', (e) => {
        const { filename, token, transferId } = e.detail;
        _addHistory({ type: 'received', token, transferId, filename });
        _renderHistory();
    });
}

// ── HISTORY PANEL ─────────────────────────────────────────────────────────────

function _renderHistory() {
    const items = loadHistory();

    if (!historyPanel) return;

    if (items.length === 0) {
        historyPanel.innerHTML = `
            <div style="padding:40px;text-align:center;color:#2d3748;font-family:system-ui,sans-serif;font-size:13px;">
                No transfer history yet.<br>Send or receive a file to see tokens here.
            </div>
        `;
        return;
    }

    const rows = items.map((item, i) => {
        const date = new Date(item.timestamp).toLocaleString();
        const typeColor = item.type === 'sent' ? '#4ecdc4' : '#a78bfa';
        const typeLabel = item.type === 'sent' ? '📤 Sent' : '📥 Received';
        return `
            <div style="padding:10px 14px;border-bottom:1px solid #0d0d1a;display:flex;flex-direction:column;gap:4px;background:${i % 2 === 0 ? '#0a0a18' : '#0d0d1a'};">
                <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
                    <span style="font-size:11px;font-weight:700;color:${typeColor};">${typeLabel}</span>
                    <span style="font-size:10px;color:#2d3748;">${date}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <code style="flex:1;font-size:12px;font-family:'Courier New',monospace;color:#e2e8f0;background:#111120;padding:3px 7px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_escHtml(item.token)}</code>
                    <button data-copy="${_escAttr(item.token)}"
                            style="flex-shrink:0;padding:3px 8px;background:#1a1a3a;border:1px solid #2d3748;border-radius:10px;color:#a0aec0;font-size:10px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">
                        Copy
                    </button>
                    ${item.type === 'received' ? '' : `
                    <button data-fill-receive="${_escAttr(item.token)}"
                            style="flex-shrink:0;padding:3px 8px;background:#1a1a3a;border:1px solid #2d3748;border-radius:10px;color:#a0aec0;font-size:10px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">
                        Re-receive
                    </button>`}
                </div>
                ${item.filename ? `<div style="font-size:10px;color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escHtml(item.filename)}</div>` : ''}
            </div>
        `;
    }).join('');

    historyPanel.innerHTML = `
        <div style="font-family:system-ui,sans-serif;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #0d0d1a;">
                <span style="font-size:11px;font-weight:600;color:#64748b;">${items.length} transfer${items.length !== 1 ? 's' : ''}</span>
                <button id="sr-clear-history"
                        style="padding:3px 10px;background:#1a1a3a;border:1px solid #2d3748;border-radius:10px;color:#ef5350;font-size:10px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">
                    Clear All
                </button>
            </div>
            ${rows}
        </div>
    `;

    historyPanel.querySelector('#sr-clear-history')?.addEventListener('click', () => {
        localStorage.removeItem(HISTORY_KEY);
        _renderHistory();
    });

    historyPanel.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(btn.dataset.copy).catch(() => {});
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
    });

    historyPanel.querySelectorAll('[data-fill-receive]').forEach(btn => {
        btn.addEventListener('click', () => {
            const receiveEl = receivePanel.querySelector('sg-send-receive');
            receiveEl?.setToken(btn.dataset.fillReceive);
            // Switch to receive tab
            layout.activateTab?.('t-receive');
        });
    });
}

_renderHistory();

// ── SgToolApi ─────────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:     'sg-send-receive',
    version:  { api: '0.1.0', ui: '0.1.49' },
    manifest: './manifest.json',
    skills:   { human: './SKILL-human.md', browser: './SKILL-browser.md', api: './SKILL-api.md' },
});

// ── sendFile ──────────────────────────────────────────────────────────────────

api.register('sendFile', async (fileOrBlob, opts = {}) => {
    const accessToken = opts.accessToken ?? _accessToken;
    if (!accessToken) throw new Error('Access token required. Call setAccessToken() first.');

    const blob     = fileOrBlob instanceof File ? fileOrBlob : fileOrBlob;
    const filename = opts.filename ?? (fileOrBlob instanceof File ? fileOrBlob.name : `file-${Date.now()}`);

    const result = await uploadFile(blob, filename, opts.sendUrl ?? SEND_URL, accessToken, opts.onProgress);
    _addHistory({ type: 'sent', token: result.token, transferId: result.transferId, url: result.url, filename });
    _renderHistory();
    return result;
}, {
    async: true,
    sanitiseParams: p => ({ ...p, accessToken: p?.accessToken ? '••••' : undefined }),
    events: [SGA_TOOL.GENERATION_STARTED, SGA_TOOL.GENERATION_COMPLETE, SGA_TOOL.GENERATION_ERROR],
});

// ── sendText ──────────────────────────────────────────────────────────────────

api.register('sendText', async (text, opts = {}) => {
    const filename = opts.filename ?? 'message.txt';
    const blob     = new Blob([text], { type: 'text/plain' });
    return api._callRegistered('sendFile', blob, { ...opts, filename });
}, { async: true, sanitiseParams: p => ({ ...p, accessToken: p?.accessToken ? '••••' : undefined }) });

// ── sendFolder ────────────────────────────────────────────────────────────────

api.register('sendFolder', async (files, opts = {}) => {
    // files: Array<File | { blob, filename }>
    const JSZip  = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    const zip    = new JSZip();
    for (const f of files) {
        if (f instanceof File) {
            zip.file(f.name, f);
        } else {
            zip.file(f.filename, f.blob);
        }
    }
    const blob     = await zip.generateAsync({ type: 'blob' });
    const filename = opts.filename ?? `folder-${Date.now()}.zip`;
    return api._callRegistered('sendFile', blob, { ...opts, filename });
}, { async: true, sanitiseParams: p => ({ ...p, accessToken: p?.accessToken ? '••••' : undefined }) });

// ── receiveFile ───────────────────────────────────────────────────────────────

api.register('receiveFile', async (token) => {
    if (!isFriendlyToken(token)) throw new Error('Invalid token format. Expected word-word-NNNN');

    const [transferId, key] = await Promise.all([deriveTransferId(token), deriveKey(token)]);
    const res = await fetch(`${SEND_URL}/api/transfers/download/${transferId}`);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

    const ciphertext = await res.arrayBuffer();
    const plaintext  = await _decryptBytes(ciphertext, key);
    const { filename, fileBytes } = _parseSgmeta(plaintext);

    const blob      = new Blob([fileBytes]);
    const objectUrl = URL.createObjectURL(blob);

    _addHistory({ type: 'received', token, transferId, filename });
    _renderHistory();

    return { filename, blob, objectUrl, token, transferId };
}, { async: true });

// ── receiveText ───────────────────────────────────────────────────────────────

api.register('receiveText', async (token) => {
    const result = await api._callRegistered('receiveFile', token);
    const text   = await result.blob.text();
    URL.revokeObjectURL(result.objectUrl);
    return text;
}, { async: true });

// ── receiveFolder ─────────────────────────────────────────────────────────────

api.register('receiveFolder', async (token) => {
    const result  = await api._callRegistered('receiveFile', token);
    const JSZip   = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    const zip     = await JSZip.loadAsync(result.blob);
    const files   = [];
    for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const blob = await entry.async('blob');
        files.push({ filename: name, blob });
    }
    URL.revokeObjectURL(result.objectUrl);
    return { files, token, transferId: result.transferId };
}, { async: true });

// ── getHistory / clearHistory ─────────────────────────────────────────────────

api.register('getHistory', () => loadHistory(), { async: false });

api.register('clearHistory', () => {
    localStorage.removeItem(HISTORY_KEY);
    _renderHistory();
}, { async: false });

// ── getState ──────────────────────────────────────────────────────────────────

api.register('getState', () => ({
    hasAccessToken: !!_accessToken,
    sendUrl:        SEND_URL,
    history:        loadHistory(),
}), { async: false });

// ── setToken ──────────────────────────────────────────────────────────────────

api.register('setToken', (token) => {
    const receiveEl = receivePanel.querySelector('sg-send-receive');
    receiveEl?.setToken(token);
}, { async: false });

// ── setAccessToken ────────────────────────────────────────────────────────────

api.register('setAccessToken', (token) => {
    _setAccessToken(token);
    const tokenInput = sendPanel.querySelector('#sr-access-token');
    if (tokenInput) tokenInput.value = token;
}, {
    async: false,
    sanitiseParams: () => ({ token: '••••' }),
});

api.activate();

// ── Helpers ───────────────────────────────────────────────────────────────────

function _escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _escAttr(s) {
    return String(s).replace(/"/g,'&quot;');
}
