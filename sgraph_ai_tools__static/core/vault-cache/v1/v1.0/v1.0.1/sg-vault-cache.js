/* =============================================================================
   SGraph — Vault Cache Module
   v1.0.1 — Browser Cache API integration for immutable vault blocks

   Changes from v1.0.0:
     - cachedFetchRaw() routes every ID through fileIdToPath() instead of
       hardcoding bare/data/. Only idx-* moves (to bare/indexes/, where sgit
       writes branch indexes); obj-*, unrecognised IDs and explicit bare/ paths
       resolve exactly as before. The hardcode meant vault-session's branch
       index read went to bare/data/ and always 404'd — silently, because the
       caller falls back to the HMAC-derived ref.

   Provides read-through caching for obj-cas-imm-* blocks using the browser
   Cache API. Because immutable block IDs encode SHA-256(ciphertext), cache
   entries are permanently valid — no invalidation ever needed.

   Design from vault team's sg-vault-object-store.js:
     - Cache name: sg-vault-blocks
     - Key pattern: https://sgvault/{vaultId}/bare/data/{objectId}
     - Only caches IDs containing '-imm-' (the immutability guard)
     - data.slice(0) copy semantics prevent caller transfer issues
     - Graceful degradation when Cache API unavailable

   Usage:
     import { cachedFetch, clearCache, getCacheStats } from './sg-vault-cache.js';

     const data = await cachedFetch(apiBaseUrl, vaultId, objectId, readKey);
     // First call: network fetch + cache store + decrypt
     // Second call: cache hit + decrypt (zero network)

   ============================================================================= */

import { fileIdToPath } from '/core/vault-client/v1/v1.2/v1.2.3/vault-id-utils.js'

/** @type {string} Cache API cache name — matches vault team convention */
const CACHE_NAME = 'sg-vault-blocks'

/** @type {number} AES-GCM IV length in bytes */
const IV_LENGTH = 12

/**
 * Check if the Cache API is available in this environment.
 * @returns {boolean}
 */
function cacheAvailable() {
    return typeof caches !== 'undefined'
}

/**
 * Check if an object ID represents an immutable block (safe to cache permanently).
 * @param {string} objectId - e.g. "obj-cas-imm-a1b2c3d4e5f6"
 * @returns {boolean}
 */
function isImmutable(objectId) {
    return typeof objectId === 'string' && objectId.includes('-imm-')
}

/**
 * Build the canonical cache key URL for a vault object.
 * @param {string} vaultId
 * @param {string} objectId
 * @returns {string}
 */
function cacheKey(vaultId, objectId) {
    return `https://sgvault/${vaultId}/bare/data/${objectId}`
}

/**
 * Fetch an encrypted vault object, using Cache API as read-through cache.
 * Returns the raw encrypted ArrayBuffer (caller decrypts).
 *
 * For immutable blocks (obj-cas-imm-*):
 *   1. Check Cache API → return cached ciphertext if hit
 *   2. Network fetch → store in cache → return ciphertext
 *
 * For mutable objects (refs, indexes):
 *   Always fetches from network (refs can change between requests).
 *
 * @param {string} apiBaseUrl - API base URL (e.g. 'https://send.sgraph.ai')
 * @param {string} vaultId - The vault identifier
 * @param {string} objectId - The object ID (e.g. 'obj-cas-imm-abc123')
 * @returns {Promise<ArrayBuffer>} Raw encrypted bytes [IV][ciphertext][tag]
 * @throws {Error} If network fetch fails
 */
export async function cachedFetchRaw(apiBaseUrl, vaultId, objectId) {
    const immutable = isImmutable(objectId)
    const key       = cacheKey(vaultId, objectId)

    if (immutable && cacheAvailable()) {
        try {
            const cache  = await caches.open(CACHE_NAME)
            const cached = await cache.match(key)
            if (cached) {
                const buf = await cached.arrayBuffer()
                return buf.slice(0)
            }
        } catch {
            // Cache API error — fall through to network
        }
    }

    const path = fileIdToPath(objectId)
    const url  = `${apiBaseUrl}/api/vault/read/${vaultId}/${encodeURIComponent(path)}`

    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Vault fetch failed: ${objectId} → ${response.status} ${response.statusText}`)
    }

    const data = await response.arrayBuffer()

    if (immutable && cacheAvailable()) {
        try {
            const cache = await caches.open(CACHE_NAME)
            const resp  = new Response(data.slice(0), {
                headers: { 'Content-Type': 'application/octet-stream' }
            })
            await cache.put(key, resp)
        } catch {
            // Storage quota or other error — vault works without cache
        }
    }

    return data.slice(0)
}

/**
 * Fetch and decrypt an immutable vault object with caching.
 * Combines cachedFetchRaw + AES-256-GCM decryption.
 *
 * @param {string} apiBaseUrl - API base URL
 * @param {string} vaultId - The vault identifier
 * @param {string} objectId - The object ID
 * @param {CryptoKey} readKey - AES-GCM decryption key
 * @returns {Promise<ArrayBuffer>} Decrypted plaintext
 */
export async function cachedFetch(apiBaseUrl, vaultId, objectId, readKey) {
    const encrypted = await cachedFetchRaw(apiBaseUrl, vaultId, objectId)
    return decrypt(readKey, encrypted)
}

/**
 * Fetch, decrypt, and parse a vault object as JSON with caching.
 *
 * @param {string} apiBaseUrl - API base URL
 * @param {string} vaultId - The vault identifier
 * @param {string} objectId - The object ID
 * @param {CryptoKey} readKey - AES-GCM decryption key
 * @returns {Promise<object>} Parsed JSON
 */
export async function cachedFetchJson(apiBaseUrl, vaultId, objectId, readKey) {
    const plain = await cachedFetch(apiBaseUrl, vaultId, objectId, readKey)
    return JSON.parse(new TextDecoder().decode(plain))
}

/**
 * Fetch a ref (always live, never cached — refs can change between requests).
 *
 * @param {string} apiBaseUrl - API base URL
 * @param {string} vaultId - The vault identifier
 * @param {string} refFileId - The ref file ID (e.g. 'ref-pid-muw-abc123')
 * @returns {Promise<ArrayBuffer>} Raw encrypted bytes
 */
export async function fetchRefRaw(apiBaseUrl, vaultId, refFileId) {
    const path = refFileId.startsWith('bare/')
        ? refFileId
        : `bare/refs/${refFileId}`
    const url  = `${apiBaseUrl}/api/vault/read/${vaultId}/${encodeURIComponent(path)}`

    const response = await fetch(url)
    if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`Ref fetch failed: ${refFileId} → ${response.status}`)
    }
    return response.arrayBuffer()
}

/**
 * Fetch and decrypt a ref as JSON (always live).
 *
 * @param {string} apiBaseUrl - API base URL
 * @param {string} vaultId - The vault identifier
 * @param {string} refFileId - The ref file ID
 * @param {CryptoKey} readKey - AES-GCM decryption key
 * @returns {Promise<object|null>} Parsed ref JSON or null if 404
 */
export async function fetchRef(apiBaseUrl, vaultId, refFileId, readKey) {
    const raw = await fetchRefRaw(apiBaseUrl, vaultId, refFileId)
    if (!raw) return null
    const plain = await decrypt(readKey, raw)
    return JSON.parse(new TextDecoder().decode(plain))
}

/**
 * Pre-warm the cache for a list of object IDs.
 * Fetches all objects in parallel and stores them in the Cache API.
 * Skips objects that are already cached.
 *
 * @param {string} apiBaseUrl - API base URL
 * @param {string} vaultId - The vault identifier
 * @param {string[]} objectIds - Array of object IDs to pre-warm
 * @returns {Promise<{ hits: number, fetched: number, errors: number }>}
 */
export async function warmCache(apiBaseUrl, vaultId, objectIds) {
    const stats = { hits: 0, fetched: 0, errors: 0 }

    if (!cacheAvailable()) {
        return stats
    }

    const cache = await caches.open(CACHE_NAME)

    const work = objectIds
        .filter(id => isImmutable(id))
        .map(async (objectId) => {
            const key = cacheKey(vaultId, objectId)
            try {
                const existing = await cache.match(key)
                if (existing) {
                    stats.hits++
                    return
                }
                await cachedFetchRaw(apiBaseUrl, vaultId, objectId)
                stats.fetched++
            } catch {
                stats.errors++
            }
        })

    await Promise.all(work)
    return stats
}

/**
 * Clear all cached objects for a specific vault (or all vaults).
 *
 * @param {string} [vaultId] - If provided, only clear objects for this vault.
 *   If omitted, deletes the entire cache.
 * @returns {Promise<number>} Number of entries deleted
 */
export async function clearCache(vaultId) {
    if (!cacheAvailable()) return 0

    if (!vaultId) {
        const deleted = await caches.delete(CACHE_NAME)
        return deleted ? -1 : 0
    }

    const cache   = await caches.open(CACHE_NAME)
    const keys    = await cache.keys()
    const prefix  = `https://sgvault/${vaultId}/`
    let   deleted = 0

    for (const req of keys) {
        if (req.url.startsWith(prefix)) {
            await cache.delete(req)
            deleted++
        }
    }
    return deleted
}

/**
 * Get cache statistics for a vault.
 *
 * @param {string} vaultId - The vault identifier
 * @returns {Promise<{ entryCount: number, totalBytes: number }>}
 */
export async function getCacheStats(vaultId) {
    const stats = { entryCount: 0, totalBytes: 0 }
    if (!cacheAvailable()) return stats

    try {
        const cache  = await caches.open(CACHE_NAME)
        const keys   = await cache.keys()
        const prefix = `https://sgvault/${vaultId}/`

        for (const req of keys) {
            if (req.url.startsWith(prefix)) {
                stats.entryCount++
                try {
                    const resp = await cache.match(req)
                    if (resp) {
                        const buf = await resp.arrayBuffer()
                        stats.totalBytes += buf.byteLength
                    }
                } catch {
                    // Skip entries that can't be read
                }
            }
        }
    } catch {
        // Cache API error
    }

    return stats
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decrypt AES-256-GCM payload: [12-byte IV][ciphertext+tag].
 * @param {CryptoKey} key
 * @param {ArrayBuffer} encrypted
 * @returns {Promise<ArrayBuffer>}
 */
async function decrypt(key, encrypted) {
    const bytes = new Uint8Array(encrypted)
    const iv    = bytes.slice(0, IV_LENGTH)
    const ct    = bytes.slice(IV_LENGTH)
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
}
