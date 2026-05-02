/**
 * <sg-mermaid-render> — Mermaid diagram renderer with zoom + fullscreen.
 *
 * Lazy-loads Mermaid v11 from CDN (esm.min.mjs) on first render call.
 * SVG cache is shared across all instances; keyed by markup hash.
 *
 * API:
 *   render(markup, {cache=true})  → Promise<void>
 *   clear()                       → void
 *   clearCache()                  → void (clears the shared module-level cache)
 *   getSvg()                      → string|null (current rendered SVG string)
 *
 * Events (dispatched on the element, bubbles + composed):
 *   sg-mermaid:rendered  — { markup, svg }
 *   sg-mermaid:error     — { markup, error }
 *
 * Attributes:
 *   theme  — 'dark' (default) | 'default' | 'neutral' | 'forest' | 'base'
 *
 * @module sg-mermaid-render
 * @version 0.1.0
 */

/** Shared lazy-load promise — resolved once mermaid is on window.mermaid */
let _mermaidReady = null;

/** @type {Map<string, string>} markup hash → SVG string */
const _svgCache = new Map();

/** @param {string} s @returns {string} */
function _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'smr_' + (h >>> 0).toString(36);
}

/** @param {string} theme @returns {object} */
function _themeVars(theme) {
    if (theme !== 'dark') return {};
    return {
        primaryColor:       '#1a3a5c',
        primaryTextColor:   '#e0e0e0',
        primaryBorderColor: '#4ecdc4',
        lineColor:          '#4ecdc4',
        secondaryColor:     '#16213e',
        tertiaryColor:      '#0f3460',
        git0: '#4ecdc4', git1: '#82aaff', git2: '#c792ea', git3: '#f78c6c',
        git4: '#c3e88d', git5: '#89ddff', git6: '#ffcb6b', git7: '#ff5370',
        gitBranchLabel0: '#e0e0e0', gitBranchLabel1: '#e0e0e0',
        gitBranchLabel2: '#e0e0e0', gitBranchLabel3: '#e0e0e0',
    };
}

/**
 * Lazy-load Mermaid from CDN and initialise with the given theme.
 * @param {string} theme
 * @returns {Promise<void>}
 */
export function loadMermaidLib(theme = 'dark') {
    if (_mermaidReady) return _mermaidReady;
    _mermaidReady = new Promise((resolve, reject) => {
        if (window.mermaid) {
            window.mermaid.initialize({ startOnLoad: false, theme, themeVariables: _themeVars(theme) });
            return resolve();
        }
        const script = document.createElement('script');
        script.type = 'module';
        script.textContent = `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
            mermaid.initialize({ startOnLoad: false, theme: '${theme}',
                themeVariables: ${JSON.stringify(_themeVars(theme))} });
            window.mermaid = mermaid;
            window.dispatchEvent(new Event('sg-mermaid-lib-ready'));
        `;
        window.addEventListener('sg-mermaid-lib-ready', () => resolve(), { once: true });
        script.onerror = () => reject(new Error('Failed to load Mermaid from CDN'));
        document.head.appendChild(script);
    });
    return _mermaidReady;
}

const STYLES = `
:host { display: block; position: relative; }
.smr-toolbar { display: none; align-items: center; justify-content: space-between;
    margin-bottom: 0.25rem; gap: 0.5rem; }
.smr-toolbar-left, .smr-toolbar-right { display: flex; align-items: center; gap: 0.25rem; }
.smr-btn { background: rgba(15,52,96,.85); border: 1px solid var(--sg-border,#1a2a3a);
    color: var(--sg-text-dim,#8899aa); cursor: pointer; border-radius: 4px;
    padding: .25rem .5rem; font-size: .75rem; font-family: var(--sg-font-mono,monospace);
    transition: color .15s, border-color .15s, background .15s; line-height: 1; }
.smr-btn:hover { color: var(--sg-accent,#4ecdc4); border-color: var(--sg-accent,#4ecdc4);
    background: rgba(15,52,96,1); }
.smr-zoom-label { font-size: .7rem; color: var(--sg-text-dim,#8899aa);
    font-family: var(--sg-font-mono,monospace); min-width: 2.5rem; text-align: center; }
.smr-cache-badge { font-size: .65rem; color: #c3e88d; font-family: var(--sg-font-mono,monospace);
    opacity: .7; margin-left: .25rem; }
.smr-container { background: var(--sg-bg-card,#0d1117); border: 1px solid var(--sg-border,#1a2a3a);
    border-radius: var(--sg-radius,6px); padding: 1rem; overflow: auto; min-height: 120px;
    display: flex; align-items: center; justify-content: center; }
.smr-container svg { max-width: 100%; height: auto; transform-origin: top left;
    transition: transform .2s ease; }
.smr-loading { color: var(--sg-text-dim,#8899aa); font-size: .8125rem; font-style: italic; }
.smr-error { color: var(--sg-error,#e94560); font-size: .8125rem;
    font-family: var(--sg-font-mono,monospace); white-space: pre-wrap; }
.smr-empty { color: var(--sg-text-dim,#8899aa); font-size: .8125rem; opacity: .5; }
/* Fullscreen overlay lives in document body, not shadow DOM */
`;

export class SgMermaidRender extends HTMLElement {
    connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>${STYLES}</style>
<div class="smr-toolbar" id="tb">
  <div class="smr-toolbar-left">
    <button class="smr-btn" id="zo" title="Zoom out">−</button>
    <span class="smr-zoom-label" id="zl">100%</span>
    <button class="smr-btn" id="zi" title="Zoom in">+</button>
    <button class="smr-btn" id="zf" title="Fit to view">Fit</button>
    <span class="smr-cache-badge" id="cb"></span>
  </div>
  <div class="smr-toolbar-right">
    <button class="smr-btn" id="fs">⛶ Fullscreen</button>
  </div>
</div>
<div class="smr-container" id="ct"><span class="smr-empty">No diagram loaded</span></div>`;

        this._ct  = shadow.getElementById('ct');
        this._tb  = shadow.getElementById('tb');
        this._zl  = shadow.getElementById('zl');
        this._cb  = shadow.getElementById('cb');
        this._svg = null;
        this._zoom = 1.0;
        this._fsZoom = 1.0;

        shadow.getElementById('zi').addEventListener('click', () => this._setZoom(this._zoom + 0.15));
        shadow.getElementById('zo').addEventListener('click', () => this._setZoom(this._zoom - 0.15));
        shadow.getElementById('zf').addEventListener('click', () => this._setZoom(1.0));
        shadow.getElementById('fs').addEventListener('click', () => this._openFullscreen());
    }

    /**
     * @param {string} markup  Mermaid diagram source
     * @param {{cache?: boolean}} [opts]
     */
    async render(markup, opts = {}) {
        const useCache = opts.cache !== false;
        const key = _hash(markup);
        this._svg = null;
        this._zoom = 1.0;
        this._tb.style.display = 'none';
        this._cb.textContent = '';
        this._ct.innerHTML = '<span class="smr-loading">Rendering diagram…</span>';

        if (useCache && _svgCache.has(key)) {
            const svg = _svgCache.get(key);
            this._ct.innerHTML = svg;
            this._svg = svg;
            this._tb.style.display = 'flex';
            this._cb.textContent = 'cached';
            this._updateZoom();
            this._emit('sg-mermaid:rendered', { markup, svg });
            return;
        }

        const theme = this.getAttribute('theme') || 'dark';
        try {
            await loadMermaidLib(theme);
            const id = 'smr-' + Math.random().toString(36).slice(2, 10);
            const { svg } = await window.mermaid.render(id, markup);
            this._ct.innerHTML = svg;
            this._svg = svg;
            this._tb.style.display = 'flex';
            this._updateZoom();
            if (useCache) _svgCache.set(key, svg);
            this._emit('sg-mermaid:rendered', { markup, svg });
        } catch (err) {
            this._ct.innerHTML = `<span class="smr-error">Diagram error:\n${this._esc(err.message)}</span>`;
            this._emit('sg-mermaid:error', { markup, error: err.message });
        }
    }

    clear() {
        this._ct.innerHTML = '<span class="smr-empty">No diagram loaded</span>';
        this._tb.style.display = 'none';
        this._svg = null;
        this._zoom = 1.0;
    }

    clearCache() { _svgCache.clear(); }

    /** @returns {string|null} */
    getSvg() { return this._svg; }

    _setZoom(level) {
        this._zoom = Math.max(0.2, Math.min(4.0, level));
        const svg = this._ct.querySelector('svg');
        if (svg) svg.style.transform = `scale(${this._zoom})`;
        this._updateZoom();
    }

    _updateZoom() {
        this._zl.textContent = `${Math.round(this._zoom * 100)}%`;
    }

    _openFullscreen() {
        if (!this._svg) return;
        this._fsZoom = 1.0;

        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0a0e27;display:flex;flex-direction:column;font-family:system-ui,sans-serif;';

        ov.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 1rem;background:rgba(15,52,96,.5);border-bottom:1px solid #1a2a3a;flex-shrink:0;">
  <div style="display:flex;align-items:center;gap:.5rem;">
    <span style="color:#8899aa;font-size:.8125rem;font-family:monospace;">Fullscreen — press Esc to close</span>
    <button data-a="zo" style="background:rgba(15,52,96,.85);border:1px solid #1a2a3a;color:#8899aa;cursor:pointer;border-radius:4px;padding:.25rem .5rem;font-size:.75rem;font-family:monospace;">−</button>
    <span data-a="zl" style="font-size:.7rem;color:#8899aa;font-family:monospace;min-width:2.5rem;text-align:center;">100%</span>
    <button data-a="zi" style="background:rgba(15,52,96,.85);border:1px solid #1a2a3a;color:#8899aa;cursor:pointer;border-radius:4px;padding:.25rem .5rem;font-size:.75rem;font-family:monospace;">+</button>
    <button data-a="zf" style="background:rgba(15,52,96,.85);border:1px solid #1a2a3a;color:#8899aa;cursor:pointer;border-radius:4px;padding:.25rem .5rem;font-size:.75rem;font-family:monospace;">Fit</button>
  </div>
  <button data-a="cl" style="background:none;border:1px solid #1a2a3a;color:#e0e0e0;cursor:pointer;border-radius:4px;padding:.25rem .75rem;font-size:.8125rem;">Close</button>
</div>
<div data-a="body" style="flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:1rem;">${this._svg}</div>`;

        const body = ov.querySelector('[data-a="body"]');
        const svg  = body.querySelector('svg');
        if (svg) { svg.removeAttribute('width'); svg.style.cssText = 'max-width:95vw;height:auto;width:auto;transform-origin:top center;transition:transform .2s ease;'; }
        const zl   = ov.querySelector('[data-a="zl"]');
        const zoom = lv => {
            this._fsZoom = Math.max(0.2, Math.min(4.0, lv));
            if (svg) svg.style.transform = `scale(${this._fsZoom})`;
            zl.textContent = `${Math.round(this._fsZoom * 100)}%`;
        };
        ov.querySelector('[data-a="zi"]').addEventListener('click', () => zoom(this._fsZoom + 0.15));
        ov.querySelector('[data-a="zo"]').addEventListener('click', () => zoom(this._fsZoom - 0.15));
        ov.querySelector('[data-a="zf"]').addEventListener('click', () => zoom(1.0));
        const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
        const esc = e => { if (e.key === 'Escape') close(); };
        ov.querySelector('[data-a="cl"]').addEventListener('click', close);
        document.addEventListener('keydown', esc);
        document.body.appendChild(ov);
    }

    _emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }

    _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

customElements.define('sg-mermaid-render', SgMermaidRender);
