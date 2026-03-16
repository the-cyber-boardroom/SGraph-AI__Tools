/**
 * <vault-mermaid> — Renders Mermaid diagrams with fullscreen support.
 *
 * Loads Mermaid from CDN on first use, then renders markup into SVG.
 * Includes a maximize button that opens the diagram in a fullscreen overlay.
 *
 * Methods:
 *   render(markup)  — Render a Mermaid diagram string
 *   clear()         — Remove the diagram
 */

let _mermaidReady = null

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
                vault-mermaid .vm-maximize-btn {
                    position: absolute;
                    top: 0.5rem;
                    right: 0.5rem;
                    background: rgba(15, 52, 96, 0.85);
                    border: 1px solid var(--sg-border);
                    color: var(--sg-text-dim);
                    cursor: pointer;
                    border-radius: 4px;
                    padding: 0.25rem 0.5rem;
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                    z-index: 2;
                    transition: color 0.15s, border-color 0.15s, background 0.15s;
                    display: none;
                }
                vault-mermaid .vm-maximize-btn:hover {
                    color: var(--sg-accent);
                    border-color: var(--sg-accent);
                    background: rgba(15, 52, 96, 1);
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
                    align-items: center;
                    justify-content: center;
                    padding: 1rem;
                }
                .vm-fullscreen-body svg {
                    max-width: 95vw;
                    max-height: 90vh;
                    height: auto;
                    width: auto;
                }
            </style>
            <button class="vm-maximize-btn" id="vm-maximize" title="Fullscreen">Fullscreen</button>
            <div class="vm-container" id="vm-container"></div>`

        this._container   = this.querySelector('#vm-container')
        this._maximizeBtn = this.querySelector('#vm-maximize')
        this._svgMarkup   = null

        this._maximizeBtn.addEventListener('click', () => this._openFullscreen())
    }

    async render(markup) {
        this._container.innerHTML = '<div class="vm-loading">Loading diagram…</div>'
        this._maximizeBtn.style.display = 'none'
        this._svgMarkup = null

        try {
            await loadMermaid()
            const id  = 'mermaid-' + Math.random().toString(36).slice(2, 10)
            const { svg } = await window.mermaid.render(id, markup)
            this._container.innerHTML = svg
            this._svgMarkup = svg
            this._maximizeBtn.style.display = ''
        } catch (err) {
            this._container.innerHTML = `<div class="vm-error">Diagram error: ${this._esc(err.message)}</div>`
        }
    }

    clear() {
        this._container.innerHTML = ''
        this._maximizeBtn.style.display = 'none'
        this._svgMarkup = null
    }

    _openFullscreen() {
        if (!this._svgMarkup) return

        const overlay = document.createElement('div')
        overlay.className = 'vm-fullscreen-overlay'

        overlay.innerHTML = `
            <div class="vm-fullscreen-toolbar">
                <span class="vm-fs-title">Diagram — press Esc to close</span>
                <button class="vm-fs-close">Close</button>
            </div>
            <div class="vm-fullscreen-body">${this._svgMarkup}</div>`

        // Remove max-width constraint so the SVG can fill the viewport
        const svg = overlay.querySelector('.vm-fullscreen-body svg')
        if (svg) {
            svg.removeAttribute('width')
            svg.style.maxWidth  = '95vw'
            svg.style.maxHeight = '88vh'
            svg.style.width     = 'auto'
            svg.style.height    = 'auto'
        }

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
