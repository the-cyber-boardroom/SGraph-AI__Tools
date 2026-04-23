/**
 * sg-llm-output — Streaming LLM response display component.
 *
 * Renders the LLM response with streaming support (chunks appear live).
 * Supports markdown toggle and syntax-highlighted code blocks.
 * Copy to clipboard and download as file.
 *
 * Consumes: llm:request-start (clear, show waiting state)
 *           llm:request-chunk (append streaming text)
 *           llm:request-complete (final render)
 *           llm:request-error (show error)
 *           llm:bundle-loaded (restore response from bundle)
 *
 * Emits: llm:output-ready, llm:output-copied
 *
 * Usage:
 *   <sg-llm-output></sg-llm-output>
 *
 * @module sg-llm-output
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.output-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #111122;
    border: 1px solid #222d4d;
    border-radius: 8px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
}

.output-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid #222d4d;
    background: #0d0d1a;
    flex-shrink: 0;
}
.output-toolbar-title {
    font-size: 12px;
    font-weight: 600;
    color: #a0aec0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
}
.output-btn {
    border: 1px solid #333d5a;
    border-radius: 4px;
    background: #1a1a3a;
    color: #a0aec0;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
}
.output-btn:hover { color: #e2e8f0; border-color: #4ECDC4; }
.output-btn.active { color: #4ECDC4; border-color: #4ECDC4; }

.output-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    scrollbar-width: thin;
    scrollbar-color: #333d5a transparent;
}

/* Plain text mode */
.output-text {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12.5px;
    color: #e2e8f0;
}

/* Markdown mode */
.output-markdown { line-height: 1.7; }
.output-markdown h1,
.output-markdown h2,
.output-markdown h3 { margin: 1em 0 0.4em; color: #4ECDC4; }
.output-markdown h1 { font-size: 1.4em; }
.output-markdown h2 { font-size: 1.2em; }
.output-markdown h3 { font-size: 1.05em; }
.output-markdown p  { margin: 0.6em 0; }
.output-markdown ul,
.output-markdown ol { margin: 0.5em 0; padding-left: 1.5em; }
.output-markdown li { margin: 0.3em 0; }
.output-markdown blockquote {
    border-left: 3px solid #4ECDC4;
    margin: 0.6em 0;
    padding: 4px 12px;
    color: #a0aec0;
}
.output-markdown code {
    background: #1a1a3a;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9em;
    color: #FF6B6B;
}
.output-markdown pre {
    background: #0d0d1a;
    border: 1px solid #222d4d;
    border-radius: 6px;
    padding: 12px;
    overflow-x: auto;
    margin: 0.8em 0;
}
.output-markdown pre code {
    background: none;
    padding: 0;
    color: #e2e8f0;
    font-size: 12px;
}
.output-markdown strong { color: #fff; }
.output-markdown a     { color: #4ECDC4; }
.output-markdown hr    { border: none; border-top: 1px solid #222d4d; margin: 1em 0; }
.output-markdown table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 12px; }
.output-markdown th, .output-markdown td {
    border: 1px solid #222d4d;
    padding: 6px 10px;
    text-align: left;
}
.output-markdown th { background: #1a1a3a; color: #4ECDC4; font-weight: 600; }
.output-markdown tr:nth-child(even) td { background: #0d0d1a; }

/* States */
.output-waiting {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #a0aec0;
    font-size: 13px;
    padding: 20px 0;
}
.output-waiting .dots::after {
    content: '...';
    animation: dots 1.2s steps(3, end) infinite;
}
@keyframes dots {
    0%   { content: '.';   }
    33%  { content: '..';  }
    66%  { content: '...'; }
}
.output-error {
    color: #ff6b6b;
    padding: 10px;
    background: rgba(255, 107, 107, 0.08);
    border: 1px solid rgba(255, 107, 107, 0.2);
    border-radius: 6px;
}
.output-empty {
    color: #555;
    font-style: italic;
    padding: 20px 0;
    font-size: 13px;
}

.output-footer {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    border-top: 1px solid #222d4d;
    background: #0d0d1a;
    font-size: 11px;
    color: #555;
    flex-shrink: 0;
    min-height: 28px;
}
.output-cursor {
    display: inline-block;
    width: 2px;
    height: 14px;
    background: #4ECDC4;
    margin-left: 2px;
    animation: blink 0.8s step-end infinite;
    vertical-align: text-bottom;
}
@keyframes blink {
    0%, 100% { opacity: 1; } 50% { opacity: 0; }
}
`;

/**
 * Minimal markdown renderer — no external dependencies.
 * Handles: headings, bold, italic, code blocks, inline code,
 * blockquotes, lists, tables, horizontal rules, links.
 *
 * @param {string} text
 * @returns {string} HTML string
 */
function renderMarkdown(text) {
    // Escape HTML first to prevent XSS from model output
    const escapeHtml = s => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Process fenced code blocks first (preserve their content)
    const codeBlocks = [];
    let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre><code class="lang-${lang || 'text'}">${escapeHtml(code.trimEnd())}</code></pre>`);
        return `\x00CODE${idx}\x00`;
    });

    // Escape the rest
    processed = escapeHtml(processed);

    // Restore code blocks (unescaped)
    processed = processed.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

    const lines = processed.split('\n');
    const html  = [];
    let   inList = false, listTag = '';
    let   inTable = false, tableRows = [];

    const flushList = () => {
        if (inList) { html.push(`</${listTag}>`); inList = false; listTag = ''; }
    };
    const flushTable = () => {
        if (inTable) {
            const [headerRow, , ...bodyRows] = tableRows;
            const headers = headerRow.split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('');
            const rows    = bodyRows.map(r => '<tr>' + r.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('') + '</tr>').join('');
            html.push(`<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`);
            inTable = false;
            tableRows = [];
        }
    };

    for (let line of lines) {
        // Fenced code block placeholders pass through
        if (line.includes('\x00CODE')) { flushList(); flushTable(); html.push(line); continue; }
        if (/<pre>/.test(line))        { flushList(); flushTable(); html.push(line); continue; }

        // HR
        if (/^---+$/.test(line.trim())) { flushList(); flushTable(); html.push('<hr>'); continue; }

        // Headings
        const hm = line.match(/^(#{1,3})\s+(.*)/);
        if (hm) {
            flushList(); flushTable();
            const level = hm[1].length;
            html.push(`<h${level}>${inlineMarkdown(hm[2])}</h${level}>`);
            continue;
        }

        // Blockquote
        if (line.startsWith('&gt; ')) {
            flushList(); flushTable();
            html.push(`<blockquote>${inlineMarkdown(line.slice(5))}</blockquote>`);
            continue;
        }

        // Table
        if (line.startsWith('|')) {
            flushList();
            inTable = true;
            tableRows.push(line);
            continue;
        } else if (inTable) {
            flushTable();
        }

        // Lists
        const ulm = line.match(/^[-*+]\s+(.*)/);
        const olm = line.match(/^\d+\.\s+(.*)/);
        if (ulm) {
            if (!inList || listTag !== 'ul') { flushList(); html.push('<ul>'); inList = true; listTag = 'ul'; }
            html.push(`<li>${inlineMarkdown(ulm[1])}</li>`);
            continue;
        }
        if (olm) {
            if (!inList || listTag !== 'ol') { flushList(); html.push('<ol>'); inList = true; listTag = 'ol'; }
            html.push(`<li>${inlineMarkdown(olm[1])}</li>`);
            continue;
        }
        flushList();

        // Empty line
        if (!line.trim()) { html.push(''); continue; }

        // Paragraph
        html.push(`<p>${inlineMarkdown(line)}</p>`);
    }

    flushList();
    flushTable();
    return html.join('\n');
}

/**
 * Render inline markdown: bold, italic, inline code, links.
 *
 * @param {string} text - already HTML-escaped
 * @returns {string}
 */
function inlineMarkdown(text) {
    return text
        .replace(/`([^`]+)`/g,      '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
        .replace(/__([^_]+)__/g,    '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g,    '<em>$1</em>')
        .replace(/_([^_]+)_/g,      '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/**
 * <sg-llm-output> — Streaming LLM response renderer.
 *
 * @fires llm:output-ready  - { content, format }
 * @fires llm:output-copied - {}
 */
export class SgLlmOutput extends HTMLElement {

    static jsUrl = import.meta.url;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._content   = '';
        this._markdown  = true;
        this._streaming = false;
    }

    connectedCallback() {
        this._render();
        this._container = this.parentElement || document;
        this._bindEvents();
    }

    disconnectedCallback() {
        if (this._container) {
            this._container.removeEventListener(SGL_LLM.REQUEST_START,    this._onStart);
            this._container.removeEventListener(SGL_LLM.REQUEST_CHUNK,    this._onChunk);
            this._container.removeEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
            this._container.removeEventListener(SGL_LLM.REQUEST_ERROR,    this._onError);
            this._container.removeEventListener(SGL_LLM.BUNDLE_LOADED,    this._onBundleLoaded);
        }
    }

    // --- Render -----------------------------------------------------------------

    _render() {
        this.shadowRoot.innerHTML = `
        <style>${STYLES}</style>
        <div class="output-root">
            <div class="output-toolbar">
                <span class="output-toolbar-title">Response</span>
                <button class="output-btn active" id="md-btn" title="Toggle markdown">Markdown</button>
                <button class="output-btn" id="copy-btn" title="Copy to clipboard">Copy</button>
                <button class="output-btn" id="dl-btn" title="Download as .md">↓ Save</button>
            </div>
            <div class="output-body" id="body">
                <div class="output-empty">Response will appear here...</div>
            </div>
            <div class="output-footer" id="footer"></div>
        </div>`;

        this._bodyEl   = this.shadowRoot.getElementById('body');
        this._footerEl = this.shadowRoot.getElementById('footer');
        this._mdBtn    = this.shadowRoot.getElementById('md-btn');
        this._copyBtn  = this.shadowRoot.getElementById('copy-btn');
        this._dlBtn    = this.shadowRoot.getElementById('dl-btn');

        this._mdBtn.addEventListener('click', () => this._toggleMarkdown());
        this._copyBtn.addEventListener('click', () => this._copyContent());
        this._dlBtn.addEventListener('click', () => this._downloadContent());
    }

    // --- Event wiring -----------------------------------------------------------

    _bindEvents() {
        this._onStart       = e => this._handleStart(e.detail);
        this._onChunk       = e => this._handleChunk(e.detail);
        this._onComplete    = e => this._handleComplete(e.detail);
        this._onError       = e => this._handleError(e.detail);
        this._onBundleLoaded= e => this._handleBundleLoaded(e.detail);

        this._container.addEventListener(SGL_LLM.REQUEST_START,    this._onStart);
        this._container.addEventListener(SGL_LLM.REQUEST_CHUNK,    this._onChunk);
        this._container.addEventListener(SGL_LLM.REQUEST_COMPLETE, this._onComplete);
        this._container.addEventListener(SGL_LLM.REQUEST_ERROR,    this._onError);
        this._container.addEventListener(SGL_LLM.BUNDLE_LOADED,    this._onBundleLoaded);
    }

    // --- Handlers ---------------------------------------------------------------

    _handleStart(detail) {
        this._content   = '';
        this._streaming = detail.streaming;
        this._bodyEl.innerHTML = '<div class="output-waiting">Waiting<span class="dots"></span></div>';
        this._footerEl.textContent = '';
    }

    _handleChunk(detail) {
        this._content = detail.accumulated;
        // During streaming always show plain text (fast, no re-render cost)
        this._bodyEl.innerHTML = `<div class="output-text">${this._escapeHtml(this._content)}<span class="output-cursor"></span></div>`;
        this._scrollToBottom();
    }

    _handleComplete(detail) {
        this._content = detail.content;
        this._streaming = false;
        this._displayContent();
        this._footerEl.textContent = detail.promptTokens
            ? `${detail.promptTokens} prompt + ${detail.completionTokens} completion tokens · ${detail.latencyMs}ms`
            : '';
        this._emit(SGL_LLM.OUTPUT_READY, { content: this._content, format: this._markdown ? 'markdown' : 'text' });
    }

    _handleError(detail) {
        this._bodyEl.innerHTML = `<div class="output-error">Error (${detail.status}): ${this._escapeHtml(detail.error)}</div>`;
        this._footerEl.textContent = `Provider: ${detail.provider}`;
    }

    _handleBundleLoaded(detail) {
        if (detail.bundle?.response?.text) {
            this._content = detail.bundle.response.text;
            this._displayContent();
        }
    }

    // --- Display ----------------------------------------------------------------

    _displayContent() {
        if (!this._content) {
            this._bodyEl.innerHTML = '<div class="output-empty">Response will appear here...</div>';
            return;
        }
        if (this._markdown) {
            this._bodyEl.innerHTML = `<div class="output-markdown">${renderMarkdown(this._content)}</div>`;
        } else {
            this._bodyEl.innerHTML = `<div class="output-text">${this._escapeHtml(this._content)}</div>`;
        }
        this._scrollToBottom();
    }

    _toggleMarkdown() {
        this._markdown = !this._markdown;
        this._mdBtn.classList.toggle('active', this._markdown);
        this._displayContent();
    }

    _scrollToBottom() {
        this._bodyEl.scrollTop = this._bodyEl.scrollHeight;
    }

    // --- Copy / Download --------------------------------------------------------

    async _copyContent() {
        if (!this._content) return;
        try {
            await navigator.clipboard.writeText(this._content);
            this._copyBtn.textContent = 'Copied!';
            setTimeout(() => { this._copyBtn.textContent = 'Copy'; }, 1500);
            this._emit(SGL_LLM.OUTPUT_COPIED, {});
        } catch {
            this._copyBtn.textContent = 'Failed';
            setTimeout(() => { this._copyBtn.textContent = 'Copy'; }, 1500);
        }
    }

    _downloadContent() {
        if (!this._content) return;
        const blob = new Blob([this._content], { type: 'text/markdown' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `llm-response-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // --- Utilities --------------------------------------------------------------

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    _emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, {
            detail, bubbles: true, composed: true,
        }));
    }

    // --- Public API -------------------------------------------------------------

    /** Current response content. */
    get content() { return this._content; }

    /** Set content programmatically (e.g. for testing). */
    set content(text) {
        this._content = text;
        this._displayContent();
    }
}

customElements.define('sg-llm-output', SgLlmOutput);
window.SgLlmOutput = SgLlmOutput;
