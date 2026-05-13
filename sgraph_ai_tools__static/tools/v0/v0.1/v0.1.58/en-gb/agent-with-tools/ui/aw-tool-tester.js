/**
 * aw-tool-tester — Interactive tool testing panel (Swagger-like).
 *
 * Lists available tools from sg-tool-definition (schemas) and sg-tool-runner
 * (callable names). For each tool, generates a form from its JSON schema.
 * "Run" invokes sg-tool-runner.execute(name, parsedArgs) directly.
 * Shows the raw result or error inline.
 *
 * @module aw-tool-tester
 * @version 0.1.58
 */

const CSS = `
:host { display:flex; flex-direction:column; height:100%; overflow:hidden;
        background:#0d0d1a; font-family:system-ui,sans-serif; font-size:12px; color:#94a3b8; }
.tt-toolbar {
    display:flex; align-items:center; gap:8px; padding:6px 8px;
    border-bottom:1px solid #1a1a3a; flex-shrink:0;
}
.tt-title { font-size:10px; font-weight:700; text-transform:uppercase;
            letter-spacing:.06em; color:#4a5568; flex:1; }
.tt-reload { background:none; border:1px solid #2d3060; color:#94a3b8;
             border-radius:4px; padding:2px 8px; cursor:pointer; font-size:10px; }
.tt-reload:hover { border-color:#7c9ef8; color:#e2e8f0; }
.tt-body { flex:1; overflow-y:auto; scrollbar-width:thin; scrollbar-color:#1a1a3a transparent; }
.tt-empty { color:#2a2a4a; text-align:center; padding:24px; font-size:11px; }
/* Tool accordion */
.tt-tool { border-bottom:1px solid #11111e; }
.tt-tool-head {
    display:flex; align-items:center; gap:8px; padding:7px 10px;
    cursor:pointer; user-select:none;
}
.tt-tool-head:hover { background:#0f0f22; }
.tt-tool-name { font-family:monospace; color:#7c9ef8; font-weight:600; flex:1; }
.tt-tool-tag { font-size:9px; padding:1px 6px; border-radius:8px;
               background:#1a1a3a; color:#475569; }
.tt-tool-tag.builtin  { background:#1e3a8a; color:#93c5fd; }
.tt-tool-tag.lb       { background:#14532d; color:#86efac; }
.tt-tool-arrow { color:#374151; font-size:10px; transition:transform .15s; }
.tt-tool.open .tt-tool-arrow { transform:rotate(90deg); }
.tt-tool-body { display:none; padding:8px 12px 12px; background:#080810; }
.tt-tool.open .tt-tool-body { display:block; }
.tt-desc { font-size:11px; color:#475569; margin-bottom:10px; font-style:italic; }
/* Form */
.tt-field { margin-bottom:8px; }
.tt-field-label {
    font-size:10px; font-weight:600; color:#64748b; margin-bottom:3px;
    display:flex; align-items:center; gap:4px;
}
.tt-req { color:#f59e0b; font-size:9px; }
.tt-field-desc { font-size:9px; color:#374151; margin-bottom:3px; }
.tt-input, .tt-textarea {
    width:100%; box-sizing:border-box;
    background:#111128; color:#e2e8f0; border:1px solid #2d3060;
    border-radius:4px; padding:5px 7px; font-family:monospace; font-size:11px;
}
.tt-input:focus, .tt-textarea:focus { outline:1px solid #7c9ef8; }
.tt-textarea { resize:vertical; min-height:48px; }
.tt-checkbox-row { display:flex; align-items:center; gap:6px; }
.tt-checkbox-row input { accent-color:#7c9ef8; }
/* Raw JSON editor fallback */
.tt-raw-label { font-size:10px; color:#374151; margin-bottom:3px; }
/* Actions */
.tt-actions { display:flex; gap:6px; align-items:center; margin-top:8px; }
.tt-run { background:#1e3a8a; border:1px solid #3d5a99; color:#93c5fd;
          border-radius:4px; padding:4px 14px; cursor:pointer; font-size:11px; }
.tt-run:hover { background:#2d4a9a; }
.tt-run:disabled { opacity:0.5; cursor:not-allowed; }
.tt-status { font-size:10px; color:#475569; font-family:monospace; }
/* Result */
.tt-result { margin-top:8px; }
.tt-result-label { font-size:10px; font-weight:600; text-transform:uppercase;
                   letter-spacing:.05em; color:#374151; margin-bottom:3px; }
.tt-result-pre {
    font-family:monospace; font-size:10px; background:#0d0d1a;
    border:1px solid #1e1e3a; border-radius:3px; padding:6px 8px;
    white-space:pre-wrap; word-break:break-all; max-height:160px; overflow-y:auto;
    color:#64748b;
}
.tt-result-pre.ok  { border-color:#14532d; color:#86efac; }
.tt-result-pre.err { border-color:#7f1d1d; color:#fca5a5; }
`;

export class AwToolTester extends HTMLElement {
    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `<style>${CSS}</style>
            <div class="tt-toolbar">
                <span class="tt-title">Tool Tester</span>
                <button class="tt-reload">↺ Reload</button>
            </div>
            <div class="tt-body" id="tt-body">
                <div class="tt-empty">Loading tools…</div>
            </div>`;

        this.shadowRoot.querySelector('.tt-reload').addEventListener('click', () => this._load());

        // Reload whenever tool definitions change (covers bridge connect at any time)
        const bus = this._bus();
        bus.addEventListener('llm:tool-defs-changed', () => this._load());
        // Also reload 300ms after bridge status in case schemas arrive slightly after
        bus.addEventListener('sg-local-bridge:status', () => setTimeout(() => this._load(), 300));
        this._load();
    }

    _load() {
        const bus    = this._bus();
        const toolDef = bus.querySelector('sg-tool-definition');
        const runner  = bus.querySelector('sg-tool-runner');

        const schemas = (toolDef && typeof toolDef.getActiveTools === 'function')
            ? toolDef.getActiveTools() : [];
        const callable = runner ? new Set(runner.toolNames ?? []) : new Set();

        // Merge: schemas from toolDef (have descriptions) + callable names without schema
        const tools = [];
        const seen  = new Set();
        for (const s of schemas) {
            const fn = s.function ?? s;
            if (fn.name) { tools.push({ name: fn.name, schema: s, callable: callable.has(fn.name) }); seen.add(fn.name); }
        }
        for (const name of callable) {
            if (!seen.has(name)) tools.push({ name, schema: null, callable: true });
        }

        const body = this.shadowRoot.getElementById('tt-body');
        if (!tools.length) {
            body.innerHTML = '<div class="tt-empty">No tools found. Connect the bridge first.</div>';
            return;
        }
        body.innerHTML = '';
        for (const t of tools.sort((a, b) => a.name.localeCompare(b.name))) {
            body.appendChild(this._makeTool(t, runner));
        }
    }

    _makeTool(t, runner) {
        const fn   = t.schema?.function ?? {};
        const desc = fn.description ?? '';
        const props = fn.parameters?.properties ?? {};
        const req   = fn.parameters?.required ?? [];
        const tag   = t.name.startsWith('lb_') ? 'lb' : (t.callable ? 'builtin' : 'def');
        const tagLabel = t.name.startsWith('lb_') ? 'bridge' : (t.callable ? 'builtin' : 'schema only');

        const el = document.createElement('div');
        el.className = 'tt-tool';
        el.innerHTML = `
            <div class="tt-tool-head">
                <span class="tt-tool-name">${_esc(t.name)}</span>
                <span class="tt-tool-tag ${tag}">${tagLabel}</span>
                <span class="tt-tool-arrow">▶</span>
            </div>
            <div class="tt-tool-body">
                ${desc ? `<div class="tt-desc">${_esc(desc)}</div>` : ''}
                <div class="tt-form"></div>
                <div class="tt-actions">
                    <button class="tt-run" ${!t.callable ? 'disabled' : ''}>▶ Run</button>
                    <span class="tt-status"></span>
                </div>
                <div class="tt-result" style="display:none">
                    <div class="tt-result-label">Result</div>
                    <pre class="tt-result-pre"></pre>
                </div>
            </div>`;

        el.querySelector('.tt-tool-head').addEventListener('click', () => el.classList.toggle('open'));

        const form   = el.querySelector('.tt-form');
        const inputs = {};

        if (Object.keys(props).length) {
            for (const [key, def] of Object.entries(props)) {
                const isReq = req.includes(key);
                const field = document.createElement('div');
                field.className = 'tt-field';
                field.innerHTML = `
                    <div class="tt-field-label">${_esc(key)}${isReq ? ' <span class="tt-req">required</span>' : ''}</div>
                    ${def.description ? `<div class="tt-field-desc">${_esc(def.description)}</div>` : ''}`;

                let input;
                if (def.type === 'boolean') {
                    const wrap = document.createElement('div');
                    wrap.className = 'tt-checkbox-row';
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    wrap.appendChild(input);
                    wrap.appendChild(document.createTextNode(key));
                    field.appendChild(wrap);
                } else if (def.type === 'number' || def.type === 'integer') {
                    input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'tt-input';
                    input.placeholder = def.type;
                    field.appendChild(input);
                } else {
                    input = document.createElement('textarea');
                    input.className = 'tt-textarea';
                    input.rows = 2;
                    input.placeholder = def.type === 'object' ? '{ "key": "value" }' : (def.default ?? '');
                    field.appendChild(input);
                }
                inputs[key] = { el: input, def };
                form.appendChild(field);
            }
        } else {
            // No schema — show a raw JSON textarea
            const field = document.createElement('div');
            field.className = 'tt-field';
            field.innerHTML = '<div class="tt-raw-label">Args (JSON)</div>';
            const ta = document.createElement('textarea');
            ta.className = 'tt-textarea';
            ta.rows = 3;
            ta.placeholder = '{}';
            field.appendChild(ta);
            inputs.__raw = { el: ta, def: { type: 'object' } };
            form.appendChild(field);
        }

        const runBtn  = el.querySelector('.tt-run');
        const status  = el.querySelector('.tt-status');
        const resDom  = el.querySelector('.tt-result');
        const resPre  = el.querySelector('.tt-result-pre');

        runBtn.addEventListener('click', async () => {
            if (!runner) { status.textContent = 'No runner'; return; }
            let args = {};
            if (inputs.__raw) {
                try { args = JSON.parse(inputs.__raw.el.value || '{}'); } catch { status.textContent = 'Invalid JSON'; return; }
            } else {
                for (const [k, { el: inp, def }] of Object.entries(inputs)) {
                    const raw = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
                    if (!raw && raw !== false) continue;
                    if (def.type === 'number' || def.type === 'integer') args[k] = Number(raw);
                    else if (def.type === 'object' || def.type === 'array') {
                        try { args[k] = JSON.parse(raw); } catch { args[k] = raw; }
                    } else {
                        args[k] = raw;
                    }
                }
            }
            runBtn.disabled = true;
            status.textContent = 'running…';
            resDom.style.display = 'none';
            const t0 = Date.now();
            try {
                const result = await runner.execute(t.name, args);
                const ms = Date.now() - t0;
                status.textContent = `✓ ${ms}ms`;
                resPre.className = 'tt-result-pre ok';
                resPre.textContent = JSON.stringify(result, null, 2);
            } catch (err) {
                const ms = Date.now() - t0;
                status.textContent = `✗ ${ms}ms`;
                resPre.className = 'tt-result-pre err';
                resPre.textContent = String(err?.message ?? err);
            } finally {
                runBtn.disabled = false;
                resDom.style.display = 'block';
            }
        });

        return el;
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-tool-tester', AwToolTester);

function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
