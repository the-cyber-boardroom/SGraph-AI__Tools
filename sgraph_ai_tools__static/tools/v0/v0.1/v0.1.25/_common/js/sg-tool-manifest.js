/* =================================================================================
   SGraph — Tool Manifest Web Component
   v0.1.0 — Renders a collapsible dependency panel from a tool's manifest.json

   Usage (in any tool's index.html):
     <script type="module" src="/_common/js/sg-tool-manifest.js"></script>
     <sg-tool-manifest src="manifest.json"></sg-tool-manifest>

   The component fetches the JSON from the `src` attribute (relative to current
   page), then renders name, version, status badge, and a dependency table.
   If the fetch fails, the element stays empty — no layout shift.
   ================================================================================= */

const STYLE = `
:host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #cbd5e0;
}
.manifest-panel {
    background: #0d0d1a;
    border: 1px solid #1e293b;
    border-radius: 6px;
    overflow: hidden;
}
.manifest-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
}
.manifest-header:hover {
    background: rgba(78, 205, 196, 0.04);
}
.manifest-icon {
    font-size: 16px;
    line-height: 1;
}
.manifest-name {
    font-weight: 600;
    font-size: 13px;
}
.manifest-version {
    color: #64748b;
    font-size: 11px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
}
.manifest-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.badge-live         { background: rgba(78,205,196,0.15); color: #4ecdc4; }
.badge-new          { background: rgba(251,191,36,0.12); color: #fbbf24; }
.badge-experimental { background: rgba(148,163,184,0.1); color: #94a3b8; }
.badge-dev          { background: rgba(139,92,246,0.12); color: #a78bfa; }
.manifest-toggle {
    margin-left: auto;
    color: #64748b;
    font-size: 11px;
    transition: transform 150ms;
}
.manifest-toggle.open {
    transform: rotate(90deg);
}
.manifest-body {
    display: none;
    padding: 0 12px 10px;
    border-top: 1px solid #1e293b;
}
.manifest-body.open {
    display: block;
}
.dep-section {
    margin-top: 8px;
}
.dep-section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    margin-bottom: 4px;
}
.dep-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.dep-list li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0;
    font-size: 12px;
    line-height: 1.4;
}
.dep-module {
    font-weight: 500;
    color: #e2e8f0;
}
.dep-version {
    color: #64748b;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
}
.dep-count {
    color: #64748b;
    font-size: 11px;
}
`;

/**
 * Extract a version string from a dependency path.
 * e.g. "/core/sg-layout/v0.1.0/sg-layout.js" → "v0.1.0"
 * @param {string} path
 * @returns {string|null}
 */
function extractVersion(path) {
    const m = path.match(/\/(v\d+\.\d+(?:\.\d+)?)\//g);
    if (!m) return null;
    // Take the last version segment (most specific)
    const last = m[m.length - 1];
    return last.replace(/\//g, '');
}

class SgToolManifest extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._data = null;
        this._open = false;
    }

    static get observedAttributes() {
        return ['src'];
    }

    connectedCallback() {
        const src = this.getAttribute('src');
        if (src) this._load(src);
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === 'src' && newVal && newVal !== oldVal) {
            this._load(newVal);
        }
    }

    async _load(src) {
        try {
            const res = await fetch(src);
            if (!res.ok) return;
            this._data = await res.json();
            this._render();
        } catch (_) {
            // Silently fail — component stays empty
        }
    }

    _render() {
        const d = this._data;
        if (!d) return;

        const deps = d.dependencies || {};
        const totalDeps = Object.values(deps).reduce((sum, arr) => sum + arr.length, 0);

        const badgeClass = `badge-${d.status}`;
        const sections = ['core', 'components', 'shared', 'external']
            .filter(key => deps[key] && deps[key].length > 0)
            .map(key => {
                const label = key.charAt(0).toUpperCase() + key.slice(1);
                const items = deps[key].map(dep => {
                    const ver = extractVersion(dep.path);
                    return `<li><span class="dep-module">${dep.module}</span>${ver ? `<span class="dep-version">${ver}</span>` : ''}</li>`;
                }).join('');
                return `<div class="dep-section">
                    <div class="dep-section-label">${label}</div>
                    <ul class="dep-list">${items}</ul>
                </div>`;
            }).join('');

        this.shadowRoot.innerHTML = `
            <style>${STYLE}</style>
            <div class="manifest-panel">
                <div class="manifest-header" id="toggle">
                    <span class="manifest-icon">${d.icon}</span>
                    <span class="manifest-name">${d.name}</span>
                    <span class="manifest-version">v${d.version}</span>
                    <span class="manifest-badge ${badgeClass}">${d.status}</span>
                    <span class="dep-count">${totalDeps} deps</span>
                    <span class="manifest-toggle" id="arrow">▸</span>
                </div>
                <div class="manifest-body" id="body">
                    ${sections}
                </div>
            </div>`;

        this.shadowRoot.getElementById('toggle').addEventListener('click', () => {
            this._open = !this._open;
            this.shadowRoot.getElementById('body').classList.toggle('open', this._open);
            this.shadowRoot.getElementById('arrow').classList.toggle('open', this._open);
        });
    }
}

if (!customElements.get('sg-tool-manifest')) {
    customElements.define('sg-tool-manifest', SgToolManifest);
}

export { SgToolManifest };
