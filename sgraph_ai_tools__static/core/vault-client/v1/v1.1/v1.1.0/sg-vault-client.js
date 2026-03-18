/* =============================================================================
   SGraph — Vault Client Module
   v1.1.0 — Browser-based vault access using Web Crypto API

   Changes from v1.0.0:
     - Self-describing file IDs: ref-pid-muw-{hex}, idx-pid-muw-{hex}, etc.
     - deriveVaultKeys() now returns refFileId and indexFileId in self-describing format
     - New: fetchSubTree() for on-demand sub-tree loading
     - New: batchRead() for fetching multiple files in one request
     - New: decryptField() re-exported from vault-id-utils
     - Deterministic entry points: no directory listing needed for initial access

   Usage:
     import { parseVaultKey, deriveVaultKeys, openVault, readFile } from './sg-vault-client.js';

     const { passphrase, vaultId } = parseVaultKey('my-secret:a1b2c3d4');
     const keys = await deriveVaultKeys(passphrase, vaultId);
     const vault = await openVault(keys, { apiBaseUrl: 'https://send.sgraph.ai' });
     // Deterministic entry: fetch ref directly, no listing needed
     const ref = await readFileAsJson(vault, keys.refFileId);
   ============================================================================= */

import { formatFileId, fileIdToPath } from './vault-id-utils.js'

// Re-export utilities for consumers
export { parseFileId, formatFileId, fileIdToPath, shortId, looksLikeRef, decryptField, decryptEncFields } from './vault-id-utils.js'

/** @type {number} PBKDF2 iteration count — matches sg-send-cli */
export const KDF_ITERATIONS = 600_000

/** @type {number} AES key length in bytes */
export const KEY_LENGTH = 32

/** @type {number} Hex chars for the HMAC portion of deterministic file IDs */
export const FILE_ID_HEX_LENGTH = 12

/** @type {number} AES-GCM initialisation vector length in bytes */
export const IV_LENGTH = 12

/** @type {string} Salt prefix for vault key derivation */
export const SALT_PREFIX = 'sg-vault-v1'

/**
 * Parse a full vault key into passphrase and vault_id.
 * Format: "{passphrase}:{vault_id}" where vault_id is exactly 8 lowercase
 * alphanumeric characters. The passphrase itself may contain colons.
 *
 * @param {string} fullVaultKey - The complete vault key string
 * @returns {{ passphrase: string, vaultId: string }}
 * @throws {Error} If the key format is invalid
 */
export function parseVaultKey(fullVaultKey) {
    if (!fullVaultKey || typeof fullVaultKey !== 'string') {
        throw new Error('Vault key must be a non-empty string')
    }
    const lastColon = fullVaultKey.lastIndexOf(':')
    if (lastColon === -1 || lastColon === 0) {
        throw new Error('Invalid vault key format. Expected "{passphrase}:{vault_id}"')
    }
    const vaultId    = fullVaultKey.slice(lastColon + 1)
    const passphrase = fullVaultKey.slice(0, lastColon)

    if (!/^[0-9a-z]{8}$/.test(vaultId)) {
        throw new Error(`Invalid vault_id "${vaultId}". Must be exactly 8 lowercase alphanumeric characters.`)
    }
    if (!passphrase) {
        throw new Error('Passphrase cannot be empty')
    }
    return { passphrase, vaultId }
}

/**
 * Derive all vault keys from a passphrase and vault_id.
 * Produces read_key (for decryption + file ID derivation) and write_key (for auth).
 * Also derives deterministic file IDs in self-describing format.
 *
 * @param {string} passphrase - The vault passphrase
 * @param {string} vaultId - The 8-char lowercase alphanumeric vault ID
 * @returns {Promise<{
 *   readKey:          CryptoKey,
 *   readKeyBytes:     Uint8Array,
 *   writeKey:         string,
 *   refFileId:        string,
 *   indexFileId:      string,
 *   settingsFileId:   string,
 *   vaultId:          string,
 *   derivationTimeMs: number
 * }>}
 */
export async function deriveVaultKeys(passphrase, vaultId) {
    const start   = performance.now()
    const encoder = new TextEncoder()

    const readSalt  = encoder.encode(`${SALT_PREFIX}:${vaultId}`)
    const writeSalt = encoder.encode(`${SALT_PREFIX}:write:${vaultId}`)

    const passBytes = encoder.encode(passphrase)

    const keyMaterial = await crypto.subtle.importKey(
        'raw', passBytes, 'PBKDF2', false, ['deriveBits']
    )

    const [readBits, writeBits] = await Promise.all([
        crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: readSalt,  iterations: KDF_ITERATIONS, hash: 'SHA-256' },
            keyMaterial, KEY_LENGTH * 8
        ),
        crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: writeSalt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
            keyMaterial, KEY_LENGTH * 8
        )
    ])

    const readKeyBytes  = new Uint8Array(readBits)
    const writeKeyBytes = new Uint8Array(writeBits)
    const writeKey      = bytesToHex(writeKeyBytes)

    const readKey = await crypto.subtle.importKey(
        'raw', readKeyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    )

    // Derive deterministic file IDs with self-describing prefixes
    const [refHex, indexHex, settingsHex] = await Promise.all([
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:ref:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:index:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:settings:${vaultId}`)
    ])

    return {
        readKey,
        readKeyBytes,
        writeKey,
        refFileId:      formatFileId('ref', 'pid', 'muw', refHex),
        indexFileId:     formatFileId('idx', 'pid', 'muw', indexHex),
        settingsFileId:  formatFileId('idx', 'pid', 'muw', settingsHex),
        vaultId,
        derivationTimeMs: performance.now() - start
    }
}

/**
 * Derive the hex portion of a deterministic file ID using HMAC-SHA256.
 * Returns the first FILE_ID_HEX_LENGTH hex characters.
 *
 * @param {Uint8Array} keyBytes - The read key bytes (32 bytes)
 * @param {string} input - The input string to derive from
 * @returns {Promise<string>} Hex characters of the HMAC digest
 */
export async function deriveFileIdHex(keyBytes, input) {
    const hmacKey = await crypto.subtle.importKey(
        'raw', keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const signature = await crypto.subtle.sign(
        'HMAC', hmacKey, new TextEncoder().encode(input)
    )
    return bytesToHex(new Uint8Array(signature)).slice(0, FILE_ID_HEX_LENGTH)
}

/**
 * Open a vault connection. Returns a handle containing keys and API
 * configuration for subsequent operations.
 *
 * @param {object} keys - Output from deriveVaultKeys()
 * @param {object} options
 * @param {string} options.apiBaseUrl - API base URL (e.g. 'https://send.sgraph.ai')
 * @returns {Promise<{
 *   keys:       object,
 *   apiBaseUrl: string,
 *   vaultId:    string
 * }>}
 */
export async function openVault(keys, options = {}) {
    const apiBaseUrl = (options.apiBaseUrl || 'https://send.sgraph.ai').replace(/\/$/, '')
    return {
        keys,
        apiBaseUrl,
        vaultId: keys.vaultId
    }
}

/**
 * Fetch and decrypt a single vault file by its file ID.
 * Accepts both self-describing IDs and legacy bare/ paths.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} fileId - The file ID (self-describing or legacy path)
 * @returns {Promise<ArrayBuffer>} Decrypted file contents
 */
export async function readFile(vault, fileId) {
    const { keys, apiBaseUrl } = vault
    const path = fileIdToPath(fileId)
    const url  = `${apiBaseUrl}/api/vault/read/${keys.vaultId}/${encodeURIComponent(path)}`

    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to fetch file ${fileId}: ${response.status} ${response.statusText}`)
    }

    const encrypted = await response.arrayBuffer()
    return decryptPayload(keys.readKey, encrypted)
}

/**
 * Fetch, decrypt, and parse a vault file as JSON.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} fileId - The file ID
 * @returns {Promise<object>} Parsed JSON
 */
export async function readFileAsJson(vault, fileId) {
    const data = await readFile(vault, fileId)
    const text = new TextDecoder().decode(data)
    return JSON.parse(text)
}

/**
 * Fetch multiple files in a single batch request.
 * Falls back to parallel individual reads if the batch endpoint is not available.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string[]} fileIds - Array of file IDs to fetch
 * @returns {Promise<Map<string, ArrayBuffer>>} Map of fileId -> decrypted content
 */
export async function batchRead(vault, fileIds) {
    const { keys, apiBaseUrl } = vault
    const results = new Map()

    // Try batch endpoint first
    try {
        const paths = fileIds.map(id => fileIdToPath(id))
        const url   = `${apiBaseUrl}/api/vault/batch-read/${keys.vaultId}`
        const resp  = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: paths })
        })

        if (resp.ok) {
            const batchData = await resp.json()
            const decryptPromises = fileIds.map(async (id, i) => {
                const path = paths[i]
                if (batchData[path]) {
                    const raw = base64ToArrayBuffer(batchData[path])
                    const decrypted = await decryptPayload(keys.readKey, raw)
                    results.set(id, decrypted)
                }
            })
            await Promise.all(decryptPromises)
            return results
        }
    } catch {
        // Batch endpoint not available — fall back to individual reads
    }

    // Fallback: parallel individual reads
    const promises = fileIds.map(async (id) => {
        try {
            const data = await readFile(vault, id)
            results.set(id, data)
        } catch {
            // Skip failed reads
        }
    })
    await Promise.all(promises)
    return results
}

/**
 * Fetch and decrypt a sub-tree object by its object ID.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} treeObjectId - The tree object ID (e.g. "obj-cas-imm-abc123")
 * @returns {Promise<object>} Parsed tree JSON with entries
 */
export async function fetchSubTree(vault, treeObjectId) {
    return readFileAsJson(vault, treeObjectId)
}

/**
 * Fetch and decrypt the vault settings.
 *
 * @param {object} vault - Vault handle from openVault()
 * @returns {Promise<object>} Decrypted settings object
 */
export async function fetchSettings(vault) {
    return readFileAsJson(vault, vault.keys.settingsFileId)
}

/**
 * List file IDs stored in a vault using the list API endpoint.
 * NOTE: With v1.1.0 self-describing IDs, this is no longer needed for initial
 * access. Use deterministic entry points (refFileId, indexFileId) instead.
 * Retained for debugging and browsing.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} [prefix=''] - Optional prefix filter
 * @returns {Promise<string[]>} Array of file ID strings
 */
export async function listFileIds(vault, prefix = '') {
    const { keys, apiBaseUrl } = vault
    let url = `${apiBaseUrl}/api/vault/list/${keys.vaultId}`
    if (prefix) {
        url += `?prefix=${encodeURIComponent(prefix)}`
    }

    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to list files: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    if (Array.isArray(result)) {
        return result
    }
    return result.files || []
}

/**
 * Derive a file ID for a custom file path within the vault.
 * Returns a self-describing ID with obj-pid-muw prefix.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} filePath - The file path (e.g. 'docs/readme.md')
 * @returns {Promise<string>} Self-describing file ID
 */
export async function deriveFileIdForPath(vault, filePath) {
    const { keys } = vault
    const hex = await deriveFileIdHex(
        keys.readKeyBytes,
        `${SALT_PREFIX}:file-id:${filePath}:${keys.vaultId}`
    )
    return formatFileId('obj', 'pid', 'muw', hex)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decrypt an AES-256-GCM payload (IV prepended to ciphertext).
 *
 * @param {CryptoKey} key - AES-GCM decryption key
 * @param {ArrayBuffer} encrypted - IV (12 bytes) + ciphertext
 * @returns {Promise<ArrayBuffer>} Decrypted data
 */
async function decryptPayload(key, encrypted) {
    const data       = new Uint8Array(encrypted)
    const iv         = data.slice(0, IV_LENGTH)
    const ciphertext = data.slice(IV_LENGTH)
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    )
}

/**
 * Convert a byte array to a lowercase hex string.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convert a base64 string to an ArrayBuffer.
 *
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(b64) {
    const binary = atob(b64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
}
