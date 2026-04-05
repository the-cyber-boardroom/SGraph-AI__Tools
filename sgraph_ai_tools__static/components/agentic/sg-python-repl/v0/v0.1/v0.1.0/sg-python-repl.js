/**
 * sg-python-repl — Reusable Python REPL Web Component.
 *
 * Wraps the Pyodide loading and execution pattern shared across tool pages
 * into a single, embeddable component. Supports:
 *   - On-demand or automatic Pyodide loading
 *   - Terminal-style output with distinct rows for input/stdout/stderr/error
 *   - Command history (Up/Down arrows)
 *   - Package installer (chip presets + custom input)
 *   - Public run(code) API for programmatic execution
 *
 * Usage:
 *   <sg-python-repl></sg-python-repl>
 *   <sg-python-repl auto-load></sg-python-repl>
 *
 * Attributes:
 *   auto-load   — Start loading Pyodide immediately on connect
 *   placeholder — Textarea placeholder text (default: 'Enter Python code…')
 *
 * Public methods:
 *   load()               — Trigger Pyodide load (idempotent)
 *   run(code)            — Run code string; returns Promise<{ result, stdout, stderr, error }>
 *   clear()              — Clear terminal output
 *   install(packages)    — Install packages; packages is string[] or CSV string
 *
 * Events dispatched (on the component element):
 *   sg-python-repl:ready      — Pyodide loaded
 *   sg-python-repl:result     — { detail: { code, result, stdout, stderr, error } }
 *   sg-python-repl:error      — { detail: { message } }
 *
 * @module sg-python-repl
 * @version 0.1.0
 */

import {
    loadPyodide,
    installPackages,
    runPythonCapture,
    getStatus,
} from '/core/pyodide/v1/v1.0/v1.0.0/sg-pyodide.js';

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    background: var(--sg-bg-secondary, #1a1a2e);
    border: 1px solid var(--sg-border, #333);
    border-radius: 6px;
    overflow: hidden;
    font-family: var(--sg-font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: 13px;
    height: 100%;
    min-height: 200px;
    box-sizing: border-box;
  }

  /* ── Header ── */
  .pr-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--sg-bg-tertiary, #16213e);
    border-bottom: 1px solid var(--sg-border, #333);
    flex-shrink: 0;
  }
  .pr-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--sg-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex: 1;
  }
  .pr-status {
    font-size: 11px;
    color: var(--sg-text-dim, #888);
  }
  .pr-status.ready   { color: var(--sg-accent, #4ecdc4); }
  .pr-status.error   { color: var(--sg-error, #ff6b6b); }
  .pr-status.loading { color: #ffc107; }

  /* ── Load button ── */
  .pr-load-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 24px;
    flex-direction: column;
    gap: 12px;
  }
  .pr-load-btn {
    padding: 8px 20px;
    background: var(--sg-accent, #4ecdc4);
    color: #000;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: opacity 0.15s;
  }
  .pr-load-btn:hover   { opacity: 0.85; }
  .pr-load-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .pr-progress {
    font-size: 12px;
    color: var(--sg-text-dim, #888);
    text-align: center;
    min-height: 18px;
  }

  /* ── Terminal ── */
  .pr-terminal {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: none;
  }
  .pr-terminal.visible { display: block; }
  .pr-line {
    padding: 1px 0;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.5;
  }
  .pr-line.input  { color: var(--sg-text, #e0e0e0); }
  .pr-line.output { color: var(--sg-accent, #4ecdc4); }
  .pr-line.stderr { color: #ffc107; }
  .pr-line.error  { color: var(--sg-error, #ff6b6b); }
  .pr-line.info   { color: var(--sg-text-dim, #888); font-style: italic; }

  /* ── Packages ── */
  .pr-pkg-bar {
    display: none;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-top: 1px solid var(--sg-border, #333);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .pr-pkg-bar.visible { display: flex; }
  .pr-pkg-chip {
    padding: 2px 8px;
    border: 1px solid var(--sg-border, #333);
    border-radius: 12px;
    font-size: 11px;
    cursor: pointer;
    color: var(--sg-text-dim, #888);
    transition: all 0.15s;
    background: transparent;
  }
  .pr-pkg-chip:hover         { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }
  .pr-pkg-chip.installed     { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); background: rgba(78,205,196,0.1); cursor: default; }
  .pr-pkg-chip.loading       { border-color: #ffc107; color: #ffc107; cursor: not-allowed; }
  .pr-pkg-chip.failed        { border-color: var(--sg-error, #ff6b6b); color: var(--sg-error, #ff6b6b); cursor: default; }
  .pr-pkg-input {
    background: transparent;
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text, #e0e0e0);
    font-size: 11px;
    padding: 2px 6px;
    width: 100px;
    font-family: inherit;
  }
  .pr-pkg-input::placeholder { color: var(--sg-text-dim, #888); }
  .pr-pkg-install-btn {
    background: transparent;
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text-dim, #888);
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }
  .pr-pkg-install-btn:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }

  /* ── Input area ── */
  .pr-input-wrap {
    display: none;
    border-top: 1px solid var(--sg-border, #333);
    flex-shrink: 0;
  }
  .pr-input-wrap.visible { display: flex; flex-direction: column; }
  .pr-textarea {
    background: var(--sg-bg-tertiary, #16213e);
    border: none;
    color: var(--sg-text, #e0e0e0);
    font-family: inherit;
    font-size: 13px;
    padding: 8px 12px;
    resize: none;
    min-height: 60px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .pr-textarea::placeholder { color: var(--sg-text-dim, #888); }
  .pr-run-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 8px;
    background: var(--sg-bg-tertiary, #16213e);
  }
  .pr-hint {
    font-size: 11px;
    color: var(--sg-text-dim, #888);
    flex: 1;
  }
  .pr-run-btn {
    padding: 4px 14px;
    background: var(--sg-accent, #4ecdc4);
    color: #000;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  .pr-run-btn:hover   { opacity: 0.85; }
  .pr-run-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .pr-clear-btn {
    padding: 4px 10px;
    background: transparent;
    color: var(--sg-text-dim, #888);
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    transition: all 0.15s;
  }
  .pr-clear-btn:hover { color: var(--sg-text, #e0e0e0); border-color: var(--sg-text, #e0e0e0); }
</style>

<div class="pr-header">
  <span class="pr-title">Python REPL</span>
  <span class="pr-status" id="status">idle</span>
</div>

<div class="pr-load-wrap" id="load-wrap">
  <button class="pr-load-btn" id="load-btn">Start Python</button>
  <div class="pr-progress" id="progress"></div>
</div>

<div class="pr-terminal" id="terminal"></div>

<div class="pr-pkg-bar" id="pkg-bar">
  <button class="pr-pkg-chip" data-pkg="numpy">numpy</button>
  <button class="pr-pkg-chip" data-pkg="pandas">pandas</button>
  <button class="pr-pkg-chip" data-pkg="cryptography">cryptography</button>
  <button class="pr-pkg-chip" data-pkg="httpx">httpx</button>
  <button class="pr-pkg-chip" data-pkg="pydantic">pydantic</button>
  <input class="pr-pkg-input" id="pkg-input" placeholder="package…" />
  <button class="pr-pkg-install-btn" id="pkg-install-btn">install</button>
</div>

<div class="pr-input-wrap" id="input-wrap">
  <textarea class="pr-textarea" id="code-input" rows="3" placeholder="Enter Python code…"></textarea>
  <div class="pr-run-row">
    <span class="pr-hint">Shift+Enter to run · ↑↓ history</span>
    <button class="pr-clear-btn" id="clear-btn">clear</button>
    <button class="pr-run-btn" id="run-btn">▶ Run</button>
  </div>
</div>
`;

// ---------------------------------------------------------------------------
// Preset chips
// ---------------------------------------------------------------------------

const PRESET_PACKAGES = ['numpy', 'pandas', 'cryptography', 'httpx', 'pydantic'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class SgPythonRepl extends HTMLElement {

    static get observedAttributes() {
        return ['auto-load', 'placeholder'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

        this._py          = null;
        this._history     = [];
        this._historyIdx  = -1;
        this._running     = false;
        this._installed   = new Set();

        this._el = {
            status:     this.shadowRoot.getElementById('status'),
            loadWrap:   this.shadowRoot.getElementById('load-wrap'),
            loadBtn:    this.shadowRoot.getElementById('load-btn'),
            progress:   this.shadowRoot.getElementById('progress'),
            terminal:   this.shadowRoot.getElementById('terminal'),
            pkgBar:     this.shadowRoot.getElementById('pkg-bar'),
            inputWrap:  this.shadowRoot.getElementById('input-wrap'),
            codeInput:  this.shadowRoot.getElementById('code-input'),
            runBtn:     this.shadowRoot.getElementById('run-btn'),
            clearBtn:   this.shadowRoot.getElementById('clear-btn'),
            pkgInput:   this.shadowRoot.getElementById('pkg-input'),
            pkgInstall: this.shadowRoot.getElementById('pkg-install-btn'),
        };
    }

    connectedCallback() {
        this._el.loadBtn.addEventListener('click', () => this.load());
        this._el.runBtn.addEventListener('click', () => this._runFromInput());
        this._el.clearBtn.addEventListener('click', () => this.clear());
        this._el.codeInput.addEventListener('keydown', (e) => this._onKeydown(e));
        this._el.pkgInstall.addEventListener('click', () => this._installFromInput());
        this._el.pkgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._installFromInput(); });

        // Chip clicks
        this.shadowRoot.querySelectorAll('.pr-pkg-chip[data-pkg]').forEach((chip) => {
            chip.addEventListener('click', () => {
                if (chip.classList.contains('installed') || chip.classList.contains('loading')) return;
                this.install([chip.dataset.pkg]);
            });
        });

        if (this.hasAttribute('auto-load')) {
            this.load();
        }

        if (this.getAttribute('placeholder')) {
            this._el.codeInput.placeholder = this.getAttribute('placeholder');
        }
    }

    attributeChangedCallback(name, _old, val) {
        if (name === 'placeholder' && this._el?.codeInput) {
            this._el.codeInput.placeholder = val ?? 'Enter Python code…';
        }
        if (name === 'auto-load' && val !== null && !this._py) {
            this.load();
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Load Pyodide. Idempotent — safe to call multiple times.
     *
     * @returns {Promise<void>}
     */
    async load() {
        if (this._py) return;
        const status = getStatus();
        if (status.loaded) {
            // Already loaded by another component — grab cached instance
            this._py = await loadPyodide();
            this._onReady();
            return;
        }

        this._setStatus('loading');
        this._el.loadBtn.disabled = true;
        this._el.progress.textContent = 'Downloading Pyodide (~20 MB, cached after first load)…';

        try {
            this._py = await loadPyodide({
                onProgress: ({ stage, detail }) => {
                    this._el.progress.textContent = detail;
                },
            });
            this._onReady();
        } catch (err) {
            this._setStatus('error');
            this._el.progress.textContent = `Load failed: ${err.message}`;
            this._el.loadBtn.disabled = false;
            this.dispatchEvent(new CustomEvent('sg-python-repl:error', { bubbles: true, detail: { message: err.message } }));
        }
    }

    /**
     * Run Python code programmatically.
     *
     * @param {string} code
     * @returns {Promise<{ result: *, stdout: string, stderr: string, error: string|null }>}
     */
    async run(code) {
        if (!this._py) {
            await this.load();
        }
        return this._execute(code, { echo: false });
    }

    /**
     * Clear terminal output.
     */
    clear() {
        this._el.terminal.innerHTML = '';
    }

    /**
     * Install Python packages.
     *
     * @param {string[]|string} packages - Array or comma-separated string
     * @returns {Promise<void>}
     */
    async install(packages) {
        if (!this._py) {
            await this.load();
        }
        if (typeof packages === 'string') {
            packages = packages.split(',').map((p) => p.trim()).filter(Boolean);
        }

        for (const pkg of packages) {
            const chip = this.shadowRoot.querySelector(`.pr-pkg-chip[data-pkg="${pkg}"]`);
            if (chip) chip.className = 'pr-pkg-chip loading';
            this._appendLine(`Installing ${pkg}…`, 'info');
            try {
                await installPackages(this._py, [pkg]);
                this._installed.add(pkg);
                if (chip) chip.className = 'pr-pkg-chip installed';
                this._appendLine(`✓ ${pkg} installed`, 'output');
            } catch (err) {
                if (chip) chip.className = 'pr-pkg-chip failed';
                this._appendLine(`✗ ${pkg}: ${err.message}`, 'error');
            }
        }
    }

    // ── Private ────────────────────────────────────────────────────────────

    _onReady() {
        this._el.loadWrap.style.display = 'none';
        this._el.terminal.classList.add('visible');
        this._el.pkgBar.classList.add('visible');
        this._el.inputWrap.classList.add('visible');
        this._setStatus('ready');
        this._appendLine('Python ready. Type code below and press Shift+Enter or ▶ Run.', 'info');
        this.dispatchEvent(new CustomEvent('sg-python-repl:ready', { bubbles: true }));
    }

    _setStatus(s) {
        const el = this._el.status;
        el.textContent = s;
        el.className = `pr-status ${s}`;
    }

    /**
     * @param {string} code
     * @param {{ echo?: boolean }} opts
     * @returns {Promise<{ result, stdout, stderr, error }>}
     */
    async _execute(code, { echo = true } = {}) {
        if (!code.trim()) return { result: null, stdout: '', stderr: '', error: null };

        this._running = true;
        this._el.runBtn.disabled = true;
        this._el.runBtn.textContent = '…';

        if (echo) this._appendLine(`>>> ${code.trimEnd()}`, 'input');

        let pyResult;
        try {
            pyResult = await runPythonCapture(this._py, code);
        } catch (err) {
            pyResult = { result: null, stdout: '', stderr: '', error: err.message };
        } finally {
            this._running = false;
            this._el.runBtn.disabled = false;
            this._el.runBtn.textContent = '▶ Run';
        }

        const { result, stdout, stderr, error } = pyResult;

        if (stdout) stdout.split('\n').forEach((l) => this._appendLine(l, 'output'));
        if (stderr) stderr.split('\n').filter(Boolean).forEach((l) => this._appendLine(l, 'stderr'));
        if (error)  error.split('\n').filter(Boolean).forEach((l) => this._appendLine(l, 'error'));
        if (result != null && result !== undefined && !stdout && !error) {
            this._appendLine(String(result), 'output');
        }

        this._scrollBottom();

        this.dispatchEvent(new CustomEvent('sg-python-repl:result', {
            bubbles: true,
            detail: { code, result, stdout, stderr, error },
        }));

        return pyResult;
    }

    _appendLine(text, cls) {
        const div = document.createElement('div');
        div.className = `pr-line ${cls}`;
        div.textContent = text;
        this._el.terminal.appendChild(div);
        this._scrollBottom();
    }

    _scrollBottom() {
        this._el.terminal.scrollTop = this._el.terminal.scrollHeight;
    }

    _runFromInput() {
        const code = this._el.codeInput.value;
        if (!code.trim() || !this._py) return;
        // Add to history (avoid consecutive duplicates)
        if (!this._history.length || this._history[this._history.length - 1] !== code) {
            this._history.push(code);
        }
        this._historyIdx = this._history.length;
        this._el.codeInput.value = '';
        this._execute(code, { echo: true });
    }

    _onKeydown(e) {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            this._runFromInput();
            return;
        }

        // History navigation — only when cursor is on first/last line
        const ta = this._el.codeInput;
        if (e.key === 'ArrowUp') {
            const beforeCursor = ta.value.slice(0, ta.selectionStart);
            if (beforeCursor.includes('\n')) return; // multi-line: let default handle
            if (this._historyIdx > 0) {
                e.preventDefault();
                this._historyIdx--;
                ta.value = this._history[this._historyIdx] ?? '';
                ta.selectionStart = ta.selectionEnd = ta.value.length;
            }
        } else if (e.key === 'ArrowDown') {
            const afterCursor = ta.value.slice(ta.selectionEnd);
            if (afterCursor.includes('\n')) return;
            if (this._historyIdx < this._history.length - 1) {
                e.preventDefault();
                this._historyIdx++;
                ta.value = this._history[this._historyIdx] ?? '';
            } else if (this._historyIdx === this._history.length - 1) {
                e.preventDefault();
                this._historyIdx = this._history.length;
                ta.value = '';
            }
        }
    }

    _installFromInput() {
        const val = this._el.pkgInput.value.trim();
        if (!val) return;
        this._el.pkgInput.value = '';
        this.install(val);
    }
}

customElements.define('sg-python-repl', SgPythonRepl);
