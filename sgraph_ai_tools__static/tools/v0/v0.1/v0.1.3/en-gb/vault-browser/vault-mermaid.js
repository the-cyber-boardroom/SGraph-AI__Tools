/**
 * <vault-mermaid> — Renders Mermaid diagrams.
 *
 * Loads Mermaid from CDN on first use, then renders markup into SVG.
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
                vault-mermaid { display: block; }
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
            </style>
            <div class="vm-container" id="vm-container"></div>`

        this._container = this.querySelector('#vm-container')
    }

    async render(markup) {
        this._container.innerHTML = '<div class="vm-loading">Loading diagram…</div>'

        try {
            await loadMermaid()
            // mermaid.render needs a unique ID
            const id  = 'mermaid-' + Math.random().toString(36).slice(2, 10)
            const { svg } = await window.mermaid.render(id, markup)
            this._container.innerHTML = svg
        } catch (err) {
            this._container.innerHTML = `<div class="vm-error">Diagram error: ${this._esc(err.message)}</div>`
        }
    }

    clear() {
        this._container.innerHTML = ''
    }

    _esc(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    }
}

customElements.define('vault-mermaid', VaultMermaid)
