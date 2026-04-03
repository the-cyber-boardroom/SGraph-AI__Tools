/**
 * sg-llm-bundle-viewer — Raw bundle data inspector.
 *
 * Displays the full content of a bundle (config, chat turns, reality blocks,
 * response metrics, raw JSON). Useful for debugging bundle save/restore issues.
 *
 * Listens for `llm:bundle-inspect-requested { bundleId }` on the bus, then
 * fetches the bundle from the sibling sg-llm-bundle and renders it.
 * Also updates when `llm:bundle-loaded` fires (auto-shows the active bundle).
 *
 * Consumes (on [data-llm-bus] ancestor):
 *   llm:bundle-inspect-requested  — { bundleId } → load and display bundle
 *   llm:bundle-loaded             — { bundle }   → optionally follow active bundle
 *
 * Attributes:
 *   follow-active  — if present, automatically shows whichever bundle is loaded
 *
 * @module sg-llm-bundle-viewer
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const INSPECT_EVENT = 'llm:bundle-inspect-requested';

const CSS = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
* { box-sizing: border-box; }
.bv-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: monospace;
    background: #0d0d1a;
    color: #e2e8f0;
    font-size: 12px;
    overflow: hidden;
}
.bv-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #2a2a4a;
    font-size: 12px;
}
/* ── Tab bar ─────────────────────────────────── */
.bv-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    background: #0f0f20;
}
.bv-tab {
    font-family: monospace;
    font-size: 11px;
    background: none;
    border: 1px solid transparent;
    border-bottom: none;
    color: #475569;
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 4px 4px 0 0;
    transition: color 0.12s;
}
.bv-tab:hover { color: #94a3b8; }
.bv-tab.active {
    background: #0d0d1a;
    border-color: #1e2035;
    color: #e2e8f0;
}
/* ── Tab content ─────────────────────────────── */
.bv-content {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
}
.bv-panel { display: none; }
.bv-panel.active { display: block; }
/* ── Overview table ──────────────────────────── */
.bv-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
}
.bv-table td {
    padding: 3px 6px;
    vertical-align: top;
    border-bottom: 1px solid #12122a;
}
.bv-table td:first-child {
    color: #475569;
    white-space: nowrap;
    width: 120px;
    font-size: 11px;
}
.bv-table td:last-child { color: #94a3b8; word-break: break-all; }
/* ── Chat turns ──────────────────────────────── */
.bv-turn {
    margin-bottom: 10px;
    border-left: 2px solid #1e2035;
    padding-left: 8px;
}
.bv-turn.user   { border-color: #3d5a99; }
.bv-turn.assistant { border-color: #166534; }
.bv-turn-role {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 3px;
}
.bv-turn.user   .bv-turn-role { color: #7c9ef8; }
.bv-turn.assistant .bv-turn-role { color: #4ade80; }
.bv-turn-text {
    color: #94a3b8;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 120px;
    overflow-y: auto;
}
.bv-att-badge {
    display: inline-block;
    background: #12122a;
    border: 1px solid #2d3060;
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 10px;
    color: #64748b;
    margin: 2px 2px 0 0;
}
/* ── Reality blocks ──────────────────────────── */
.bv-block {
    margin-bottom: 8px;
    border: 1px solid #1e2035;
    border-radius: 4px;
    overflow: hidden;
}
.bv-block-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: #0f1020;
    font-size: 10px;
    color: #64748b;
}
.bv-block-type {
    background: #1e2035;
    border-radius: 3px;
    padding: 1px 5px;
    color: #94a3b8;
}
.bv-block-body {
    padding: 6px 8px;
    color: #64748b;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 100px;
    overflow-y: auto;
}
/* ── JSON panel ──────────────────────────────── */
.bv-json-actions {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
}
.bv-json-btn {
    font-family: monospace;
    font-size: 10px;
    background: none;
    border: 1px solid #1e2035;
    color: #64748b;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    transition: color 0.12s;
}
.bv-json-btn:hover { color: #e2e8f0; border-color: #374151; }
.bv-json-tree { font-size: 11px; line-height: 1.6; }
.bv-json-key   { color: #7c9ef8; }
.bv-json-str   { color: #4ade80; }
.bv-json-num   { color: #f59e0b; }
.bv-json-bool  { color: #f87171; }
.bv-json-null  { color: #475569; }
.bv-json-node  { cursor: pointer; user-select: none; }
.bv-json-node::before { content: '▾ '; font-size: 9px; color: #475569; }
.bv-json-node.collapsed::before { content: '▸ '; }
.bv-json-children { margin-left: 16px; }
.bv-json-children.hidden { display: none; }
.bv-json-summary { color: #475569; font-size: 10px; }
/* ── Section headings ────────────────────────── */
.bv-section-title {
    font-size: 10px;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 10px 0 5px;
    padding-bottom: 3px;
    border-bottom: 1px solid #12122a;
}
.bv-no-data { color: #2a2a4a; font-size: 11px; padding: 6px 0; }
`;

export class SgLlmBundleViewer extends HTMLElement {

    constructor() {
        super();
        this._bundle         = null;
        this._activeTab      = 'overview';
        this._boundHandlers  = {};
        this._shadow         = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
        this._bindEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(ev, fn);
        }
    }

    // ── Event binding ──────────────────────────────────────────────────────

    _bindEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._boundHandlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };
        on(INSPECT_EVENT,          this._onInspect);
        if (this.hasAttribute('follow-active')) {
            on(SGL_LLM.BUNDLE_LOADED, this._onBundleLoaded);
        }
    }

    _onInspect(e) {
        const id = e.detail?.bundleId;
        if (!id) return;
        const mgr = this._bus()?.querySelector?.('sg-llm-bundle');
        const bundle = mgr?.getBundle?.(id) ?? null;
        this._showBundle(bundle);
    }

    _onBundleLoaded(e) {
        const bundle = e.detail?.bundle;
        if (bundle) this._showBundle(bundle);
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Display a bundle directly.
     * @param {object|null} bundle
     */
    showBundle(bundle) { this._showBundle(bundle); }

    // ── Internal ───────────────────────────────────────────────────────────

    _showBundle(bundle) {
        this._bundle = bundle;
        this._updateContent();
    }

    _switchTab(name) {
        this._activeTab = name;
        const content = this._shadow.querySelector('.bv-content');
        if (!content) return;
        for (const tab of this._shadow.querySelectorAll('.bv-tab')) {
            tab.classList.toggle('active', tab.dataset.tab === name);
        }
        for (const panel of content.querySelectorAll('.bv-panel')) {
            panel.classList.toggle('active', panel.dataset.panel === name);
        }
    }

    _updateContent() {
        const content = this._shadow.querySelector('.bv-content');
        const empty   = this._shadow.querySelector('.bv-empty');
        const tabs    = this._shadow.querySelector('.bv-tabs');
        if (!content) return;

        if (!this._bundle) {
            empty?.style && (empty.style.display = 'flex');
            tabs && (tabs.style.display = 'none');
            content.style.display = 'none';
            return;
        }
        empty?.style && (empty.style.display = 'none');
        tabs && (tabs.style.display = 'flex');
        content.style.display = 'block';

        content.querySelector('[data-panel="overview"]').innerHTML  = this._renderOverview();
        content.querySelector('[data-panel="chat"]').innerHTML      = this._renderChat();
        content.querySelector('[data-panel="reality"]').innerHTML   = this._renderReality();
        content.querySelector('[data-panel="json"]').innerHTML      = this._renderJson();

        // Re-wire JSON collapse/expand buttons
        content.querySelector('#bv-expand-all')?.addEventListener('click',  () => this._jsonExpandAll());
        content.querySelector('#bv-collapse-all')?.addEventListener('click', () => this._jsonCollapseAll());
        content.querySelector('#bv-copy-json')?.addEventListener('click',   () => this._copyJson());
        for (const node of content.querySelectorAll('.bv-json-node')) {
            node.addEventListener('click', (e) => { e.stopPropagation(); this._toggleNode(node); });
        }
    }

    _renderOverview() {
        const b = this._bundle;
        const rows = [
            ['ID',         b.id ?? '—'],
            ['Timestamp',  b.timestamp ? new Date(b.timestamp).toLocaleString() : '—'],
            ['Parent',     b.parent_id ?? '(root)'],
            ['Provider',   b.config?.provider ?? '—'],
            ['Model',      b.config?.model ?? '—'],
            ['Streaming',  String(b.config?.streaming ?? '—')],
            ['Response',   b.response?.text ? b.response.text.slice(0, 120) + (b.response.text.length > 120 ? '…' : '') : '(none)'],
            ['Prompt tk',  String(b.response?.tokens?.prompt ?? '—')],
            ['Completion', String(b.response?.tokens?.completion ?? '—')],
            ['Cost',       b.response?.cost != null ? `$${Number(b.response.cost).toFixed(6)}` : '—'],
            ['Duration',   b.response?.duration_ms != null ? `${b.response.duration_ms}ms` : '—'],
            ['Finish',     b.response?.finish_reason ?? '—'],
            ['Chat turns', String(b.chat?.turns?.length ?? '—')],
            ['Reality blk',String(b.reality?.blocks?.length ?? '—')],
        ];
        return `<table class="bv-table">${rows.map(([k,v]) =>
            `<tr><td>${_esc(k)}</td><td>${_esc(String(v))}</td></tr>`
        ).join('')}</table>`;
    }

    _renderChat() {
        const turns = this._bundle?.chat?.turns;
        const sys   = this._bundle?.chat?.systemPrompt;
        let html = '';
        if (sys) {
            html += `<div class="bv-section-title">System Prompt</div>
                     <div class="bv-turn"><div class="bv-turn-text">${_esc(sys)}</div></div>`;
        }
        if (!turns?.length) {
            html += `<div class="bv-no-data">No chat turns in this bundle.</div>`;
            return html;
        }
        html += `<div class="bv-section-title">${turns.length} Turn${turns.length !== 1 ? 's' : ''}</div>`;
        for (const t of turns) {
            const text = typeof t.content === 'string' ? t.content
                : (t.content?.find?.(c => c.type === 'text')?.text ?? '');
            const atts = t.attachments ?? [];
            html += `<div class="bv-turn ${_esc(t.role)}">
                <div class="bv-turn-role">${_esc(t.role)}</div>
                <div class="bv-turn-text">${_esc(text || '(no text)')}</div>
                ${atts.map(a => `<span class="bv-att-badge">${_esc(a.name ?? a.type ?? 'file')}</span>`).join('')}
            </div>`;
        }
        return html;
    }

    _renderReality() {
        const blocks = this._bundle?.reality?.blocks;
        if (!blocks?.length) return `<div class="bv-no-data">No reality blocks in this bundle.</div>`;
        return blocks.map(b => `
            <div class="bv-block">
                <div class="bv-block-header">
                    <span class="bv-block-type">${_esc(b.type ?? '?')}</span>
                    ${b.label ? `<span>${_esc(b.label)}</span>` : ''}
                    ${b.enabled === false ? '<span style="color:#f87171">disabled</span>' : ''}
                </div>
                <div class="bv-block-body">${_esc(b.content ?? '(empty)')}</div>
            </div>`).join('');
    }

    _renderJson() {
        const json = JSON.stringify(this._bundle, null, 2);
        const tree = _buildJsonTree(this._bundle, 0);
        return `<div class="bv-json-actions">
            <button class="bv-json-btn" id="bv-expand-all">Expand all</button>
            <button class="bv-json-btn" id="bv-collapse-all">Collapse all</button>
            <button class="bv-json-btn" id="bv-copy-json">Copy JSON</button>
        </div>
        <div class="bv-json-tree">${tree}</div>`;
    }

    _toggleNode(node) {
        node.classList.toggle('collapsed');
        const children = node.nextElementSibling;
        if (children?.classList.contains('bv-json-children')) {
            children.classList.toggle('hidden', node.classList.contains('collapsed'));
        }
    }

    _jsonExpandAll() {
        for (const node of this._shadow.querySelectorAll('.bv-json-node.collapsed')) {
            node.classList.remove('collapsed');
        }
        for (const ch of this._shadow.querySelectorAll('.bv-json-children.hidden')) {
            ch.classList.remove('hidden');
        }
    }

    _jsonCollapseAll() {
        for (const node of this._shadow.querySelectorAll('.bv-json-node:not(.collapsed)')) {
            node.classList.add('collapsed');
        }
        for (const ch of this._shadow.querySelectorAll('.bv-json-children:not(.hidden)')) {
            ch.classList.add('hidden');
        }
    }

    async _copyJson() {
        const json = JSON.stringify(this._bundle, null, 2);
        try {
            await navigator.clipboard.writeText(json);
            const btn = this._shadow.querySelector('#bv-copy-json');
            if (btn) { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500); }
        } catch { /* ignore */ }
    }

    // ── DOM ────────────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `
        <style>${CSS}</style>
        <div class="bv-wrap" part="wrap">
            <div class="bv-empty">Select a bundle to inspect</div>
            <div class="bv-tabs" style="display:none">
                <button class="bv-tab active" data-tab="overview">Overview</button>
                <button class="bv-tab" data-tab="chat">Chat</button>
                <button class="bv-tab" data-tab="reality">Reality</button>
                <button class="bv-tab" data-tab="json">JSON</button>
            </div>
            <div class="bv-content" style="display:none">
                <div class="bv-panel active" data-panel="overview"></div>
                <div class="bv-panel" data-panel="chat"></div>
                <div class="bv-panel" data-panel="reality"></div>
                <div class="bv-panel" data-panel="json"></div>
            </div>
        </div>`;

        for (const btn of this._shadow.querySelectorAll('.bv-tab')) {
            btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
        }
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
}

customElements.define('sg-llm-bundle-viewer', SgLlmBundleViewer);
window.SgLlmBundleViewer = SgLlmBundleViewer;

// ── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Recursively build a collapsible JSON tree as HTML.
 * @param {*} val
 * @param {number} depth
 * @param {string} [key]
 * @returns {string}
 */
function _buildJsonTree(val, depth, key) {
    const keyHtml = key !== undefined
        ? `<span class="bv-json-key">${_esc(JSON.stringify(key))}</span>: `
        : '';

    if (val === null)              return `<div>${keyHtml}<span class="bv-json-null">null</span></div>`;
    if (typeof val === 'boolean')  return `<div>${keyHtml}<span class="bv-json-bool">${val}</span></div>`;
    if (typeof val === 'number')   return `<div>${keyHtml}<span class="bv-json-num">${val}</span></div>`;
    if (typeof val === 'string') {
        const display = val.length > 200 ? _esc(val.slice(0, 200)) + `<span class="bv-json-summary"> …(${val.length} chars)</span>` : _esc(val);
        return `<div>${keyHtml}<span class="bv-json-str">"${display}"</span></div>`;
    }

    if (Array.isArray(val)) {
        if (val.length === 0) return `<div>${keyHtml}<span class="bv-json-null">[]</span></div>`;
        const children = val.map((v, i) => _buildJsonTree(v, depth + 1, i)).join('');
        return `<div class="bv-json-node">${keyHtml}<span class="bv-json-summary">Array[${val.length}]</span></div>
                <div class="bv-json-children">${children}</div>`;
    }

    if (typeof val === 'object') {
        const keys = Object.keys(val);
        if (keys.length === 0) return `<div>${keyHtml}<span class="bv-json-null">{}</span></div>`;
        const children = keys.map(k => _buildJsonTree(val[k], depth + 1, k)).join('');
        return `<div class="bv-json-node">${keyHtml}<span class="bv-json-summary">{${keys.length} keys}</span></div>
                <div class="bv-json-children">${children}</div>`;
    }

    return `<div>${keyHtml}${_esc(String(val))}</div>`;
}
