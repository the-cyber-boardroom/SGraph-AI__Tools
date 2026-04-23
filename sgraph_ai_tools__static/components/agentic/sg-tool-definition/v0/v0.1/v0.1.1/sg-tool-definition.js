/**
 * sg-tool-definition — Visual editor for LLM tool definitions (JSON schema).
 *
 * Displays available tools (built-in + custom) with enable/disable checkboxes.
 * Provides a form to add custom tools and a template library with pre-built schemas.
 * Exports and imports tool sets as JSON.
 *
 * Fires `llm:tool-defs-changed { tools }` on the [data-llm-bus] ancestor whenever the
 * active tool selection changes. sg-agentic-loop listens to keep its tools in sync.
 *
 * Built-in tools are sourced from `BUILTIN_TOOL_DEFS` exported by sg-tool-runner.
 * Additional templates are baked in for common LLM patterns.
 *
 * Attributes:
 *   none (self-contained)
 *
 * Public API:
 *   toolDef.getActiveTools()          → Array<ToolDefinition>  (currently enabled)
 *   toolDef.setTools(defs)            → replace full list (built-ins preserved)
 *   toolDef.addTool(def)              → add a single custom tool
 *
 * @module sg-tool-definition
 * @version 0.1.1
 */

import { SGL_LLM }           from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';
// v0.1.1: import from sg-tool-runner v0.1.1 (Python support) to avoid double customElements.define
import { BUILTIN_TOOL_DEFS } from '/components/agentic/sg-tool-runner/v0/v0.1/v0.1.1/sg-tool-runner.js';

// ── Template library ─────────────────────────────────────────────────────────

/** Pre-built tool schemas for common patterns. Users can customise and enable these. */
const TEMPLATE_TOOL_DEFS = [
    {
        type: 'function',
        function: {
            name: 'fetch_url',
            description: 'Fetch the text content of a URL. Returns the response body as a string.',
            parameters: {
                type: 'object',
                properties: {
                    url:    { type: 'string', description: 'The URL to fetch' },
                    method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method (default: GET)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_current_time',
            description: 'Get the current date and time in ISO 8601 format.',
            parameters: {
                type: 'object',
                properties: {
                    timezone: { type: 'string', description: 'IANA timezone name, e.g. "Europe/London" (optional, defaults to UTC)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'parse_csv',
            description: 'Parse a CSV string and return a JSON array of objects with column headers as keys.',
            parameters: {
                type: 'object',
                properties: {
                    csv:       { type: 'string', description: 'CSV text to parse' },
                    delimiter: { type: 'string', description: 'Column delimiter (default: ",")' },
                },
                required: ['csv'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'format_table',
            description: 'Format an array of objects as a Markdown table.',
            parameters: {
                type: 'object',
                properties: {
                    rows:    { type: 'array', description: 'Array of objects to format', items: { type: 'object' } },
                    columns: { type: 'array', description: 'Column names to include (optional; defaults to all keys)', items: { type: 'string' } },
                },
                required: ['rows'],
            },
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
:host { display: block; width: 100%; height: 100%; min-height: 0; box-sizing: border-box; overflow: hidden; }
.td-wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #0d0d1a;
    box-sizing: border-box;
    overflow: hidden;
}
.td-header {
    display: flex;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid #1e2035;
    gap: 6px;
    flex-shrink: 0;
}
.td-header h4 { margin: 0; font-size: 12px; color: #94a3b8; font-weight: 600; flex: 1; }
.td-btn {
    background: #12122a;
    border: 1px solid #2d3060;
    color: #94a3b8;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 10px;
    cursor: pointer;
    white-space: nowrap;
}
.td-btn:hover { background: #1e2035; }
.td-btn.primary { border-color: #7c9ef8; color: #7c9ef8; }
.td-btn.primary:hover { background: #0f1a3a; }
.td-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 10px 0;
    border-bottom: 1px solid #1e2035;
    flex-shrink: 0;
}
.td-tab {
    padding: 4px 10px;
    font-size: 11px;
    color: #475569;
    cursor: pointer;
    border-radius: 4px 4px 0 0;
    border: 1px solid transparent;
    border-bottom: none;
    user-select: none;
}
.td-tab.active { color: #94a3b8; background: #12122a; border-color: #1e2035; }
.td-panels { flex: 1; overflow: hidden; position: relative; }
.td-panel { display: none; height: 100%; overflow-y: auto; padding: 8px 10px; box-sizing: border-box; }
.td-panel.active { display: block; }

/* Active tools list */
.td-tool {
    background: #12122a;
    border: 1px solid #1e2035;
    border-radius: 6px;
    margin-bottom: 6px;
    overflow: hidden;
}
.td-tool-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    cursor: pointer;
    user-select: none;
}
.td-tool-header:hover { background: #161630; }
.td-tool input[type=checkbox] { margin: 0; accent-color: #7c9ef8; flex-shrink: 0; cursor: pointer; }
.td-tool-name { font-size: 11px; font-weight: 600; color: #7c9ef8; font-family: monospace; flex: 1; }
.td-tool-tag {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #1e2035;
    color: #475569;
}
.td-tool-tag.builtin { background: #0f1a3a; color: #7c9ef8; }
.td-tool-tag.template { background: #1a1a0a; color: #fbbf24; }
.td-tool-tag.custom { background: #1a0a1a; color: #c084fc; }
.td-tool-chevron { color: #2a2a4a; font-size: 10px; flex-shrink: 0; transition: transform 0.15s; }
.td-tool.open .td-tool-chevron { transform: rotate(90deg); }
.td-tool-body { display: none; padding: 6px 10px 10px; border-top: 1px solid #1e2035; }
.td-tool.open .td-tool-body { display: block; }
.td-tool-desc { font-size: 11px; color: #64748b; line-height: 1.5; margin-bottom: 6px; }
.td-param { font-size: 10px; color: #475569; font-family: monospace; margin-bottom: 2px; }
.td-param code { color: #94a3b8; }
.td-param .req { color: #f87171; }
.td-tool-actions { display: flex; gap: 4px; margin-top: 6px; }
.td-tool-del { background: none; border: none; color: #2a2a4a; cursor: pointer; font-size: 11px; padding: 2px 4px; border-radius: 3px; }
.td-tool-del:hover { color: #f87171; background: #2a0d0d; }

/* Add tool form */
.td-form { display: flex; flex-direction: column; gap: 10px; }
.td-form label { font-size: 11px; color: #64748b; display: flex; flex-direction: column; gap: 4px; }
.td-form input, .td-form textarea, .td-form select {
    background: #12122a;
    border: 1px solid #2d3060;
    border-radius: 4px;
    color: #e2e8f0;
    font-size: 11px;
    padding: 5px 8px;
    outline: none;
    font-family: system-ui, sans-serif;
}
.td-form input:focus, .td-form textarea:focus { border-color: #7c9ef8; }
.td-form textarea { resize: vertical; min-height: 80px; font-family: monospace; font-size: 10px; }
.td-error { font-size: 10px; color: #f87171; margin-top: 4px; }
.td-success { font-size: 10px; color: #4ade80; margin-top: 4px; }
.td-form-row { display: flex; gap: 6px; }
.td-form-row > * { flex: 1; }
.td-template-picker { display: flex; gap: 6px; align-items: center; }
.td-template-picker select { flex: 1; }

/* Import/export */
.td-io { display: flex; flex-direction: column; gap: 8px; }
.td-io textarea { min-height: 160px; font-family: monospace; font-size: 10px; }
.td-io-row { display: flex; gap: 6px; }
.td-count { font-size: 10px; color: #475569; padding: 2px 0; }
`;

// ─────────────────────────────────────────────────────────────────────────────

export class SgToolDefinition extends HTMLElement {

    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
        // Each entry: { def: ToolDef, enabled: boolean, kind: 'builtin'|'template'|'custom' }
        this._entries = [];
        this._activeTab = 'tools';
    }

    connectedCallback() {
        this._initEntries();
        this._render();
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /** @returns {Array<ToolDefinition>} currently enabled tools */
    getActiveTools() {
        return this._entries.filter(e => e.enabled).map(e => e.def);
    }

    /**
     * Replace the custom tool list (built-ins preserved).
     * @param {Array<ToolDefinition>} defs
     */
    setTools(defs) {
        this._entries = this._entries.filter(e => e.kind === 'builtin' || e.kind === 'template');
        for (const def of defs) {
            this._entries.push({ def, enabled: true, kind: 'custom' });
        }
        this._refreshToolList();
        this._notifyChanged();
    }

    /**
     * Add a single tool definition.
     * @param {ToolDefinition} def
     */
    addTool(def) {
        const name = def.function?.name ?? def.name;
        const exists = this._entries.find(e => (e.def.function?.name ?? e.def.name) === name);
        if (!exists) {
            this._entries.push({ def, enabled: true, kind: 'custom' });
            this._refreshToolList();
            this._notifyChanged();
        }
    }

    // ── Initialisation ──────────────────────────────────────────────────────

    _initEntries() {
        this._entries = [
            ...BUILTIN_TOOL_DEFS.map(def => ({ def, enabled: true, kind: 'builtin' })),
            ...TEMPLATE_TOOL_DEFS.map(def => ({ def, enabled: false, kind: 'template' })),
        ];
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `<style>${CSS}</style>
        <div class="td-wrap">
            <div class="td-header">
                <h4>Tool Definitions</h4>
                <button class="td-btn primary" id="btn-export">↑ Export</button>
                <button class="td-btn"         id="btn-import">↓ Import</button>
            </div>
            <div class="td-tabs">
                <div class="td-tab active" data-tab="tools">Tools</div>
                <div class="td-tab"        data-tab="add">+ Add</div>
                <div class="td-tab"        data-tab="io">Import/Export</div>
            </div>
            <div class="td-panels">
                <div class="td-panel active" id="panel-tools"></div>
                <div class="td-panel"        id="panel-add">
                    ${this._renderAddForm()}
                </div>
                <div class="td-panel" id="panel-io">
                    ${this._renderIOPanel()}
                </div>
            </div>
        </div>`;

        this._refreshToolList();
        this._bindPanelEvents();
    }

    _renderAddForm() {
        const templateOptions = TEMPLATE_TOOL_DEFS.map(t =>
            `<option value="${t.function.name}">${t.function.name}</option>`
        ).join('');
        return `<div class="td-form" id="add-form">
            <div class="td-template-picker">
                <select id="tmpl-select">
                    <option value="">— blank —</option>
                    ${templateOptions}
                </select>
                <button class="td-btn" id="tmpl-load">Load Template</button>
            </div>
            <label>Tool name (snake_case)
                <input id="add-name" placeholder="my_tool">
            </label>
            <label>Description
                <input id="add-desc" placeholder="What this tool does">
            </label>
            <label>Parameters (JSON Schema)
                <textarea id="add-params" rows="6">{
  "type": "object",
  "properties": {
    "input": { "type": "string", "description": "The input text" }
  },
  "required": ["input"]
}</textarea>
            </label>
            <div id="add-msg"></div>
            <button class="td-btn primary" id="btn-add-tool">+ Add Tool</button>
        </div>`;
    }

    _renderIOPanel() {
        return `<div class="td-io">
            <div class="td-count" id="io-count"></div>
            <textarea id="io-json" placeholder="Paste tool definitions JSON here to import…"></textarea>
            <div class="td-io-row">
                <button class="td-btn primary" id="btn-copy-json">Copy JSON</button>
                <button class="td-btn"         id="btn-apply-json">Apply JSON</button>
            </div>
            <div id="io-msg"></div>
        </div>`;
    }

    /** Re-render the tools list panel without re-rendering the whole component. */
    _refreshToolList() {
        const panel = this._shadow.getElementById('panel-tools');
        if (!panel) return;
        if (this._entries.length === 0) {
            panel.innerHTML = '<div style="color:#2a2a4a;font-size:12px;padding:12px 0;text-align:center">No tools loaded</div>';
            return;
        }
        panel.innerHTML = this._entries.map((entry, idx) =>
            this._renderToolEntry(entry, idx)
        ).join('');

        // Bind checkboxes
        panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
            cb.onchange = () => {
                const idx = parseInt(cb.dataset.idx, 10);
                this._entries[idx].enabled = cb.checked;
                this._notifyChanged();
            };
        });
        // Bind expand toggles
        panel.querySelectorAll('.td-tool-header').forEach(hdr => {
            hdr.onclick = (e) => {
                if (e.target.type === 'checkbox') return;
                hdr.closest('.td-tool').classList.toggle('open');
            };
        });
        // Bind delete buttons
        panel.querySelectorAll('.td-tool-del').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.idx, 10);
                this._entries.splice(idx, 1);
                this._refreshToolList();
                this._notifyChanged();
            };
        });
    }

    _renderToolEntry(entry, idx) {
        const { def, enabled, kind } = entry;
        const fn     = def.function ?? {};
        const name   = fn.name ?? def.name ?? '(unnamed)';
        const desc   = fn.description ?? def.description ?? '';
        const params = fn.parameters ?? def.input_schema ?? {};
        const props  = params?.properties ?? {};
        const reqs   = new Set(params?.required ?? []);

        const paramLines = Object.entries(props).map(([k, v]) =>
            `<div class="td-param"><code>${k}</code>${reqs.has(k) ? ' <span class="req">*</span>' : ''} — ${v.type ?? '?'}${v.description ? ': ' + v.description : ''}</div>`
        ).join('');

        const canDelete = kind === 'custom' || kind === 'template';

        return `<div class="td-tool">
            <div class="td-tool-header">
                <input type="checkbox" data-idx="${idx}" ${enabled ? 'checked' : ''}>
                <span class="td-tool-name">${_esc(name)}</span>
                <span class="td-tool-tag ${kind}">${kind}</span>
                <span class="td-tool-chevron">▶</span>
            </div>
            <div class="td-tool-body">
                <div class="td-tool-desc">${_esc(desc)}</div>
                ${paramLines || '<div class="td-param" style="color:#2a2a4a">No parameters</div>'}
                ${canDelete ? `<div class="td-tool-actions"><button class="td-tool-del" data-idx="${idx}" title="Remove tool">✕ Remove</button></div>` : ''}
            </div>
        </div>`;
    }

    // ── Panel event binding ─────────────────────────────────────────────────

    _bindPanelEvents() {
        const sh = this._shadow;

        // Tab switching
        sh.querySelectorAll('.td-tab').forEach(tab => {
            tab.onclick = () => {
                sh.querySelectorAll('.td-tab').forEach(t => t.classList.remove('active'));
                sh.querySelectorAll('.td-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                sh.getElementById(`panel-${tab.dataset.tab}`)?.classList.add('active');
                this._activeTab = tab.dataset.tab;
                if (this._activeTab === 'io') this._populateIOJson();
            };
        });

        // Export button (header)
        sh.getElementById('btn-export')?.addEventListener('click', () => {
            this._populateIOJson();
            sh.querySelectorAll('.td-tab').forEach(t => t.classList.remove('active'));
            sh.querySelectorAll('.td-panel').forEach(p => p.classList.remove('active'));
            sh.querySelector('[data-tab="io"]')?.classList.add('active');
            sh.getElementById('panel-io')?.classList.add('active');
        });
        sh.getElementById('btn-import')?.addEventListener('click', () => {
            sh.querySelectorAll('.td-tab').forEach(t => t.classList.remove('active'));
            sh.querySelectorAll('.td-panel').forEach(p => p.classList.remove('active'));
            sh.querySelector('[data-tab="io"]')?.classList.add('active');
            sh.getElementById('panel-io')?.classList.add('active');
        });

        // Template load
        sh.getElementById('tmpl-load')?.addEventListener('click', () => {
            const name = sh.getElementById('tmpl-select')?.value;
            if (!name) return;
            const tmpl = TEMPLATE_TOOL_DEFS.find(t => t.function.name === name);
            if (!tmpl) return;
            sh.getElementById('add-name').value  = tmpl.function.name;
            sh.getElementById('add-desc').value  = tmpl.function.description;
            sh.getElementById('add-params').value = JSON.stringify(tmpl.function.parameters, null, 2);
        });

        // Add tool
        sh.getElementById('btn-add-tool')?.addEventListener('click', () => this._addToolFromForm());

        // Copy JSON
        sh.getElementById('btn-copy-json')?.addEventListener('click', () => {
            const json = sh.getElementById('io-json')?.value;
            navigator.clipboard?.writeText(json).catch(() => {});
            sh.getElementById('io-msg').textContent = '✓ Copied';
            setTimeout(() => { const el = sh.getElementById('io-msg'); if (el) el.textContent = ''; }, 1500);
        });

        // Apply JSON
        sh.getElementById('btn-apply-json')?.addEventListener('click', () => this._applyIOJson());
    }

    _addToolFromForm() {
        const sh = this._shadow;
        const name   = sh.getElementById('add-name')?.value.trim();
        const desc   = sh.getElementById('add-desc')?.value.trim();
        const rawParams = sh.getElementById('add-params')?.value.trim();
        const msgEl  = sh.getElementById('add-msg');

        if (!name) { msgEl.innerHTML = '<span class="td-error">Tool name is required</span>'; return; }
        if (!/^[a-z][a-z0-9_]*$/.test(name)) { msgEl.innerHTML = '<span class="td-error">Name must be snake_case (a-z, 0-9, _)</span>'; return; }

        let params;
        try { params = JSON.parse(rawParams || '{"type":"object","properties":{},"required":[]}'); } catch (e) {
            msgEl.innerHTML = `<span class="td-error">Invalid JSON: ${_esc(e.message)}</span>`; return;
        }

        const def = {
            type: 'function',
            function: { name, description: desc || `Tool: ${name}`, parameters: params },
        };

        const existing = this._entries.findIndex(e => (e.def.function?.name ?? e.def.name) === name);
        if (existing >= 0) {
            this._entries[existing] = { def, enabled: true, kind: 'custom' };
        } else {
            this._entries.push({ def, enabled: true, kind: 'custom' });
        }

        this._refreshToolList();
        this._notifyChanged();
        msgEl.innerHTML = `<span class="td-success">✓ Tool "${_esc(name)}" added</span>`;
        sh.getElementById('add-name').value   = '';
        sh.getElementById('add-desc').value   = '';
        sh.getElementById('add-params').value = '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}';
        setTimeout(() => { const el = sh.getElementById('add-msg'); if (el) el.textContent = ''; }, 2000);
    }

    _populateIOJson() {
        const all = this._entries.map(e => ({
            ...e.def,
            _enabled: e.enabled,
            _kind:    e.kind,
        }));
        const sh = this._shadow;
        const json = JSON.stringify(all, null, 2);
        if (sh.getElementById('io-json')) sh.getElementById('io-json').value = json;
        const countEl = sh.getElementById('io-count');
        if (countEl) countEl.textContent = `${this._entries.filter(e => e.enabled).length}/${this._entries.length} tools active`;
    }

    _applyIOJson() {
        const sh  = this._shadow;
        const raw = sh.getElementById('io-json')?.value.trim();
        const msg = sh.getElementById('io-msg');
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) { msg.innerHTML = '<span class="td-error">Expected a JSON array</span>'; return; }
            this._entries = [];
            for (const item of parsed) {
                const { _enabled, _kind, ...def } = item;
                this._entries.push({ def, enabled: _enabled !== false, kind: _kind || 'custom' });
            }
            this._refreshToolList();
            this._notifyChanged();
            msg.innerHTML = `<span class="td-success">✓ ${this._entries.length} tools loaded</span>`;
        } catch (e) {
            msg.innerHTML = `<span class="td-error">JSON parse error: ${_esc(e.message)}</span>`;
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    _notifyChanged() {
        const bus = this._bus();
        bus.dispatchEvent(new CustomEvent(SGL_LLM.TOOL_DEFS_CHANGED, {
            detail: { tools: this.getActiveTools() },
            bubbles: true, composed: true,
        }));
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }
}

customElements.define('sg-tool-definition', SgToolDefinition);
window.SgToolDefinition = SgToolDefinition;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
