/**
 * sg-json-receiver — JSON response parser with collapsible tree viewer.
 *
 * Listens for llm:request-complete events on the LLM bus and displays the
 * response content. Automatically detects:
 *   - Plain text responses
 *   - JSON responses (from response_format: json_schema or free-form JSON)
 *   - Tool call responses
 *
 * Features:
 *   - Auto-detect response type
 *   - Collapsible JSON tree viewer for JSON responses
 *   - Schema validation (when a schema is provided)
 *   - Copy to clipboard button
 *   - Download as JSON button
 *
 * Usage:
 *   <sg-json-receiver></sg-json-receiver>
 *
 * Attributes:
 *   (none)
 *
 * Events:
 *   sg-json-receiver:parsed — { detail: { type, data } } fired after each response
 *
 * @module sg-json-receiver
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    background: var(--sg-bg-secondary, #1a1a2e);
    border: 1px solid var(--sg-border, #333);
    border-radius: 6px;
    overflow: hidden;
    font-family: var(--sg-font-sans, system-ui, sans-serif);
    font-size: 13px;
    color: var(--sg-text, #e0e0e0);
    box-sizing: border-box;
  }

  /* Header */
  .jr-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--sg-bg-tertiary, #16213e);
    border-bottom: 1px solid var(--sg-border, #333);
    flex-shrink: 0;
  }
  .jr-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--sg-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex: 1;
  }
  .jr-badge {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid var(--sg-border, #333);
    color: var(--sg-text-dim, #888);
  }
  .jr-badge.json    { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .jr-badge.text    { border-color: #ffc107; color: #ffc107; }
  .jr-badge.tools   { border-color: #7b68ee; color: #7b68ee; }
  .jr-badge.error   { border-color: var(--sg-error, #ff6b6b); color: var(--sg-error, #ff6b6b); }
  .jr-badge.waiting { border-color: var(--sg-border, #333); color: var(--sg-text-dim, #888); }

  /* Toolbar */
  .jr-toolbar {
    display: flex;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--sg-border, #333);
    background: var(--sg-bg-tertiary, #16213e);
    flex-shrink: 0;
  }
  .jr-tool-btn {
    background: none;
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text-dim, #888);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 10px;
    font-family: inherit;
    transition: all 0.15s;
  }
  .jr-tool-btn:hover   { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .jr-tool-btn:disabled { opacity: 0.3; cursor: default; }
  .jr-expand-all, .jr-collapse-all { }

  /* Content area */
  .jr-content {
    flex: 1;
    overflow: auto;
    padding: 10px 12px;
  }

  /* Empty state */
  .jr-empty {
    color: var(--sg-text-dim, #888);
    font-style: italic;
    padding: 20px 0;
    text-align: center;
  }

  /* Text response */
  .jr-text-output {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    color: var(--sg-text, #e0e0e0);
  }

  /* JSON tree */
  .jr-tree { font-family: var(--sg-font-mono, monospace); font-size: 12px; }
  .jr-node { padding: 1px 0; }
  .jr-node-toggle {
    display: inline-block;
    width: 14px;
    text-align: center;
    cursor: pointer;
    color: var(--sg-text-dim, #888);
    user-select: none;
  }
  .jr-node-key   { color: #7b68ee; }
  .jr-node-str   { color: var(--sg-accent, #4ecdc4); }
  .jr-node-num   { color: #ffa500; }
  .jr-node-bool  { color: #ff6b6b; }
  .jr-node-null  { color: var(--sg-text-dim, #888); font-style: italic; }
  .jr-node-type  { color: var(--sg-text-dim, #888); font-size: 10px; margin-left: 4px; }
  .jr-children   { margin-left: 18px; border-left: 1px solid var(--sg-border, #333); padding-left: 6px; }
  .jr-children.collapsed { display: none; }

  /* Validation */
  .jr-validation {
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 8px;
  }
  .jr-validation.ok   { background: rgba(78,205,196,0.1); color: var(--sg-accent, #4ecdc4); border: 1px solid rgba(78,205,196,0.2); }
  .jr-validation.fail { background: rgba(255,107,107,0.1); color: var(--sg-error, #ff6b6b); border: 1px solid rgba(255,107,107,0.2); }

  /* Tool calls view */
  .jr-tool-call {
    background: var(--sg-bg-primary, #0d1117);
    border: 1px solid #7b68ee44;
    border-radius: 4px;
    padding: 8px 10px;
    margin-bottom: 6px;
  }
  .jr-tool-call-name { color: #7b68ee; font-weight: 600; font-size: 12px; }
  .jr-tool-call-args { color: var(--sg-text-dim, #888); font-family: var(--sg-font-mono, monospace); font-size: 11px; margin-top: 4px; white-space: pre-wrap; }

  /* Stream indicator */
  .jr-streaming {
    color: var(--sg-accent, #4ecdc4);
    font-size: 11px;
    padding: 4px 0;
    animation: blink 1s infinite;
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
</style>

<div class="jr-header">
  <span class="jr-title">JSON Receiver</span>
  <span class="jr-badge waiting" id="badge">waiting</span>
</div>

<div class="jr-toolbar">
  <button class="jr-tool-btn" id="copy-btn" disabled>Copy</button>
  <button class="jr-tool-btn" id="download-btn" disabled>Download</button>
  <button class="jr-tool-btn jr-expand-all" id="expand-btn" disabled>Expand all</button>
  <button class="jr-tool-btn jr-collapse-all" id="collapse-btn" disabled>Collapse all</button>
  <button class="jr-tool-btn" id="clear-btn">Clear</button>
</div>

<div class="jr-content" id="content">
  <div class="jr-empty" id="empty-state">Waiting for LLM response…</div>
</div>
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class SgJsonReceiver extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

        this._lastData    = null;
        this._lastType    = 'waiting';
        this._schema      = null;   // optional JSON schema for validation
        this._streamBuf   = '';

        this._el = {
            badge:       this.shadowRoot.getElementById('badge'),
            content:     this.shadowRoot.getElementById('content'),
            emptyState:  this.shadowRoot.getElementById('empty-state'),
            copyBtn:     this.shadowRoot.getElementById('copy-btn'),
            downloadBtn: this.shadowRoot.getElementById('download-btn'),
            expandBtn:   this.shadowRoot.getElementById('expand-btn'),
            collapseBtn: this.shadowRoot.getElementById('collapse-btn'),
            clearBtn:    this.shadowRoot.getElementById('clear-btn'),
        };
    }

    connectedCallback() {
        const bus = this._llmBus();

        this._onComplete = (e) => this._handleComplete(e);
        this._onChunk    = (e) => this._handleChunk(e);
        this._onError    = (e) => this._handleError(e);

        bus.addEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
        bus.addEventListener(SGL_LLM.REQUEST_CHUNK,    this._onChunk);
        bus.addEventListener(SGL_LLM.REQUEST_ERROR,    this._onError);

        this._el.copyBtn.addEventListener('click', () => this._copy());
        this._el.downloadBtn.addEventListener('click', () => this._download());
        this._el.expandBtn.addEventListener('click', () => this._setAllCollapsed(false));
        this._el.collapseBtn.addEventListener('click', () => this._setAllCollapsed(true));
        this._el.clearBtn.addEventListener('click', () => this._clear());
    }

    disconnectedCallback() {
        const bus = this._llmBus();
        bus.removeEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
        bus.removeEventListener(SGL_LLM.REQUEST_CHUNK,    this._onChunk);
        bus.removeEventListener(SGL_LLM.REQUEST_ERROR,    this._onError);
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Set a JSON schema for response validation.
     * @param {Object|null} schema - JSON schema object, or null to disable validation
     */
    setSchema(schema) {
        this._schema = schema;
    }

    /**
     * Display data directly without an LLM event.
     * @param {*} data
     */
    show(data) {
        const isStr = typeof data === 'string';
        const parsed = isStr ? this._tryParseJSON(data) : data;
        if (parsed !== null && typeof parsed === 'object') {
            this._renderJSON(parsed);
        } else {
            this._renderText(isStr ? data : JSON.stringify(data));
        }
    }

    // ── Event handlers ─────────────────────────────────────────────────────

    _handleChunk(e) {
        const chunk = e.detail?.chunk ?? '';
        this._streamBuf += chunk;

        // Show streaming indicator
        if (!this.shadowRoot.getElementById('stream-indicator')) {
            this._el.content.innerHTML = '';
            const ind = document.createElement('div');
            ind.id = 'stream-indicator';
            ind.className = 'jr-streaming';
            ind.textContent = '● streaming…';
            this._el.content.appendChild(ind);
        }
        this._setBadge('waiting', 'streaming');
    }

    _handleComplete(e) {
        const { content, toolCalls, finishReason } = e.detail ?? {};
        this._streamBuf = '';

        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
            this._renderToolCalls(toolCalls);
            return;
        }

        if (!content) {
            this._clear();
            return;
        }

        const parsed = this._tryParseJSON(content);
        if (parsed !== null && typeof parsed === 'object') {
            this._renderJSON(parsed);
        } else {
            this._renderText(content);
        }
    }

    _handleError(e) {
        const msg = e.detail?.error ?? 'Unknown error';
        this._el.content.innerHTML = `<div style="color:var(--sg-error,#ff6b6b);padding:10px 0">${this._esc(msg)}</div>`;
        this._setBadge('error', 'error');
        this._setToolbarEnabled(false);
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _renderText(text) {
        this._lastData = text;
        this._lastType = 'text';
        this._el.content.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'jr-text-output';
        div.textContent = text;
        this._el.content.appendChild(div);
        this._setBadge('text', 'text');
        this._setToolbarEnabled(false, false);
        this._dispatchParsed('text', text);
    }

    _renderJSON(data) {
        this._lastData = data;
        this._lastType = 'json';
        this._el.content.innerHTML = '';

        // Validation
        if (this._schema) {
            const errors = this._validateSchema(data, this._schema);
            const vDiv = document.createElement('div');
            vDiv.className = `jr-validation ${errors.length === 0 ? 'ok' : 'fail'}`;
            vDiv.textContent = errors.length === 0
                ? '✓ Schema valid'
                : `✗ Schema errors: ${errors.slice(0, 3).join('; ')}`;
            this._el.content.appendChild(vDiv);
        }

        const tree = this._buildTree(data, '', true);
        this._el.content.appendChild(tree);

        this._setBadge('json', 'json');
        this._setToolbarEnabled(true, true);
        this._dispatchParsed('json', data);
    }

    _renderToolCalls(toolCalls) {
        this._lastData = toolCalls;
        this._lastType = 'tools';
        this._el.content.innerHTML = '';

        for (const tc of toolCalls) {
            const div = document.createElement('div');
            div.className = 'jr-tool-call';
            let argsStr = tc.function?.arguments ?? '';
            try { argsStr = JSON.stringify(JSON.parse(argsStr), null, 2); } catch { /* keep raw */ }
            div.innerHTML = `
              <div class="jr-tool-call-name">${this._esc(tc.function?.name ?? 'unknown')}</div>
              <div class="jr-tool-call-args">${this._esc(argsStr)}</div>
            `;
            this._el.content.appendChild(div);
        }

        this._setBadge('tools', `${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''}`);
        this._setToolbarEnabled(false, false);
        this._dispatchParsed('tools', toolCalls);
    }

    // ── JSON Tree builder ──────────────────────────────────────────────────

    /**
     * Build a collapsible DOM tree for a JSON value.
     *
     * @param {*} value
     * @param {string} key - property name ('' for root)
     * @param {boolean} isRoot
     * @returns {HTMLElement}
     */
    _buildTree(value, key, isRoot = false) {
        const node = document.createElement('div');
        node.className = 'jr-node';

        const keySpan = key !== '' ? `<span class="jr-node-key">"${this._esc(key)}"</span>: ` : '';

        if (value === null) {
            node.innerHTML = `${keySpan}<span class="jr-node-null">null</span>`;
        } else if (typeof value === 'boolean') {
            node.innerHTML = `${keySpan}<span class="jr-node-bool">${value}</span>`;
        } else if (typeof value === 'number') {
            node.innerHTML = `${keySpan}<span class="jr-node-num">${value}</span>`;
        } else if (typeof value === 'string') {
            node.innerHTML = `${keySpan}<span class="jr-node-str">"${this._esc(value)}"</span>`;
        } else if (Array.isArray(value)) {
            const count = value.length;
            const toggle = document.createElement('span');
            toggle.className = 'jr-node-toggle';
            toggle.textContent = '▼';

            const children = document.createElement('div');
            children.className = 'jr-children';

            value.forEach((v, i) => {
                children.appendChild(this._buildTree(v, String(i)));
            });

            const header = document.createElement('span');
            header.innerHTML = `${keySpan}<span class="jr-node-type">[${count}]</span>`;
            header.style.cursor = 'pointer';

            toggle.addEventListener('click', () => this._toggleNode(toggle, children));
            header.addEventListener('click', () => this._toggleNode(toggle, children));

            node.appendChild(toggle);
            node.appendChild(header);
            node.appendChild(children);
        } else if (typeof value === 'object') {
            const keys = Object.keys(value);
            const toggle = document.createElement('span');
            toggle.className = 'jr-node-toggle';
            toggle.textContent = '▼';

            const children = document.createElement('div');
            children.className = 'jr-children';

            keys.forEach((k) => {
                children.appendChild(this._buildTree(value[k], k));
            });

            const header = document.createElement('span');
            header.innerHTML = `${keySpan}<span class="jr-node-type">{${keys.length}}</span>`;
            header.style.cursor = 'pointer';

            toggle.addEventListener('click', () => this._toggleNode(toggle, children));
            header.addEventListener('click', () => this._toggleNode(toggle, children));

            node.appendChild(toggle);
            node.appendChild(header);
            node.appendChild(children);
        }

        return node;
    }

    _toggleNode(toggle, children) {
        const collapsed = children.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '▶' : '▼';
    }

    _setAllCollapsed(collapsed) {
        this._el.content.querySelectorAll('.jr-children').forEach((el) => {
            el.classList.toggle('collapsed', collapsed);
        });
        this._el.content.querySelectorAll('.jr-node-toggle').forEach((el) => {
            el.textContent = collapsed ? '▶' : '▼';
        });
    }

    // ── Schema validation (simple, structural) ─────────────────────────────

    /**
     * Very lightweight JSON schema validation — checks required fields and types.
     * Not a full JSON Schema implementation; covers common cases.
     *
     * @param {*} data
     * @param {Object} schema - JSON schema object
     * @returns {string[]} Array of error messages (empty = valid)
     */
    _validateSchema(data, schema) {
        const errors = [];
        if (schema.type === 'object') {
            if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                errors.push('Expected object');
                return errors;
            }
            for (const req of (schema.required ?? [])) {
                if (!(req in data)) errors.push(`Missing required field: "${req}"`);
            }
            for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
                if (key in data) {
                    const val = data[key];
                    if (propSchema.type === 'string'  && typeof val !== 'string')  errors.push(`"${key}" should be string`);
                    if (propSchema.type === 'number'  && typeof val !== 'number')  errors.push(`"${key}" should be number`);
                    if (propSchema.type === 'boolean' && typeof val !== 'boolean') errors.push(`"${key}" should be boolean`);
                    if (propSchema.type === 'array'   && !Array.isArray(val))      errors.push(`"${key}" should be array`);
                    if (propSchema.enum && !propSchema.enum.includes(val))         errors.push(`"${key}" must be one of: ${propSchema.enum.join(', ')}`);
                }
            }
        }
        return errors;
    }

    // ── Actions ────────────────────────────────────────────────────────────

    _copy() {
        const text = this._lastType === 'json'
            ? JSON.stringify(this._lastData, null, 2)
            : String(this._lastData ?? '');
        navigator.clipboard?.writeText(text).catch(() => {});
    }

    _download() {
        const text = this._lastType === 'json'
            ? JSON.stringify(this._lastData, null, 2)
            : String(this._lastData ?? '');
        const blob = new Blob([text], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `response-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    _clear() {
        this._lastData = null;
        this._lastType = 'waiting';
        this._streamBuf = '';
        this._el.content.innerHTML = '<div class="jr-empty" id="empty-state">Waiting for LLM response…</div>';
        this._setBadge('waiting', 'waiting');
        this._setToolbarEnabled(false, false);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _setBadge(cls, text) {
        this._el.badge.className = `jr-badge ${cls}`;
        this._el.badge.textContent = text;
    }

    _setToolbarEnabled(actionBtns, treeBtns) {
        this._el.copyBtn.disabled     = !actionBtns;
        this._el.downloadBtn.disabled = !actionBtns;
        this._el.expandBtn.disabled   = !treeBtns;
        this._el.collapseBtn.disabled = !treeBtns;
    }

    _tryParseJSON(str) {
        if (typeof str !== 'string') return null;
        const trimmed = str.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
        try { return JSON.parse(trimmed); } catch { return null; }
    }

    _llmBus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return document;
    }

    _dispatchParsed(type, data) {
        this.dispatchEvent(new CustomEvent('sg-json-receiver:parsed', {
            bubbles: true,
            detail: { type, data },
        }));
    }

    _esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

customElements.define('sg-json-receiver', SgJsonReceiver);
