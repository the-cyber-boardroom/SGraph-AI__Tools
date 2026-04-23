/**
 * sg-tool-api-explorer — Live debug panel for SgToolApi instances.
 *
 * Shows health status, registered methods, live window events, and the
 * execution log for any tool that implements the JS API Primitive.
 *
 * Usage:
 *   <sg-tool-api-explorer></sg-tool-api-explorer>
 *   <sg-tool-api-explorer tool-id="infographic-generator:root"></sg-tool-api-explorer>
 *
 * Attributes:
 *   tool-id — instanceId to bind to (default: window.__tool)
 *
 * @element sg-tool-api-explorer
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
.explorer {
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
    letter-spacing: 0.03em;
}
.tab-btn:hover { color: #a0aec0; }
.tab-btn.active { color: #4ECDC4; border-bottom-color: #4ECDC4; }
.tab-panel { display: none; flex: 1; overflow-y: auto; padding: 10px; }
.tab-panel.active { display: block; }
/* Health */
.health-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; align-items: start; }
.k { font-size: 10px; font-weight: 600; color: #4a5568; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 2px; }
.v { color: #e2e8f0; word-break: break-all; }
.badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
}
.badge-ready { background: #1c4532; color: #68d391; }
.badge-init  { background: #744210; color: #fbd38d; }
.badge-none  { background: #2d3748; color: #718096; }
/* Methods */
.method-row {
    padding: 6px 8px;
    margin-bottom: 3px;
    background: #0d0d1a;
    border-radius: 4px;
    border-left: 2px solid #2d3748;
}
.method-name { color: #4ECDC4; font-weight: 600; font-size: 12px; }
.method-async { font-size: 10px; color: #4a5568; margin-left: 6px; }
/* Events */
.event-row {
    padding: 5px 8px;
    margin-bottom: 2px;
    background: #0d0d1a;
    border-radius: 4px;
    border-left: 2px solid #2a4365;
    cursor: pointer;
}
.event-row:hover { background: #111122; }
.event-row.expanded .event-detail { display: block; }
.event-name { color: #63b3ed; font-size: 11px; font-weight: 600; }
.event-time { color: #4a5568; font-size: 10px; margin-left: 6px; }
.event-detail {
    display: none;
    margin-top: 4px;
    font-family: monospace;
    font-size: 10px;
    color: #718096;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 120px;
    overflow-y: auto;
}
/* Log */
.log-row {
    padding: 5px 8px;
    margin-bottom: 2px;
    background: #0d0d1a;
    border-radius: 4px;
    border-left: 2px solid #2d3748;
    cursor: pointer;
}
.log-row:hover { background: #111122; }
.log-row.error { border-left-color: #742a2a; }
.log-row.expanded .log-detail { display: block; }
.log-method { color: #4ECDC4; font-weight: 600; font-size: 11px; }
.log-dur { color: #4a5568; font-size: 10px; margin-left: 6px; }
.log-err { color: #fc8181; font-size: 10px; margin-left: 6px; }
.log-detail {
    display: none;
    margin-top: 4px;
    font-family: monospace;
    font-size: 10px;
    color: #718096;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 120px;
    overflow-y: auto;
}
.empty { color: #4a5568; font-style: italic; text-align: center; padding: 20px; }
.section-hdr {
    font-size: 10px;
    font-weight: 600;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid #1a1a3a;
}
.poll-indicator {
    font-size: 9px;
    color: #2d3748;
    text-align: right;
    padding: 2px 4px;
    flex-shrink: 0;
}
`;

class SgToolApiExplorer extends HTMLElement {
    constructor() {
        super();
        this._tool       = null;
        this._events     = [];   // live events ring buffer (max 100)
        this._pollTimer  = null;
        this._activeTab  = 'health';
        this._shadow     = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._build();
        // Try to bind immediately (tool may already be ready)
        this._tryBind();
        // Also listen for tool:ready in case we load before the tool
        window.addEventListener('tool:ready', () => this._tryBind());
    }

    disconnectedCallback() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = null;
    }

    static get observedAttributes() { return ['tool-id']; }
    attributeChangedCallback() { this._tryBind(); }

    // ── Bind to tool ──────────────────────────────────────────────────────────

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
        this._attachEventListeners();
        this._startPolling();
        this._refreshAll();
    }

    _attachEventListeners() {
        const evtNames = window.SGA_TOOL ? Object.values(window.SGA_TOOL) : [];
        for (const name of evtNames) {
            window.addEventListener(name, (e) => this._onToolEvent(name, e.detail));
        }
    }

    _startPolling() {
        if (this._pollTimer) return;
        this._pollTimer = setInterval(() => this._refreshAll(), 2000);
    }

    // ── Event capture ─────────────────────────────────────────────────────────

    _onToolEvent(name, detail) {
        this._events.unshift({
            time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            name,
            detail,
        });
        if (this._events.length > 100) this._events.pop();
        if (this._activeTab === 'events') this._renderEvents();
    }

    // ── Refresh ───────────────────────────────────────────────────────────────

    _refreshAll() {
        if (!this._tool) return;
        switch (this._activeTab) {
            case 'health':   this._renderHealth();   break;
            case 'methods':  this._renderMethods();  break;
            case 'events':   this._renderEvents();   break;
            case 'log':      this._renderLog();      break;
        }
        const ind = this._shadow.querySelector('.poll-indicator');
        if (ind) ind.textContent = `last refresh ${new Date().toLocaleTimeString('en-GB', { hour12: false })}`;
    }

    // ── Build skeleton ────────────────────────────────────────────────────────

    _build() {
        this._shadow.innerHTML = '';

        const style = document.createElement('style');
        style.textContent = STYLES;
        this._shadow.appendChild(style);

        const explorer = document.createElement('div');
        explorer.className = 'explorer';

        // Tabs
        const tabs = document.createElement('div');
        tabs.className = 'tabs';
        for (const tab of ['health', 'methods', 'events', 'log']) {
            const btn = document.createElement('button');
            btn.className = `tab-btn${tab === this._activeTab ? ' active' : ''}`;
            btn.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
            btn.dataset.tab = tab;
            btn.addEventListener('click', () => this._switchTab(tab));
            tabs.appendChild(btn);
        }
        explorer.appendChild(tabs);

        // Panels
        for (const tab of ['health', 'methods', 'events', 'log']) {
            const panel = document.createElement('div');
            panel.className = `tab-panel${tab === this._activeTab ? ' active' : ''}`;
            panel.dataset.panel = tab;
            panel.innerHTML = '<div class="empty">Waiting for tool…</div>';
            explorer.appendChild(panel);
        }

        // Poll indicator
        const ind = document.createElement('div');
        ind.className = 'poll-indicator';
        ind.textContent = 'not connected';
        explorer.appendChild(ind);

        this._shadow.appendChild(explorer);
    }

    _switchTab(tab) {
        this._activeTab = tab;
        for (const btn of this._shadow.querySelectorAll('.tab-btn')) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        }
        for (const panel of this._shadow.querySelectorAll('.tab-panel')) {
            panel.classList.toggle('active', panel.dataset.panel === tab);
        }
        this._refreshAll();
    }

    _panel(name) {
        return this._shadow.querySelector(`.tab-panel[data-panel="${name}"]`);
    }

    // ── Health tab ────────────────────────────────────────────────────────────

    _renderHealth() {
        if (!this._tool) return;
        const h = this._tool.meta.health();
        const panel = this._panel('health');

        const statusClass = h.status === 'ready' ? 'badge-ready'
            : h.status === 'initialising'         ? 'badge-init'
            : 'badge-none';

        panel.innerHTML = `
            <p class="section-hdr">Tool Health</p>
            <div class="health-grid">
                <span class="k">Status</span>
                <span class="v"><span class="badge ${statusClass}">${h.status}</span></span>
                <span class="k">Instance</span>
                <span class="v">${h.instanceId || '—'}</span>
                <span class="k">Methods</span>
                <span class="v">${h.methodCount}</span>
                <span class="k">Log entries</span>
                <span class="v">${h.logEntries}</span>
                <span class="k">Manifest</span>
                <span class="v">${h.manifestLoaded ? '✓ loaded' : '— not loaded'}</span>
            </div>
        `;

        const ver = this._tool.meta.getVersion();
        panel.innerHTML += `
            <p class="section-hdr" style="margin-top:12px;">Version</p>
            <div class="health-grid">
                <span class="k">UI</span>      <span class="v">${ver.ui      || '—'}</span>
                <span class="k">API</span>     <span class="v">${ver.api     || '—'}</span>
                <span class="k">Content</span> <span class="v">${ver.content || '—'}</span>
            </div>
        `;
    }

    // ── Methods tab ───────────────────────────────────────────────────────────

    _renderMethods() {
        if (!this._tool) return;
        const methods = this._tool.meta.getMethods();
        const panel   = this._panel('methods');

        if (!methods.length) {
            panel.innerHTML = '<div class="empty">No methods registered</div>';
            return;
        }

        panel.innerHTML = `<p class="section-hdr">${methods.length} registered method${methods.length !== 1 ? 's' : ''}</p>`;
        for (const m of methods) {
            const row = document.createElement('div');
            row.className = 'method-row';
            row.innerHTML = `<span class="method-name">${m}()</span>`;
            panel.appendChild(row);
        }
    }

    // ── Events tab ────────────────────────────────────────────────────────────

    _renderEvents() {
        const panel = this._panel('events');

        if (!this._events.length) {
            panel.innerHTML = '<div class="empty">No events yet — generate something to see events here</div>';
            return;
        }

        panel.innerHTML = `<p class="section-hdr">${this._events.length} event${this._events.length !== 1 ? 's' : ''} (newest first)</p>`;

        for (const ev of this._events) {
            const row = document.createElement('div');
            row.className = 'event-row';

            const shortName = ev.name.replace(/^tool:/, '');
            row.innerHTML = `
                <span class="event-name">${shortName}</span>
                <span class="event-time">${ev.time}</span>
                <div class="event-detail">${this._safeJson(ev.detail)}</div>
            `;
            row.addEventListener('click', () => row.classList.toggle('expanded'));
            panel.appendChild(row);
        }
    }

    // ── Log tab ───────────────────────────────────────────────────────────────

    _renderLog() {
        if (!this._tool) return;
        const log   = this._tool.meta.getLog();
        const panel = this._panel('log');

        if (!log.length) {
            panel.innerHTML = '<div class="empty">No method calls logged yet</div>';
            return;
        }

        // Show newest first
        const entries = [...log].reverse();
        panel.innerHTML = `<p class="section-hdr">${entries.length} call${entries.length !== 1 ? 's' : ''} (newest first)</p>`;

        for (const entry of entries) {
            const row = document.createElement('div');
            const hasErr = !!entry.error;
            row.className = `log-row${hasErr ? ' error' : ''}`;

            const dur = entry.duration != null ? `${entry.duration}ms` : '';
            row.innerHTML = `
                <span class="log-method">${entry.method}</span>
                ${dur  ? `<span class="log-dur">${dur}</span>`             : ''}
                ${hasErr ? `<span class="log-err">✗ ${entry.error.message}</span>` : ''}
                <div class="log-detail">${this._safeJson({ params: entry.params, result: entry.result, error: entry.error })}</div>
            `;
            row.addEventListener('click', () => row.classList.toggle('expanded'));
            panel.appendChild(row);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _safeJson(obj) {
        try {
            return JSON.stringify(obj, (k, v) => {
                // Truncate very long strings (e.g. base64 images)
                if (typeof v === 'string' && v.length > 200) return v.substring(0, 200) + '…';
                return v;
            }, 2)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        } catch {
            return String(obj);
        }
    }
}

customElements.define('sg-tool-api-explorer', SgToolApiExplorer);

export { SgToolApiExplorer };
