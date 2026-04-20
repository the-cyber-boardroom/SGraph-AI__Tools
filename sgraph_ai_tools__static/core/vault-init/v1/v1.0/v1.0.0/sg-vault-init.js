/* =============================================================================
   SGraph — Vault Init Module
   v1.0.0 — Bootstrap a brand-new vault from scratch

   Creates the three foundational objects on the server for an empty vault:
     1. Empty tree object (tree_v1, no entries)
     2. Initial commit object (commit_v2, empty parents, points to empty tree)
     3. Named HEAD ref pointing to the initial commit

   After init, a fresh VaultSession can open the vault and start committing.

   Usage:
     import { createVault, generateVaultId, generateMemorablePassphrase }
       from '/core/vault-init/v1/v1.0/v1.0.0/sg-vault-init.js'

     const result = await createVault({
       apiBaseUrl: 'https://send.sgraph.ai',
       passphrase: 'my secret phrase',  // optional, generated if missing
       vaultId:    'abc123def456',      // optional, generated if missing
     })
     // result = { vaultId, vaultKey, keys, commitId, treeId }
     // vaultKey is "passphrase:vaultId" — the user must save this

   ============================================================================= */

import { deriveWriteKeys } from '/core/vault-write/v1/v1.1/v1.1.1/sg-vault-write.js'
import { encryptMetadata, computeObjectId }
    from '/core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js'

const IV_LENGTH = 12
const DEFAULT_VAULT_ID_LENGTH = 12

const PASSPHRASE_WORDS = [
    'amber', 'beach', 'cloud', 'delta', 'ember', 'forge', 'glass', 'haven',
    'ivory', 'jolly', 'koala', 'lemon', 'magic', 'noble', 'ocean', 'piano',
    'quill', 'raven', 'storm', 'tiger', 'umbra', 'vivid', 'wheat', 'xenon',
    'yacht', 'zebra', 'agile', 'brave', 'crisp', 'dusty', 'eager', 'fancy',
]

/**
 * Generate a random vault ID (lowercase hex).
 *
 * @param {number} [length=12] - Length in hex characters (4-24)
 * @returns {string}
 */
export function generateVaultId(length = DEFAULT_VAULT_ID_LENGTH) {
    if (length < 4 || length > 24) {
        throw new Error('vaultId length must be 4-24')
    }
    const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)))
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, length)
}

/**
 * Generate a memorable passphrase: word-word-word-word-word-word
 *
 * Uses 6 words from a 32-word list (~30 bits entropy) combined with a
 * separate vaultId for key derivation salt. No number suffix — the
 * vaultId provides uniqueness; the passphrase provides memorability.
 *
 * @param {number} [wordCount=6] - Number of words
 * @returns {string}
 */
export function generateMemorablePassphrase(wordCount = 6) {
    const words = []
    const buf = crypto.getRandomValues(new Uint32Array(wordCount))
    for (let i = 0; i < wordCount; i++) {
        words.push(PASSPHRASE_WORDS[buf[i] % PASSPHRASE_WORDS.length])
    }
    return words.join('-')
}

/**
 * Create a new empty vault on the server.
 * Writes empty tree + initial commit + named HEAD ref.
 *
 * @param {object} config
 * @param {string} config.apiBaseUrl - API base URL (e.g. https://send.sgraph.ai)
 * @param {string} [config.passphrase] - Vault passphrase (generated if missing)
 * @param {string} [config.vaultId]   - Vault ID hex (generated if missing)
 * @param {string} [config.accessToken] - Optional server access token
 * @param {string} [config.message='Initial commit'] - Initial commit message
 * @returns {Promise<{
 *   vaultId: string,
 *   vaultKey: string,
 *   keys: object,
 *   commitId: string,
 *   treeId: string,
 *   passphrase: string
 * }>}
 */
export async function createVault(config) {
    const apiBaseUrl = config.apiBaseUrl.replace(/\/$/, '')
    const passphrase = config.passphrase || generateMemorablePassphrase()
    const vaultId    = config.vaultId    || generateVaultId()
    const message    = config.message    || 'Initial commit'
    const accessToken = config.accessToken || null

    if (!/^[0-9a-z]{4,24}$/.test(vaultId)) {
        throw new Error('vaultId must be 4-24 lowercase hex characters')
    }

    // 1. Derive keys
    const keys = await deriveWriteKeys(passphrase, vaultId)
    if (!keys.writeKey) {
        throw new Error('Failed to derive write key')
    }

    // 2. Build encryption key once
    const encKey = await crypto.subtle.importKey(
        'raw', keys.readKeyBytes,
        { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    )

    // 3. Create empty tree object
    const treeJson   = JSON.stringify({ schema: 'tree_v1', entries: [] })
    const treeCipher = await _encrypt(encKey, new TextEncoder().encode(treeJson))
    const treeId     = await computeObjectId(treeCipher)
    await _putObject(apiBaseUrl, vaultId, treeId, treeCipher, keys.writeKey, accessToken)

    // 4. Create initial commit object
    const msgCipher = await encryptMetadata(keys.readKeyBytes, message)
    const commitData = {
        schema:       'commit_v2',
        parents:      [],
        tree_id:      treeId,
        timestamp_ms: Date.now(),
        message_enc:  msgCipher,
        branch_id:    null,
        signature:    null,
    }
    const commitCipher = await _encrypt(
        encKey, new TextEncoder().encode(JSON.stringify(commitData))
    )
    const commitId = await computeObjectId(commitCipher)
    await _putObject(apiBaseUrl, vaultId, commitId, commitCipher, keys.writeKey, accessToken)

    // 5. Write named HEAD ref pointing to the initial commit
    const refCipher = await _encrypt(
        encKey, new TextEncoder().encode(JSON.stringify({ commit_id: commitId }))
    )
    await _putRef(apiBaseUrl, vaultId, keys.refFileId, refCipher, keys.writeKey, accessToken)

    return {
        vaultId,
        passphrase,
        vaultKey: `${passphrase}:${vaultId}`,
        keys,
        commitId,
        treeId,
    }
}

/**
 * Check whether a vault already exists at the given ID.
 *
 * @param {string} apiBaseUrl
 * @param {string} vaultId
 * @param {string} refFileId - The HMAC-derived named HEAD ref file ID
 * @returns {Promise<boolean>}
 */
export async function vaultExists(apiBaseUrl, vaultId, refFileId) {
    const barePath = refFileId.startsWith('bare/') ? refFileId : `bare/refs/${refFileId}`
    const url = `${apiBaseUrl.replace(/\/$/, '')}/api/vault/read/${vaultId}/${barePath}`
    try {
        const resp = await fetch(url)
        return resp.ok
    } catch {
        return false
    }
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function _encrypt(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
    const result = new Uint8Array(IV_LENGTH + ct.byteLength)
    result.set(iv)
    result.set(new Uint8Array(ct), IV_LENGTH)
    return result
}

async function _putObject(apiBaseUrl, vaultId, objectId, cipher, writeKey, accessToken) {
    const url = `${apiBaseUrl}/api/vault/write/${vaultId}/bare/data/${objectId}`
    const headers = { 'x-sgraph-vault-write-key': writeKey }
    if (accessToken) headers['x-sgraph-access-token'] = accessToken

    const resp = await fetch(url, { method: 'PUT', headers, body: cipher })
    if (!resp.ok) {
        throw new Error(`Write object ${objectId}: HTTP ${resp.status}`)
    }
}

async function _putRef(apiBaseUrl, vaultId, refFileId, cipher, writeKey, accessToken) {
    const barePath = refFileId.startsWith('bare/') ? refFileId : `bare/refs/${refFileId}`
    const url = `${apiBaseUrl}/api/vault/write/${vaultId}/${barePath}`
    const headers = { 'x-sgraph-vault-write-key': writeKey }
    if (accessToken) headers['x-sgraph-access-token'] = accessToken

    const resp = await fetch(url, { method: 'PUT', headers, body: cipher })
    if (!resp.ok) {
        throw new Error(`Write ref ${refFileId}: HTTP ${resp.status}`)
    }
}
