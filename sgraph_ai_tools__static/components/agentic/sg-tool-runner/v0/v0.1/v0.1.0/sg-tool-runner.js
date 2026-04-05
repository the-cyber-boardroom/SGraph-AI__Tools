/**
 * sg-tool-runner — Headless Web Component that executes LLM tool calls.
 *
 * Place on the page alongside <sg-llm-request> (both must be inside or reachable
 * from the same [data-llm-bus] element).
 *
 * Listens for `llm:tool-calls` on the LLM bus. For each tool call, looks up the
 * tool function in its registry, executes it, and collects results. Once all tools
 * in a batch complete, emits `llm:tool-results-complete` with the updated messages
 * array ready for the next `llm:send`.
 *
 * Built-in tools (registered automatically unless builtins="none" attribute set):
 *   list_folder  — list VFS folder entries
 *   read_file    — read a VFS file
 *   write_file   — write a VFS file
 *   delete_file  — delete a VFS file
 *   run_code     — execute JavaScript in a sandboxed iframe (sg-sandbox)
 *
 * Custom tools can be registered via toolRunner.register(name, asyncFn).
 *
 * VFS tools require a [data-vfs-bus] element on the page (sg-vfs-bus must be inside
 * it). If no VFS bus is found, VFS tools return { error: 'No VFS bus' }.
 *
 * Usage:
 *   <div data-llm-bus>
 *     <sg-llm-request></sg-llm-request>
 *     <sg-tool-runner id="runner"></sg-tool-runner>
 *   </div>
 *
 *   // Register a custom tool:
 *   document.getElementById('runner').register('my_tool', async (args) => {
 *     return { result: args.input * 2 };
 *   });
 *
 * Tool definition format (for llm:send detail.tools[]):
 *   {
 *     type: 'function',
 *     function: {
 *       name: 'list_folder',
 *       description: 'List files in a VFS folder',
 *       parameters: {
 *         type: 'object',
 *         properties: { path: { type: 'string', description: 'Folder path' } },
 *         required: ['path']
 *       }
 *     }
 *   }
 *
 * @module sg-tool-runner
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';
import { SGL_VFS } from '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-events.js';
import { SGSandbox } from '/core/sg-sandbox/v0/v0.1/v0.1.0/sg-sandbox.js';

/** VFS request timeout in milliseconds */
const VFS_TIMEOUT_MS = 10000;

/**
 * JSON schema definitions for the built-in tools.
 * Exported so pages can include them in llm:send detail.tools[].
 *
 * @type {Array<{type:'function', function:{name:string,description:string,parameters:Object}}>}
 */
export const BUILTIN_TOOL_DEFS = [
    {
        type: 'function',
        function: {
            name: 'list_folder',
            description: 'List the files and folders inside a VFS directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute folder path, e.g. "/" or "/docs"' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the text content of a VFS file.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute file path' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write text content to a VFS file (creates if absent, overwrites if exists).',
            parameters: {
                type: 'object',
                properties: {
                    path:    { type: 'string', description: 'Absolute file path' },
                    content: { type: 'string', description: 'Text content to write' },
                },
                required: ['path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file from the VFS.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute file path to delete' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_code',
            description: 'Execute JavaScript code in a sandboxed environment. Use `return` to return a value. The `input` variable holds any data passed in.',
            parameters: {
                type: 'object',
                properties: {
                    code:  { type: 'string', description: 'JavaScript code to execute. Use `return value;` to return a result.' },
                    input: { type: 'object', description: 'Optional data available as the `input` variable inside the code.' },
                },
                required: ['code'],
            },
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────

export class SgToolRunner extends HTMLElement {

    constructor() {
        super();
        /** @type {Map<string, function(Object): Promise<*>>} */
        this._tools   = new Map();
        /** @type {SGSandbox|null} */
        this._sandbox = null;
    }

    connectedCallback() {
        this._container = this._bus();
        this._onToolCalls = this._handleToolCalls.bind(this);
        this._container.addEventListener(SGL_LLM.TOOL_CALLS, this._onToolCalls);

        if (this.getAttribute('builtins') !== 'none') {
            this._registerBuiltins();
        }
    }

    disconnectedCallback() {
        this._container.removeEventListener(SGL_LLM.TOOL_CALLS, this._onToolCalls);
        this._sandbox?.destroy();
        this._sandbox = null;
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Register a tool function.
     *
     * @param {string} name - Tool name (must match what the LLM will call)
     * @param {function(Object): Promise<*>} fn - Async function receiving args object
     */
    register(name, fn) {
        this._tools.set(name, fn);
    }

    /**
     * Remove a registered tool.
     * @param {string} name
     */
    unregister(name) {
        this._tools.delete(name);
    }

    /**
     * Execute a named tool with given args.
     * @param {string} name
     * @param {Object} args
     * @returns {Promise<*>}
     */
    async execute(name, args) {
        const fn = this._tools.get(name);
        if (!fn) throw new Error(`Unknown tool: "${name}". Registered tools: ${[...this._tools.keys()].join(', ') || 'none'}`);
        return fn(args);
    }

    /**
     * Return the list of currently registered tool names.
     * @returns {string[]}
     */
    get toolNames() { return [...this._tools.keys()]; }

    // ── Event handling ─────────────────────────────────────────────────────

    /**
     * Handle the llm:tool-calls event: execute all tools and emit results.
     *
     * @param {CustomEvent} e
     * detail: { toolCalls: [{id, type, function:{name, arguments}}], messages: Array }
     */
    async _handleToolCalls(e) {
        const { toolCalls, messages } = e.detail ?? {};
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) return;

        const results = [];

        for (const tc of toolCalls) {
            const name = tc.function?.name ?? '';
            let args = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* malformed JSON */ }

            let result, toolError;
            try {
                result = await this.execute(name, args);
                this._emit(SGL_LLM.TOOL_RESULT, { toolCallId: tc.id, name, result });
            } catch (err) {
                toolError = err.message || String(err);
                this._emit(SGL_LLM.TOOL_RESULT, { toolCallId: tc.id, name, error: toolError });
            }

            results.push({ toolCallId: tc.id, name, result, error: toolError });
        }

        // Build the updated messages array: original + assistant tool_calls message + tool results
        const assistantMsg = {
            role:       'assistant',
            content:    null,
            tool_calls: toolCalls,
        };

        const toolResultMsgs = results.map(r => ({
            role:         'tool',
            tool_call_id: r.toolCallId,
            content:      r.error
                ? JSON.stringify({ error: r.error })
                : JSON.stringify(r.result ?? null),
        }));

        const updatedMessages = [...(messages ?? []), assistantMsg, ...toolResultMsgs];

        this._emit(SGL_LLM.TOOL_RESULTS_COMPLETE, { results, messages: updatedMessages });
    }

    // ── Built-in tools ─────────────────────────────────────────────────────

    _registerBuiltins() {
        this.register('list_folder', async ({ path = '/' }) => {
            const resp = await this._vfsOp(
                SGL_VFS.LIST_REQUEST, SGL_VFS.LIST_RESPONSE,
                { path }
            );
            // Return a simple array of entry names+types
            return (resp.entries ?? []).map(e => ({ name: e.name, type: e.type, size: e.size }));
        });

        this.register('read_file', async ({ path }) => {
            if (!path) throw new Error('path is required');
            const resp = await this._vfsOp(
                SGL_VFS.READ_REQUEST, SGL_VFS.READ_RESPONSE,
                { path }
            );
            return resp.content;
        });

        this.register('write_file', async ({ path, content }) => {
            if (!path)    throw new Error('path is required');
            if (content === undefined) throw new Error('content is required');
            await this._vfsOp(
                SGL_VFS.WRITE_REQUEST, SGL_VFS.WRITE_RESPONSE,
                { path, content }
            );
            return { success: true, path };
        });

        this.register('delete_file', async ({ path }) => {
            if (!path) throw new Error('path is required');
            await this._vfsOp(
                SGL_VFS.DELETE_REQUEST, SGL_VFS.DELETE_RESPONSE,
                { path }
            );
            return { success: true, path };
        });

        this.register('run_code', async ({ code, input = {} }) => {
            if (!code) throw new Error('code is required');
            if (!this._sandbox) this._sandbox = new SGSandbox({ timeout: 15000 });
            return this._sandbox.execute(code, input);
        });
    }

    // ── VFS bridge ─────────────────────────────────────────────────────────

    /**
     * Dispatch a VFS request event and await the response.
     *
     * @param {string} reqEvent   - e.g. SGL_VFS.READ_REQUEST
     * @param {string} respEvent  - e.g. SGL_VFS.READ_RESPONSE
     * @param {Object} detail     - requestId will be added automatically
     * @returns {Promise<Object>} response detail
     */
    _vfsOp(reqEvent, respEvent, detail) {
        return new Promise((resolve, reject) => {
            const requestId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const bus = this._vfsBus();
            if (!bus) return reject(new Error('No VFS bus found — place a [data-vfs-bus] element with <sg-vfs-bus> on the page'));

            let timer;
            const cleanup = () => {
                clearTimeout(timer);
                bus.removeEventListener(respEvent, onResp);
                bus.removeEventListener(SGL_VFS.ERROR, onErr);
            };
            const onResp = (e) => {
                if (e.detail?.requestId !== requestId) return;
                cleanup(); resolve(e.detail);
            };
            const onErr = (e) => {
                if (e.detail?.requestId !== requestId) return;
                cleanup(); reject(new Error(e.detail?.error || 'VFS error'));
            };

            timer = setTimeout(() => {
                cleanup(); reject(new Error(`VFS operation timed out: ${reqEvent}`));
            }, VFS_TIMEOUT_MS);

            bus.addEventListener(respEvent, onResp);
            bus.addEventListener(SGL_VFS.ERROR, onErr);
            bus.dispatchEvent(new CustomEvent(reqEvent, {
                detail: { requestId, ...detail },
                bubbles: true, composed: true,
            }));
        });
    }

    // ── DOM walking ─────────────────────────────────────────────────────────

    /**
     * Find the [data-llm-bus] ancestor (or document fallback).
     * @returns {Element|Document}
     */
    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    /**
     * Find the [data-vfs-bus] element. Walks ancestors first, then queries document.
     * Returns null if not found.
     * @returns {Element|null}
     */
    _vfsBus() {
        // Walk ancestors
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-vfs-bus')) return el;
            el = el.parentElement;
        }
        // Global search (in case VFS bus is elsewhere in the document)
        return document.querySelector('[data-vfs-bus]');
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * @param {string} eventName
     * @param {Object} detail
     */
    _emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true, composed: true }));
    }
}

customElements.define('sg-tool-runner', SgToolRunner);
window.SgToolRunner   = SgToolRunner;
window.BUILTIN_TOOL_DEFS = BUILTIN_TOOL_DEFS;
