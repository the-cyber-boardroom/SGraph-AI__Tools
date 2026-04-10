/**
 * sg-tool-api-manifest — Manifest and API spec viewer for SgToolApi instances.
 *
 * Renders manifest.json (identity, dependencies) and the API section
 * (methods, events, skills) in a readable, structured format. Fetches
 * SKILL files inline and displays them as rendered text.
 *
 * Usage:
 *   <sg-tool-api-manifest></sg-tool-api-manifest>
 *   <sg-tool-api-manifest tool-id="infographic-generator:root"></sg-tool-api-manifest>
 *
 * @element sg-tool-api-manifest
 * @version 0.1.0
 */

const STYLES = `
:host {
    display: block;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    font-family: system-ui, sans-serif;
    font-size: 12px;
    background: #0a0a18;
    color: #a0aec0;
    overflow: hidden;
}
.manifest {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}
.tabs {
    display: flex;
    border-bottom: 1px solid #1a1a3a;
    flex-shrink: 0;
    background: #0d0d1a;
}
.tab-btn {
    padding: 7px 14px;
    font-size: 11px;
    font-weight: 600;
    color: #4a5568;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    white-space: nowrap;
}
.tab-btn:hover { color: #a0aec0; }
.tab-btn.active { color: #4ECDC4; border-bottom-color: #4ECDC4; }
.tab-panel { display: none; flex: 1; overflow-y: auto; padding: 10px 12px; }
.tab-panel.active { display: block; }
/* Shared */
.section {
    margin-bottom: 14px;
}
.section-title {
    font-size: 10px;
    font-weight: 700;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid #1a1a3a;
}
.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin-bottom: 2px; }
.k { font-size: 10px; color: #4a5568; font-weight: 600; text-transform: uppercase; padding-top: 2px; }
.v { color: #e2e8f0; word-break: break-all; }
.badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 700;
}
.badge-live  { background: #1c4532; color: #68d391; }
.badge-beta  { background: #744210; color: #fbd38d; }
.badge-draft { background: #2d3748; color: #718096; }
/* Dependencies */
.dep-group { margin-bottom: 6px; }
.dep-group-title { font-size: 10px; color: #4a5568; font-weight: 600; margin-bottom: 3px; }
.dep-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 6px;
    background: #0d0d1a;
    border-radius: 3px;
    margin-bottom: 2px;
}
.dep-name { color: #4ECDC4; font-size: 11px; }
.dep-path { color: #4a5568; font-size: 10px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
/* API section */
.method-card {
    background: #0d0d1a;
    border: 1px solid #1a1a3a;
    border-radius: 4px;
    margin-bottom: 6px;
    overflow: hidden;
}
.method-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    cursor: pointer;
    border-bottom: 1px solid #1a1a3a;
}
.method-header:hover { background: #111120; }
.method-name { color: #4ECDC4; font-weight: 600; font-size: 12px; font-family: monospace; }
.method-async { font-size: 10px; color: #4a5568; background: #1a1a2a; padding: 1px 5px; border-radius: 3px; }
.method-body { padding: 6px 8px; display: none; }
.method-card.open .method-body { display: block; }
.method-card.open .method-header { border-bottom: 1px solid #1a1a3a; }
.param-row {
    display: flex;
    gap: 8px;
    padding: 2px 0;
    align-items: baseline;
}
.param-name { color: #63b3ed; font-family: monospace; font-size: 11px; min-width: 80px; }
.param-type { color: #4a5568; font-size: 10px; min-width: 60px; }
.param-note { color: #718096; font-size: 10px; }
.returns-val { color: #68d391; font-family: monospace; font-size: 11px; }
/* Events */
.event-row {
    padding: 4px 6px;
    background: #0d0d1a;
    border-radius: 3px;
    margin-bottom: 3px;
    border-left: 2px solid #2a4365;
}
.event-name { color: #63b3ed; font-weight: 600; font-size: 11px; }
.event-when { color: #4a5568; font-size: 10px; margin-left: 8px; }
.event-detail { color: #718096; font-size: 10px; font-family: monospace; margin-top: 2px; }
/* Skills */
.skill-card {
    background: #0d0d1a;
    border: 1px solid #1a1a3a;
    border-radius: 4px;
    margin-bottom: 8px;
    overflow: hidden;
}
.skill-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    cursor: pointer;
    border-bottom: 1px solid #1a1a3a;
}
.skill-header:hover { background: #111120; }
.skill-title { font-size: 12px; font-weight: 600; color: #a0aec0; }
.skill-body {
    display: none;
    padding: 10px;
    font-size: 11px;
    line-height: 1.65;
    color: #718096;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
    font-family: system-ui, sans-serif;
}
.skill-card.open .skill-body { display: block; }
.skill-toggle { color: #4ECDC4; font-size: 10px; }
.empty { color: #4a5568; font-style: italic; text-align: center; padding: 20px; }
`;

const SKILL_LABELS = { human: 'Human Guide', browser: 'Browser / Playwright', api: 'API Spec' };

class SgToolApiManifest extends HTMLElement {
    constructor() {
        super();
        this._tool       = null;
        this._manifest   = null;
        this._skills     = {};
        this._activeTab  = 'identity';
        this._shadow     = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._build();
        this._tryBind();
        window.addEventListener('tool:ready', () => this._tryBind());
    }

    static get observedAttributes() { return ['tool-id']; }
    attributeChangedCallback() { this._tryBind(); }

    _tryBind() {
        const id = this.getAttribute('tool-id');
        let tool = null;
        if (id && window.__tool_registry) {
            tool = window.__tool_registry.findById?.(id) || null;
        } else if (window.__tool) {
            tool = window.__tool;
        }
        if (!tool || tool === this._tool) return;
        this._tool = tool;
        this._load();
    }

    async _load() {
        if (!this._tool) return;
        this._manifest = await this._tool.meta.getManifest();
        this._skills   = await this._tool.meta.getSkills();
        this._renderAll();
    }

    _build() {
        this._shadow.innerHTML = '';
        const style = document.createElement('style');
        style.textContent = STYLES;
        this._shadow.appendChild(style);

        const root = document.createElement('div');
        root.className = 'manifest';

        const tabs = document.createElement('div');
        tabs.className = 'tabs';
        for (const [id, label] of [['identity', 'Identity'], ['api', 'API'], ['skills', 'Skills']]) {
            const btn = document.createElement('button');
            btn.className = `tab-btn${id === this._activeTab ? ' active' : ''}`;
            btn.dataset.tab = id;
            btn.textContent = label;
            btn.addEventListener('click', () => this._switchTab(id));
            tabs.appendChild(btn);
        }
        root.appendChild(tabs);

        for (const id of ['identity', 'api', 'skills']) {
            const panel = document.createElement('div');
            panel.className = `tab-panel${id === this._activeTab ? ' active' : ''}`;
            panel.dataset.panel = id;
            panel.innerHTML = '<div class="empty">Loading…</div>';
            root.appendChild(panel);
        }

        this._shadow.appendChild(root);
    }

    _switchTab(tab) {
        this._activeTab = tab;
        for (const btn of this._shadow.querySelectorAll('.tab-btn')) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        }
        for (const panel of this._shadow.querySelectorAll('.tab-panel')) {
            panel.classList.toggle('active', panel.dataset.panel === tab);
        }
    }

    _panel(id) { return this._shadow.querySelector(`.tab-panel[data-panel="${id}"]`); }

    _renderAll() {
        this._renderIdentity();
        this._renderApi();
        this._renderSkills();
    }

    // ── Identity tab ──────────────────────────────────────────────────────────

    _renderIdentity() {
        const m     = this._manifest || {};
        const panel = this._panel('identity');
        const statusClass = m.status === 'live' ? 'badge-live' : m.status === 'beta' ? 'badge-beta' : 'badge-draft';

        let html = `
            <div class="section">
                <div class="section-title">Tool Identity</div>
                <div class="kv">
                    <span class="k">Name</span>    <span class="v">${m.name || '—'}</span>
                    <span class="k">Slug</span>    <span class="v">${m.slug || '—'}</span>
                    <span class="k">Version</span> <span class="v">${m.version || '—'}</span>
                    <span class="k">Status</span>  <span class="v"><span class="badge ${statusClass}">${m.status || '—'}</span></span>
                    <span class="k">Category</span><span class="v">${m.category || '—'}</span>
                </div>
            </div>`;

        if (m.description) {
            html += `<div class="section"><div class="section-title">Description</div>
                     <div style="color:#a0aec0;line-height:1.6;">${m.description}</div></div>`;
        }

        if (m.dependencies) {
            html += `<div class="section"><div class="section-title">Dependencies</div>`;
            for (const [groupName, items] of Object.entries(m.dependencies)) {
                if (!items?.length) continue;
                html += `<div class="dep-group"><div class="dep-group-title">${groupName}</div>`;
                for (const dep of items) {
                    html += `<div class="dep-item">
                        <span class="dep-name">${dep.module}</span>
                        <span class="dep-path" title="${dep.path}">${dep.path}</span>
                    </div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;
        }

        panel.innerHTML = html;
    }

    // ── API tab ───────────────────────────────────────────────────────────────

    _renderApi() {
        const m     = this._manifest || {};
        const api   = m.api || {};
        const panel = this._panel('api');

        if (!api.actions && !api.events) {
            panel.innerHTML = '<div class="empty">No API schema in manifest</div>';
            return;
        }

        let html = '';

        // Methods
        if (api.actions) {
            html += `<div class="section"><div class="section-title">Methods (${Object.keys(api.actions).length})</div></div>`;
            for (const [name, action] of Object.entries(api.actions)) {
                html += this._methodCard(name, action);
            }
        }

        // Events
        if (api.events?.length) {
            html += `<div class="section" style="margin-top:12px;"><div class="section-title">Window Events</div>`;
            for (const ev of api.events) {
                html += `<div class="event-row">
                    <span class="event-name">${ev.name}</span>
                    <span class="event-when">${ev.when || ''}</span>
                    ${ev.detail ? `<div class="event-detail">${ev.detail}</div>` : ''}
                </div>`;
            }
            html += `</div>`;
        }

        panel.innerHTML = html;

        // Wire accordion toggles
        for (const card of panel.querySelectorAll('.method-card')) {
            card.querySelector('.method-header')
                .addEventListener('click', () => card.classList.toggle('open'));
        }
    }

    _methodCard(name, action) {
        const isAsync  = action.async !== false;
        const params   = action.params || {};
        const returns  = action.returns || 'void';
        const note     = action.note || '';

        let paramsHtml = '';
        for (const [pname, pdef] of Object.entries(params)) {
            if (pname === '0') {
                paramsHtml += `<div class="param-row">
                    <span class="param-name">(value)</span>
                    <span class="param-type">${pdef.type || 'any'}</span>
                    <span class="param-note">${pdef.optional ? 'optional' : 'required'}${pdef.note ? ' · ' + pdef.note : ''}</span>
                </div>`;
            } else {
                paramsHtml += `<div class="param-row">
                    <span class="param-name">${pname}</span>
                    <span class="param-type">${pdef.type || 'any'}</span>
                    <span class="param-note">${pdef.optional ? 'optional' : 'required'}${pdef.secret ? ' · secret' : ''}${pdef.note ? ' · ' + pdef.note : ''}</span>
                </div>`;
            }
        }

        return `<div class="method-card">
            <div class="method-header">
                <span class="method-name">${name}()</span>
                ${isAsync ? '<span class="method-async">async</span>' : ''}
            </div>
            <div class="method-body">
                ${paramsHtml ? `<div style="margin-bottom:6px;">${paramsHtml}</div>` : ''}
                <div style="margin-bottom:4px;">
                    <span class="k" style="font-size:10px;color:#4a5568;font-weight:600;text-transform:uppercase;">Returns</span>
                    <span class="returns-val"> ${returns}</span>
                </div>
                ${note ? `<div style="color:#4a5568;font-size:10px;margin-top:4px;">${note}</div>` : ''}
            </div>
        </div>`;
    }

    // ── Skills tab ────────────────────────────────────────────────────────────

    _renderSkills() {
        const panel = this._panel('skills');
        const skillEntries = Object.entries(this._skills || {});

        if (!skillEntries.length) {
            panel.innerHTML = '<div class="empty">No SKILL files loaded — check getSkills() wiring</div>';
            return;
        }

        panel.innerHTML = '';
        for (const [key, content] of skillEntries) {
            const label = SKILL_LABELS[key] || key;
            const card  = document.createElement('div');
            card.className = 'skill-card';
            card.innerHTML = `
                <div class="skill-header">
                    <span class="skill-title">${label}</span>
                    <span class="skill-toggle">▼ expand</span>
                </div>
                <div class="skill-body">${this._escHtml(content)}</div>
            `;
            card.querySelector('.skill-header').addEventListener('click', () => {
                card.classList.toggle('open');
                card.querySelector('.skill-toggle').textContent = card.classList.contains('open') ? '▲ collapse' : '▼ expand';
            });
            panel.appendChild(card);
        }
    }

    _escHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

customElements.define('sg-tool-api-manifest', SgToolApiManifest);
export { SgToolApiManifest };
