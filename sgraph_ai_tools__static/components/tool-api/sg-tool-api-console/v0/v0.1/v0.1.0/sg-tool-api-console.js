/**
 * sg-tool-api-console — Interactive method caller for SgToolApi instances.
 *
 * Lets developers call any registered method directly from the browser,
 * see the result, and review recent call history. Reads the method list
 * from meta.getMethods() and invokes via window.__tool[method](params).
 *
 * Usage:
 *   <sg-tool-api-console></sg-tool-api-console>
 *   <sg-tool-api-console tool-id="infographic-generator:root"></sg-tool-api-console>
 *
 * @element sg-tool-api-console
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
.console {
    display: flex;
    height: 100%;
    gap: 0;
    overflow: hidden;
}
/* ── Left: method selector + call form ── */
.call-panel {
    width: 260px;
    flex-shrink: 0;
    border-right: 1px solid #1a1a3a;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.section-hdr {
    font-size: 10px;
    font-weight: 600;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 10px 4px;
    border-bottom: 1px solid #1a1a3a;
    flex-shrink: 0;
}
.method-list {
    overflow-y: auto;
    flex-shrink: 0;
    max-height: 160px;
    border-bottom: 1px solid #1a1a3a;
}
.method-item {
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
    color: #718096;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.method-item:hover  { background: #0d0d1a; color: #a0aec0; }
.method-item.active { background: #0d1020; color: #4ECDC4; border-left: 2px solid #4ECDC4; }
.params-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 8px;
    gap: 6px;
}
.params-label {
    font-size: 10px;
    font-weight: 600;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.params-ta {
    flex: 1;
    resize: none;
    background: #060610;
    border: 1px solid #1a1a3a;
    border-radius: 4px;
    color: #a0aec0;
    padding: 6px 8px;
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
    outline: none;
    overflow-y: auto;
}
.params-ta:focus { border-color: #4ECDC4; }
.call-btn {
    flex-shrink: 0;
    padding: 7px 12px;
    background: #1a3a2a;
    border: 1px solid #2d6a4a;
    border-radius: 4px;
    color: #68d391;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    letter-spacing: 0.03em;
}
.call-btn:hover    { background: #1c4532; border-color: #4ECDC4; }
.call-btn:disabled { background: #111; border-color: #1a1a3a; color: #4a5568; cursor: default; }
/* ── Right: result + history ── */
.output-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.result-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-bottom: 1px solid #1a1a3a;
}
.result-box {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
    font-family: monospace;
    font-size: 11px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
}
.result-box.ok  { color: #68d391; }
.result-box.err { color: #fc8181; }
.result-box.pending { color: #4a5568; font-style: italic; }
.dur { font-size: 10px; color: #4a5568; padding: 2px 10px 4px; flex-shrink: 0; text-align: right; }
.history-section {
    height: 130px;
    flex-shrink: 0;
    overflow-y: auto;
}
.hist-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    cursor: pointer;
    border-bottom: 1px solid #0d0d1a;
    font-size: 11px;
}
.hist-row:hover { background: #0d0d1a; }
.hist-method { color: #4ECDC4; font-weight: 600; min-width: 90px; }
.hist-dur    { color: #4a5568; font-size: 10px; min-width: 42px; text-align: right; }
.hist-ok     { color: #68d391; font-size: 10px; }
.hist-err    { color: #fc8181; font-size: 10px; }
.empty { color: #4a5568; font-style: italic; text-align: center; padding: 16px; }
`;

// Default param templates per method
const PARAM_TEMPLATES = {
    connect:     '{\n  "apiKey": "sk-or-v1-...",\n  "model": "google/gemini-2.0-flash-exp:free"\n}',
    generate:    '{\n  "prompt": "A simple 3-step process: Plan → Build → Ship",\n  "model": "google/gemini-2.0-flash-exp:free",\n  "renderUI": true\n}',
    setPrompt:   '"A timeline of major AI milestones from 2017 to 2025"',
    setModel:    '"google/gemini-2.0-flash-exp:free"',
    setTemplate: '"timeline"',
    getState:    '{}',
    getPrompt:   '{}',
    getModel:    '{}',
    stop:        '{}',
};

class SgToolApiConsole extends HTMLElement {
    constructor() {
        super();
        this._tool    = null;
        this._method  = null;
        this._history = [];   // max 20
        this._shadow  = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._build();
        this._tryBind();
        window.addEventListener('tool:ready', () => this._tryBind());
    }

    static get observedAttributes() { return ['tool-id']; }
    attributeChangedCallback() { this._tryBind(); }

    // ── Bind ──────────────────────────────────────────────────────────────────

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
        this._renderMethods();
        // Select first method by default
        const methods = this._tool.meta.getMethods();
        if (methods.length > 0) this._selectMethod(methods[0]);
    }

    // ── Build DOM ─────────────────────────────────────────────────────────────

    _build() {
        this._shadow.innerHTML = '';
        const style = document.createElement('style');
        style.textContent = STYLES;
        this._shadow.appendChild(style);

        const root = document.createElement('div');
        root.className = 'console';

        // ── Call panel (left) ─────────────────────────────────────────────────
        const callPanel = document.createElement('div');
        callPanel.className = 'call-panel';

        const methodHdr = document.createElement('div');
        methodHdr.className = 'section-hdr';
        methodHdr.textContent = 'Methods';
        callPanel.appendChild(methodHdr);

        const methodList = document.createElement('div');
        methodList.className = 'method-list';
        methodList.dataset.role = 'method-list';
        callPanel.appendChild(methodList);

        const paramsArea = document.createElement('div');
        paramsArea.className = 'params-area';
        paramsArea.innerHTML = '<div class="params-label">Parameters (JSON)</div>';

        const ta = document.createElement('textarea');
        ta.className = 'params-ta';
        ta.placeholder = '{}';
        ta.spellcheck = false;
        ta.dataset.role = 'params-ta';
        paramsArea.appendChild(ta);

        const callBtn = document.createElement('button');
        callBtn.className = 'call-btn';
        callBtn.textContent = '▶ Call';
        callBtn.dataset.role = 'call-btn';
        callBtn.disabled = true;
        callBtn.addEventListener('click', () => this._call());
        paramsArea.appendChild(callBtn);

        callPanel.appendChild(paramsArea);
        root.appendChild(callPanel);

        // ── Output panel (right) ──────────────────────────────────────────────
        const outputPanel = document.createElement('div');
        outputPanel.className = 'output-panel';

        const resultSection = document.createElement('div');
        resultSection.className = 'result-section';

        const resultHdr = document.createElement('div');
        resultHdr.className = 'section-hdr';
        resultHdr.dataset.role = 'result-hdr';
        resultHdr.textContent = 'Result';
        resultSection.appendChild(resultHdr);

        const resultBox = document.createElement('div');
        resultBox.className = 'result-box pending';
        resultBox.dataset.role = 'result-box';
        resultBox.textContent = 'Select a method and click ▶ Call';
        resultSection.appendChild(resultBox);

        const durEl = document.createElement('div');
        durEl.className = 'dur';
        durEl.dataset.role = 'dur';
        resultSection.appendChild(durEl);

        outputPanel.appendChild(resultSection);

        const histHdr = document.createElement('div');
        histHdr.className = 'section-hdr';
        histHdr.textContent = 'History';
        outputPanel.appendChild(histHdr);

        const histSection = document.createElement('div');
        histSection.className = 'history-section';
        histSection.dataset.role = 'history';
        histSection.innerHTML = '<div class="empty">No calls yet</div>';
        outputPanel.appendChild(histSection);

        root.appendChild(outputPanel);
        this._shadow.appendChild(root);
    }

    // ── Methods list ──────────────────────────────────────────────────────────

    _renderMethods() {
        if (!this._tool) return;
        const list    = this._shadow.querySelector('[data-role="method-list"]');
        const methods = this._tool.meta.getMethods();
        list.innerHTML = '';
        for (const m of methods) {
            const item = document.createElement('div');
            item.className = 'method-item';
            item.textContent = m + '()';
            item.dataset.method = m;
            item.addEventListener('click', () => this._selectMethod(m));
            list.appendChild(item);
        }
    }

    _selectMethod(name) {
        this._method = name;

        // Highlight active
        for (const el of this._shadow.querySelectorAll('.method-item')) {
            el.classList.toggle('active', el.dataset.method === name);
        }

        // Set param template
        const ta = this._shadow.querySelector('[data-role="params-ta"]');
        ta.value = PARAM_TEMPLATES[name] || '{}';

        // Enable call button
        const btn = this._shadow.querySelector('[data-role="call-btn"]');
        btn.disabled = false;
        btn.textContent = `▶ ${name}()`;

        // Update result header
        const hdr = this._shadow.querySelector('[data-role="result-hdr"]');
        hdr.textContent = `Result — ${name}()`;
    }

    // ── Call ──────────────────────────────────────────────────────────────────

    async _call() {
        if (!this._tool || !this._method) return;
        const name   = this._method;
        const taVal  = this._shadow.querySelector('[data-role="params-ta"]').value.trim();
        const btn    = this._shadow.querySelector('[data-role="call-btn"]');
        const box    = this._shadow.querySelector('[data-role="result-box"]');
        const durEl  = this._shadow.querySelector('[data-role="dur"]');

        let params;
        try {
            params = taVal === '{}' || taVal === '' ? {} : JSON.parse(taVal);
        } catch (e) {
            box.className = 'result-box err';
            box.textContent = `JSON parse error: ${e.message}`;
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ calling…';
        box.className = 'result-box pending';
        box.textContent = 'Calling…';
        durEl.textContent = '';

        const t0 = Date.now();
        try {
            const result  = await this._tool[name](params);
            const dur     = Date.now() - t0;
            const pretty  = this._safeJson(result);
            box.className = 'result-box ok';
            box.textContent = pretty;
            durEl.textContent = `${dur}ms`;
            this._addHistory({ name, params, result, dur, ok: true });
        } catch (err) {
            const dur = Date.now() - t0;
            box.className = 'result-box err';
            box.textContent = `Error: ${err.message}`;
            durEl.textContent = `${dur}ms`;
            this._addHistory({ name, params, error: err.message, dur, ok: false });
        } finally {
            btn.disabled = false;
            btn.textContent = `▶ ${name}()`;
        }
    }

    // ── History ───────────────────────────────────────────────────────────────

    _addHistory(entry) {
        this._history.unshift(entry);
        if (this._history.length > 20) this._history.pop();
        this._renderHistory();
    }

    _renderHistory() {
        const container = this._shadow.querySelector('[data-role="history"]');
        container.innerHTML = '';
        if (!this._history.length) {
            container.innerHTML = '<div class="empty">No calls yet</div>';
            return;
        }
        for (const h of this._history) {
            const row = document.createElement('div');
            row.className = 'hist-row';
            row.innerHTML = `
                <span class="hist-method">${h.name}()</span>
                <span class="hist-dur">${h.dur}ms</span>
                <span class="${h.ok ? 'hist-ok' : 'hist-err'}">${h.ok ? '✓ ok' : '✗ ' + h.error}</span>
            `;
            // Click to restore this call
            row.addEventListener('click', () => {
                this._selectMethod(h.name);
                const ta = this._shadow.querySelector('[data-role="params-ta"]');
                ta.value = h.params && Object.keys(h.params).length
                    ? JSON.stringify(h.params, null, 2)
                    : '{}';
                const box = this._shadow.querySelector('[data-role="result-box"]');
                box.className = `result-box ${h.ok ? 'ok' : 'err'}`;
                box.textContent = h.ok ? this._safeJson(h.result) : `Error: ${h.error}`;
                this._shadow.querySelector('[data-role="dur"]').textContent = `${h.dur}ms`;
            });
            container.appendChild(row);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _safeJson(obj) {
        try {
            return JSON.stringify(obj, (k, v) => {
                if (typeof v === 'string' && v.length > 300) return v.substring(0, 300) + '…';
                return v;
            }, 2);
        } catch { return String(obj); }
    }
}

customElements.define('sg-tool-api-console', SgToolApiConsole);
export { SgToolApiConsole };
