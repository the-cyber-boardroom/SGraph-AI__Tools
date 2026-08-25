/**
 * <sg-vault-trace> — introspection panel for the vault embed stack.
 *
 * Listens to all vault-embed events (any event whose name starts with
 * 'sg-vault-') and renders a chronological introspection panel.
 * Pure sink — emits no events of its own.
 *
 * Attributes:
 *   target — element ID to scope to (default: document level)
 *   format — "compact" (default) or "detailed"
 *
 * @module sg-vault-trace
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

/** All vault-embed event names we listen for, in the order they typically fire */
const VAULT_EVENTS = [
    'sg-vault-key:key-ready',
    'sg-vault-key:key-error',
    'sg-vault-manifest:manifest-loaded',
    'sg-vault-manifest:manifest-error',
    'sg-vault-manifest:slot-ready',
    'sg-vault-fetch:fetch-started',
    'sg-vault-fetch:fetch-completed',
    'sg-vault-fetch:decrypt-started',
    'sg-vault-fetch:decrypt-completed',
    'sg-vault-fetch:content-ready',
    'sg-vault-fetch:fetch-error',
]

/** Emoji icons for event types */
const EVENT_ICONS = {
    'sg-vault-key:key-ready':               '🔑',
    'sg-vault-key:key-error':               '🔴',
    'sg-vault-manifest:manifest-loaded':    '📋',
    'sg-vault-manifest:manifest-error':     '🔴',
    'sg-vault-manifest:slot-ready':         '📌',
    'sg-vault-fetch:fetch-started':         '🌐',
    'sg-vault-fetch:fetch-completed':       '✅',
    'sg-vault-fetch:decrypt-started':       '🔓',
    'sg-vault-fetch:decrypt-completed':     '✅',
    'sg-vault-fetch:content-ready':         '📄',
    'sg-vault-fetch:fetch-error':           '🔴',
}

class SgVaultTrace extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-vault-trace' }

    /** @type {Array<{event: string, detail: object, ts: number}>} */
    #log = []

    onReady() {
        const targetId = this.getAttribute('target')
        const scope    = targetId ? document.getElementById(targetId) : document

        if (!scope) {
            console.warn(`[sg-vault-trace] target element "${targetId}" not found, falling back to document`)
        }

        const target = scope || document

        for (const eventName of VAULT_EVENTS) {
            this.addTrackedListener(target, eventName, (e) => {
                this.#record(eventName, e.detail || {})
            })
        }
    }

    /**
     * Record an event and re-render the trace.
     * @param {string} event
     * @param {object} detail
     */
    #record(event, detail) {
        // Sanitise detail to prevent any CryptoKey objects from breaking serialisation
        const safeDetail = this.#sanitiseDetail(event, detail)
        this.#log.push({ event, detail: safeDetail, ts: Date.now() })
        this.#render()
    }

    /**
     * Produce a display-safe version of the event detail.
     * Removes CryptoKey objects (non-serialisable) and truncates large ArrayBuffers.
     * @param {string} event
     * @param {object} detail
     * @returns {object}
     */
    #sanitiseDetail(event, detail) {
        const safe = {}
        for (const [k, v] of Object.entries(detail)) {
            if (v instanceof CryptoKey) {
                safe[k] = '[CryptoKey]'
            } else if (v instanceof ArrayBuffer) {
                safe[k] = `[ArrayBuffer ${v.byteLength} bytes]`
            } else {
                safe[k] = v
            }
        }
        return safe
    }

    /**
     * Render all recorded events into the trace panel.
     */
    #render() {
        const list = this.$('#trace-list')
        if (!list) return

        const format = this.getAttribute('format') || 'compact'
        list.innerHTML = this.#log.map((entry, idx) =>
            this.#renderEntry(entry, idx, format)
        ).join('')
    }

    /**
     * Render a single trace entry.
     * @param {{event: string, detail: object, ts: number}} entry
     * @param {number} idx
     * @param {string} format
     * @returns {string}
     */
    #renderEntry(entry, idx, format) {
        const icon     = EVENT_ICONS[entry.event] || '•'
        const shortEvt = entry.event.replace(/^sg-vault-(?:key:|fetch:|manifest:)/, '')
        const rows     = this.#buildRows(entry.event, entry.detail)
        const rowsHtml = rows.map(([k, v]) =>
            `<div class="sgvt-row"><span class="sgvt-key">${this.#esc(k)}:</span><span class="sgvt-val">${this.#esc(String(v))}</span></div>`
        ).join('')

        const isError  = entry.event.includes(':error')
        const errClass = isError ? ' sgvt-entry--error' : ''

        if (format === 'compact') {
            return `<div class="sgvt-entry${errClass}" data-trace-event="${this.#esc(shortEvt)}">`
                 + `<div class="sgvt-header"><span class="sgvt-icon">${icon}</span>`
                 + `<span class="sgvt-name">${this.#esc(entry.event)}</span></div>`
                 + rowsHtml
                 + `</div>`
        }

        return `<div class="sgvt-entry${errClass}" data-trace-event="${this.#esc(shortEvt)}">`
             + `<div class="sgvt-header"><span class="sgvt-icon">${icon}</span>`
             + `<span class="sgvt-name">${this.#esc(entry.event)}</span>`
             + `<span class="sgvt-ts">#${idx + 1}</span></div>`
             + rowsHtml
             + `</div>`
    }

    /**
     * Build human-readable key-value rows for a detail object.
     * @param {string} event
     * @param {object} detail
     * @returns {Array<[string, string]>}
     */
    #buildRows(event, detail) {
        const rows = []
        const d    = detail || {}

        if (event === 'sg-vault-key:key-ready') {
            if (d.vaultId)      rows.push(['vault_id',    d.vaultId])
            if (d.endpoint)     rows.push(['endpoint',    d.endpoint])
            if (d.derivationMs != null) rows.push(['derivation', `${d.derivationMs.toFixed(1)}ms`])
        } else if (event === 'sg-vault-fetch:fetch-started') {
            if (d.url)          rows.push(['url',         d.url])
        } else if (event === 'sg-vault-fetch:fetch-completed') {
            rows.push(['bytes',  `${(d.bytesReceived || 0).toLocaleString()} (cache: ${d.cacheHit ? 'HIT' : 'MISS'})`])
            if (d.fetchMs != null) rows.push(['time',     `${d.fetchMs.toFixed(0)}ms`])
        } else if (event === 'sg-vault-fetch:decrypt-completed') {
            if (d.plaintextBytes != null) rows.push(['plaintext', `${d.plaintextBytes.toLocaleString()} bytes`])
            if (d.decryptMs != null)      rows.push(['decrypt',   `${d.decryptMs.toFixed(1)}ms`])
        } else if (event === 'sg-vault-fetch:content-ready') {
            if (d.objectId)     rows.push(['objectId',   d.objectId])
            if (d.contentType)  rows.push(['contentType', d.contentType])
            if (d.text)         rows.push(['text',        `"${d.text.slice(0, 60)}${d.text.length > 60 ? '...' : ''}"` ])
        } else if (event === 'sg-vault-manifest:manifest-loaded') {
            if (d.src)          rows.push(['src',         d.src])
            if (d.slotCount != null) rows.push(['slots',  String(d.slotCount)])
        } else if (event === 'sg-vault-manifest:slot-ready') {
            if (d.slotName)     rows.push(['slot',        d.slotName])
            if (d.render)       rows.push(['render',      d.render])
            if (d.objectId)     rows.push(['objectId',    d.objectId])
        } else {
            // Generic: show all fields
            for (const [k, v] of Object.entries(d)) {
                rows.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
            }
        }

        return rows
    }

    /**
     * Returns all recorded events as structured data (for SgToolApi).
     * @param {number} [limit]
     * @returns {Array<{event: string, detail: object, ts: number}>}
     */
    getLog(limit) {
        if (limit != null) return this.#log.slice(-limit)
        return [...this.#log]
    }

    /**
     * Clear all recorded events.
     */
    clearLog() {
        this.#log = []
        this.#render()
    }

    /**
     * HTML-escape a string for safe insertion into template literals.
     * @param {string} s
     * @returns {string}
     */
    #esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    }
}

if (!customElements.get('sg-vault-trace')) {
    customElements.define('sg-vault-trace', SgVaultTrace)
}

export { SgVaultTrace }
