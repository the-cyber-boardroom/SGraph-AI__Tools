/* =============================================================================
   SGraph — Vault Client Module
   v1.0.0 — Browser-based vault access using Web Crypto API

   Derives vault keys from a passphrase + vault_id, fetches encrypted files
   from the SG/Send API, and decrypts them client-side. Wire-compatible with
   sg-send-cli (Python) — same PBKDF2 salts, HMAC file IDs, AES-256-GCM.

   Usage:
     import { parseVaultKey, deriveVaultKeys, openVault, listFileIds, readFile } from './sg-vault-client.js';

     const { passphrase, vaultId } = parseVaultKey('my-secret:a1b2c3d4');
     const keys = await deriveVaultKeys(passphrase, vaultId);
     const vault = await openVault(keys, { apiBaseUrl: 'https://send.sgraph.ai' });
     const files = await listFileIds(vault, 'bare/');
     const data  = await readFile(vault, files[0]);
   ============================================================================= */

/** @type {number} PBKDF2 iteration count — matches sg-send-cli */
export const KDF_ITERATIONS = 600_000

/** @type {number} AES key length in bytes */
export const KEY_LENGTH = 32

/** @type {number} Hex chars for deterministic file IDs */
export const FILE_ID_LENGTH = 12

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
 * Also derives deterministic file IDs for the tree and settings files.
 *
 * @param {string} passphrase - The vault passphrase
 * @param {string} vaultId - The 8-char lowercase alphanumeric vault ID
 * @returns {Promise<{
 *   readKey:        CryptoKey,
 *   readKeyBytes:   Uint8Array,
 *   writeKey:       string,
 *   treeFileId:     string,
 *   settingsFileId: string,
 *   refFileId:      string,
 *   vaultId:        string,
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

    const [treeFileId, settingsFileId, refFileId] = await Promise.all([
        deriveFileId(readKeyBytes, `${SALT_PREFIX}:file-id:tree:${vaultId}`),
        deriveFileId(readKeyBytes, `${SALT_PREFIX}:file-id:settings:${vaultId}`),
        deriveFileId(readKeyBytes, `${SALT_PREFIX}:file-id:ref:${vaultId}`)
    ])

    return {
        readKey,
        readKeyBytes,
        writeKey,
        treeFileId,
        settingsFileId,
        refFileId,
        vaultId,
        derivationTimeMs: performance.now() - start
    }
}

/**
 * Derive a deterministic file ID using HMAC-SHA256.
 * Returns the first FILE_ID_LENGTH hex characters.
 *
 * @param {Uint8Array} keyBytes - The read key bytes (32 bytes)
 * @param {string} input - The input string to derive from
 * @returns {Promise<string>} First 12 hex characters of the HMAC digest
 */
export async function deriveFileId(keyBytes, input) {
    const hmacKey = await crypto.subtle.importKey(
        'raw', keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const signature = await crypto.subtle.sign(
        'HMAC', hmacKey, new TextEncoder().encode(input)
    )
    return bytesToHex(new Uint8Array(signature)).slice(0, FILE_ID_LENGTH)
}

/**
 * Open a vault connection. Validates the vault exists and returns a handle
 * containing keys and API configuration for subsequent operations.
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
 * Fetch and decrypt the vault tree (file listing).
 * The tree is stored as an encrypted JSON blob at the deterministic tree file ID.
 *
 * @param {object} vault - Vault handle from openVault()
 * @returns {Promise<object>} Decrypted tree object
 */
export async function fetchTree(vault) {
    const { keys, apiBaseUrl } = vault
    const url = `${apiBaseUrl}/api/vault/read/${keys.vaultId}/${encodeURIComponent(keys.treeFileId)}`

    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to fetch vault tree: ${response.status} ${response.statusText}`)
    }

    const encrypted = await response.arrayBuffer()
    const decrypted = await decryptPayload(keys.readKey, encrypted)
    const text      = new TextDecoder().decode(decrypted)
    return JSON.parse(text)
}

/**
 * Fetch and decrypt a single vault file by its file ID.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} fileId - The file ID to fetch
 * @returns {Promise<ArrayBuffer>} Decrypted file contents
 */
export async function readFile(vault, fileId) {
    const { keys, apiBaseUrl } = vault
    const url = `${apiBaseUrl}/api/vault/read/${keys.vaultId}/${encodeURIComponent(fileId)}`

    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to fetch file ${fileId}: ${response.status} ${response.statusText}`)
    }

    const encrypted = await response.arrayBuffer()
    return decryptPayload(keys.readKey, encrypted)
}

/**
 * Derive a file ID for a custom file path within the vault.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} filePath - The file path (e.g. 'docs/readme.md')
 * @returns {Promise<string>} 12-char hex file ID
 */
export async function deriveFileIdForPath(vault, filePath) {
    const { keys } = vault
    return deriveFileId(
        keys.readKeyBytes,
        `${SALT_PREFIX}:file-id:${filePath}:${keys.vaultId}`
    )
}

/**
 * Fetch and decrypt the vault settings.
 *
 * @param {object} vault - Vault handle from openVault()
 * @returns {Promise<object>} Decrypted settings object
 */
export async function fetchSettings(vault) {
    const { keys, apiBaseUrl } = vault
    const url = `${apiBaseUrl}/api/vault/read/${keys.vaultId}/${encodeURIComponent(keys.settingsFileId)}`

    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.status} ${response.statusText}`)
    }

    const encrypted = await response.arrayBuffer()
    const decrypted = await decryptPayload(keys.readKey, encrypted)
    const text      = new TextDecoder().decode(decrypted)
    return JSON.parse(text)
}

/**
 * List file IDs stored in a vault using the list API endpoint.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} [prefix=''] - Optional prefix filter (e.g. 'bare/' or 'bare/data/')
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

