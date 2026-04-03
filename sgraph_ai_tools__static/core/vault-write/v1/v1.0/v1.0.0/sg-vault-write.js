/* =============================================================================
   SGraph — Vault Write Module
   v1.0.0 — Browser-based vault write support (AES-256-GCM + sgit schemas)

   Extends the read-only vault-client with write capabilities: encrypt blobs,
   create commit_v2 + tree_v1 objects, and update branch refs. Compatible
   with sgit (sg-send-cli) schema and key derivation.

   Schemas (from sg-send-cli / Send vault):
     commit_v2: { schema, parents[], tree_id, timestamp_ms, message_enc, branch_id, signature }
     tree_v1:   { schema, entries[] }
       entry:   { name_enc, blob_id, tree_id, size_enc?, content_hash_enc? }

   Object storage paths:
     blobs/commits/trees → bare/data/obj-cas-imm-{SHA256(ciphertext)[:12]}
     refs               → bare/refs/{refFileId}

   Write API:
     PUT /api/vault/write/{vaultId}/{path}
     Header: x-sgraph-vault-write-key: {writeKey}
     Body: raw ciphertext (Uint8Array)

   Usage:
     import { writeVaultFile, deriveWriteKeys } from './sg-vault-write.js';

     // vault = from openVault() in sg-vault-client.js (requires keys.readKeyBytes)
     await writeVaultFile(vault, 'notes.md', '# Hello\nThis is a note.');

   ============================================================================= */

import { fileIdToPath } from '/core/vault-client/v1/v1.1/v1.1.0/sg-vault-client.js';

export const IV_LENGTH = 12;

/**
 * High-level: write a text file to the vault, auto-committing the change.
 * Reads the current HEAD ref, updates the flat root tree, creates a new
 * commit, and updates the ref. Handles both new files and overwrites.
 *
 * NOTE: This is a flat-tree implementation (no subdirectories in v1.0.0).
 * The path must be a simple filename (e.g. 'notes.md', not 'docs/notes.md').
 * Nested paths will have the directory separators stripped and the filename used.
 *
 * @param {object} vault     - Vault handle from openVault() in sg-vault-client.js
 * @param {string} filePath  - File path within the vault (flat or nested)
 * @param {string|Uint8Array} content - File content (string gets UTF-8 encoded)
 * @param {object} [options]
 * @param {string} [options.message]   - Commit message (default: auto-generated)
 * @param {string} [options.branchId]  - Branch identifier (default: 'main')
 * @returns {Promise<{ commitId: string, treeId: string, blobId: string }>}
 */
export async function writeVaultFile(vault, filePath, content, options = {}) {
    const { apiBaseUrl, vaultId, keys } = vault;

    // Derive an encrypt-capable key from the raw key bytes stored in keys
    const encKey = await _importEncryptKey(keys.readKeyBytes);

    // Normalise content to Uint8Array
    const plainBytes = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content;

    // Use just the final path segment as the entry name
    const fileName = filePath.split('/').filter(Boolean).pop() || filePath;
    const message  = options.message  ?? `Update ${fileName}`;
    const branchId = options.branchId ?? 'main';

    // 1. Encrypt blob and compute IDs
    const blobCipher  = await _encrypt(encKey, plainBytes);
    const contentHash = await _sha256Hex(plainBytes, 12);
    const blobId      = 'obj-cas-imm-' + await _sha256Hex(blobCipher, 12);

    // 2. Upload blob
    await _putObject(apiBaseUrl, vaultId, keys.writeKey, blobId, blobCipher);

    // 3. Read current state (ref → commit → tree)
    let parentCommitIds = [];
    let currentEntries  = [];
    try {
        const refCipher  = await _fetchRaw(apiBaseUrl, vaultId, keys.refFileId);
        const refPlain   = await _decrypt(keys.readKey, refCipher);
        const refObj     = JSON.parse(new TextDecoder().decode(refPlain));
        const headId     = refObj.head || refObj.commit_id;
        if (headId) {
            parentCommitIds = [headId];
            const commitObj  = await _fetchDecryptJson(apiBaseUrl, vaultId, keys.readKey, headId);
            if (commitObj.tree_id) {
                const treeObj = await _fetchDecryptJson(apiBaseUrl, vaultId, keys.readKey, commitObj.tree_id);
                currentEntries = await _decryptEntries(treeObj.entries || [], keys.readKey);
            }
        }
    } catch {
        // Empty vault or first write — start fresh
    }

    // 4. Update entries (add or replace file)
    const updated = currentEntries.filter(e => e.name !== fileName);
    updated.push({ name: fileName, blob_id: blobId, size: plainBytes.byteLength, content_hash: contentHash });

    // 5. Create tree
    const encEntries = await _encryptEntries(updated, encKey);
    const treeCipher = await _encrypt(encKey, new TextEncoder().encode(
        JSON.stringify({ schema: 'tree_v1', entries: encEntries })
    ));
    const treeId = 'obj-cas-imm-' + await _sha256Hex(treeCipher, 12);
    await _putObject(apiBaseUrl, vaultId, keys.writeKey, treeId, treeCipher);

    // 6. Create commit
    const msgCipher  = await _encrypt(encKey, new TextEncoder().encode(message));
    const commitData = {
        schema:       'commit_v2',
        parents:      parentCommitIds,
        tree_id:      treeId,
        timestamp_ms: Date.now(),
        message_enc:  _toBase64(msgCipher),
        branch_id:    branchId,
        signature:    null,
    };
    const commitCipher = await _encrypt(encKey, new TextEncoder().encode(JSON.stringify(commitData)));
    const commitId     = 'obj-cas-imm-' + await _sha256Hex(commitCipher, 12);
    await _putObject(apiBaseUrl, vaultId, keys.writeKey, commitId, commitCipher);

    // 7. Update ref
    const refData   = { schema: 'ref_v1', head: commitId, branch_id: branchId };
    const refCipher = await _encrypt(encKey, new TextEncoder().encode(JSON.stringify(refData)));
    await _putRef(apiBaseUrl, vaultId, keys.writeKey, keys.refFileId, refCipher);

    return { commitId, treeId, blobId };
}

/**
 * Derive keys including an encrypt-capable readKey.
 * Use this instead of deriveVaultKeys() from sg-vault-client when you need
 * to write to the vault. Compatible with the same passphrase:vaultId format.
 *
 * @param {string} passphrase
 * @param {string} vaultId
 * @returns {Promise<{ readKey: CryptoKey, readKeyBytes: Uint8Array, writeKey: string, hmacKey: CryptoKey, refFileId: string, branchIndexFileId: string, vaultId: string }>}
 */
export async function deriveWriteKeys(passphrase, vaultId) {
    const enc       = new TextEncoder();
    const passBytes = enc.encode(passphrase);

    const keyMaterial = await crypto.subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits']);

    const readSalt  = enc.encode(`sg-vault-v1:${vaultId}`);
    const writeSalt = enc.encode(`sg-vault-v1:write:${vaultId}`);

    const [readBits, writeBits] = await Promise.all([
        crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: readSalt,  iterations: 600_000, hash: 'SHA-256' },
            keyMaterial, 256
        ),
        crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: writeSalt, iterations: 600_000, hash: 'SHA-256' },
            keyMaterial, 256
        ),
    ]);

    const readKeyBytes = new Uint8Array(readBits);

    const [readKey, hmacKey] = await Promise.all([
        crypto.subtle.importKey('raw', readKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
        crypto.subtle.importKey('raw', readKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    ]);

    const writeKey = _bytesToHex(new Uint8Array(writeBits));

    const [refHex, branchIndexHex] = await Promise.all([
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:ref:${vaultId}`),
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:branch-index:${vaultId}`),
    ]);

    return {
        readKey,
        readKeyBytes,
        writeKey,
        hmacKey,
        refFileId:         `ref-pid-muw-${refHex}`,
        branchIndexFileId: `idx-pid-muw-${branchIndexHex}`,
        vaultId,
    };
}

/**
 * Derive write keys from a simple token (word-word-NNNN format).
 * Uses 4-step PBKDF2 → HKDF derivation (matches sgit simple-token semantics).
 *
 * @param {string} token - Simple token string
 * @returns {Promise<object>} Same shape as deriveWriteKeys()
 */
export async function deriveWriteKeysFromSimpleToken(token) {
    const enc      = new TextEncoder();
    const tokenLow = token.toLowerCase().trim();

    // Step 1: PBKDF2 fixed salt → intermediate key
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(tokenLow), 'PBKDF2', false, ['deriveBits']);
    const aesKeyBits  = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode('sgraph-send-v1'), iterations: 600_000, hash: 'SHA-256' },
        keyMaterial, 256
    );

    // Steps 2+3: HKDF → read+write keys
    const hkdfKey = await crypto.subtle.importKey('raw', aesKeyBits, 'HKDF', false, ['deriveBits']);
    const [readBits, writeBits] = await Promise.all([
        crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vault-read-key') },
            hkdfKey, 256
        ),
        crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vault-write-key') },
            hkdfKey, 256
        ),
    ]);

    // Step 4: vault_id = SHA-256(token)[:12 hex chars]
    const hashBuf  = await crypto.subtle.digest('SHA-256', enc.encode(tokenLow));
    const vaultId  = _bytesToHex(new Uint8Array(hashBuf)).slice(0, 12);

    const readKeyBytes = new Uint8Array(readBits);
    const [readKey, hmacKey] = await Promise.all([
        crypto.subtle.importKey('raw', readKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
        crypto.subtle.importKey('raw', readKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    ]);
    const writeKey = _bytesToHex(new Uint8Array(writeBits));

    const [refHex, branchIndexHex] = await Promise.all([
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:ref:${vaultId}`),
        _hmacFileId(hmacKey, `sg-vault-v1:file-id:branch-index:${vaultId}`),
    ]);

    return {
        readKey,
        readKeyBytes,
        writeKey,
        hmacKey,
        vaultId,
        refFileId:         `ref-pid-muw-${refHex}`,
        branchIndexFileId: `idx-pid-muw-${branchIndexHex}`,
    };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Import raw key bytes as an AES-GCM key with encrypt+decrypt capability.
 * @param {Uint8Array} keyBytes
 * @returns {Promise<CryptoKey>}
 */
async function _importEncryptKey(keyBytes) {
    return crypto.subtle.importKey(
        'raw', keyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt data with AES-256-GCM. Returns IV (12 bytes) + ciphertext as Uint8Array.
 * @param {CryptoKey} key
 * @param {Uint8Array} plaintext
 * @returns {Promise<Uint8Array>}
 */
async function _encrypt(key, plaintext) {
    const iv         = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const result     = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ciphertext), IV_LENGTH);
    return result;
}

/**
 * Decrypt AES-256-GCM payload (IV prepended).
 * @param {CryptoKey} key
 * @param {ArrayBuffer|Uint8Array} encrypted
 * @returns {Promise<ArrayBuffer>}
 */
async function _decrypt(key, encrypted) {
    const data       = new Uint8Array(encrypted);
    const iv         = data.slice(0, IV_LENGTH);
    const ciphertext = data.slice(IV_LENGTH);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

/**
 * Compute SHA-256 hex digest (optionally truncated to hexLen chars).
 * @param {Uint8Array} bytes
 * @param {number} [hexLen] - truncate to this many hex chars
 * @returns {Promise<string>}
 */
async function _sha256Hex(bytes, hexLen) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    const hex = _bytesToHex(new Uint8Array(buf));
    return hexLen ? hex.slice(0, hexLen) : hex;
}

/**
 * Derive a 12-char hex file ID via HMAC-SHA256.
 * @param {CryptoKey} hmacKey
 * @param {string} input
 * @returns {Promise<string>}
 */
async function _hmacFileId(hmacKey, input) {
    const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(input));
    return _bytesToHex(new Uint8Array(sig)).slice(0, 12);
}

/**
 * Encode Uint8Array to base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function _toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

/**
 * Encrypt a single string field, returns base64(IV+ciphertext).
 * @param {CryptoKey} encKey
 * @param {string} value
 * @returns {Promise<string>}
 */
async function _encField(encKey, value) {
    if (value === null || value === undefined) return null;
    const cipher = await _encrypt(encKey, new TextEncoder().encode(String(value)));
    return _toBase64(cipher);
}

/**
 * Encrypt all entries for a tree_v1 object.
 * @param {Array<{name, blob_id, tree_id, size?, content_hash?}>} entries
 * @param {CryptoKey} encKey
 * @returns {Promise<Array>}
 */
async function _encryptEntries(entries, encKey) {
    return Promise.all(entries.map(async (entry) => {
        const result = {
            name_enc: await _encField(encKey, entry.name),
            blob_id:  entry.blob_id  || null,
            tree_id:  entry.tree_id  || null,
        };
        if (entry.blob_id) {
            result.size_enc         = await _encField(encKey, entry.size);
            result.content_hash_enc = await _encField(encKey, entry.content_hash);
        }
        return result;
    }));
}

/**
 * Decrypt tree entries (best-effort — skips fields that fail).
 * @param {Array} entries - Encrypted entry objects
 * @param {CryptoKey} readKey
 * @returns {Promise<Array<{name, blob_id, tree_id, size, content_hash}>>}
 */
async function _decryptEntries(entries, readKey) {
    return Promise.all(entries.map(async (entry) => {
        const dec = async (b64) => {
            if (!b64) return null;
            try {
                const raw   = _fromBase64(b64);
                const plain = await _decrypt(readKey, raw);
                return new TextDecoder().decode(plain);
            } catch { return null; }
        };
        return {
            name:         await dec(entry.name_enc),
            blob_id:      entry.blob_id  || null,
            tree_id:      entry.tree_id  || null,
            size:         Number(await dec(entry.size_enc)) || 0,
            content_hash: await dec(entry.content_hash_enc),
        };
    }));
}

function _fromBase64(b64) {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Fetch a raw file from the vault API (returns ArrayBuffer).
 * @param {string} apiBaseUrl
 * @param {string} vaultId
 * @param {string} fileId
 * @returns {Promise<ArrayBuffer>}
 */
async function _fetchRaw(apiBaseUrl, vaultId, fileId) {
    const path = fileIdToPath(fileId);
    const url  = `${apiBaseUrl}/api/vault/read/${vaultId}/${encodeURIComponent(path)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fetch ${fileId}: ${resp.status} ${resp.statusText}`);
    return resp.arrayBuffer();
}

/**
 * Fetch, decrypt and JSON-parse a vault object.
 * @param {string} apiBaseUrl
 * @param {string} vaultId
 * @param {CryptoKey} readKey
 * @param {string} fileId
 * @returns {Promise<object>}
 */
async function _fetchDecryptJson(apiBaseUrl, vaultId, readKey, fileId) {
    const encrypted = await _fetchRaw(apiBaseUrl, vaultId, fileId);
    const plain     = await _decrypt(readKey, encrypted);
    return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * PUT an object to the vault's content-addressed store.
 * Path: bare/data/{objectId}
 * @param {string} apiBaseUrl
 * @param {string} vaultId
 * @param {string} writeKey
 * @param {string} objectId  - self-describing ID (obj-cas-imm-{hex})
 * @param {Uint8Array} data  - encrypted bytes
 * @returns {Promise<void>}
 */
async function _putObject(apiBaseUrl, vaultId, writeKey, objectId, data) {
    const path = `bare/data/${objectId}`;
    const url  = `${apiBaseUrl}/api/vault/write/${vaultId}/${encodeURIComponent(path)}`;
    const resp = await fetch(url, {
        method:  'PUT',
        headers: { 'x-sgraph-vault-write-key': writeKey },
        body:    data,
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Write ${objectId}: ${resp.status} ${body || resp.statusText}`);
    }
}

/**
 * PUT a ref file (HEAD pointer) to the vault.
 * Path: bare/refs/{refFileId}
 * @param {string} apiBaseUrl
 * @param {string} vaultId
 * @param {string} writeKey
 * @param {string} refFileId - self-describing ID (ref-pid-muw-{hex})
 * @param {Uint8Array} data  - encrypted bytes
 * @returns {Promise<void>}
 */
async function _putRef(apiBaseUrl, vaultId, writeKey, refFileId, data) {
    const path = fileIdToPath(refFileId);
    const url  = `${apiBaseUrl}/api/vault/write/${vaultId}/${encodeURIComponent(path)}`;
    const resp = await fetch(url, {
        method:  'PUT',
        headers: { 'x-sgraph-vault-write-key': writeKey },
        body:    data,
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Write ref ${refFileId}: ${resp.status} ${body || resp.statusText}`);
    }
}

function _bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
