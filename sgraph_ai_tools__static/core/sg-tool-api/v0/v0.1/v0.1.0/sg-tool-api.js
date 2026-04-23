/**
 * SgToolApi — JavaScript API Primitive Base Class
 *
 * Every tool that implements the JS API Primitive creates an instance,
 * registers its methods via register(), then calls activate() to publish
 * itself to window.__tools and fire tool:ready.
 *
 * The UI is just one consumer of the API. Playwright, other components,
 * test suites, and the browser console are equal consumers.
 *
 * Usage:
 *   import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
 *
 *   const api = new SgToolApi({
 *       name:     'infographic-generator',
 *       version:  { api: '0.1.0', ui: '0.1.26', content: '0.1.0' },
 *       manifest: './manifest.json',
 *       skills:   { human: './SKILL-human.md', browser: './SKILL-browser.md', api: './SKILL-api.md' },
 *   });
 *
 *   api.register('connect', connectImpl, { async: true, sanitiseParams: p => ({ ...p, apiKey: '••••' }) });
 *   api.register('generate', generateImpl, { async: true, events: ['tool:generation:started', 'tool:generation:complete'] });
 *   api.activate();
 *
 * @module sg-tool-api
 * @version 0.1.0
 */

import { SGA_TOOL }      from './sg-tool-api-events.js';
import { registerTool }  from './sg-tool-api-registry.js';

/** Maximum entries in the execution log ring buffer. */
const LOG_MAX = 500;

class SgToolApi {
    /**
     * @param {object}  opts
     * @param {string}  opts.name          Tool name, e.g. 'infographic-generator'
     * @param {object}  opts.version       { api: string, ui: string, content: string }
     * @param {string}  [opts.panelId]     sg-layout panel ID. Auto-detected from DOM if omitted.
     *                                     Falls back to 'root' for standalone pages.
     * @param {string}  [opts.manifest]    URL to manifest.json (relative to tool page)
     * @param {object}  [opts.skills]      { human, browser, api } — URLs to SKILL .md files
     */
    constructor({ name, version, panelId, manifest, skills } = {}) {
        this._name         = name;
        this._version      = version || {};
        this._panelId      = panelId || this._detectPanelId() || 'root';
        this._instanceId   = `${name}:${this._panelId}`;
        this._manifestUrl  = manifest || null;
        this._skillsUrls   = skills  || {};
        this._methods      = new Map();  // name → { fn, opts }
        this._execLog      = [];         // ring buffer of execution records
        this._manifestData = null;       // cached manifest.json
        this._skillsCache  = {};         // cached SKILL file contents
        this._active       = false;

        /** Public meta API — bound methods, safe to destructure. */
        this.meta = {
            /** @returns {Promise<object>} Full manifest.json (with api section if present) */
            getManifest:  () => this._getManifest(),
            /** @returns {string[]} Registered method names */
            getMethods:   () => [...this._methods.keys()],
            /** @returns {Promise<object>} { human, browser, api } SKILL file contents */
            getSkills:    () => this._getSkills(),
            /** @returns {{ api: string, ui: string, content: string }} */
            getVersion:   () => ({ ...this._version }),
            /** @returns {string[]} All event names this tool may emit */
            getEvents:    () => this._getEvents(),
            /** @returns {object} Health snapshot — ready status, method count, etc. */
            health:       () => this._health(),
            /** @returns {object[]} Execution log (last LOG_MAX entries) */
            getLog:       () => [...this._execLog],
        };
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Register a method on this tool's API.
     * After registration the method is callable as `api.methodName(params)`.
     *
     * @param {string}   name
     * @param {Function} fn                   Implementation. Receives params object.
     * @param {object}   [opts]
     * @param {boolean}  [opts.async]          True if fn returns a Promise (default: true)
     * @param {string[]} [opts.events]         Event names this method may emit
     * @param {string[]} [opts.environment]    ['browser'] or ['browser','node']
     * @param {Function} [opts.sanitiseParams] Params → safe copy for logging (e.g. mask apiKey)
     * @returns {SgToolApi} this (chainable)
     */
    register(name, fn, opts = {}) {
        this._methods.set(name, { fn, opts });
        // Expose as a direct method so callers can do: api.connect({ apiKey })
        this[name] = (params) => this._invoke(name, params);
        return this;
    }

    /**
     * Publish this tool to window.__tools and fire tool:ready.
     * Must be called after all register() calls and after any async initialisation.
     *
     * @returns {SgToolApi} this (chainable)
     */
    activate() {
        registerTool(this._name, this._instanceId, this);
        this._active = true;
        this._emit(SGA_TOOL.TOOL_READY, {
            tool:       this._name,
            instanceId: this._instanceId,
            version:    { ...this._version },
        });
        return this;
    }

    // ── Event emission ────────────────────────────────────────────────────────

    /**
     * Dispatch a CustomEvent on window with instanceId injected into detail.
     * Tools call this to emit events defined in sg-tool-api-events.js.
     *
     * @param {string} eventName  Use SGA_TOOL constants
     * @param {object} [detail]
     */
    _emit(eventName, detail = {}) {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(eventName, {
                detail: { instanceId: this._instanceId, ...detail },
            }));
        }
    }

    // ── Execution log ─────────────────────────────────────────────────────────

    /**
     * Append an entry to the execution log (ring buffer).
     * @param {object} entry
     */
    _appendLog(entry) {
        if (this._execLog.length >= LOG_MAX) this._execLog.shift();
        this._execLog.push(entry);
    }

    // ── Method invocation ─────────────────────────────────────────────────────

    /**
     * Invoke a registered method with logging, sanitisation, and error capture.
     * @param {string} name
     * @param {object} [params]
     * @returns {Promise<*>}
     */
    async _invoke(name, params = {}) {
        const entry = this._methods.get(name);
        if (!entry) throw Object.assign(new Error(`Unknown method: ${name}`), { code: 'UNKNOWN_METHOD' });

        const { fn, opts } = entry;
        const loggedParams = opts.sanitiseParams ? opts.sanitiseParams(params) : params;
        const t0 = Date.now();
        const logEntry = {
            timestamp:  new Date().toISOString(),
            instanceId: this._instanceId,
            method:     name,
            params:     loggedParams,
        };

        try {
            const result = await fn(params);
            this._appendLog({ ...logEntry, result, duration: Date.now() - t0 });
            return result;
        } catch (err) {
            this._appendLog({ ...logEntry, error: { message: err.message, code: err.code }, duration: Date.now() - t0 });
            throw err;
        }
    }

    // ── Meta helpers ──────────────────────────────────────────────────────────

    /**
     * Try to walk up the DOM to find the nearest sg-layout panel ID.
     * Tools mounted in sg-layout should pass panelId explicitly in the constructor
     * instead of relying on auto-detection.
     * @returns {string|null}
     */
    _detectPanelId() {
        if (typeof document === 'undefined') return null;
        // sg-layout sets data-panel-id on panel wrapper elements
        const el = document.currentScript?.closest('[data-panel-id]');
        return el ? el.getAttribute('data-panel-id') : null;
    }

    /** @returns {Promise<object|null>} */
    async _getManifest() {
        if (this._manifestData) return this._manifestData;
        if (!this._manifestUrl) {
            // Synthesise a minimal manifest from registered methods
            return {
                name:    this._name,
                version: this._version.ui || '0.0.0',
                api: {
                    version: this._version.api || '0.0.0',
                    actions: Object.fromEntries(
                        [...this._methods.entries()].map(([k, { opts }]) => [k, {
                            async:       opts.async       ?? true,
                            environment: opts.environment ?? ['browser'],
                            events:      opts.events      ?? [],
                        }])
                    ),
                },
            };
        }
        try {
            const res = await fetch(this._manifestUrl);
            if (!res.ok) return null;
            this._manifestData = await res.json();
            return this._manifestData;
        } catch { return null; }
    }

    /** @returns {Promise<object>} */
    async _getSkills() {
        const out = {};
        for (const [key, url] of Object.entries(this._skillsUrls)) {
            if (this._skillsCache[key]) { out[key] = this._skillsCache[key]; continue; }
            try {
                const res = await fetch(url);
                if (res.ok) { out[key] = this._skillsCache[key] = await res.text(); }
            } catch { /* skip — skill files are optional */ }
        }
        return out;
    }

    /** @returns {string[]} */
    _getEvents() {
        const events = new Set();
        for (const { opts } of this._methods.values()) {
            (opts.events || []).forEach(e => events.add(e));
        }
        return [...events];
    }

    /** @returns {object} */
    _health() {
        return {
            status:         this._active ? 'ready' : 'initialising',
            instanceId:     this._instanceId,
            methodCount:    this._methods.size,
            methods:        [...this._methods.keys()],
            manifestLoaded: !!this._manifestData,
            logEntries:     this._execLog.length,
        };
    }
}

export { SgToolApi };
