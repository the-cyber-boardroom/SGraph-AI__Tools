/**
 * vault-embed-demo — SgToolApi registration.
 *
 * Registers all API methods via SgToolApi and activates the tool interface
 * at window.__tools['vault-embed-demo'].
 *
 * @module vault-embed-demo-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js'
import { DEMO_CONFIG } from '../ui/main.js'
import { getTraceLog, clearTraceLog } from '../ui/ui-trace-panel.js'

// ── Private state ─────────────────────────────────────────────────────────────

let _currentEndpoint = DEMO_CONFIG.endpoint

// ── API method implementations ────────────────────────────────────────────────

/**
 * Returns the demo vault's public credentials and object IDs.
 * @returns {{ vaultId: string, readKey: string, endpoint: string, objectIds: object }}
 */
function getDemoVaultInfoImpl() {
    return {
        vaultId:   DEMO_CONFIG.vaultId,
        readKey:   DEMO_CONFIG.readKey,
        endpoint:  _currentEndpoint,
        objectIds: { ...DEMO_CONFIG.objectIds },
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
    _currentEndpoint = endpoint.replace(/\/$/, '')
    // Update all sg-vault-key elements on the page
    document.querySelectorAll('sg-vault-key').forEach(el => {
        el.setAttribute('endpoint', _currentEndpoint)
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
