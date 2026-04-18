/* =============================================================================
   SGraph — Vault Session Module
   v1.0.0 — Two-branch model with push/pull, cache, and tree model

   Orchestrates a vault session using:
     - sg-vault-cache for cached object fetching
     - sg-vault-tree-model for persistent in-memory tree
     - vault-write primitives for encryption and uploads

   Two-branch model (from vault team's sg-vault.js):
     - Named HEAD (ref-pid-muw-*): shared/published state, advances only on push()
     - Clone HEAD (ref-pid-snw-*): this session's working state, advances on commit()

   The gap between these two refs is the pending work. push() collapses the gap
   by writing named HEAD → clone HEAD (1 PUT). pull() collapses it in the other
   direction (1 GET + 1 PUT + tree reload).

   Usage:
     import { createSession } from './sg-vault-session.js';

     const session = createSession({ apiBaseUrl, vaultId, keys, accessToken });
     await session.open();
     session.treeModel.insertFile('/', 'hello.txt', { blob_id, size, content_hash });
     await session.commit('Add hello.txt');
     await session.push();

   ============================================================================= */

import { cachedFetch, cachedFetchJson, fetchRef, cachedFetchRaw }
    from '/core/vault-cache/v1/v1.0/v1.0.0/sg-vault-cache.js'

import { createTreeModel }
    from '/core/vault-tree-model/v1/v1.0/v1.0.0/sg-vault-tree-model.js'

import { encryptMetadata, computeObjectId, decryptMetadata, deriveBranchRefFileId }
    from '/core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js'

/** @type {number} AES-GCM IV length */
const IV_LENGTH = 12

/** @type {number} Max commit-chain walk depth */
const MAX_WALK_DEPTH = 100

/**
 * Create a new vault session.
 *
 * @param {object} config
 * @param {string} config.apiBaseUrl - API base URL
 * @param {string} config.vaultId - Vault identifier
 * @param {object} config.keys - Derived keys (readKey, readKeyBytes, writeKey, refFileId, etc.)
 * @param {string} [config.accessToken] - Optional server-level access token
 * @param {string} [config.branchName='web-ui'] - Branch name for clone ref derivation
 * @returns {VaultSession}
 */
export function createSession(config) {
    return new VaultSession(config)
}

class VaultSession {
    constructor({ apiBaseUrl, vaultId, keys, accessToken, branchName = 'web-ui' }) {
        this.apiBaseUrl  = apiBaseUrl.replace(/\/$/, '')
        this.vaultId     = vaultId
        this.keys        = keys
        this.accessToken = accessToken || null
        this.branchName  = branchName

        /** @type {import('./sg-vault-tree-model.js').TreeModel} */
        this.treeModel = createTreeModel()

        this._namedHeadId   = null
        this._headCommitId  = null
        this._refFileId     = keys.refFileId
        this._cloneRefFileId = null

        this._writable = !!keys.writeKey
        this._opened   = false
    }

    /**
     * Open the vault — read refs, load root tree, establish session state.
     * Equivalent to the vault team's open() (6 HTTP calls on first open).
     */
    async open() {
        const { apiBaseUrl, vaultId, keys } = this

        // Step 0: Derive clone ref file ID
        this._cloneRefFileId = await deriveBranchRefFileId(
            keys.readKeyBytes, vaultId, this.branchName
        )

        // Step 1: Read branch index (optional, 404 expected)
        try {
            const idx = await this._fetchJson(keys.branchIndexFileId)
            if (idx && idx.branches) {
                const named = idx.branches.find(b => b.branch_type === 'named')
                if (named && named.head_ref_id) {
                    this._refFileId = named.head_ref_id
                }
            }
        } catch {
            // No branch index — use HMAC-derived refFileId
        }

        // Step 2: Read named HEAD ref (required)
        const namedRef = await fetchRef(apiBaseUrl, vaultId, this._refFileId, keys.readKey)
        if (!namedRef) {
            throw new Error('Vault not found: named HEAD ref missing')
        }
        const namedCommitId = namedRef.commit_id || namedRef.commitId || namedRef.target
        if (!namedCommitId) {
            throw new Error('Named HEAD ref does not contain a commit ID')
        }
        this._namedHeadId = namedCommitId

        // Step 3: Read clone branch ref (404 expected for fresh/read-only vaults)
        let cloneCommitId = null
        try {
            const cloneRef = await fetchRef(apiBaseUrl, vaultId, this._cloneRefFileId, keys.readKey)
            if (cloneRef) {
                cloneCommitId = cloneRef.commit_id || cloneRef.commitId
            }
        } catch {
            // Clone ref not created yet — expected
        }

        this._headCommitId = cloneCommitId || namedCommitId

        // Steps 4-6: Load commit → root tree → populate tree model
        await this._loadTreeFromCommit(this._headCommitId)

        this._opened = true
    }

    /**
     * Check whether the session has write capability.
     * @returns {boolean}
     */
    get writable() {
        return this._writable
    }

    /**
     * Check whether the session is open.
     * @returns {boolean}
     */
    get opened() {
        return this._opened
    }

    /**
     * Get the current head commit ID (clone HEAD if it exists, otherwise named HEAD).
     * @returns {string|null}
     */
    get headCommitId() {
        return this._headCommitId
    }

    /**
     * Get the named (shared/published) HEAD commit ID.
     * @returns {string|null}
     */
    get namedHeadId() {
        return this._namedHeadId
    }

    // ── Commit ──────────────────────────────────────────────────────────────

    /**
     * Commit the current in-memory tree state to the clone branch.
     * Does NOT touch the named HEAD — that only moves on push().
     *
     * Follows vault team's _commit() pattern:
     *   1. Serialise settings blob
     *   2. Build tree entries (preserving unloaded stubs)
     *   3. Create tree objects bottom-up
     *   4. Create commit object
     *   5. Update clone ref
     *
     * @param {string} [message='Update'] - Commit message
     * @returns {Promise<{ commitId: string, treeId: string }>}
     */
    async commit(message = 'Update') {
        if (!this._writable) throw new Error('Read-only: no write key')

        const { apiBaseUrl, vaultId, keys } = this
        const encKey = await this._importEncryptKey()

        // 1. Encrypt settings blob
        let settingsBlobId = null
        if (this.treeModel.getSettings()) {
            const settingsPlain = new TextEncoder().encode(
                JSON.stringify(this.treeModel.getSettings())
            )
            const settingsCipher = await this._encrypt(encKey, settingsPlain)
            settingsBlobId = await computeObjectId(settingsCipher)
            await this._putObject(settingsBlobId, settingsCipher)
        }

        // 2. Build tree entries from root, recursing into loaded folders
        const rootNode = this.treeModel.getRoot()
        const rootTreeId = await this._buildAndUploadTree(rootNode, encKey, settingsBlobId)

        // 3. Create commit object
        const parentIds = this._headCommitId ? [this._headCommitId] : []
        const msgCipher = await encryptMetadata(keys.readKeyBytes, message)
        const commitData = {
            schema:       'commit_v2',
            parents:      parentIds,
            tree_id:      rootTreeId,
            timestamp_ms: Date.now(),
            message_enc:  msgCipher,
            branch_id:    null,
            signature:    null
        }
        const commitCipher = await this._encrypt(
            encKey, new TextEncoder().encode(JSON.stringify(commitData))
        )
        const commitId = await computeObjectId(commitCipher)
        await this._putObject(commitId, commitCipher)

        // 4. Update clone ref (create it lazily if needed)
        if (!this._cloneRefFileId) {
            this._cloneRefFileId = await deriveBranchRefFileId(
                keys.readKeyBytes, vaultId, this.branchName
            )
        }
        await this._writeRef(this._cloneRefFileId, commitId)

        this._headCommitId = commitId

        return { commitId, treeId: rootTreeId }
    }

    // ── Push / Pull ─────────────────────────────────────────────────────────

    /**
     * Publish local commits to the shared named branch.
     * Fast-forward only — moves named HEAD → clone HEAD (1 PUT).
     *
     * @returns {Promise<void>}
     */
    async push() {
        if (!this._cloneRefFileId) throw new Error('No clone branch initialised')
        if (!this._writable) throw new Error('Read-only: no write key')

        await this._writeRef(this._refFileId, this._headCommitId)
        this._namedHeadId = this._headCommitId
    }

    /**
     * Fetch new commits pushed by another client and rebuild the in-memory tree.
     * Fast-forward only — refuses if there are unpushed local commits.
     *
     * @returns {Promise<boolean>} true if pulled new commits, false if already up to date
     */
    async pull() {
        if (!this._writable) throw new Error('Read-only: no write key')

        if (this._headCommitId !== this._namedHeadId) {
            throw new Error('Cannot pull: you have unpushed local commits. Push first, then pull.')
        }

        const serverNamedHead = await this._readRefLive(this._refFileId)
        if (!serverNamedHead || serverNamedHead === this._headCommitId) return false

        this._namedHeadId  = serverNamedHead
        this._headCommitId = serverNamedHead

        if (this._cloneRefFileId) {
            await this._writeRef(this._cloneRefFileId, serverNamedHead)
        }

        await this._loadTreeFromCommit(serverNamedHead)
        return true
    }

    // ── Ahead / Behind ──────────────────────────────────────────────────────

    /**
     * Count local unpushed commits (clone HEAD → named HEAD distance).
     * @returns {Promise<number>}
     */
    async getAheadCount() {
        if (!this._namedHeadId || this._headCommitId === this._namedHeadId) return 0
        return this._walkCommitChain(this._headCommitId, this._namedHeadId)
    }

    /**
     * Count remote unpulled commits (server named HEAD → local named HEAD distance).
     * Always fetches the named ref live to detect remote changes.
     * @returns {Promise<number>}
     */
    async getBehindCount() {
        const serverNamedHead = await this._readRefLive(this._refFileId)
        if (!serverNamedHead || serverNamedHead === this._namedHeadId) return 0
        return this._walkCommitChain(serverNamedHead, this._namedHeadId)
    }

    // ── File operations (convenience wrappers) ──────────────────────────────

    /**
     * Read a file from the vault (uses cache).
     *
     * @param {string} blobId - The blob's object ID
     * @returns {Promise<ArrayBuffer>} Decrypted file content
     */
    async getFile(blobId) {
        return cachedFetch(this.apiBaseUrl, this.vaultId, blobId, this.keys.readKey)
    }

    /**
     * Load a sub-tree on demand (lazy folder expansion).
     * Fetches, decrypts, and populates the tree model for the given folder.
     *
     * @param {string} folderPath - Absolute folder path
     * @returns {Promise<boolean>} true if loaded, false if already loaded
     */
    async loadSubTree(folderPath) {
        if (!this.treeModel.needsLoading(folderPath)) return false

        const treeId = this.treeModel.getTreeId(folderPath)
        if (!treeId) return false

        const tree = await cachedFetchJson(
            this.apiBaseUrl, this.vaultId, treeId, this.keys.readKey
        )

        const entries = await this._decryptTreeEntries(tree.entries || [])
        return this.treeModel.loadSubTree(folderPath, entries)
    }

    /**
     * Encrypt and upload a blob, returning its object ID and metadata.
     * Does NOT commit — caller should mutate the tree model then call commit().
     *
     * @param {string|Uint8Array} content - File content
     * @returns {Promise<{ blob_id: string, size: number, content_hash: string }>}
     */
    async uploadBlob(content) {
        const plainBytes = typeof content === 'string'
            ? new TextEncoder().encode(content)
            : content

        const encKey      = await this._importEncryptKey()
        const ciphertext  = await this._encrypt(encKey, plainBytes)
        const blobId      = await computeObjectId(ciphertext)
        const contentHash = await this._sha256Hex(plainBytes, 12)

        await this._putObject(blobId, ciphertext)

        return {
            blob_id: blobId,
            size: plainBytes.byteLength,
            content_hash: contentHash
        }
    }

    // ── Internal ────────────────────────────────────────────────────────────

    async _loadTreeFromCommit(commitId) {
        const { apiBaseUrl, vaultId, keys } = this

        const commit = await cachedFetchJson(apiBaseUrl, vaultId, commitId, keys.readKey)
        const treeId = commit.tree_id || commit.treeId || commit.tree
        if (!treeId) throw new Error('Commit has no tree_id')

        const tree = await cachedFetchJson(apiBaseUrl, vaultId, treeId, keys.readKey)
        const entries = await this._decryptTreeEntries(tree.entries || [])

        this.treeModel.loadRoot(entries)

        // Load settings if present
        const settingsBlobId = this.treeModel.getSettingsBlobId()
        if (settingsBlobId) {
            try {
                const settingsPlain = await cachedFetch(
                    apiBaseUrl, vaultId, settingsBlobId, keys.readKey
                )
                const settings = JSON.parse(new TextDecoder().decode(settingsPlain))
                this.treeModel.setSettings(settings)
            } catch {
                // Settings blob missing or corrupt
            }
        }
    }

    async _decryptTreeEntries(rawEntries) {
        const { keys } = this
        return Promise.all(rawEntries.map(async (entry) => {
            const result = { ...entry }

            if (entry.name_enc) {
                try {
                    result.name = await decryptMetadata(keys.readKey, entry.name_enc)
                } catch {
                    result.name = '[decrypt failed]'
                }
            }
            if (entry.size_enc) {
                try {
                    result.size = Number(await decryptMetadata(keys.readKey, entry.size_enc)) || 0
                } catch {
                    result.size = 0
                }
            }
            if (entry.content_hash_enc) {
                try {
                    result.content_hash = await decryptMetadata(keys.readKey, entry.content_hash_enc)
                } catch {
                    result.content_hash = ''
                }
            }

            return result
        }))
    }

    async _buildAndUploadTree(node, encKey, settingsBlobId) {
        const { keys } = this
        const entries = []

        // Add settings entry at root level
        if (settingsBlobId) {
            entries.push({
                blob_id:          settingsBlobId,
                name_enc:         await encryptMetadata(keys.readKeyBytes, '.vault-settings'),
                size_enc:         await encryptMetadata(keys.readKeyBytes, '0'),
                content_hash_enc: await encryptMetadata(keys.readKeyBytes, ''),
            })
        }

        for (const [name, child] of Object.entries(node.children)) {
            if (child.type === 'folder') {
                if (!child._loaded && child._tree_id) {
                    // STUB: preserve existing tree_id unchanged
                    entries.push({
                        tree_id:  child._tree_id,
                        name_enc: await encryptMetadata(keys.readKeyBytes, name),
                    })
                } else {
                    // LOADED: recurse and create new sub-tree object
                    const childTreeId = await this._buildAndUploadTree(child, encKey, null)
                    entries.push({
                        tree_id:  childTreeId,
                        name_enc: await encryptMetadata(keys.readKeyBytes, name),
                    })
                }
            } else {
                // File entry
                entries.push({
                    blob_id:          child.blob_id,
                    name_enc:         await encryptMetadata(keys.readKeyBytes, name),
                    size_enc:         await encryptMetadata(keys.readKeyBytes, String(child.size)),
                    content_hash_enc: await encryptMetadata(keys.readKeyBytes, child.content_hash || ''),
                })
            }
        }

        const treeJson   = JSON.stringify({ schema: 'tree_v1', entries })
        const treeCipher = await this._encrypt(encKey, new TextEncoder().encode(treeJson))
        const treeId     = await computeObjectId(treeCipher)
        await this._putObject(treeId, treeCipher)
        return treeId
    }

    async _walkCommitChain(fromId, toId) {
        let count  = 0
        let cursor = fromId

        while (cursor && cursor !== toId && count < MAX_WALK_DEPTH) {
            count++
            try {
                const commit = await cachedFetchJson(
                    this.apiBaseUrl, this.vaultId, cursor, this.keys.readKey
                )
                cursor = (commit.parents && commit.parents[0]) || null
            } catch {
                break
            }
        }
        return count
    }

    async _readRefLive(refFileId) {
        const ref = await fetchRef(this.apiBaseUrl, this.vaultId, refFileId, this.keys.readKey)
        if (!ref) return null
        return ref.commit_id || ref.commitId || ref.target || null
    }

    async _writeRef(refFileId, commitId) {
        const encKey = await this._importEncryptKey()
        const refData = JSON.stringify({ commit_id: commitId })
        const refCipher = await this._encrypt(encKey, new TextEncoder().encode(refData))

        const barePath = refFileId.startsWith('bare/')
            ? refFileId
            : `bare/refs/${refFileId}`
        const url = `${this.apiBaseUrl}/api/vault/write/${this.vaultId}/${barePath}`
        const headers = { 'x-sgraph-vault-write-key': this.keys.writeKey }
        if (this.accessToken) headers['x-sgraph-access-token'] = this.accessToken

        const resp = await fetch(url, { method: 'PUT', headers, body: refCipher })
        if (!resp.ok) {
            throw new Error(`Write ref ${refFileId}: ${resp.status}`)
        }
    }

    async _putObject(objectId, cipherBytes) {
        const url = `${this.apiBaseUrl}/api/vault/write/${this.vaultId}/bare/data/${objectId}`
        const headers = { 'x-sgraph-vault-write-key': this.keys.writeKey }
        if (this.accessToken) headers['x-sgraph-access-token'] = this.accessToken

        const resp = await fetch(url, { method: 'PUT', headers, body: cipherBytes })
        if (!resp.ok) {
            throw new Error(`Write object ${objectId}: ${resp.status}`)
        }
    }

    async _fetchJson(objectId) {
        return cachedFetchJson(this.apiBaseUrl, this.vaultId, objectId, this.keys.readKey)
    }

    async _importEncryptKey() {
        return crypto.subtle.importKey(
            'raw', this.keys.readKeyBytes,
            { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
        )
    }

    async _encrypt(key, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
        const result = new Uint8Array(IV_LENGTH + ct.byteLength)
        result.set(iv)
        result.set(new Uint8Array(ct), IV_LENGTH)
        return result
    }

    async _sha256Hex(bytes, hexLen) {
        const buf = await crypto.subtle.digest('SHA-256', bytes)
        const hex = Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, '0')).join('')
        return hexLen ? hex.slice(0, hexLen) : hex
    }
}
