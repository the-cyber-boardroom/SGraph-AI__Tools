/* =============================================================================
   SGraph — Vault Init Module
   v1.0.0 — Bootstrap a brand-new vault from scratch

   Creates the foundational objects on the server for an empty vault using a
   simple token (word-word-NNNN format) which derives both the encryption key
   and vault ID.

   Protocol (5 PUTs):
     1. Encrypted settings blob (.vault-settings)
     2. Root tree object (tree_v1, contains settings entry)
     3. Initial commit object (commit_v2, empty parents, points to root tree)
     4. Clone ref (ref-pid-muw-* for branch 'web-ui') → commit
     5. Named HEAD ref (ref-pid-muw-*) → commit

   After init, a fresh VaultSession can open the vault and start committing.

   Usage:
     import { createVault } from '/core/vault-init/v1/v1.0/v1.0.0/sg-vault-init.js'
     import { generateToken } from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js'

     const token = generateToken()   // e.g. 'storm-crisp-0285'
     const result = await createVault({
       apiBaseUrl:  'https://send.sgraph.ai',
       token,
       accessToken: 'server-access-token',
     })
     // result = { token, vaultId, keys, commitId, treeId }

   ============================================================================= */

import { deriveWriteKeysFromSimpleToken }
    from '/core/vault-write/v1/v1.1/v1.1.1/sg-vault-write.js'

import { encryptMetadata, computeObjectId, deriveBranchRefFileId }
    from '/core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js'

import { generateToken, isFriendlyToken }
    from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js'

export { generateToken, isFriendlyToken }

const IV_LENGTH = 12

/**
 * Create a new empty vault on the server using a simple token.
 *
 * The token (word-word-NNNN) is the single secret. From it we derive:
 *   - read_key + write_key (via PBKDF2 + HKDF)
 *   - vault_id (SHA-256(token)[:12])
 *   - ref file IDs (HMAC-based)
 *
 * Follows the vault protocol: writes settings blob, root tree, commit,
 * clone ref, and named HEAD ref (5 PUTs total).
 *
 * @param {object} config
 * @param {string} config.apiBaseUrl - API base URL (e.g. https://send.sgraph.ai)
 * @param {string} [config.token] - Simple token word-word-NNNN (generated if missing)
 * @param {string} [config.accessToken] - Server access token (required for write)
 * @param {string} [config.message='Initial vault creation'] - Initial commit message
 * @param {string} [config.vaultName='Untitled Vault'] - Vault display name
 * @param {string} [config.branchName='web-ui'] - Clone branch name
 * @returns {Promise<{
 *   token: string,
 *   vaultId: string,
 *   keys: object,
 *   commitId: string,
 *   treeId: string,
 * }>}
 */
export async function createVault(config) {
    const apiBaseUrl  = config.apiBaseUrl.replace(/\/$/, '')
    const token       = config.token || generateToken()
    const accessToken = config.accessToken || null
    const message     = config.message    || 'Initial vault creation'
    const vaultName   = config.vaultName  || 'Untitled Vault'
    const branchName  = config.branchName || 'web-ui'

    if (!isFriendlyToken(token)) {
        throw new Error(`Invalid token format: "${token}". Expected word-word-NNNN.`)
    }

    // 1. Derive all keys from the simple token
    const keys = await deriveWriteKeysFromSimpleToken(token)
    if (!keys.writeKey) {
        throw new Error('Failed to derive write key')
    }
    const { vaultId } = keys

    // 2. Build encryption key
    const encKey = await crypto.subtle.importKey(
        'raw', keys.readKeyBytes,
        { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    )

    // 3. Create settings blob
    const settings = {
        vault_name:  vaultName,
        vault_id:    vaultId,
        created:     new Date().toISOString(),
        version:     3,
        description: '',
    }
    const settingsCipher = await _encrypt(encKey, new TextEncoder().encode(JSON.stringify(settings)))
    const settingsBlobId = await computeObjectId(settingsCipher)
    await _putObject(apiBaseUrl, vaultId, settingsBlobId, settingsCipher, keys.writeKey, accessToken)

    // 4. Create root tree with .vault-settings entry
    const settingsEntry = {
        blob_id:          settingsBlobId,
        name_enc:         await encryptMetadata(keys.readKeyBytes, '.vault-settings'),
        size_enc:         await encryptMetadata(keys.readKeyBytes, String(JSON.stringify(settings).length)),
        content_hash_enc: await encryptMetadata(keys.readKeyBytes, settingsBlobId.slice(-12)),
        content_type_enc: await encryptMetadata(keys.readKeyBytes, 'application/json'),
        large:            false,
    }
    const treeJson   = JSON.stringify({ schema: 'tree_v1', entries: [settingsEntry] })
    const treeCipher = await _encrypt(encKey, new TextEncoder().encode(treeJson))
    const treeId     = await computeObjectId(treeCipher)
    await _putObject(apiBaseUrl, vaultId, treeId, treeCipher, keys.writeKey, accessToken)

    // 5. Create initial commit object
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

    // 6. Write clone ref (branch 'web-ui') → commit
    const cloneRefFileId = await deriveBranchRefFileId(keys.readKeyBytes, vaultId, branchName)
    const cloneRefCipher = await _encrypt(
        encKey, new TextEncoder().encode(JSON.stringify({ commit_id: commitId }))
    )
    await _putRef(apiBaseUrl, vaultId, cloneRefFileId, cloneRefCipher, keys.writeKey, accessToken)

    // 7. Write named HEAD ref → same commit (starts in sync, ahead=0)
    const namedRefCipher = await _encrypt(
        encKey, new TextEncoder().encode(JSON.stringify({ commit_id: commitId }))
    )
    await _putRef(apiBaseUrl, vaultId, keys.refFileId, namedRefCipher, keys.writeKey, accessToken)

    return {
        token,
        vaultId,
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
