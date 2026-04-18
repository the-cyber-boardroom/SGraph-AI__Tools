/* =============================================================================
   SGraph — Vault Client Module
   v1.2.1 — Browser-based vault access using Web Crypto API

   Changes from v1.2.0:
     - parseVaultKey() now accepts vault IDs of 4–24 chars (was exactly 8)
     - vault-id-utils.js: added 'snw' (single-writer) to VALID_MUTABILITIES
     - vault-id-utils.js: fixed idx path mapping from bare/indexes to bare/idx

   Changes from v1.1.0 (in v1.2.0):
     - encryptMetadata() for encrypting tree entry fields (name_enc, size_enc)
     - decryptMetadata() for decrypting base64-encoded metadata fields
     - computeObjectId() for content-addressed object IDs from ciphertext
     - deriveVaultKeys() now returns branchIndexFileId
     - deriveBranchRefFileId() for branch-specific reference file IDs
     - readKey imported with ['encrypt', 'decrypt'] (was decrypt-only)
     - walkTree() fetches and decrypts a tree object with name decryption
     - openVaultTree() full traversal from ref -> commit -> root tree

   Retained from v1.1.0:
     - Self-describing file IDs: ref-pid-muw-{hex}, idx-pid-muw-{hex}, etc.
     - deriveVaultKeys() returns refFileId, indexFileId, settingsFileId
     - fetchSubTree(), batchRead(), fetchSettings(), listFileIds()
     - Deterministic entry points: no directory listing needed for initial access

   Usage:
     import { parseVaultKey, deriveVaultKeys, openVault, readFile } from './sg-vault-client.js';

     const { passphrase, vaultId } = parseVaultKey('my-secret:a1b2c3d4');
     const keys = await deriveVaultKeys(passphrase, vaultId);
     const vault = await openVault(keys, { apiBaseUrl: 'https://send.sgraph.ai' });
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
 * Format: "{passphrase}:{vault_id}" where vault_id is 4–24 lowercase
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

    if (!/^[0-9a-z]{4,24}$/.test(vaultId)) {
        throw new Error(`Invalid vault_id "${vaultId}". Must be 4–24 lowercase alphanumeric characters.`)
    }
    if (!passphrase) {
        throw new Error('Passphrase cannot be empty')
    }
    return { passphrase, vaultId }
}

/**
 * Derive all vault keys from a passphrase and vault_id.
 * Produces read_key (for encryption/decryption + file ID derivation) and write_key (for auth).
 * Also derives deterministic file IDs in self-describing format.
 *
 * @param {string} passphrase - The vault passphrase
 * @param {string} vaultId - The 4–24 char lowercase alphanumeric vault ID
 * @returns {Promise<{
 *   readKey:              CryptoKey,
 *   readKeyBytes:         Uint8Array,
 *   writeKey:             string,
 *   refFileId:            string,
 *   indexFileId:          string,
 *   branchIndexFileId:    string,
 *   settingsFileId:       string,
 *   vaultId:              string,
 *   derivationTimeMs:     number
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
        ['encrypt', 'decrypt']
    )

    // Derive deterministic file IDs with self-describing prefixes
    const [refHex, indexHex, branchIndexHex, settingsHex] = await Promise.all([
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:ref:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:index:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:branch-index:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:settings:${vaultId}`)
    ])

    return {
        readKey,
        readKeyBytes,
        writeKey,
        refFileId:           formatFileId('ref', 'pid', 'muw', refHex),
        indexFileId:          formatFileId('idx', 'pid', 'muw', indexHex),
        branchIndexFileId:   formatFileId('idx', 'pid', 'muw', branchIndexHex),
        settingsFileId:      formatFileId('idx', 'pid', 'muw', settingsHex),
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
 * Derive a branch-specific reference file ID.
 * Uses domain "sg-vault-v1:file-id:branch-ref:{vaultId}:{branchName}".
 *
 * @param {Uint8Array} readKeyBytes - The read key bytes (32 bytes)
 * @param {string} vaultId - The vault ID (4–24 chars)
 * @param {string} branchName - The branch name (e.g. "main", "feature-x")
 * @returns {Promise<string>} Self-describing file ID for this branch ref
 */
export async function deriveBranchRefFileId(readKeyBytes, vaultId, branchName) {
    const hex = await deriveFileIdHex(
        readKeyBytes,
        `${SALT_PREFIX}:file-id:branch-ref:${vaultId}:${branchName}`
    )
    return formatFileId('ref', 'pid', 'muw', hex)
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
// v1.2.0 — Metadata encryption / decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a string value for use in tree entries (name_enc, size_enc, etc).
 * Encodes to UTF-8, generates a random 12-byte IV, encrypts with AES-256-GCM,
 * and returns base64(iv + ciphertext).
 *
 * @param {Uint8Array} readKeyBytes - The raw read key bytes (32 bytes)
 * @param {string} plaintext - The string to encrypt
 * @returns {Promise<string>} Base64-encoded IV + ciphertext
 */
export async function encryptMetadata(readKeyBytes, plaintext) {
    const data = new TextEncoder().encode(plaintext)
    const iv   = crypto.getRandomValues(new Uint8Array(12))
    const key  = await crypto.subtle.importKey(
        'raw', readKeyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    )
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
    const combined   = new Uint8Array(iv.byteLength + ciphertext.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(ciphertext), iv.byteLength)
    return btoa(String.fromCharCode(...combined))
}

/**
 * Decrypt a base64-encoded encrypted metadata field.
 * Accepts either a CryptoKey or a raw Uint8Array for the key.
 * Decodes base64 to bytes, splits into IV (first 12 bytes) and ciphertext,
 * AES-256-GCM decrypts, and returns the UTF-8 decoded string.
 *
 * @param {CryptoKey|Uint8Array} readKeyOrBytes - AES-GCM key or raw key bytes
 * @param {string} b64Ciphertext - Base64-encoded IV + ciphertext
 * @returns {Promise<string>} Decrypted UTF-8 string
 */
export async function decryptMetadata(readKeyOrBytes, b64Ciphertext) {
    const raw = base64ToBytes(b64Ciphertext)
    const iv  = raw.slice(0, IV_LENGTH)
    const ct  = raw.slice(IV_LENGTH)

    let key = readKeyOrBytes
    if (readKeyOrBytes instanceof Uint8Array) {
        key = await crypto.subtle.importKey(
            'raw', readKeyOrBytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        )
    }

    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(plainBuffer)
}

// ---------------------------------------------------------------------------
// v1.2.0 — Content-addressed object IDs
// ---------------------------------------------------------------------------

/**
 * Compute a content-addressed object ID from encrypted bytes.
 * SHA-256 hashes the ciphertext (NOT plaintext), takes the first 12 hex chars,
 * and returns "obj-cas-imm-{hex12}".
 *
 * @param {Uint8Array|ArrayBuffer} ciphertext - The encrypted bytes to hash
 * @returns {Promise<string>} Content-addressed object ID (e.g. "obj-cas-imm-a1b2c3d4e5f6")
 */
export async function computeObjectId(ciphertext) {
    const data   = ciphertext instanceof ArrayBuffer ? ciphertext : ciphertext.buffer
    const hash   = await crypto.subtle.digest('SHA-256', data)
    const hex12  = bytesToHex(new Uint8Array(hash)).slice(0, FILE_ID_HEX_LENGTH)
    return formatFileId('obj', 'cas', 'imm', hex12)
}

// ---------------------------------------------------------------------------
// v1.2.0 — Tree traversal
// ---------------------------------------------------------------------------

/**
 * Fetch a tree object, decrypt it, then decrypt all name_enc fields in entries.
 * Returns the parsed tree with a decrypted `name` field on each entry.
 *
 * @param {object} vault - Vault handle from openVault()
 * @param {string} treeObjectId - The tree object ID (e.g. "obj-cas-imm-abc123")
 * @returns {Promise<{ schema: string, entries: Array<{ name: string, blob_id?: string, tree_id?: string, name_enc: string }> }>}
 */
export async function walkTree(vault, treeObjectId) {
    const tree = await readFileAsJson(vault, treeObjectId)
    const { keys } = vault

    if (tree.entries && Array.isArray(tree.entries)) {
        const decryptPromises = tree.entries.map(async (entry) => {
            if (entry.name_enc && typeof entry.name_enc === 'string') {
                try {
                    entry.name = await decryptMetadata(keys.readKey, entry.name_enc)
                } catch (err) {
                    console.warn(`walkTree: failed to decrypt name_enc for entry:`, err)
                    entry.name = '[decrypt failed]'
                }
            }
        })
        await Promise.all(decryptPromises)
    }

    return tree
}

/**
 * Full traversal from ref to root tree.
 * Fetches ref -> commit -> root tree, decrypting names along the way.
 * Returns the commit object, the root tree with decrypted names, and the
 * flat entries array for convenience.
 *
 * @param {object} vault - Vault handle from openVault()
 * @returns {Promise<{
 *   commit:   object,
 *   rootTree: { schema: string, entries: Array },
 *   entries:  Array<{ name: string, blob_id?: string, tree_id?: string, name_enc: string }>
 * }>}
 */
export async function openVaultTree(vault) {
    const { keys } = vault

    // Step 1: Fetch the ref to get the commit object ID
    const ref = await readFileAsJson(vault, keys.refFileId)
    const commitId = ref.commit_id || ref.commitId || ref.target

    if (!commitId) {
        throw new Error('Ref does not contain a commit ID (checked commit_id, commitId, target)')
    }

    // Step 2: Fetch the commit to get the root tree ID
    const commit = await readFileAsJson(vault, commitId)
    const treeId = commit.tree_id || commit.treeId || commit.tree

    if (!treeId) {
        throw new Error('Commit does not contain a tree ID (checked tree_id, treeId, tree)')
    }

    // Step 3: Fetch and decrypt the root tree
    const rootTree = await walkTree(vault, treeId)

    return {
        commit,
        rootTree,
        entries: rootTree.entries || []
    }
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
 * Decode a base64 string to Uint8Array.
 *
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
    const binary = atob(b64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

/**
 * Convert a base64 string to an ArrayBuffer.
 *
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(b64) {
    return base64ToBytes(b64).buffer
}
