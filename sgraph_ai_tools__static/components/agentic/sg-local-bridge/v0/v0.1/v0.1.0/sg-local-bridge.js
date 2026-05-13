/**
 * sg-local-bridge — Headless Web Component that bridges an LLM tool-runner
 * to a local FastAPI bridge service (sgraph_bridge).
 *
 * Place inside a [data-llm-bus] element alongside <sg-tool-runner>.
 * On connectedCallback, if auto-connect is set, pings the bridge and registers
 * six tools on the nearest sg-tool-runner.
 *
 * Attributes:
 *   endpoint      - FastAPI base URL (default: "http://localhost:8000")
 *   workspace     - Display label only (default: "/workspace")
 *   auto-connect  - Boolean presence; pings on mount if set
 *   tools         - CSV of tool names to register, or "*" for all (default: "*")
 *   timeout-ms    - Per-request timeout in ms (default: 30000)
 *
 * Bus events (dispatched on [data-llm-bus] ancestor):
 *   sg-local-bridge:status    { ok, version, workspace, latency_ms }
 *   sg-local-bridge:tool-call { name, args, result, ms }
 *   sg-local-bridge:error     { message, detail }
 *
 * @module sg-local-bridge
 * @version 0.1.0
 */

import {
    ping, readFile, writeFile, deleteFile, listFolder, runBash, fetchUrl,
} from './sg-local-bridge-client.js';

// ── Tool name constants ───────────────────────────────────────────────────────

const ALL_TOOLS = ['lb_read_file', 'lb_write_file', 'lb_delete_file', 'lb_list_folder', 'lb_run_bash', 'lb_fetch_url'];

// ── Tool schemas (OpenAI function format) ─────────────────────────────────────
// Used to register lb_* tools with sg-tool-definition so they appear in the
// Tools panel and are included in the tool_calls payload sent to the LLM.

const LB_TOOL_SCHEMAS = {
    lb_read_file: {
        type: 'function',
        function: {
            name: 'lb_read_file',
            description: 'Read a text file from the workspace.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                },
                required: ['path'],
            },
        },
    },
    lb_write_file: {
        type: 'function',
        function: {
            name: 'lb_write_file',
            description: 'Write content to a file in the workspace (creates missing directories).',
            parameters: {
                type: 'object',
                properties: {
                    path:        { type: 'string',  description: 'File path relative to workspace root' },
                    content:     { type: 'string',  description: 'Text content to write' },
                    create_dirs: { type: 'boolean', description: 'Create parent directories if missing (default: true)' },
                },
                required: ['path', 'content'],
            },
        },
    },
    lb_delete_file: {
        type: 'function',
        function: {
            name: 'lb_delete_file',
            description: 'Delete a file from the workspace.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                },
                required: ['path'],
            },
        },
    },
    lb_list_folder: {
        type: 'function',
        function: {
            name: 'lb_list_folder',
            description: 'List files and folders in a workspace directory.',
            parameters: {
                type: 'object',
                properties: {
                    path:      { type: 'string',  description: 'Directory path relative to workspace root' },
                    recursive: { type: 'boolean', description: 'List subdirectories recursively (default: false)' },
                },
                required: ['path'],
            },
        },
    },
    lb_run_bash: {
        type: 'function',
        function: {
            name: 'lb_run_bash',
            description: 'Run a bash command inside the Docker container workspace.',
            parameters: {
                type: 'object',
                properties: {
                    command:   { type: 'string', description: 'Shell command to execute' },
                    cwd:       { type: 'string', description: 'Working directory relative to workspace root (default: workspace root)' },
                    timeout_s: { type: 'number', description: 'Timeout in seconds (default: 30)' },
                },
                required: ['command'],
            },
        },
    },
    lb_fetch_url: {
        type: 'function',
        function: {
            name: 'lb_fetch_url',
            description: 'Fetch a URL from inside the Docker container and return the response body.',
            parameters: {
                type: 'object',
                properties: {
                    url:     { type: 'string', description: 'URL to fetch' },
                    method:  { type: 'string', description: 'HTTP method (default: GET)' },
                    headers: { type: 'object', description: 'Request headers as key-value pairs' },
                    body:    { type: 'string', description: 'Request body for POST/PUT' },
                },
                required: ['url'],
            },
        },
    },
};

// ── Component ─────────────────────────────────────────────────────────────────

export class SgLocalBridge extends HTMLElement {

    constructor() {
        super();
        /** @type {Element|null} Nearest [data-llm-bus] ancestor */
        this._bus    = null;
        /** @type {Object|null} Last successful ping result */
        this._status = null;
    }

    // ── Attribute helpers ───────────────────────────────────────────────────

    /** @returns {string} */
    get _endpoint()  { return this.getAttribute('endpoint')   || 'http://localhost:8000'; }
    /** @returns {string} */
    get _workspace() { return this.getAttribute('workspace')  || '/workspace'; }
    /** @returns {number} */
    get _timeoutMs() { return parseInt(this.getAttribute('timeout-ms') || '30000', 10); }
    /** @returns {boolean} */
    get _autoConnect() { return this.hasAttribute('auto-connect'); }
    /** @returns {string[]} Names to register — subset of ALL_TOOLS or all */
    get _toolNames() {
        const raw = (this.getAttribute('tools') || '*').trim();
        if (raw === '*') return ALL_TOOLS;
        return raw.split(',').map(s => s.trim()).filter(s => ALL_TOOLS.includes(s));
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    connectedCallback() {
        // Walk ancestors to find [data-llm-bus]
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) { this._bus = el; break; }
            el = el.parentElement;
        }
        if (!this._bus) this._bus = this.parentElement || document.body;

        if (this._autoConnect) this.connect();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Ping the bridge, update status, and register tools on sg-tool-runner.
     * Fires sg-local-bridge:status on success, sg-local-bridge:error on failure.
     *
     * @returns {Promise<void>}
     */
    async connect() {
        let result;
        try {
            result = await ping(this._endpoint, Math.min(this._timeoutMs, 8000));
        } catch (err) {
            this._emitBus('sg-local-bridge:error', {
                message: err.message || 'Bridge unreachable',
                detail:  err.detail  || null,
            });
            return;
        }
        this._status = { ok: result.ok, version: result.version, workspace: result.workspace, latency_ms: result.latency_ms };
        this._emitBus('sg-local-bridge:status', this._status);
        this._registerTools();
    }

    // ── Tool registration ───────────────────────────────────────────────────

    /**
     * Register the enabled lb_* tools on the nearest sg-tool-runner.
     * If runner.register is not yet available, waits for sg-tool-runner:ready.
     * @private
     */
    _registerTools() {
        const runner = this._bus.querySelector('sg-tool-runner');
        if (runner && typeof runner.register === 'function') {
            this._doRegister(runner);
        } else {
            // Wait for the runner to declare itself ready
            const onReady = () => {
                this._bus.removeEventListener('sg-tool-runner:ready', onReady);
                const r = this._bus.querySelector('sg-tool-runner');
                if (r && typeof r.register === 'function') this._doRegister(r);
            };
            this._bus.addEventListener('sg-tool-runner:ready', onReady);
        }
    }

    /**
     * Perform the actual runner.register() calls for each enabled tool,
     * then push the lb_* schemas into sg-tool-definition so the Tools panel
     * shows them and sg-llm-request includes them in the Ollama API payload.
     * @param {Element} runner - sg-tool-runner element
     * @private
     */
    _doRegister(runner) {
        const ep  = this._endpoint;
        const tms = this._timeoutMs;
        const bus = this._bus;

        /** Wrap a client call: fires tool-call event, returns result */
        const wrap = (name, fn) => {
            runner.register(name, async (args) => {
                const t0 = Date.now();
                const result = await fn(args);
                bus.dispatchEvent(new CustomEvent('sg-local-bridge:tool-call', {
                    detail: { name, args, result, ms: Date.now() - t0 },
                    bubbles: false, composed: false,
                }));
                return result;
            });
        };

        const names = this._toolNames;

        if (names.includes('lb_read_file'))
            wrap('lb_read_file',   ({ path }) => readFile(ep, path, tms));

        if (names.includes('lb_write_file'))
            wrap('lb_write_file',  ({ path, content, create_dirs }) => writeFile(ep, path, content, create_dirs ?? true, tms));

        if (names.includes('lb_delete_file'))
            wrap('lb_delete_file', ({ path }) => deleteFile(ep, path, tms));

        if (names.includes('lb_list_folder'))
            wrap('lb_list_folder', ({ path, recursive }) => listFolder(ep, path, recursive ?? false, tms));

        if (names.includes('lb_run_bash'))
            wrap('lb_run_bash',    ({ command, cwd, timeout_s }) => runBash(ep, command, cwd ?? '', timeout_s ?? 30, tms));

        if (names.includes('lb_fetch_url'))
            wrap('lb_fetch_url',   ({ url, method, headers, body }) => fetchUrl(ep, url, method ?? 'GET', headers ?? {}, body ?? '', tms));

        this._pushToToolDef(names);
    }

    /**
     * Push lb_* schemas into sg-tool-definition so the Tools panel and the
     * Ollama API payload include them. Waits for the element if not yet defined.
     * @param {string[]} names - Tool names that were registered
     * @private
     */
    _pushToToolDef(names) {
        const push = (td) => {
            for (const name of names) {
                if (LB_TOOL_SCHEMAS[name]) td.addTool(LB_TOOL_SCHEMAS[name]);
            }
        };
        const td = this._bus.querySelector('sg-tool-definition');
        if (td && typeof td.addTool === 'function') {
            push(td);
        } else {
            customElements.whenDefined('sg-tool-definition').then(() => {
                const el = this._bus.querySelector('sg-tool-definition');
                if (el && typeof el.addTool === 'function') push(el);
            });
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Dispatch a CustomEvent on the bus element.
     * @param {string} name
     * @param {Object} detail
     * @private
     */
    _emitBus(name, detail) {
        this._bus.dispatchEvent(new CustomEvent(name, {
            detail, bubbles: false, composed: false,
        }));
    }
}

customElements.define('sg-local-bridge', SgLocalBridge);
window.SgLocalBridge = SgLocalBridge;
