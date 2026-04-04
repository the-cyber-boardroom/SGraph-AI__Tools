/**
 * sg-vfs-core — VirtualFileSystem: the central VFS orchestrator.
 *
 * VirtualFileSystem wraps a storage provider and exposes both:
 *   - A direct async API (await vfs.readFile('/path'))
 *   - A DOM event bridge (listens on a [data-vfs-bus] element, dispatches
 *     response events back so components can communicate without direct
 *     references to the VFS instance)
 *
 * Every operation emits request, response (or error) events on the bus,
 * enabling the sg-vfs-event-viewer to observe all activity.
 *
 * @module sg-vfs-core
 * @version 0.1.0
 */

import { SGL_VFS }      from './sg-vfs-events.js';
import { newRequestId } from './sg-vfs-request-id.js';
import { assertValidPath } from './sg-vfs-path.js';

export class VirtualFileSystem {

    /**
     * @param {import('./sg-vfs-provider-base.js').VfsProviderBase} provider
     * @param {object} [options]
     * @param {Element|null} [options.bus] — DOM element with [data-vfs-bus]; events are dispatched here
     */
    constructor(provider, options = {}) {
        this._provider = provider;
        this._bus      = options.bus || null;
        this._ready    = false;
    }

    get providerName() { return this._provider.name; }

    /**
     * Initialise the provider. Must be called before any operations.
     * @returns {Promise<void>}
     */
    async init() {
        await this._provider.init();
        this._ready = true;
        this._emit(SGL_VFS.PROVIDER_READY, { provider: this._provider.name });
    }

    /**
     * Attach (or detach) a DOM bus element after construction.
     * @param {Element|null} bus
     */
    setBus(bus) {
        this._bus = bus;
    }

    // ── Internal event helpers ───────────────────────────────────────────

    /**
     * @param {string} eventName
     * @param {object} detail
     */
    _emit(eventName, detail) {
        if (!this._bus) return;
        this._bus.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    /**
     * Wrap a provider operation: emit request→response (or error) events,
     * measure wall time, and return the result.
     *
     * @template T
     * @param {string} requestEvent
     * @param {string} responseEvent
     * @param {object} reqDetail
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async _op(requestEvent, responseEvent, reqDetail, fn) {
        // Re-use requestId from the inbound event if provided (bus routing),
        // otherwise mint a new one (direct API call).
        const requestId = reqDetail.requestId || newRequestId();
        const timestamp = Date.now();
        const start     = performance.now();

        // NOTE: we do NOT re-emit the request event here.
        // The request was already dispatched by the caller (tool page or component),
        // so the event viewer sees it from there. Re-emitting it would cause the
        // sg-vfs-bus listener to trigger another readFile() call → infinite loop.

        try {
            const result   = await fn();
            const wallTime = Math.round(performance.now() - start);
            this._emit(responseEvent, {
                ...reqDetail,
                requestId,
                timestamp,
                wallTime,
                provider: this._provider.name,
                result,
            });
            return result;
        } catch (err) {
            const wallTime = Math.round(performance.now() - start);
            this._emit(SGL_VFS.ERROR, {
                ...reqDetail,
                requestId,
                timestamp,
                wallTime,
                provider:  this._provider.name,
                operation: requestEvent,
                error:     err.message,
            });
            throw err;
        }
    }

    // ── Public API ───────────────────────────────────────────────────────

    /**
     * Read a file. Returns its string content.
     * @param {string} path
     * @returns {Promise<string>}
     */
    async readFile(path) {
        const p = assertValidPath(path);
        return this._op(
            SGL_VFS.READ_REQUEST,
            SGL_VFS.READ_RESPONSE,
            { path: p },
            () => this._provider.readFile(p),
        );
    }

    /**
     * Write (create or overwrite) a file.
     * @param {string} path
     * @param {string} content
     * @param {object} [options]
     * @returns {Promise<void>}
     */
    async writeFile(path, content, options = {}) {
        const p = assertValidPath(path);
        return this._op(
            SGL_VFS.WRITE_REQUEST,
            SGL_VFS.WRITE_RESPONSE,
            { path: p, size: typeof content === 'string' ? content.length : 0 },
            () => this._provider.writeFile(p, content, options),
        );
    }

    /**
     * Delete a file.
     * @param {string} path
     * @returns {Promise<void>}
     */
    async deleteFile(path) {
        const p = assertValidPath(path);
        return this._op(
            SGL_VFS.DELETE_REQUEST,
            SGL_VFS.DELETE_RESPONSE,
            { path: p },
            () => this._provider.deleteFile(p),
        );
    }

    /**
     * List folder contents.
     * @param {string} path
     * @returns {Promise<Array>}
     */
    async listFolder(path) {
        const p = assertValidPath(path);
        return this._op(
            SGL_VFS.LIST_REQUEST,
            SGL_VFS.LIST_RESPONSE,
            { path: p },
            () => this._provider.listFolder(p),
        );
    }

    /**
     * Stat a path.
     * @param {string} path
     * @returns {Promise<object>}
     */
    async stat(path) {
        const p = assertValidPath(path);
        return this._op(
            SGL_VFS.STAT_REQUEST,
            SGL_VFS.STAT_RESPONSE,
            { path: p },
            () => this._provider.stat(p),
        );
    }

    /**
     * Create a folder (and parents).
     * @param {string} path
     * @returns {Promise<void>}
     */
    async createFolder(path) {
        const p = assertValidPath(path);
        return this._op(
            SGL_VFS.CREATE_FOLDER_REQUEST,
            SGL_VFS.CREATE_FOLDER_RESPONSE,
            { path: p },
            () => this._provider.createFolder(p),
        );
    }

    /**
     * Copy a file.
     * @param {string} src
     * @param {string} dst
     * @returns {Promise<void>}
     */
    async copyFile(src, dst) {
        const s = assertValidPath(src);
        const d = assertValidPath(dst);
        return this._op(
            SGL_VFS.COPY_REQUEST,
            SGL_VFS.COPY_RESPONSE,
            { path: s, src: s, dst: d },
            () => this._provider.copyFile(s, d),
        );
    }

    /**
     * Rename/move a file.
     * @param {string} src
     * @param {string} dst
     * @returns {Promise<void>}
     */
    async rename(src, dst) {
        const s = assertValidPath(src);
        const d = assertValidPath(dst);
        return this._op(
            SGL_VFS.RENAME_REQUEST,
            SGL_VFS.RENAME_RESPONSE,
            { path: s, src: s, dst: d },
            () => this._provider.rename(s, d),
        );
    }

    /**
     * Check whether a path exists.
     * @param {string} path
     * @returns {Promise<boolean>}
     */
    async exists(path) {
        const p = assertValidPath(path);
        return this._op(
            SGL_VFS.EXISTS_REQUEST,
            SGL_VFS.EXISTS_RESPONSE,
            { path: p },
            () => this._provider.exists(p),
        );
    }
}
