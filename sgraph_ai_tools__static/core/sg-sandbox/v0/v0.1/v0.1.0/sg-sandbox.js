/**
 * sg-sandbox — Sandboxed JavaScript execution environment.
 *
 * Runs untrusted code (typically LLM-generated) inside a sandboxed iframe using
 * the `sandbox="allow-scripts"` attribute (no `allow-same-origin`). The iframe's
 * origin becomes null, preventing any access to parent DOM, cookies, localStorage,
 * or IndexedDB. Communication is strictly via postMessage.
 *
 * Security properties:
 *   - No access to parent origin (null origin iframe)
 *   - No DOM, cookies, or storage access
 *   - Timeout enforced (default 10 s) — iframe destroyed on timeout
 *   - No network access from within the sandbox (fetch/XMLHttpRequest are available
 *     but will hit CORS for all real origins — treat as effectively blocked)
 *   - Memory limits enforced by the browser (tab OOM kill)
 *
 * Usage:
 *   import { SGSandbox } from '/core/sg-sandbox/v0/v0.1/v0.1.0/sg-sandbox.js';
 *
 *   const sb = new SGSandbox();
 *   const result = await sb.execute(`
 *     const data = [3, 1, 4, 1, 5, 9];
 *     return { sorted: data.sort((a,b) => a-b), sum: data.reduce((a,b) => a+b) };
 *   `);
 *   sb.destroy();
 *
 * The code string may use `return` to produce a value. The returned value must be
 * structured-cloneable (plain objects, arrays, strings, numbers, booleans, null).
 *
 * An `input` variable is available inside the sandbox with whatever was passed in
 * `execute(code, input)`.
 *
 * @module sg-sandbox
 * @version 0.1.0
 */

/**
 * The srcdoc of the sandboxed iframe.
 * Uses AsyncFunction to allow async code and top-level `return`.
 * Sends { type:'ready' } on load, then listens for { type:'execute', id, code, input }.
 * Responds with { type:'result', id, result } or { type:'error', id, error }.
 */
const SANDBOX_SRCDOC = `<!DOCTYPE html>
<html>
<body>
<script>
(function() {
  'use strict';
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  window.addEventListener('message', async function(e) {
    var d = e.data;
    if (!d || d.type !== 'execute') return;
    var id   = d.id;
    var code = d.code;
    var input = d.input !== undefined ? d.input : {};
    try {
      var fn = new AsyncFunction('input', code);
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

/**
 * Sandboxed JavaScript execution environment.
 */
export class SGSandbox {

    /**
     * @param {Object} [opts]
     * @param {number} [opts.timeout=10000] Execution timeout in milliseconds.
     */
    constructor({ timeout = 10000 } = {}) {
        this._timeout   = timeout;
        this._iframe    = null;
        this._ready     = null;   // Promise<void> resolves when iframe is loaded
        this._pending   = new Map();  // id → { resolve, reject, timer }
        this._onMessage = null;
    }

    /**
     * Execute a JavaScript code string in the sandbox.
     *
     * The code may use `return` to produce a value. The `input` variable is
     * available inside the code with whatever is passed here.
     *
     * @param {string} code - JavaScript code to execute
     * @param {*} [input={}] - Value available as `input` inside the code
     * @returns {Promise<*>} Resolves with the return value; rejects on error or timeout
     */
    async execute(code, input = {}) {
        await this._ensureReady();

        const id = `sb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                // Destroy and recreate on timeout so the next call gets a fresh sandbox
                this._destroyIframe();
                reject(new Error(`Sandbox timeout after ${this._timeout}ms`));
            }, this._timeout);

            this._pending.set(id, { resolve, reject, timer });
            this._iframe.contentWindow?.postMessage({ type: 'execute', id, code, input }, '*');
        });
    }

    /**
     * Release the sandbox iframe. Call when done to free resources.
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
    }

    // ── Private ────────────────────────────────────────────────────────────

    /**
     * Ensure the sandboxed iframe exists and has finished loading.
     * Returns a Promise that resolves when the iframe's script sends 'ready'.
     * Idempotent — safe to call before every execute().
     *
     * @returns {Promise<void>}
     */
    _ensureReady() {
        if (this._ready) return this._ready;

        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;top:-1px;left:-1px;opacity:0;pointer-events:none;';
        iframe.title = 'sg-sandbox';
        document.body.appendChild(iframe);
        this._iframe = iframe;

        this._ready = new Promise((resolve) => {
            // Listen for the 'ready' postMessage from the iframe script
            const onMessage = (e) => {
                const d = e.data;
                if (!d) return;

                if (d.type === 'ready') {
                    window.removeEventListener('message', onMessage);
                    // Install the permanent message handler
                    this._installHandler();
                    resolve();
                    return;
                }
            };
            window.addEventListener('message', onMessage);

            // Fallback: if the iframe loads but never sends 'ready' (unusual),
            // resolve after load event so execute() doesn't hang forever.
            iframe.addEventListener('load', () => {
                // Handler may already be installed; resolve is idempotent
                resolve();
            }, { once: true });

            // Write the srcdoc AFTER attaching listeners
            iframe.srcdoc = SANDBOX_SRCDOC;
        });

        return this._ready;
    }

    /**
     * Install the permanent postMessage handler for result/error messages.
     * Called once after the iframe sends 'ready'.
     */
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

    /**
     * Remove and null the iframe without touching pending jobs (caller handles those).
     */
    _destroyIframe() {
        if (this._iframe) {
            this._iframe.remove();
            this._iframe = null;
            this._ready  = null;
        }
    }
}
