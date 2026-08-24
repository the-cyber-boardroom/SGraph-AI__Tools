/* =============================================================================
   SGraph — Vault Write Module
   v1.1.2 — Sub-tree model with encrypted metadata + optional access token

   v1.1.2 changes:
     - Re-pinned onto vault-client v1.2.3. v1.1.1 imported v1.2.0 while
       sg-vault-connect imported v1.2.1, so a page loading both got two copies
       of vault-client with DIFFERENT idx path tables. One pin now, and it is
       the one that agrees with sgit.
     - No API change.

   v1.1.1 changes:
     - writeVaultFile: extracts vault.accessToken if present
     - _putObject / _putRef: accept optional accessToken; adds
       x-sgraph-access-token header when provided

   Rewrites v1.0.0 to use the sub-tree model (one tree object per directory),
   matching the sgit-ai CLI bottom-up tree construction. All metadata fields
   (name, size, content_hash, content_type) are encrypted — no plaintext
   metadata leaks.

   Schemas (matching sgit-ai CLI exactly):
     commit_v2: { schema, parents[], tree_id, timestamp_ms, message_enc,
                  branch_id, signature }
     tree_v1:   { schema, entries[] }
       file entry:  { blob_id, name_enc, size_enc, content_hash_enc,
                      content_type_enc, large }
       dir  entry:  { tree_id, name_enc }

   Object IDs:
     obj-cas-imm-{SHA256(ciphertext)[:12]}
     where ciphertext = full encrypted bytes (12-byte IV + AES-GCM output)

   Encrypted metadata format:
     base64( 12-byte-random-IV + AES-256-GCM-ciphertext )

   Write API:
     PUT /api/vault/write/{vaultId}/{bare_path}
     Header: x-sgraph-vault-write-key: {writeKey}
     Body: raw ciphertext bytes (Uint8Array)

   Usage:
     import { writeVaultFile, buildSubTrees, deriveWriteKeys }
       from '/core/vault-write/v1/v1.1/v1.1.2/sg-vault-write.js';

     const vault = await openVault(keys, { apiBaseUrl: '...' });
     await writeVaultFile(vault, 'docs/notes.md', '# Hello', {
       message: 'Add notes', contentType: 'text/markdown'
     });

   ============================================================================= */

import {
    parseVaultKey, deriveVaultKeys, deriveFileIdHex,
    openVault, readFile, readFileAsJson, fetchSubTree,
    encryptMetadata, decryptMetadata, computeObjectId,
    fileIdToPath, formatFileId, walkTree
} from '/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js'

// Re-export vault-client utilities that consumers commonly need alongside write
export { parseVaultKey, deriveVaultKeys, openVault, fileIdToPath, formatFileId }

/** @type {number} AES-GCM initialisation vector length in bytes */
export const IV_LENGTH = 12

/** @type {number} Hex chars used for object ID derivation */
export const OBJECT_ID_HEX_LENGTH = 12

// ── Exported Functions ───────────────────────────────────────────────────────

/**
 * High-level: write a single file to the vault using the sub-tree model.
 *
 * Reads the current HEAD ref, walks the existing tree into a flat map,
 * incorporates the new/changed file, rebuilds sub-trees bottom-up,
 * creates a commit_v2 object, and updates the branch ref.
 *
 * Handles:
 *   - New file in an existing directory
 *   - New file in a new (previously non-existent) directory
 *   - Overwrite of an existing file
 *   - File in the root directory (no subdirectories)
 *   - Nested paths (e.g. 'docs/sub/notes.md')
 *
 * @param {object} vault - Vault handle from openVault() (must include keys.readKeyBytes)
 * @param {string} filePath - File path within the vault (e.g. 'docs/notes.md')
 * @param {string|Uint8Array} content - File content (strings are UTF-8 encoded)
 * @param {object} [options]
 * @param {string} [options.message] - Commit message (default: auto-generated)
 * @param {string} [options.contentType] - MIME type (default: 'application/octet-stream')
 * @param {string} [options.branchId] - Branch ref ID (default: vault.keys.refFileId)
 * @returns {Promise<{ commitId: string, treeId: string, blobId: string }>}
 */
export async function writeVaultFile(vault, filePath, content, options = {}) {
    const { apiBaseUrl, vaultId, keys, accessToken } = vault

    // Derive an encrypt-capable AES key from the raw key bytes
    const encKey = await _importEncryptKey(keys.readKeyBytes)

    // Normalise content to Uint8Array
    const plainBytes = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content

    // Normalise path: strip leading/trailing slashes, collapse doubles
    const normPath    = filePath.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
    const fileName    = normPath.split('/').pop()
    const message     = options.message     ?? `Update ${normPath}`
    const contentType = options.contentType  ?? _guessContentType(normPath)
    const branchId    = options.branchId    ?? keys.refFileId

    // --- 1. Encrypt blob and compute IDs ---
    const blobCipher  = await _encrypt(encKey, plainBytes)
    const contentHash = await _sha256Hex(plainBytes, OBJECT_ID_HEX_LENGTH)
    const blobId      = await computeObjectId(blobCipher)

    // --- 2. Upload blob ---
    await _putObject(apiBaseUrl, vaultId, keys.writeKey, blobId, blobCipher, accessToken)

    // --- 3. Read current state: ref -> commit -> root tree ---
    let parentCommitIds = []
    let flatMap         = {}   // { 'path/to/file': { blob_id, size, content_hash, content_type } }

    try {
        const refPlain   = await readFile(vault, keys.refFileId)
        const refObj     = JSON.parse(new TextDecoder().decode(refPlain))
        const headId     = refObj.head || refObj.commit_id
        if (headId) {
            parentCommitIds = [headId]

            // Decrypt the commit to get tree_id
            const commitPlain = await readFile(vault, headId)
            const commitObj   = JSON.parse(new TextDecoder().decode(commitPlain))

            if (commitObj.tree_id) {
                // Walk the sub-tree structure recursively into a flat map
                flatMap = await _walkTreeToFlatMap(
                    vault, commitObj.tree_id, keys.readKeyBytes, ''
                )
            }
        }
    } catch {
        // Empty vault or first write — start with empty flat map
    }

    // --- 4. Update the flat map with the new/changed file ---
    flatMap[normPath] = {
        blob_id:      blobId,
        size:         plainBytes.byteLength,
        content_hash: contentHash,
        content_type: contentType,
    }

    // --- 5. Build new sub-trees bottom-up ---
    const uploadFn = async (objectId, encryptedBytes) => {
        await _putObject(apiBaseUrl, vaultId, keys.writeKey, objectId, encryptedBytes, accessToken)
    }
    const treeId = await buildSubTrees(flatMap, keys.readKeyBytes, uploadFn)

    // --- 6. Create commit_v2 ---
    const msgCipher  = await encryptMetadata(keys.readKeyBytes, message)
    const commitData = {
        schema:       'commit_v2',
        parents:      parentCommitIds,
        tree_id:      treeId,
        timestamp_ms: Date.now(),
        message_enc:  msgCipher,
        branch_id:    branchId,
        signature:    null,
    }
    const commitCipherBytes = await _encrypt(
        encKey,
        new TextEncoder().encode(JSON.stringify(commitData))
    )
    const commitId = await computeObjectId(commitCipherBytes)
    await _putObject(apiBaseUrl, vaultId, keys.writeKey, commitId, commitCipherBytes, accessToken)

    // --- 7. Update ref ---
    const refData       = { commit_id: commitId }
    const refCipherBytes = await _encrypt(
        encKey,
        new TextEncoder().encode(JSON.stringify(refData))
    )
    await _putRef(apiBaseUrl, vaultId, keys.writeKey, keys.refFileId, refCipherBytes, accessToken)

    return { commitId, treeId, blobId }
}

/**
 * Build sub-tree objects bottom-up from a flat file map, matching the sgit-ai
 * CLI tree construction algorithm exactly.
 *
 * Algorithm:
 *   1. Parse all file paths, group by parent directory
 *   2. Collect all unique directories, sort deepest-first
 *   3. For each directory (deepest first):
 *      a. Create file entries (blob_id + encrypted metadata)
 *      b. Create directory entries for children that already have tree_ids
 *      c. Serialize as JSON: { "schema": "tree_v1", "entries": [...] }
 *      d. Encrypt the JSON with AES-256-GCM
 *      e. Compute object ID: obj-cas-imm-{SHA256(ciphertext)[:12]}
 *      f. Call uploadFn(objectId, encryptedBytes)
 *   4. Return root tree object ID
 *
 * @param {Object<string, { blob_id: string, size: number, content_hash: string, content_type: string }>} flatMap
 *   Map of full file paths to their blob metadata.
 * @param {Uint8Array} readKeyBytes - Raw 32-byte AES key for encryption
 * @param {function(string, Uint8Array): Promise<void>} uploadFn
 *   Called for each tree object: uploadFn(objectId, encryptedBytes)
 * @returns {Promise<string>} Root tree object ID (obj-cas-imm-{hex})
 */
export async function buildSubTrees(flatMap, readKeyBytes, uploadFn) {
    const encKey = await _importEncryptKey(readKeyBytes)

    // --- Step 1: Group files by their parent directory ---
    // dirFiles:  { 'docs/sub': ['docs/sub/file.md'], '': ['readme.md'] }
    // childDirs: { 'docs': Set{'sub'}, '': Set{'docs'} }
    const dirFiles  = {}   // parentDir -> [fullPath, ...]
    const allDirs   = new Set()

    allDirs.add('')  // root always exists

    for (const fullPath of Object.keys(flatMap)) {
        const parts     = fullPath.split('/')
        const fileName  = parts.pop()
        const parentDir = parts.join('/')

        // Register the parent directory and all ancestors
        let current = ''
        for (const segment of parts) {
            const parent = current
            current = current ? `${current}/${segment}` : segment
            allDirs.add(current)
        }
        allDirs.add(parentDir)

        if (!dirFiles[parentDir]) dirFiles[parentDir] = []
        dirFiles[parentDir].push(fullPath)
    }

    // --- Step 2: Collect child directories for each directory ---
    const childDirs = {}  // parentDir -> Set of child dir names (just the segment)
    for (const dir of allDirs) {
        if (dir === '') continue
        const parts     = dir.split('/')
        const segment   = parts.pop()
        const parentDir = parts.join('/')
        if (!childDirs[parentDir]) childDirs[parentDir] = new Set()
        childDirs[parentDir].add(segment)
    }

    // --- Step 3: Sort directories deepest-first ---
    const sortedDirs = [...allDirs].sort((a, b) => {
        const depthA = a === '' ? 0 : a.split('/').length
        const depthB = b === '' ? 0 : b.split('/').length
        return depthB - depthA  // deepest first
    })

    // --- Step 4: Build tree objects bottom-up ---
    const treeIds = {}  // dir -> objectId

    for (const dir of sortedDirs) {
        const entries = []

        // File entries in this directory
        const files = dirFiles[dir] || []
        for (const fullPath of files) {
            const meta     = flatMap[fullPath]
            const parts    = fullPath.split('/')
            const fileName = parts[parts.length - 1]

            entries.push({
                blob_id:          meta.blob_id,
                name_enc:         await encryptMetadata(readKeyBytes, fileName),
                size_enc:         await encryptMetadata(readKeyBytes, String(meta.size)),
                content_hash_enc: await encryptMetadata(readKeyBytes, meta.content_hash),
                content_type_enc: await encryptMetadata(readKeyBytes, meta.content_type),
                large:            false,
            })
        }

        // Child directory entries (already processed, deepest-first)
        const children = childDirs[dir] || new Set()
        for (const childName of children) {
            const childPath = dir ? `${dir}/${childName}` : childName
            const childTreeId = treeIds[childPath]
            if (childTreeId) {
                entries.push({
                    tree_id:  childTreeId,
                    name_enc: await encryptMetadata(readKeyBytes, childName),
                })
            }
        }

        // Serialize, encrypt, compute ID, upload
        const treeJson    = JSON.stringify({ schema: 'tree_v1', entries })
        const treeCipher  = await _encrypt(encKey, new TextEncoder().encode(treeJson))
        const treeObjId   = await computeObjectId(treeCipher)

        await uploadFn(treeObjId, treeCipher)
        treeIds[dir] = treeObjId
    }

    // Root tree is the tree for the '' directory
    return treeIds['']
}

/**
 * Derive vault keys (including write key) from a passphrase and vault ID.
 *
 * Produces an encrypt-capable readKey (unlike the read-only vault-client
 * version which imports with ['decrypt'] only). The writeKey is the hex
 * encoding of a separate PBKDF2-derived key used for API auth.
 *
 * @param {string} passphrase - The vault passphrase
 * @param {string} vaultId - The 8-char lowercase alphanumeric vault ID
 * @returns {Promise<{
 *   readKey:          CryptoKey,
 *   readKeyBytes:     Uint8Array,
 *   writeKey:         string,
 *   hmacKey:          CryptoKey,
 *   refFileId:        string,
 *   branchIndexFileId: string,
 *   vaultId:          string
 * }>}
 */
export async function deriveWriteKeys(passphrase, vaultId) {
    const enc       = new TextEncoder()
    const passBytes = enc.encode(passphrase)

    const keyMaterial = await crypto.subtle.importKey(
        'raw', passBytes, 'PBKDF2', false, ['deriveBits']
    )

    const readSalt  = enc.encode(`sg-vault-v1:${vaultId}`)
    const writeSalt = enc.encode(`sg-vault-v1:write:${vaultId}`)

    const [readBits, writeBits] = await Promise.all([
        crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: readSalt, iterations: 600_000, hash: 'SHA-256' },
            keyMaterial, 256
        ),
        crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: writeSalt, iterations: 600_000, hash: 'SHA-256' },
            keyMaterial, 256
        ),
    ])

    const readKeyBytes = new Uint8Array(readBits)

    const [readKey, hmacKey] = await Promise.all([
        crypto.subtle.importKey(
            'raw', readKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
        ),
        crypto.subtle.importKey(
            'raw', readKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        ),
    ])

    const writeKey = _bytesToHex(new Uint8Array(writeBits))

    const [refHex, branchIndexHex] = await Promise.all([
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:ref:${vaultId}`),
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:branch-index:${vaultId}`),
    ])

    return {
        readKey,
        readKeyBytes,
        writeKey,
        hmacKey,
        refFileId:         `ref-pid-muw-${refHex}`,
        branchIndexFileId: `idx-pid-muw-${branchIndexHex}`,
        vaultId,
    }
}

/**
 * Derive write keys from a simple token (word-word-NNNN format).
 * Uses 4-step PBKDF2 -> HKDF derivation matching sgit simple-token semantics.
 *
 * @param {string} token - Simple token string
 * @returns {Promise<{
 *   readKey:          CryptoKey,
 *   readKeyBytes:     Uint8Array,
 *   writeKey:         string,
 *   hmacKey:          CryptoKey,
 *   vaultId:          string,
 *   refFileId:        string,
 *   branchIndexFileId: string
 * }>}
 */
export async function deriveWriteKeysFromSimpleToken(token) {
    const enc      = new TextEncoder()
    const tokenLow = token.toLowerCase().trim()

    // Step 1: PBKDF2 fixed salt -> intermediate key
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(tokenLow), 'PBKDF2', false, ['deriveBits']
    )
    const aesKeyBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode('sgraph-send-v1'), iterations: 600_000, hash: 'SHA-256' },
        keyMaterial, 256
    )

    // Steps 2+3: HKDF -> read+write keys
    const hkdfKey = await crypto.subtle.importKey('raw', aesKeyBits, 'HKDF', false, ['deriveBits'])
    const [readBits, writeBits] = await Promise.all([
        crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vault-read-key') },
            hkdfKey, 256
        ),
        crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vault-write-key') },
            hkdfKey, 256
        ),
    ])

    // Step 4: vault_id = SHA-256(token)[:12 hex chars]
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(tokenLow))
    const vaultId = _bytesToHex(new Uint8Array(hashBuf)).slice(0, 12)

    const readKeyBytes = new Uint8Array(readBits)
    const [readKey, hmacKey] = await Promise.all([
        crypto.subtle.importKey(
            'raw', readKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
        ),
        crypto.subtle.importKey(
            'raw', readKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        ),
    ])
    const writeKey = _bytesToHex(new Uint8Array(writeBits))

    const [refHex, branchIndexHex] = await Promise.all([
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:ref:${vaultId}`),
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:branch-index:${vaultId}`),
    ])

    return {
        readKey,
        readKeyBytes,
        writeKey,
        hmacKey,
        vaultId,
        refFileId:         `ref-pid-muw-${refHex}`,
        branchIndexFileId: `idx-pid-muw-${branchIndexHex}`,
    }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Recursively walk a sub-tree structure and flatten it into a path -> metadata map.
 * Decrypts name_enc fields at each level to reconstruct full paths.
 *
 * @param {object} vault - Vault handle
 * @param {string} treeId - Tree object ID to walk
 * @param {Uint8Array} readKeyBytes - Raw key bytes for decryption
 * @param {string} prefix - Path prefix for this tree level ('' for root)
 * @returns {Promise<Object<string, { blob_id: string, size: number, content_hash: string, content_type: string }>>}
 */
async function _walkTreeToFlatMap(vault, treeId, readKeyBytes, prefix) {
    const flatMap = {}

    try {
        const treePlain = await readFile(vault, treeId)
        const treeObj   = JSON.parse(new TextDecoder().decode(treePlain))
        const entries   = treeObj.entries || []

        for (const entry of entries) {
            // Decrypt the entry name
            let name = null
            if (entry.name_enc) {
                try {
                    name = await decryptMetadata(readKeyBytes, entry.name_enc)
                } catch {
                    // Skip entries we cannot decrypt
                    continue
                }
            }
            if (!name) continue

            const fullPath = prefix ? `${prefix}/${name}` : name

            if (entry.blob_id) {
                // File entry: extract metadata
                let size         = 0
                let content_hash = ''
                let content_type = 'application/octet-stream'

                if (entry.size_enc) {
                    try {
                        size = Number(await decryptMetadata(readKeyBytes, entry.size_enc)) || 0
                    } catch { /* use default */ }
                }
                if (entry.content_hash_enc) {
                    try {
                        content_hash = await decryptMetadata(readKeyBytes, entry.content_hash_enc)
                    } catch { /* use default */ }
                }
                if (entry.content_type_enc) {
                    try {
                        content_type = await decryptMetadata(readKeyBytes, entry.content_type_enc)
                    } catch { /* use default */ }
                }

                flatMap[fullPath] = {
                    blob_id:      entry.blob_id,
                    size,
                    content_hash,
                    content_type,
                }
            } else if (entry.tree_id) {
                // Directory entry: recurse
                const subMap = await _walkTreeToFlatMap(
                    vault, entry.tree_id, readKeyBytes, fullPath
                )
                Object.assign(flatMap, subMap)
            }
        }
    } catch {
        // Tree not readable — return empty map for this level
    }

    return flatMap
}

/**
 * Import raw key bytes as an AES-GCM key with encrypt+decrypt capability.
 * @param {Uint8Array} keyBytes - 32-byte AES key
 * @returns {Promise<CryptoKey>}
 */
async function _importEncryptKey(keyBytes) {
    return crypto.subtle.importKey(
        'raw', keyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    )
}

/**
 * Encrypt data with AES-256-GCM. Returns IV (12 bytes) + ciphertext as Uint8Array.
 * @param {CryptoKey} key - AES-GCM CryptoKey
 * @param {Uint8Array} plaintext - Data to encrypt
 * @returns {Promise<Uint8Array>} IV + ciphertext
 */
async function _encrypt(key, plaintext) {
    const iv         = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
    const result     = new Uint8Array(IV_LENGTH + ciphertext.byteLength)
    result.set(iv)
    result.set(new Uint8Array(ciphertext), IV_LENGTH)
    return result
}

/**
 * Compute SHA-256 hex digest, optionally truncated.
 * @param {Uint8Array} bytes - Input bytes
 * @param {number} [hexLen] - Truncate to this many hex chars
 * @returns {Promise<string>}
 */
async function _sha256Hex(bytes, hexLen) {
    const buf = await crypto.subtle.digest('SHA-256', bytes)
    const hex = _bytesToHex(new Uint8Array(buf))
    return hexLen ? hex.slice(0, hexLen) : hex
}

/**
 * Derive a 12-char hex file ID via HMAC-SHA256.
 * @param {CryptoKey} hmacKey - HMAC key
 * @param {string} input - Input string to HMAC
 * @returns {Promise<string>} 12-char hex string
 */
async function _hmacFileId(hmacKey, input) {
    const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(input))
    return _bytesToHex(new Uint8Array(sig)).slice(0, 12)
}

/**
 * PUT an object to the vault's content-addressed store.
 * Path: bare/data/{objectId}
 * @param {string} apiBaseUrl - API base URL
 * @param {string} vaultId - Vault identifier
 * @param {string} writeKey - Hex write key for auth
 * @param {string} objectId - Self-describing ID (obj-cas-imm-{hex})
 * @param {Uint8Array} data - Encrypted bytes
 * @param {string} [accessToken] - Optional server-level access token
 * @returns {Promise<void>}
 */
async function _putObject(apiBaseUrl, vaultId, writeKey, objectId, data, accessToken) {
    const barePath = `bare/data/${objectId}`
    const url      = `${apiBaseUrl}/api/vault/write/${vaultId}/${barePath}`
    const headers  = { 'x-sgraph-vault-write-key': writeKey }
    if (accessToken) headers['x-sgraph-access-token'] = accessToken
    const resp     = await fetch(url, { method: 'PUT', headers, body: data })
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`Write ${objectId}: ${resp.status} ${body || resp.statusText}`)
    }
}

/**
 * PUT a ref file (HEAD pointer) to the vault.
 * Path: bare/refs/{refFileId}
 * @param {string} apiBaseUrl - API base URL
 * @param {string} vaultId - Vault identifier
 * @param {string} writeKey - Hex write key for auth
 * @param {string} refFileId - Self-describing ID (ref-pid-muw-{hex})
 * @param {Uint8Array} data - Encrypted bytes
 * @param {string} [accessToken] - Optional server-level access token
 * @returns {Promise<void>}
 */
async function _putRef(apiBaseUrl, vaultId, writeKey, refFileId, data, accessToken) {
    const barePath = fileIdToPath(refFileId)
    const url      = `${apiBaseUrl}/api/vault/write/${vaultId}/${barePath}`
    const headers  = { 'x-sgraph-vault-write-key': writeKey }
    if (accessToken) headers['x-sgraph-access-token'] = accessToken
    const resp     = await fetch(url, { method: 'PUT', headers, body: data })
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`Write ref ${refFileId}: ${resp.status} ${body || resp.statusText}`)
    }
}

/**
 * Guess MIME type from a file path extension.
 * @param {string} path - File path
 * @returns {string} MIME type string
 */
function _guessContentType(path) {
    const ext = (path.split('.').pop() || '').toLowerCase()
    const types = {
        'json': 'application/json',
        'js':   'application/javascript',
        'mjs':  'application/javascript',
        'html': 'text/html',
        'htm':  'text/html',
        'css':  'text/css',
        'md':   'text/markdown',
        'txt':  'text/plain',
        'xml':  'application/xml',
        'svg':  'image/svg+xml',
        'png':  'image/png',
        'jpg':  'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif':  'image/gif',
        'webp': 'image/webp',
        'pdf':  'application/pdf',
        'zip':  'application/zip',
        'csv':  'text/csv',
        'yaml': 'text/yaml',
        'yml':  'text/yaml',
        'toml': 'application/toml',
    }
    return types[ext] || 'application/octet-stream'
}

/**
 * Convert a byte array to a lowercase hex string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function _bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
