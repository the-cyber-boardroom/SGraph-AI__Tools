/**
 * sg-vault-file-preview — Rich file preview for vault sessions.
 *
 * Listens for vault:file-select on [data-vault-bus] and renders the file
 * according to its extension:
 *   .md / .markdown          → rendered HTML via sg-markdown
 *   .png / .jpg / .gif / .webp → inline image (object URL)
 *   .svg                     → inline SVG
 *   .json                    → pretty-printed JSON with syntax highlight
 *   .csv / .tsv              → HTML table
 *   .html / .htm             → sandboxed iframe preview (escaped source by default)
 *   anything else            → plain text fallback
 *
 * Reads use session.getFile() so the cache layer is engaged. Preview is
 * read-only — for editing, use sg-vault-viewer.
 *
 * Bus events consumed:
 *   vault:connected    — { session }
 *   vault:disconnected — {}
 *   vault:file-select  — { path, fileId, size }
 *
 * @module sg-vault-file-preview
 * @version 0.1.0
 */

import { renderMarkdown, escapeHtml } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js';

export class SgVaultFilePreview extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._session  = null;
        this._handlers = {};
        this._objectUrl = null;
    }

    connectedCallback() {
        this._render();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        this._revokeObjectUrl();
        const bus = this._bus();
        for (const [evt, fn] of Object.entries(this._handlers)) {
            bus.removeEventListener(evt, fn);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-family: inherit; height: 100%; overflow: hidden; }
  .fp-panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      background: var(--sg-bg-secondary, #16213e);
      overflow: hidden;
  }
  .fp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      flex-shrink: 0;
      gap: 0.5rem;
      min-height: 36px;
  }
  .fp-path {
      font-size: 0.75rem;
      color: var(--sg-text-muted, #8892b0);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      font-family: monospace;
  }
  .fp-type-badge {
      font-size: 0.65rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      background: rgba(78,205,196,0.12);
      color: var(--sg-accent, #4ecdc4);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
  }
  .fp-body {
      flex: 1;
      overflow: auto;
      padding: 0.75rem 1rem;
  }
  .fp-placeholder {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      color: var(--sg-text-muted, #8892b0);
      text-align: center;
  }
  .fp-loading {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--sg-text-muted, #8892b0);
  }
  .spinner {
      width: 14px; height: 14px;
      border: 2px solid var(--sg-border, #2a3a5c);
      border-top-color: var(--sg-accent, #4ecdc4);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Markdown styles */
  .fp-md { color: var(--sg-text, #ccd6f6); line-height: 1.6; font-size: 0.875rem; }
  .fp-md h1, .fp-md h2, .fp-md h3 { color: var(--sg-accent, #4ecdc4); margin: 1em 0 0.5em; line-height: 1.3; }
  .fp-md h1 { font-size: 1.5em; border-bottom: 1px solid var(--sg-border, #2a3a5c); padding-bottom: 0.3em; }
  .fp-md h2 { font-size: 1.25em; }
  .fp-md h3 { font-size: 1.1em; }
  .fp-md p  { margin: 0.5em 0; }
  .fp-md a  { color: var(--sg-accent, #4ecdc4); }
  .fp-md code {
      background: var(--sg-bg-primary, #0d1b2a);
      padding: 0.1em 0.35em;
      border-radius: 3px;
      font-size: 0.85em;
      font-family: 'Courier New', Courier, monospace;
  }
  .fp-md pre {
      background: var(--sg-bg-primary, #0d1b2a);
      padding: 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      margin: 0.75em 0;
      border: 1px solid var(--sg-border, #2a3a5c);
  }
  .fp-md pre code { background: none; padding: 0; font-size: 0.8125em; }
  .fp-md blockquote {
      border-left: 3px solid var(--sg-accent, #4ecdc4);
      padding-left: 0.75rem;
      margin: 0.75em 0;
      color: var(--sg-text-muted, #8892b0);
      font-style: italic;
  }
  .fp-md ul, .fp-md ol { margin: 0.5em 0; padding-left: 1.5rem; }
  .fp-md li { margin: 0.2em 0; }
  .fp-md hr { border: none; border-top: 1px solid var(--sg-border, #2a3a5c); margin: 1em 0; }
  .fp-md table {
      border-collapse: collapse;
      margin: 0.75em 0;
      font-size: 0.8125rem;
  }
  .fp-md th, .fp-md td {
      border: 1px solid var(--sg-border, #2a3a5c);
      padding: 0.35rem 0.6rem;
      text-align: left;
  }
  .fp-md th { background: var(--sg-bg-primary, #0d1b2a); font-weight: 600; }

  /* Image preview */
  .fp-image {
      display: block;
      max-width: 100%;
      max-height: 80vh;
      margin: 0 auto;
      background: repeating-conic-gradient(#1a2540 0% 25%, #0d1b2a 0% 50%) 50% / 16px 16px;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
  }

  /* JSON pretty-print */
  .fp-json {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.8125rem;
      color: var(--sg-text, #ccd6f6);
      white-space: pre-wrap;
      word-break: break-all;
  }
  .fp-json .key    { color: #fbbf24; }
  .fp-json .string { color: #6ee7b7; }
  .fp-json .number { color: #4ecdc4; }
  .fp-json .bool   { color: #c084fc; }
  .fp-json .null   { color: #8892b0; }

  /* CSV table */
  .fp-csv {
      border-collapse: collapse;
      font-size: 0.8125rem;
      color: var(--sg-text, #ccd6f6);
  }
  .fp-csv th, .fp-csv td {
      border: 1px solid var(--sg-border, #2a3a5c);
      padding: 0.3rem 0.6rem;
      text-align: left;
      white-space: nowrap;
  }
  .fp-csv th { background: var(--sg-bg-primary, #0d1b2a); font-weight: 600; color: var(--sg-accent, #4ecdc4); }
  .fp-csv tr:nth-child(even) td { background: rgba(13,27,42,0.5); }

  /* HTML iframe sandbox */
  .fp-iframe {
      width: 100%;
      height: 100%;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
      background: white;
  }

  /* Plain text */
  .fp-text {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.8125rem;
      color: var(--sg-text, #ccd6f6);
      white-space: pre-wrap;
      word-break: break-word;
  }
  .fp-error {
      color: var(--sg-error, #e94560);
      padding: 1rem;
      text-align: center;
  }
</style>

<div class="fp-panel">
  <div class="fp-header">
    <span class="fp-path" id="file-path">No file selected</span>
    <span class="fp-type-badge" id="type-badge" style="display:none"></span>
  </div>
  <div class="fp-body" id="body">
    <div class="fp-placeholder">Select a file from the tree to preview.</div>
  </div>
</div>
`;
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on = (evt, fn) => {
            const bound = fn.bind(this);
            this._handlers[evt] = bound;
            bus.addEventListener(evt, bound);
        };
        on('vault:connected',    (e) => { this._session = e.detail.session; });
        on('vault:disconnected', ()  => { this._session = null; this._reset(); });
        on('vault:file-select',  (e) => this._loadFile(e.detail));
    }

    // ── Load + Render ──────────────────────────────────────────────────────

    async _loadFile({ path, fileId }) {
        if (!this._session || !fileId) return;

        this._revokeObjectUrl();
        this.shadowRoot.getElementById('file-path').textContent = path;

        const ext = (path.split('.').pop() || '').toLowerCase();
        const badge = this.shadowRoot.getElementById('type-badge');
        badge.textContent = ext;
        badge.style.display = ext ? '' : 'none';

        this._setBody('<div class="fp-loading"><div class="spinner"></div>Loading…</div>');

        try {
            const data = await this._session.getFile(fileId);
            const bytes = new Uint8Array(data);

            if (this._isImageExt(ext)) {
                this._renderImage(bytes, ext);
            } else if (ext === 'svg') {
                this._renderSvg(bytes);
            } else if (ext === 'md' || ext === 'markdown') {
                this._renderMarkdown(bytes);
            } else if (ext === 'json') {
                this._renderJson(bytes);
            } else if (ext === 'csv' || ext === 'tsv') {
                this._renderCsv(bytes, ext === 'tsv' ? '\t' : ',');
            } else if (ext === 'html' || ext === 'htm') {
                this._renderHtml(bytes);
            } else {
                this._renderText(bytes);
            }
        } catch (err) {
            this._setBody(`<div class="fp-error">Error: ${escapeHtml(err.message)}</div>`);
        }
    }

    _isImageExt(ext) {
        return ext === 'png' || ext === 'jpg' || ext === 'jpeg'
            || ext === 'gif' || ext === 'webp' || ext === 'bmp' || ext === 'avif';
    }

    _renderImage(bytes, ext) {
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const blob = new Blob([bytes], { type: mime });
        this._objectUrl = URL.createObjectURL(blob);
        this._setBody(`<img class="fp-image" src="${this._objectUrl}" alt="">`);
    }

    _renderSvg(bytes) {
        const text = new TextDecoder().decode(bytes);
        // Sanitise: strip <script> tags before injecting
        const safe = text.replace(/<script[\s\S]*?<\/script>/gi, '');
        this._setBody(`<div style="text-align:center">${safe}</div>`);
    }

    _renderMarkdown(bytes) {
        const text = new TextDecoder().decode(bytes);
        const html = renderMarkdown(text);
        this._setBody(`<div class="fp-md">${html}</div>`);
    }

    _renderJson(bytes) {
        const text = new TextDecoder().decode(bytes);
        try {
            const obj = JSON.parse(text);
            const pretty = JSON.stringify(obj, null, 2);
            const highlighted = this._highlightJson(escapeHtml(pretty));
            this._setBody(`<pre class="fp-json">${highlighted}</pre>`);
        } catch (err) {
            this._setBody(`<pre class="fp-text">${escapeHtml(text)}</pre>`);
        }
    }

    _highlightJson(escaped) {
        return escaped
            .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="key">$1</span>$2')
            .replace(/:\s*(&quot;[^&]*?&quot;)/g, ': <span class="string">$1</span>')
            .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="number">$1</span>')
            .replace(/:\s*(true|false)\b/g, ': <span class="bool">$1</span>')
            .replace(/:\s*(null)\b/g, ': <span class="null">$1</span>');
    }

    _renderCsv(bytes, delim) {
        const text = new TextDecoder().decode(bytes);
        const rows = this._parseCsv(text, delim);
        if (rows.length === 0) {
            this._setBody('<div class="fp-placeholder">Empty file.</div>');
            return;
        }

        const [header, ...body] = rows;
        const ths = header.map(c => `<th>${escapeHtml(c)}</th>`).join('');
        const trs = body.map(r =>
            '<tr>' + r.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>'
        ).join('');

        this._setBody(`<table class="fp-csv"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`);
    }

    _parseCsv(text, delim) {
        const rows = [];
        let row = [], field = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
                else if (ch === '"') { inQuotes = false; }
                else { field += ch; }
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === delim) {
                row.push(field); field = '';
            } else if (ch === '\n' || ch === '\r') {
                if (field !== '' || row.length > 0) { row.push(field); rows.push(row); row = []; field = ''; }
                if (ch === '\r' && text[i + 1] === '\n') i++;
            } else {
                field += ch;
            }
        }
        if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
        return rows;
    }

    _renderHtml(bytes) {
        const text = new TextDecoder().decode(bytes);
        // Render in a sandboxed iframe (no scripts, no same-origin)
        const blob = new Blob([text], { type: 'text/html' });
        this._objectUrl = URL.createObjectURL(blob);
        this._setBody(`<iframe class="fp-iframe" src="${this._objectUrl}" sandbox=""></iframe>`);
    }

    _renderText(bytes) {
        if (this._isBinaryBytes(bytes)) {
            this._setBody(`<div class="fp-placeholder">Binary file (${this._formatBytes(bytes.length)}) — preview not supported.</div>`);
            return;
        }
        const text = new TextDecoder().decode(bytes);
        this._setBody(`<pre class="fp-text">${escapeHtml(text)}</pre>`);
    }

    _isBinaryBytes(bytes) {
        const sample = bytes.slice(0, 512);
        let nonPrintable = 0;
        for (const b of sample) {
            if (b === 0) return true;
            if (b < 9 || (b > 13 && b < 32)) nonPrintable++;
        }
        return sample.length > 0 && nonPrintable / sample.length > 0.3;
    }

    _formatBytes(n) {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _setBody(html) {
        this.shadowRoot.getElementById('body').innerHTML = html;
    }

    _reset() {
        this._revokeObjectUrl();
        this.shadowRoot.getElementById('file-path').textContent = 'No file selected';
        this.shadowRoot.getElementById('type-badge').style.display = 'none';
        this._setBody('<div class="fp-placeholder">Select a file from the tree to preview.</div>');
    }

    _revokeObjectUrl() {
        if (this._objectUrl) {
            URL.revokeObjectURL(this._objectUrl);
            this._objectUrl = null;
        }
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-vault-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
}

customElements.define('sg-vault-file-preview', SgVaultFilePreview);
