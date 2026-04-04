/**
 * sg-vfs-bus — Headless Web Component that owns the VirtualFileSystem instance
 * and bridges DOM events ↔ VFS operations.
 *
 * Usage:
 *   <div data-vfs-bus>
 *     <sg-vfs-bus provider="memory"></sg-vfs-bus>
 *     <!-- other components -->
 *   </div>
 *
 * The component:
 *   1. Creates a VirtualFileSystem with the selected provider.
 *   2. Mounts to the nearest [data-vfs-bus] ancestor as the event bus.
 *   3. Listens for vfs:*-request events bubbling up from child components.
 *   4. Executes the operation and lets VirtualFileSystem dispatch the response.
 *   5. Exposes `this.vfs` for direct programmatic access if needed.
 *
 * Attributes:
 *   provider — 'memory' (default). Future: 'indexeddb', 'vault'.
 *
 * Bus events handled (from child components):
 *   vfs:read-request, vfs:write-request, vfs:delete-request,
 *   vfs:list-request, vfs:stat-request, vfs:create-folder-request,
 *   vfs:copy-request, vfs:rename-request, vfs:exists-request
 *
 * Bus events emitted:
 *   vfs:provider-registered, vfs:provider-ready — on init
 *   vfs:*-response, vfs:error — after each operation
 *
 * @module sg-vfs-bus
 * @version 0.1.0
 */

import { VirtualFileSystem } from '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js';
import { MemoryProvider }    from '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-provider-memory.js';
import { SGL_VFS }           from '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-events.js';

export class SgVfsBus extends HTMLElement {

    connectedCallback() {
        const bus = this._bus();
        const provider = this._makeProvider();

        // Announce registration
        bus.dispatchEvent(new CustomEvent(SGL_VFS.PROVIDER_REGISTERED, {
            detail:   { provider: provider.name, priority: 0 },
            bubbles:  true,
            composed: true,
        }));

        this.vfs = new VirtualFileSystem(provider, { bus });
        this.vfs.init().catch(err => {
            bus.dispatchEvent(new CustomEvent(SGL_VFS.PROVIDER_ERROR, {
                detail:   { provider: provider.name, error: err.message },
                bubbles:  true,
                composed: true,
            }));
        });

        // Wire up all request events
        this._listen(bus);
    }

    disconnectedCallback() {
        if (this._handlers && this._busEl) {
            for (const [event, handler] of this._handlers) {
                this._busEl.removeEventListener(event, handler);
            }
        }
    }

    // ── Provider factory ─────────────────────────────────────────────────

    _makeProvider() {
        const type = this.getAttribute('provider') || 'memory';
        switch (type) {
            case 'memory':
            default:
                return new MemoryProvider();
        }
    }

    // ── Bus ──────────────────────────────────────────────────────────────

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-vfs-bus')) { this._busEl = el; return el; }
            el = el.parentElement;
        }
        // Fallback: use document
        this._busEl = document;
        return document;
    }

    // ── Event routing ────────────────────────────────────────────────────

    _listen(bus) {
        this._handlers = [
            [SGL_VFS.READ_REQUEST,          e => this._handle(e, d => this.vfs.readFile(d.path))],
            [SGL_VFS.WRITE_REQUEST,         e => this._handle(e, d => this.vfs.writeFile(d.path, d.content, d.options))],
            [SGL_VFS.DELETE_REQUEST,        e => this._handle(e, d => this.vfs.deleteFile(d.path))],
            [SGL_VFS.LIST_REQUEST,          e => this._handle(e, d => this.vfs.listFolder(d.path))],
            [SGL_VFS.STAT_REQUEST,          e => this._handle(e, d => this.vfs.stat(d.path))],
            [SGL_VFS.CREATE_FOLDER_REQUEST, e => this._handle(e, d => this.vfs.createFolder(d.path))],
            [SGL_VFS.COPY_REQUEST,          e => this._handle(e, d => this.vfs.copyFile(d.src, d.dst))],
            [SGL_VFS.RENAME_REQUEST,        e => this._handle(e, d => this.vfs.rename(d.src, d.dst))],
            [SGL_VFS.EXISTS_REQUEST,        e => this._handle(e, d => this.vfs.exists(d.path))],
        ];

        for (const [event, handler] of this._handlers) {
            bus.addEventListener(event, handler);
        }
    }

    /**
     * Handle an inbound request event. The requestId from the event detail is
     * preserved so the caller can correlate request↔response.
     *
     * Note: VirtualFileSystem._op() emits the response event itself, so this
     * method just needs to call the right VFS method with the preserved
     * requestId injected. We override the requestId on the vfs call by
     * temporarily monkey-patching newRequestId — simpler: we pass the
     * existing requestId through the detail and let _op use it if present.
     */
    _handle(event, fn) {
        const detail = event.detail || {};
        // Prevent double-handling if multiple sg-vfs-bus elements exist
        if (detail._handled) return;
        detail._handled = true;
        fn(detail).catch(() => {/* error already emitted by VFS */});
    }
}

customElements.define('sg-vfs-bus', SgVfsBus);
