/**
 * sg-sandbox — Sandboxed code execution environment (v0.2.0).
 *
 * Extends v0.1.0 with Python execution via Pyodide (main thread).
 *
 * Language support:
 *   - 'javascript' (default) — sandboxed iframe, null origin, postMessage
 *   - 'python' — Pyodide on main thread via sg-pyodide.js
 *
 * JavaScript security properties (unchanged from v0.1.0):
 *   - Null-origin iframe (sandbox="allow-scripts", no allow-same-origin)
 *   - No parent DOM / cookie / storage access
 *   - Timeout enforced; iframe destroyed on timeout
 *
 * Python notes:
 *   - Pyodide runs on the main thread (Worker-based isolation is future work)
 *   - Pyodide is loaded lazily on first Python execute() call
 *   - `input` variable is available as a Python dict inside the code
 *   - Use the last expression or explicit print() for output; no `return` needed
 *   - stdout/stderr captured; error stack cleaned of Pyodide internals
 *
 * Usage:
 *   import { SGSandbox } from '/core/sg-sandbox/v0/v0.2/v0.2.0/sg-sandbox.js';
 *
 *   const sb = new SGSandbox();
 *
 *   // JavaScript
 *   const r1 = await sb.execute('return input.x * 2', { x: 21 });
 *
 *   // Python
 *   const r2 = await sb.execute('output = input["x"] * 2', { x: 21 }, 'python');
 *   // r2 = { result: null, stdout: '', stderr: '', error: null, language: 'python' }
 *
 *   sb.destroy();
 *
 * @module sg-sandbox
 * @version 0.2.0
 */

import {
    loadPyodide as _loadPyodide,
    runPythonCapture,
} from '/core/pyodide/v1/v1.0/v1.0.0/sg-pyodide.js';

// ---------------------------------------------------------------------------
// JavaScript sandboxed iframe srcdoc (unchanged from v0.1.0)
// ---------------------------------------------------------------------------

const SANDBOX_SRCDOC = `<!DOCTYPE html>
<html>
<body>
<script>
(function() {
  'use strict';
  var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  window.addEventListener('message', async function(e) {
    var d = e.data;
    if (!d || d.type !== 'execute') return;
    var id    = d.id;
    var code  = d.code;
    var input = d.input !== undefined ? d.input : {};
    try {
      var fn     = new AsyncFunction('input', code);
      var result = await fn(input);
      window.parent.postMessage({ type: 'result', id: id, result: result }, '*');
    } catch(err) {
      window.parent.postMessage({ type: 'error', id: id, error: err.message || String(err) }, '*');
    }
  });
  window.parent.postMessage({ type: 'ready' }, '*');
})();
<\/script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// SGSandbox
// ---------------------------------------------------------------------------

/**
 * Multi-language sandboxed execution environment.
 */
export class SGSandbox {

    /**
     * @param {Object} [opts]
     * @param {number} [opts.timeout=10000] Execution timeout in milliseconds.
     * @param {Function} [opts.onPyodideProgress] Called with {stage, detail} during Pyodide loading.
     */
    constructor({ timeout = 10000, onPyodideProgress = null } = {}) {
        this._timeout             = timeout;
        this._onPyodideProgress   = onPyodideProgress;

        // JS iframe state
        this._iframe    = null;
        this._ready     = null;
        this._pending   = new Map();
        this._onMessage = null;

        // Python (Pyodide) state — shared singleton managed by sg-pyodide.js
        this._py        = null;
        this._pyLoading = null;
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Execute code in the sandbox.
     *
     * For JavaScript: use `return` to produce a value. The `input` variable
     * holds whatever was passed here (structured-cloneable).
     *
     * For Python: `input` is available as a Python dict. Return value is the
     * result of the last expression (like the Python REPL). stdout/stderr are
     * captured. Returns { result, stdout, stderr, error, language }.
     *
     * @param {string} code     - Code to execute
     * @param {*}      [input={}] - Input data (available as `input` inside)
     * @param {string} [language='javascript'] - 'javascript' or 'python'
     * @returns {Promise<*>} For JS: the return value. For Python: { result, stdout, stderr, error, language }
     */
    async execute(code, input = {}, language = 'javascript') {
        if (language === 'python') {
            return this._executePython(code, input);
        }
        return this._executeJS(code, input);
    }

    /**
     * Release resources. For Python the Pyodide singleton is kept (managed globally).
     */
    destroy() {
        this._destroyIframe();
        if (this._onMessage) {
            window.removeEventListener('message', this._onMessage);
            this._onMessage = null;
        }
        for (const [, p] of this._pending) {
            clearTimeout(p.timer);
            p.reject(new Error('Sandbox destroyed'));
        }
        this._pending.clear();
        // Pyodide instance is a global singleton — not destroyed here
        this._py = null;
    }

    // ── JavaScript (iframe) ─────────────────────────────────────────────────

    /**
     * @param {string} code
     * @param {*} input
     * @returns {Promise<*>}
     */
    async _executeJS(code, input) {
        await this._ensureReady();

        const id = `sb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                this._destroyIframe();
                reject(new Error(`Sandbox timeout after ${this._timeout}ms`));
            }, this._timeout);

            this._pending.set(id, { resolve, reject, timer });
            this._iframe.contentWindow?.postMessage({ type: 'execute', id, code, input }, '*');
        });
    }

    _ensureReady() {
        if (this._ready) return this._ready;

        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;top:-1px;left:-1px;opacity:0;pointer-events:none;';
        iframe.title = 'sg-sandbox';
        document.body.appendChild(iframe);
        this._iframe = iframe;

        this._ready = new Promise((resolve) => {
            const onMessage = (e) => {
                if (!e.data) return;
                if (e.data.type === 'ready') {
                    window.removeEventListener('message', onMessage);
                    this._installHandler();
                    resolve();
                }
            };
            window.addEventListener('message', onMessage);
            iframe.addEventListener('load', () => resolve(), { once: true });
            iframe.srcdoc = SANDBOX_SRCDOC;
        });

        return this._ready;
    }

    _installHandler() {
        this._onMessage = (e) => {
            const d = e.data;
            if (!d || (d.type !== 'result' && d.type !== 'error')) return;
            const p = this._pending.get(d.id);
            if (!p) return;
            clearTimeout(p.timer);
            this._pending.delete(d.id);
            if (d.type === 'result') p.resolve(d.result);
            else                     p.reject(new Error(d.error || 'Sandbox error'));
        };
        window.addEventListener('message', this._onMessage);
    }

    _destroyIframe() {
        if (this._iframe) {
            this._iframe.remove();
            this._iframe = null;
            this._ready  = null;
        }
    }

    // ── Python (Pyodide) ────────────────────────────────────────────────────

    /**
     * Ensure Pyodide is loaded (lazy, singleton via sg-pyodide.js).
     *
     * @returns {Promise<object>} Pyodide instance
     */
    async _ensurePyodide() {
        if (this._py) return this._py;

        if (this._pyLoading) return this._pyLoading;

        this._pyLoading = _loadPyodide({
            onProgress: this._onPyodideProgress || (() => {}),
        }).then((py) => {
            this._py = py;
            return py;
        });

        return this._pyLoading;
    }

    /**
     * Execute Python code via Pyodide on the main thread.
     *
     * The `input` value is injected into the Python global namespace as `input`
     * (converted to a Python dict/list/primitive via Pyodide's toPy). After
     * execution the Python-side `input` variable is deleted to avoid leaking
     * between calls.
     *
     * @param {string} code
     * @param {*} input
     * @returns {Promise<{ result: *, stdout: string, stderr: string, error: string|null, language: string }>}
     */
    async _executePython(code, input) {
        const py = await this._ensurePyodide();

        // Inject input into Python globals
        try {
            py.globals.set('input', py.toPy(input));
        } catch {
            py.globals.set('input', input);
        }

        let pyResult;
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Python sandbox timeout after ${this._timeout}ms`)), this._timeout)
        );

        try {
            pyResult = await Promise.race([
                runPythonCapture(py, code),
                timeoutPromise,
            ]);
        } finally {
            // Clean up injected globals
            try { py.runPython('del input') } catch { /* not set */ }
        }

        return { ...pyResult, language: 'python' };
    }
}
