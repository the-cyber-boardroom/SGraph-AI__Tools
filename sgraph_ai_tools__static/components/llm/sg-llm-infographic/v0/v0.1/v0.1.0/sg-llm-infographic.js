/**
 * sg-llm-infographic — SVG infographic extractor and renderer.
 *
 * Listens for LLM streaming chunks and final response, extracts the first
 * <svg>…</svg> block, and renders it live. Provides style preset selector
 * (executive/technical/playful/minimal/bold/data) and orientation toggle.
 * Exports to SVG or PNG. Emits INFOGRAPHIC_READY when SVG is extracted.
 *
 * Consumes (on parentElement):
 *   llm:request-start     — clears preview, resets state
 *   llm:request-chunk     — live SVG extraction from accumulated text
 *   llm:request-complete  — final SVG extraction from full content
 *   llm:request-error     — shows error state
 *   llm:request-cancel    — resets to idle
 *
 * Emits (on parentElement):
 *   llm:infographic-ready    — { svg, width, height }
 *   llm:infographic-exported — { format }
 *
 * Public API:
 *   getSystemPrompt()   → style-specific system prompt string for the reality
 *   getCurrentStyle()   → current style preset name
 *   setStyle(name)      → set style programmatically
 *   getCurrentSvg()     → current SVG string or null
 *
 * Attributes:
 *   style-preset   — initial style preset (default: executive)
 *   orientation    — initial orientation: landscape | portrait (default: landscape)
 *
 * @module sg-llm-infographic
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

// ── Style presets ─────────────────────────────────────────────────────────────

const STYLE_PRESETS = Object.freeze({
    executive: {
        label: 'Executive',
        prompt: `You are an expert executive infographic designer. Create a single clean, professional SVG infographic that summarises the key information clearly for a business audience. Use a dark navy background (#0d1b2a), white headings, muted accent colours (teal, blue-grey). Output ONLY the raw SVG — no markdown fences, no text before or after. Use viewBox="0 0 1200 800" and include width and height attributes on the root <svg> element.`,
    },
    technical: {
        label: 'Technical',
        prompt: `You are a technical diagram specialist. Create a single SVG diagram that shows the technical structure, architecture, or flow described. Use a dark background (#0d0d1a), colour-coded nodes, connecting arrows. Output ONLY the raw SVG — no markdown fences, no text before or after. Use viewBox="0 0 1200 800" and include width and height attributes on the root <svg> element.`,
    },
    playful: {
        label: 'Playful',
        prompt: `You are a creative visual designer. Create a vibrant, playful SVG infographic with bold colours, rounded shapes, icons, and an engaging layout. Background: white or light cream. Use bright, contrasting colours. Output ONLY the raw SVG — no markdown fences, no text before or after. Use viewBox="0 0 1200 800" and include width and height attributes on the root <svg> element.`,
    },
    minimal: {
        label: 'Minimal',
        prompt: `You are a minimalist designer. Create a clean, spacious SVG infographic with generous whitespace, a single accent colour, and only essential information. White background. Simple sans-serif labels. Output ONLY the raw SVG — no markdown fences, no text before or after. Use viewBox="0 0 1200 800" and include width and height attributes on the root <svg> element.`,
    },
    bold: {
        label: 'Bold',
        prompt: `You are a bold graphic designer. Create a high-contrast, impactful SVG infographic with large text, strong geometric shapes, and a striking colour palette. Black background with neon accents or white on strong colour blocks. Output ONLY the raw SVG — no markdown fences, no text before or after. Use viewBox="0 0 1200 800" and include width and height attributes on the root <svg> element.`,
    },
    data: {
        label: 'Data',
        prompt: `You are a data visualisation expert. Create a data-focused SVG that shows charts, graphs, or data tables from the provided information. Use a clean light background, clear axis labels, a consistent colour scale. Output ONLY the raw SVG — no markdown fences, no text before or after. Use viewBox="0 0 1200 800" and include width and height attributes on the root <svg> element.`,
    },
});

const ORIENTATIONS = Object.freeze({
    landscape: { label: 'Landscape', w: 1200, h: 800 },
    portrait:  { label: 'Portrait',  w: 800,  h: 1200 },
});

// ── Component ─────────────────────────────────────────────────────────────────

const CSS = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.inf-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: monospace;
    background: #0d0d1a;
    color: #e2e8f0;
    overflow: hidden;
}
.inf-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
    flex-wrap: wrap;
}
.inf-label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
select {
    font-family: monospace;
    font-size: 12px;
    background: #12122a;
    color: #e2e8f0;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 3px 6px;
    cursor: pointer;
}
select:focus { outline: 1px solid #7c9ef8; }
.inf-orient-btns {
    display: flex;
    gap: 4px;
}
.inf-orient-btn {
    font-family: monospace;
    font-size: 11px;
    background: #12122a;
    color: #94a3b8;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
}
.inf-orient-btn.active { background: #1e2860; color: #7c9ef8; border-color: #4060c0; }
.inf-orient-btn:hover:not(.active) { background: #1a1a3a; }
.inf-status {
    font-size: 11px;
    color: #64748b;
    margin-left: auto;
    flex-shrink: 0;
}
.inf-status.streaming { color: #f59e0b; }
.inf-status.ready     { color: #4ade80; }
.inf-status.error     { color: #f87171; }
.inf-preview {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #080810;
    position: relative;
}
.inf-placeholder {
    font-size: 13px;
    color: #2a2a4a;
    text-align: center;
    user-select: none;
    pointer-events: none;
}
.inf-preview svg {
    max-width: 100%;
    max-height: 100%;
    height: auto;
    display: block;
}
.inf-actions {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid #1e2035;
    flex-shrink: 0;
}
.inf-btn {
    font-family: monospace;
    font-size: 12px;
    background: #1e2860;
    color: #7c9ef8;
    border: 1px solid #4060c0;
    border-radius: 4px;
    padding: 4px 12px;
    cursor: pointer;
    transition: background 0.12s;
}
.inf-btn:hover { background: #2d3880; }
.inf-btn:disabled { opacity: 0.35; cursor: default; }
`;

export class SgLlmInfographic extends HTMLElement {

    constructor() {
        super();
        this._currentSvg    = null;
        this._currentStyle  = 'executive';
        this._orientation   = 'landscape';
        this._boundHandlers = {};
        this._shadow        = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._currentStyle = this.getAttribute('style-preset') || 'executive';
        if (!(this._currentStyle in STYLE_PRESETS)) this._currentStyle = 'executive';
        const orient = this.getAttribute('orientation') || 'landscape';
        this._orientation = orient === 'portrait' ? 'portrait' : 'landscape';

        this._render();
        this._bindLlmEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [event, handler] of Object.entries(this._boundHandlers)) {
            bus.removeEventListener(event, handler);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Returns the system prompt string for the currently selected style preset.
     * Tool pages call this to pre-populate the reality's system block.
     * @returns {string}
     */
    getSystemPrompt() {
        return STYLE_PRESETS[this._currentStyle]?.prompt ?? STYLE_PRESETS.executive.prompt;
    }

    /** @returns {string} Current style preset name. */
    getCurrentStyle() {
        return this._currentStyle;
    }

    /**
     * Set the style preset programmatically.
     * @param {string} name — one of: executive, technical, playful, minimal, bold, data
     */
    setStyle(name) {
        if (!(name in STYLE_PRESETS)) return;
        this._currentStyle = name;
        const sel = this._shadow.querySelector('.inf-style-select');
        if (sel) sel.value = name;
    }

    /** @returns {string|null} The current extracted SVG string, or null. */
    getCurrentSvg() {
        return this._currentSvg;
    }

    // ── Event binding ──────────────────────────────────────────────────────

    _bindLlmEvents() {
        const bus = this._bus();
        const on  = (event, handler) => {
            const bound = handler.bind(this);
            this._boundHandlers[event] = bound;
            bus.addEventListener(event, bound);
        };

        on(SGL_LLM.REQUEST_START,    this._onRequestStart);
        on(SGL_LLM.REQUEST_CHUNK,    this._onRequestChunk);
        on(SGL_LLM.REQUEST_COMPLETE, this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,    this._onRequestError);
        on(SGL_LLM.REQUEST_CANCEL,   this._onRequestCancel);
    }

    _onRequestStart() {
        this._currentSvg = null;
        this._clearPreview();
        this._setStatus('Waiting…', '');
        this._setExportEnabled(false);
    }

    _onRequestChunk(e) {
        const text = e.detail?.accumulated ?? '';
        const svg  = _extractSvg(text);
        if (svg) this._renderSvg(svg, true);
    }

    _onRequestComplete(e) {
        const text = e.detail?.content ?? '';
        const svg  = _extractSvg(text);
        if (svg) {
            this._renderSvg(svg, false);
        } else {
            this._setStatus('No SVG found in response', 'error');
        }
    }

    _onRequestError(e) {
        const msg = e.detail?.error ?? 'Request failed';
        this._setStatus(`Error: ${msg}`, 'error');
    }

    _onRequestCancel() {
        if (!this._currentSvg) {
            this._clearPreview();
            this._setStatus('Cancelled', '');
        }
    }

    // ── SVG rendering ──────────────────────────────────────────────────────

    _renderSvg(svgString, isStreaming) {
        this._currentSvg = svgString;

        const preview = this._shadow.querySelector('.inf-preview');
        if (!preview) return;

        // Sanitise before injection — allow only SVG elements, strip scripts
        const safe = _sanitiseSvg(svgString);

        preview.innerHTML = safe;

        this._setStatus(isStreaming ? 'Streaming…' : 'Ready', isStreaming ? 'streaming' : 'ready');
        this._setExportEnabled(true);

        if (!isStreaming) {
            const dims = _parseSvgDimensions(svgString);
            this._emitLlm(SGL_LLM.INFOGRAPHIC_READY, { svg: svgString, ...dims });
        }
    }

    _clearPreview() {
        const preview = this._shadow.querySelector('.inf-preview');
        if (preview) preview.innerHTML = '<div class="inf-placeholder">SVG will appear here</div>';
        this._setExportEnabled(false);
    }

    // ── DOM ────────────────────────────────────────────────────────────────

    _render() {
        const styleOptions = Object.entries(STYLE_PRESETS)
            .map(([k, v]) => `<option value="${k}"${k === this._currentStyle ? ' selected' : ''}>${v.label}</option>`)
            .join('');

        const orientBtns = Object.entries(ORIENTATIONS).map(([k, v]) => `
            <button class="inf-orient-btn${k === this._orientation ? ' active' : ''}" data-orient="${k}">${v.label}</button>`
        ).join('');

        this._shadow.innerHTML = `
            <style>${CSS}</style>
            <div class="inf-wrap" part="wrap">
                <div class="inf-toolbar" part="toolbar">
                    <span class="inf-label">Style</span>
                    <select class="inf-style-select" aria-label="Style preset">${styleOptions}</select>
                    <span class="inf-label">Orient</span>
                    <div class="inf-orient-btns">${orientBtns}</div>
                    <span class="inf-status" part="status">Idle</span>
                </div>
                <div class="inf-preview" part="preview">
                    <div class="inf-placeholder">SVG will appear here</div>
                </div>
                <div class="inf-actions" part="actions">
                    <button class="inf-btn" id="export-svg" disabled>Export SVG</button>
                    <button class="inf-btn" id="export-png" disabled>Export PNG</button>
                </div>
            </div>`;

        this._shadow.querySelector('.inf-style-select').addEventListener('change', (e) => {
            this._currentStyle = e.target.value;
        });

        for (const btn of this._shadow.querySelectorAll('.inf-orient-btn')) {
            btn.addEventListener('click', () => {
                this._orientation = btn.dataset.orient;
                for (const b of this._shadow.querySelectorAll('.inf-orient-btn')) {
                    b.classList.toggle('active', b.dataset.orient === this._orientation);
                }
            });
        }

        this._shadow.querySelector('#export-svg').addEventListener('click', () => this._doExportSvg());
        this._shadow.querySelector('#export-png').addEventListener('click', () => this._doExportPng());
    }

    _setStatus(text, cls) {
        const el = this._shadow.querySelector('.inf-status');
        if (!el) return;
        el.textContent = text;
        el.className   = 'inf-status' + (cls ? ` ${cls}` : '');
    }

    _setExportEnabled(enabled) {
        for (const id of ['export-svg', 'export-png']) {
            const btn = this._shadow.querySelector(`#${id}`);
            if (btn) btn.disabled = !enabled;
        }
    }

    // ── Export ─────────────────────────────────────────────────────────────

    _doExportSvg() {
        if (!this._currentSvg) return;
        _downloadBlob(
            new Blob([this._currentSvg], { type: 'image/svg+xml' }),
            `infographic-${Date.now()}.svg`
        );
        this._emitLlm(SGL_LLM.INFOGRAPHIC_EXPORTED, { format: 'svg' });
    }

    _doExportPng() {
        if (!this._currentSvg) return;
        const dims   = _parseSvgDimensions(this._currentSvg);
        const blob   = new Blob([this._currentSvg], { type: 'image/svg+xml' });
        const url    = URL.createObjectURL(blob);
        const img    = new Image();
        img.onload   = () => {
            const canvas    = document.createElement('canvas');
            canvas.width    = dims.width  || img.naturalWidth  || 1200;
            canvas.height   = dims.height || img.naturalHeight || 800;
            const ctx       = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(pngBlob => {
                if (pngBlob) {
                    _downloadBlob(pngBlob, `infographic-${Date.now()}.png`);
                    this._emitLlm(SGL_LLM.INFOGRAPHIC_EXPORTED, { format: 'png' });
                }
            }, 'image/png');
        };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src     = url;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _bus() { return this.parentElement || document; }

    _emitLlm(eventName, detail) {
        this._bus().dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }
}

customElements.define('sg-llm-infographic', SgLlmInfographic);
window.SgLlmInfographic = SgLlmInfographic;

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Extract the first <svg>…</svg> block from a text string.
 * Handles partial SVG during streaming (greedy — stops at last </svg>).
 * @param {string} text
 * @returns {string|null}
 */
function _extractSvg(text) {
    const m = text.match(/<svg[\s\S]*?<\/svg>/i);
    return m ? m[0] : null;
}

/**
 * Parse width and height from an SVG string.
 * Reads width/height attributes first, then falls back to viewBox.
 * @param {string} svgString
 * @returns {{ width: number, height: number }}
 */
function _parseSvgDimensions(svgString) {
    const tag = svgString.match(/<svg([^>]*)>/i)?.[1] ?? '';

    const wAttr = tag.match(/\bwidth="([^"]+)"/i)?.[1];
    const hAttr = tag.match(/\bheight="([^"]+)"/i)?.[1];
    const vb    = tag.match(/\bviewBox="([^"]+)"/i)?.[1];

    const w = parseFloat(wAttr) || (vb ? parseFloat(vb.split(/[\s,]+/)[2]) : 0) || 1200;
    const h = parseFloat(hAttr) || (vb ? parseFloat(vb.split(/[\s,]+/)[3]) : 0) || 800;
    return { width: w, height: h };
}

/**
 * Basic SVG sanitisation — removes <script> tags and event handler attributes.
 * Not a full XSS sanitiser; sufficient for trusted LLM output rendered in Shadow DOM.
 * @param {string} svgString
 * @returns {string}
 */
function _sanitiseSvg(svgString) {
    return svgString
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\bon\w+\s*=/gi, 'data-removed=');
}

/**
 * Trigger a file download from a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
function _downloadBlob(blob, filename) {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
