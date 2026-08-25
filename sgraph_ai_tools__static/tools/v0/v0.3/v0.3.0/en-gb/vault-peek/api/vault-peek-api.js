/**
 * vault-embed-demo — SgToolApi registration.
 *
 * Registers all API methods via SgToolApi and activates the tool interface
 * at window.__tools['vault-embed-demo'].
 *
 * @module vault-embed-demo-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js'
import { getTraceLog, clearTraceLog } from '../ui/ui-trace-panel.js'

const STORAGE_KEY = 'sg-vault-embed-demo-v1'

/** Read current config from localStorage. */
function getConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {} } catch { return {} }
}

// ── Private state ─────────────────────────────────────────────────────────────

let _endpointOverride = null

// ── API method implementations ────────────────────────────────────────────────

/**
 * Returns the demo vault's public credentials and object IDs.
 * @returns {{ vaultId: string, readKey: string, endpoint: string, objectIds: object }}
 */
function getDemoVaultInfoImpl() {
    const cfg = getConfig()
    return {
        vaultId:   cfg.vaultId   || null,
        readKey:   cfg.readKey   || null,
        endpoint:  _endpointOverride || cfg.endpoint || 'https://send.sgraph.ai',
        objectIds: cfg.objectIds || {},
    }
}

/**
 * Re-triggers a fetch+decrypt for one slot.
 * @param {{ slot: 'hero'|'image'|'json' }} params
 */
async function loadDemoContentImpl({ slot }) {
    const fetchId = `fetch-${slot}`
    const fetchEl = document.getElementById(fetchId)
    if (!fetchEl) throw new Error(`No fetch element found for slot: ${slot}`)
    if (typeof fetchEl.fetch !== 'function') throw new Error('fetch element has no fetch() method')
    await fetchEl.fetch()
}

/**
 * Returns the last N events from the trace panel.
 * @param {{ limit?: number }} params
 * @returns {Array}
 */
function getTraceLogImpl({ limit } = {}) {
    return getTraceLog(limit)
}

/**
 * Clears the trace panel.
 */
function clearTraceLogImpl() {
    clearTraceLog()
}

/**
 * Switch the API endpoint for testing.
 * @param {{ endpoint: string }} params
 */
function setEndpointImpl({ endpoint }) {
    if (!endpoint || typeof endpoint !== 'string') {
        throw new Error('endpoint must be a non-empty string')
    }
    _endpointOverride = endpoint.replace(/\/$/, '')
    document.querySelectorAll('sg-vault-key').forEach(el => {
        el.setAttribute('endpoint', _endpointOverride)
    })
}

// ── Register ──────────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:     'vault-embed-demo',
    version:  { api: '0.1.0', ui: '0.1.56' },
    manifest: '../manifest.json',
    skills: {
        human:   '../SKILL-human.md',
        browser: '../SKILL-browser.md',
        api:     '../SKILL-api.md',
    },
})

api.register('getDemoVaultInfo',  getDemoVaultInfoImpl,  { async: false })
api.register('loadDemoContent',   loadDemoContentImpl,   { async: true })
api.register('getTraceLog',       getTraceLogImpl,       { async: false })
api.register('clearTraceLog',     clearTraceLogImpl,     { async: false })
api.register('setEndpoint',       setEndpointImpl,       { async: false })

api.activate()

export { api }
