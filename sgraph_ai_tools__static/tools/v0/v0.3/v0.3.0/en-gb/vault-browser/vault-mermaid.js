/**
 * <vault-mermaid> — Renders Mermaid diagrams with fullscreen support and zoom.
 *
 * Loads Mermaid from CDN on first use, then renders markup into SVG.
 * Includes a toolbar with zoom controls and fullscreen button.
 * Supports caching rendered SVGs keyed by markup hash.
 *
 * Methods:
 *   render(markup)             — Render a Mermaid diagram string
 *   render(markup, { cache })  — Render with caching (cache key = markup)
 *   clear()                    — Remove the diagram
 *   clearCache()               — Clear all cached diagrams
 */

let _mermaidReady = null

/** @type {Map<string, string>} markup hash → SVG string */
const _svgCache = new Map()

function loadMermaid() {
    if (_mermaidReady) return _mermaidReady

    _mermaidReady = new Promise((resolve, reject) => {
        if (window.mermaid) {
            window.mermaid.initialize({
                startOnLoad: false,
                theme: 'dark',
                themeVariables: {
                    primaryColor:       '#1a3a5c',
                    primaryTextColor:   '#e0e0e0',
                    primaryBorderColor: '#4ecdc4',
                    lineColor:          '#4ecdc4',
                    secondaryColor:     '#16213E',
                    tertiaryColor:      '#0f3460',
                    git0:     '#4ecdc4',
                    git1:     '#82aaff',
                    git2:     '#c792ea',
                    git3:     '#f78c6c',
                    git4:     '#c3e88d',
                    git5:     '#89ddff',
                    git6:     '#ffcb6b',
                    git7:     '#ff5370',
                    gitBranchLabel0: '#e0e0e0',
                    gitBranchLabel1: '#e0e0e0',
                    gitBranchLabel2: '#e0e0e0',
                    gitBranchLabel3: '#e0e0e0',
                }
            })
            return resolve()
        }

        const script  = document.createElement('script')
        script.type   = 'module'
        script.textContent = `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
            mermaid.initialize({
                startOnLoad: false,
                theme: 'dark',
                themeVariables: {
                    primaryColor:       '#1a3a5c',
                    primaryTextColor:   '#e0e0e0',
                    primaryBorderColor: '#4ecdc4',
                    lineColor:          '#4ecdc4',
                    secondaryColor:     '#16213E',
                    tertiaryColor:      '#0f3460',
                    git0:     '#4ecdc4',
                    git1:     '#82aaff',
                    git2:     '#c792ea',
                    git3:     '#f78c6c',
                    git4:     '#c3e88d',
                    git5:     '#89ddff',
                    git6:     '#ffcb6b',
                    git7:     '#ff5370',
                    gitBranchLabel0: '#e0e0e0',
                    gitBranchLabel1: '#e0e0e0',
                    gitBranchLabel2: '#e0e0e0',
                    gitBranchLabel3: '#e0e0e0',
                }
            });
            window.mermaid = mermaid;
            window.dispatchEvent(new Event('mermaid-ready'));
        `
        window.addEventListener('mermaid-ready', () => resolve(), { once: true })
        script.onerror = () => reject(new Error('Failed to load Mermaid'))
        document.head.appendChild(script)
    })

    return _mermaidReady
}

/** Simple string hash for cache key */
function _hashMarkup(s) {
    let h = 0
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0
    }
    return 'mc_' + (h >>> 0).toString(36)
}

export class VaultMermaid extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-mermaid { display: block; position: relative; }
                vault-mermaid .vm-container {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 1rem;
                    overflow: auto;
                    min-height: 80px;
                }
                vault-mermaid .vm-container svg {
                    max-width: 100%;
                    height: auto;
                    transform-origin: top left;
                    transition: transform 0.2s ease;
                }
                vault-mermaid .vm-loading {
                    color: var(--sg-text-dim);
                    font-size: 0.8125rem;
                    font-style: italic;
                }
                vault-mermaid .vm-error {
                    color: var(--sg-error, #e94560);
                    font-size: 0.8125rem;
                    font-family: var(--sg-font-mono);
                    white-space: pre-wrap;
                }
                vault-mermaid .vm-toolbar {
                    display: none;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 0.25rem;
                    gap: 0.5rem;
                }
                vault-mermaid .vm-toolbar-left {
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                }
                vault-mermaid .vm-toolbar-right {
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                }
                vault-mermaid .vm-btn {
                    background: rgba(15, 52, 96, 0.85);
                    border: 1px solid var(--sg-border);
                    color: var(--sg-text-dim);
                    cursor: pointer;
                    border-radius: 4px;
                    padding: 0.25rem 0.5rem;
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                    transition: color 0.15s, border-color 0.15s, background 0.15s;
                    line-height: 1;
                }
                vault-mermaid .vm-btn:hover {
                    color: var(--sg-accent);
                    border-color: var(--sg-accent);
                    background: rgba(15, 52, 96, 1);
                }
                vault-mermaid .vm-btn.vm-active {
                    color: var(--sg-accent);
                    border-color: var(--sg-accent);
                }
                vault-mermaid .vm-zoom-level {
                    font-size: 0.7rem;
                    color: var(--sg-text-dim);
                    font-family: var(--sg-font-mono);
                    min-width: 2.5rem;
                    text-align: center;
                }
                vault-mermaid .vm-cache-badge {
                    font-size: 0.65rem;
                    color: #c3e88d;
                    font-family: var(--sg-font-mono);
                    opacity: 0.7;
                    margin-left: 0.25rem;
                }

                /* Fullscreen overlay */
                .vm-fullscreen-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 10000;
                    background: var(--sg-bg, #0a0e27);
                    display: flex;
                    flex-direction: column;
                }
                .vm-fullscreen-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.5rem 1rem;
                    background: rgba(15, 52, 96, 0.5);
                    border-bottom: 1px solid var(--sg-border);
                    flex-shrink: 0;
                }
                .vm-fullscreen-toolbar .vm-fs-left {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                .vm-fullscreen-toolbar .vm-fs-title {
                    color: var(--sg-text-dim);
                    font-size: 0.8125rem;
                    font-family: var(--sg-font-mono);
                }
                .vm-fullscreen-toolbar .vm-fs-close {
                    background: none;
                    border: 1px solid var(--sg-border);
                    color: var(--sg-text);
                    cursor: pointer;
                    border-radius: 4px;
                    padding: 0.25rem 0.75rem;
                    font-size: 0.8125rem;
                    transition: color 0.15s, border-color 0.15s;
                }
                .vm-fullscreen-toolbar .vm-fs-close:hover {
                    color: var(--sg-accent);
                    border-color: var(--sg-accent);
                }
                .vm-fullscreen-body {
                    flex: 1;
                    overflow: auto;
                    display: flex;
                    align-items: flex-start;
                    justify-content: center;
                    padding: 1rem;
                }
                .vm-fullscreen-body svg {
                    max-width: 95vw;
                    max-height: none;
                    height: auto;
                    width: auto;
                    transform-origin: top center;
                    transition: transform 0.2s ease;
                }
            </style>
            <div class="vm-toolbar" id="vm-toolbar">
                <div class="vm-toolbar-left">
                    <button class="vm-btn" id="vm-zoom-out" title="Zoom out">−</button>
                    <span class="vm-zoom-level" id="vm-zoom-level">100%</span>
                    <button class="vm-btn" id="vm-zoom-in" title="Zoom in">+</button>
                    <button class="vm-btn" id="vm-zoom-fit" title="Fit to view">Fit</button>
                    <span class="vm-cache-badge" id="vm-cache-badge"></span>
                </div>
                <div class="vm-toolbar-right">
                    <button class="vm-btn" id="vm-maximize" title="Open in fullscreen">Fullscreen</button>
                </div>
            </div>
            <div class="vm-container" id="vm-container"></div>`

        this._container  = this.querySelector('#vm-container')
        this._toolbar    = this.querySelector('#vm-toolbar')
        this._zoomLabel  = this.querySelector('#vm-zoom-level')
        this._cacheBadge = this.querySelector('#vm-cache-badge')
        this._svgMarkup  = null
        this._zoom       = 1.0
        this._fsZoom     = 1.0

        this.querySelector('#vm-maximize').addEventListener('click', () => this._openFullscreen())
        this.querySelector('#vm-zoom-in').addEventListener('click', () => this._setZoom(this._zoom + 0.15))
        this.querySelector('#vm-zoom-out').addEventListener('click', () => this._setZoom(this._zoom - 0.15))
        this.querySelector('#vm-zoom-fit').addEventListener('click', () => this._setZoom(1.0))
    }

    /**
     * @param {string} markup — Mermaid diagram markup
     * @param {object} [opts]
     * @param {boolean} [opts.cache=false] — Use cache if available
     */
    async render(markup, opts = {}) {
        const useCache = opts.cache !== false
        const cacheKey = _hashMarkup(markup)

        this._container.innerHTML = '<div class="vm-loading">Loading diagram…</div>'
        this._toolbar.style.display = 'none'
        this._cacheBadge.textContent = ''
        this._svgMarkup = null
        this._zoom = 1.0

        // Check cache first
        if (useCache && _svgCache.has(cacheKey)) {
            this._container.innerHTML = _svgCache.get(cacheKey)
            this._svgMarkup = _svgCache.get(cacheKey)
            this._toolbar.style.display = 'flex'
            this._cacheBadge.textContent = 'cached'
            this._updateZoomLabel()
            return
        }

        try {
            await loadMermaid()
            const id  = 'mermaid-' + Math.random().toString(36).slice(2, 10)
            const { svg } = await window.mermaid.render(id, markup)
            this._container.innerHTML = svg
            this._svgMarkup = svg
            this._toolbar.style.display = 'flex'
            this._updateZoomLabel()

            // Store in cache
            if (useCache) {
                _svgCache.set(cacheKey, svg)
            }
        } catch (err) {
            this._container.innerHTML = `<div class="vm-error">Diagram error: ${this._esc(err.message)}</div>`
        }
    }

    clear() {
        this._container.innerHTML = ''
        this._toolbar.style.display = 'none'
        this._svgMarkup = null
        this._zoom = 1.0
    }

    /** Clear all cached SVGs */
    clearCache() {
        _svgCache.clear()
    }

    _setZoom(level) {
        this._zoom = Math.max(0.25, Math.min(3.0, level))
        const svg = this._container.querySelector('svg')
        if (svg) {
            svg.style.transform = `scale(${this._zoom})`
        }
        this._updateZoomLabel()
    }

    _updateZoomLabel() {
        this._zoomLabel.textContent = `${Math.round(this._zoom * 100)}%`
    }

    _openFullscreen() {
        if (!this._svgMarkup) return
        this._fsZoom = 1.0

        const overlay = document.createElement('div')
        overlay.className = 'vm-fullscreen-overlay'

        overlay.innerHTML = `
            <div class="vm-fullscreen-toolbar">
                <div class="vm-fs-left">
                    <span class="vm-fs-title">Diagram — press Esc to close</span>
                    <button class="vm-btn vm-fs-zoom-out" title="Zoom out">−</button>
                    <span class="vm-zoom-level vm-fs-zoom-level">100%</span>
                    <button class="vm-btn vm-fs-zoom-in" title="Zoom in">+</button>
                    <button class="vm-btn vm-fs-zoom-fit" title="Fit to view">Fit</button>
                </div>
                <button class="vm-fs-close">Close</button>
            </div>
            <div class="vm-fullscreen-body">${this._svgMarkup}</div>`

        // Remove max-width constraint so the SVG can fill the viewport
        const svg = overlay.querySelector('.vm-fullscreen-body svg')
        if (svg) {
            svg.removeAttribute('width')
            svg.style.maxWidth  = '95vw'
            svg.style.maxHeight = 'none'
            svg.style.width     = 'auto'
            svg.style.height    = 'auto'
        }

        const fsZoomLabel = overlay.querySelector('.vm-fs-zoom-level')

        const setFsZoom = (level) => {
            this._fsZoom = Math.max(0.25, Math.min(3.0, level))
            if (svg) svg.style.transform = `scale(${this._fsZoom})`
            fsZoomLabel.textContent = `${Math.round(this._fsZoom * 100)}%`
        }

        overlay.querySelector('.vm-fs-zoom-in').addEventListener('click', () => setFsZoom(this._fsZoom + 0.15))
        overlay.querySelector('.vm-fs-zoom-out').addEventListener('click', () => setFsZoom(this._fsZoom - 0.15))
        overlay.querySelector('.vm-fs-zoom-fit').addEventListener('click', () => setFsZoom(1.0))

        // Clone click handlers from original SVG nodes
        this._wireFullscreenClicks(overlay)

        const close = () => {
            overlay.remove()
            document.removeEventListener('keydown', escHandler)
        }

        const escHandler = (e) => {
            if (e.key === 'Escape') close()
        }

        overlay.querySelector('.vm-fs-close').addEventListener('click', close)
        document.addEventListener('keydown', escHandler)
        document.body.appendChild(overlay)
    }

    /** Re-wire click handlers on fullscreen SVG nodes so they emit events from this element */
    _wireFullscreenClicks(overlay) {
        const origSvg = this._container.querySelector('svg')
        if (!origSvg) return

        const origNodes = origSvg.querySelectorAll('.node')
        const fsNodes   = overlay.querySelectorAll('.vm-fullscreen-body svg .node')

        // Map by index (same rendering order)
        for (let i = 0; i < fsNodes.length && i < origNodes.length; i++) {
            const origNode = origNodes[i]
            const fsNode   = fsNodes[i]
            fsNode.style.cursor = 'pointer'
            fsNode.addEventListener('click', () => {
                // Trigger a click on the original node to reuse its handlers
                origNode.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            })
        }
    }

    _esc(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    }
}

customElements.define('vault-mermaid', VaultMermaid)
