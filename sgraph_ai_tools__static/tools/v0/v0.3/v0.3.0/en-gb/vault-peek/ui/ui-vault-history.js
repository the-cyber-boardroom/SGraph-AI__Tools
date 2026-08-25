/**
 * ui-vault-history — read/write vault history in localStorage.
 *
 * Stores up to MAX_ENTRIES past vault configs, deduped by vaultId.
 * Never stores passphrases — only vaultId, readKey, endpoint.
 *
 * @module ui-vault-history
 */

const HISTORY_KEY = 'sg-vault-embed-demo-v1__history'
const MAX_ENTRIES = 10

/**
 * @returns {Array<{vaultId: string, readKey: string, endpoint: string, lastUsed: number}>}
 */
export function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [] } catch { return [] }
}

/**
 * Add or update a vault entry (deduped by vaultId, newest first, capped at MAX_ENTRIES).
 * @param {{ vaultId: string, readKey: string, endpoint: string }} config
 */
export function pushHistory(config) {
    const hist = loadHistory().filter(e => e.vaultId !== config.vaultId)
    hist.unshift({
        vaultId:  config.vaultId,
        readKey:  config.readKey,
        endpoint: config.endpoint || 'https://send.sgraph.ai',
        lastUsed: Date.now(),
    })
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, MAX_ENTRIES))) } catch {}
}

/**
 * Format a timestamp as a human-readable "time ago" string.
 * @param {number} ts Unix ms
 * @returns {string}
 */
export function formatAgo(ts) {
    const diffMins = Math.floor((Date.now() - ts) / 60000)
    if (diffMins < 2)  return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const hours = Math.floor(diffMins / 60)
    if (hours < 24)    return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
}
