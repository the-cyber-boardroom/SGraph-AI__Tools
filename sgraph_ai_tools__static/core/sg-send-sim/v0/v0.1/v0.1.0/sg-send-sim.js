/**
 * sg-send-sim — VFS-backed simulation of the SG/Send vault API.
 *
 * Creates simulated vaults in VFS that mirror the exact on-disk structure of
 * the real SG/Send vault: encrypted blobs in bare/data/, refs in bare/refs/.
 * Uses the same key derivation (PBKDF2-SHA-256 @ 600k), same AES-256-GCM wire
 * format, and the same self-describing object ID scheme as the real server.
 *
 * VFS layout:
 *   /vaults/{vaultId}/bare/data/{objectId}   ← encrypted blobs, trees, commits
 *   /vaults/{vaultId}/bare/refs/{refFileId}  ← HEAD ref
 *   /vaults/{vaultId}/bare/keys/{keyFileId}  ← key objects (future)
 *
 * Public API:
 *   generateVaultId()                          → random 8-char vault ID
 *   createSimVault(vfs, passphrase, vaultId)   → SimVault handle
 *   writeSimFile(simVault, path, content, opts) → { blobId, treeId, commitId }
 *   readSimFile(simVault, fileId)              → ArrayBuffer (decrypted)
 *   readSimFileAsJson(simVault, fileId)        → object
 *   getSimHead(simVault)                       → ref object | null
 *   listSimObjects(simVault, prefix)           → string[] of VFS paths
 *   decryptSimEntry(simVault, encHex)          → string (decrypted entry field)
 *
 * @module sg-send-sim
 * @version 0.1.0
 */

import {
    deriveVaultKeys,
    formatFileId,
    fileIdToPath,
    IV_LENGTH,
    SALT_PREFIX,
} from '/core/vault-client/v1/v1.1/v1.1.0/sg-vault-client.js';

/** VFS root for all simulated vaults */
export const SIM_VFS_ROOT = '/vaults';

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * SHA-256 hash → lowercase hex (first `chars` characters).
 *
 * @param {Uint8Array|ArrayBuffer} data
 * @param {number} [chars=12]
 * @returns {Promise<string>}
 */
async function sha256Hex(data, chars = 12) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const hash  = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, chars);
}

/**
 * AES-256-GCM encrypt. Returns IV (12 bytes) + ciphertext as Uint8Array.
 *
 * @param {CryptoKey} encKey
 * @param {Uint8Array} plainBytes
 * @returns {Promise<Uint8Array>}
 */
async function encrypt(encKey, plainBytes) {
    const iv     = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, plainBytes);
    const out    = new Uint8Array(IV_LENGTH + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), IV_LENGTH);
    return out;
}

/**
 * AES-256-GCM decrypt. Expects IV (12 bytes) prepended to ciphertext.
 *
 * @param {CryptoKey} readKey
 * @param {Uint8Array} encryptedBytes
 * @returns {Promise<ArrayBuffer>}
 */
async function decrypt(readKey, encryptedBytes) {
    const iv     = encryptedBytes.slice(0, IV_LENGTH);
    const cipher = encryptedBytes.slice(IV_LENGTH);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, readKey, cipher);
}

/**
 * Encrypt a JS object as JSON then as AES-256-GCM.
 *
 * @param {CryptoKey} encKey
 * @param {object} obj
 * @returns {Promise<Uint8Array>}
 */
async function encryptJson(encKey, obj) {
    return encrypt(encKey, new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * Import raw key bytes as an AES-256-GCM encrypt key.
 *
 * @param {Uint8Array} keyBytes
 * @returns {Promise<CryptoKey>}
 */
async function importEncryptKey(keyBytes) {
    return crypto.subtle.importKey(
        'raw', keyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
    );
}

/**
 * Convert Uint8Array → lowercase hex string.
 *
 * @param {Uint8Array} arr
 * @returns {string}
 */
function toHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert lowercase hex string → Uint8Array.
 *
 * @param {string} hex
 * @returns {Uint8Array}
 */
function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Compute the VFS path for a vault object.
 *
 * @param {string} vaultId
 * @param {string} fileId — self-describing ID or bare/ path
 * @returns {string}
 */
function vfsObjectPath(vaultId, fileId) {
    return `${SIM_VFS_ROOT}/${vaultId}/${fileIdToPath(fileId)}`;
}

/**
 * Read raw bytes (stored as hex) from VFS.
 *
 * @param {import('/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js').VirtualFileSystem} vfs
 * @param {string} vaultId
 * @param {string} fileId
 * @returns {Promise<Uint8Array>}
 */
async function readRawObject(vfs, vaultId, fileId) {
    const hexStr = await vfs.readFile(vfsObjectPath(vaultId, fileId));
    return fromHex(typeof hexStr === 'string' ? hexStr : new TextDecoder().decode(hexStr));
}

/**
 * Write raw bytes (as hex) to VFS, auto-creating parent folders.
 *
 * @param {import('/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js').VirtualFileSystem} vfs
 * @param {string} vaultId
 * @param {string} fileId
 * @param {Uint8Array} cipherBytes
 */
async function writeRawObject(vfs, vaultId, fileId, cipherBytes) {
    const path   = vfsObjectPath(vaultId, fileId);
    const parts  = path.split('/').filter(Boolean);
    // mkdir -p for all ancestor segments
    for (let i = 1; i < parts.length; i++) {
        await vfs.createFolder('/' + parts.slice(0, i).join('/')).catch(() => {});
    }
    await vfs.writeFile(path, toHex(cipherBytes));
}

/**
 * Read and decrypt an object, returning parsed JSON.
 *
 * @param {import('/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js').VirtualFileSystem} vfs
 * @param {CryptoKey} readKey
 * @param {string} vaultId
 * @param {string} fileId
 * @returns {Promise<object>}
 */
async function readDecryptJson(vfs, readKey, vaultId, fileId) {
    const cipher = await readRawObject(vfs, vaultId, fileId);
    const plain  = await decrypt(readKey, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a random vault ID (8 lowercase alphanumeric characters).
 *
 * @returns {string}
 */
export function generateVaultId() {
    const chars  = '0123456789abcdefghijklmnopqrstuvwxyz';
    const buf    = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(buf).map(b => chars[b % chars.length]).join('');
}

/**
 * Create (or open) a simulated vault backed by VFS.
 * Derives vault keys (PBKDF2 @ 600k, identical to real SG/Send),
 * creates the bare/ folder hierarchy, and returns a SimVault handle.
 *
 * The returned handle is an opaque object — pass it to the other functions.
 *
 * @param {import('/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js').VirtualFileSystem} vfs
 * @param {string} passphrase
 * @param {string} vaultId — must be 8 lowercase alphanumeric chars
 * @returns {Promise<SimVault>}
 */
export async function createSimVault(vfs, passphrase, vaultId) {
    if (!/^[0-9a-z]{8}$/.test(vaultId)) {
        throw new Error(`vaultId must be 8 lowercase alphanumeric chars, got: "${vaultId}"`);
    }

    const keys   = await deriveVaultKeys(passphrase, vaultId);
    const encKey = await importEncryptKey(keys.readKeyBytes);

    // Create VFS folder structure (mkdir -p equivalent)
    const root = `${SIM_VFS_ROOT}/${vaultId}`;
    for (const p of [
        SIM_VFS_ROOT,
        root,
        `${root}/bare`,
        `${root}/bare/data`,
        `${root}/bare/refs`,
        `${root}/bare/keys`,
    ]) {
        await vfs.createFolder(p).catch(() => {});
    }

    return { vfs, keys, encKey, vaultId };
}

/**
 * Alias for createSimVault — opening an existing vault uses the same flow.
 *
 * @param {import('/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js').VirtualFileSystem} vfs
 * @param {string} passphrase
 * @param {string} vaultId
 * @returns {Promise<SimVault>}
 */
export const openSimVault = createSimVault;

/**
 * Write a file to the simulated vault (full commit cycle).
 *
 * Mirrors the real sg-vault-write.js flow:
 *   1. Encrypt the blob content (AES-256-GCM)
 *   2. Store blob as obj-cas-imm-{sha256[:12]}
 *   3. Read current HEAD ref → current tree entries
 *   4. Update tree entries (add/replace filename)
 *   5. Encrypt and store tree_v1 object
 *   6. Encrypt and store commit_v2 object
 *   7. Update ref (HEAD pointer)
 *
 * @param {SimVault} simVault — handle from createSimVault
 * @param {string} filePath — e.g. 'docs/readme.md' (filename used as tree entry)
 * @param {string|Uint8Array} content — file content
 * @param {object} [options]
 * @param {string} [options.message] — commit message
 * @param {string} [options.branchId] — branch ID (default: 'main')
 * @returns {Promise<{ blobId: string, treeId: string, commitId: string, refFileId: string }>}
 */
export async function writeSimFile(simVault, filePath, content, options = {}) {
    const { vfs, keys, encKey, vaultId } = simVault;
    const fileName = filePath.split('/').filter(Boolean).pop() || filePath;
    const message  = options.message  ?? `Update ${fileName}`;
    const branchId = options.branchId ?? 'main';

    const plainBytes = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content;

    // ── Step 1: Encrypt blob ───────────────────────────────────────────────
    const blobCipher = await encrypt(encKey, plainBytes);
    const blobId     = 'obj-cas-imm-' + await sha256Hex(blobCipher);

    // ── Step 2: Store blob ─────────────────────────────────────────────────
    await writeRawObject(vfs, vaultId, blobId, blobCipher);

    // ── Step 3: Read current state ────────────────────────────────────────
    let parentCommitIds = [];
    let currentEntries  = [];
    try {
        const refObj = await readDecryptJson(vfs, keys.readKey, vaultId, keys.refFileId);
        const headId = refObj.head || refObj.commit_id;
        if (headId) {
            parentCommitIds = [headId];
            const commitObj = await readDecryptJson(vfs, keys.readKey, vaultId, headId);
            if (commitObj.tree_id) {
                const treeObj = await readDecryptJson(vfs, keys.readKey, vaultId, commitObj.tree_id);
                // Decrypt each entry's name_enc field
                for (const e of (treeObj.entries || [])) {
                    const nameBytes = await decrypt(keys.readKey, fromHex(e.name_enc));
                    currentEntries.push({
                        name:    new TextDecoder().decode(nameBytes),
                        blob_id: e.blob_id,
                        size:    e.size,
                    });
                }
            }
        }
    } catch {
        // Empty vault — start fresh
    }

    // ── Step 4: Update entries (add/replace) ──────────────────────────────
    const updated = currentEntries.filter(e => e.name !== fileName);
    updated.push({ name: fileName, blob_id: blobId, size: plainBytes.byteLength });

    // ── Step 5: Encrypt tree ──────────────────────────────────────────────
    const encEntries = await Promise.all(updated.map(async e => {
        const nameCipher = await encrypt(encKey, new TextEncoder().encode(e.name));
        return { name_enc: toHex(nameCipher), blob_id: e.blob_id, size: e.size };
    }));

    const treeObj    = { schema: 'tree_v1', entries: encEntries };
    const treeCipher = await encryptJson(encKey, treeObj);
    const treeId     = 'obj-cas-imm-' + await sha256Hex(treeCipher);
    await writeRawObject(vfs, vaultId, treeId, treeCipher);

    // ── Step 6: Encrypt commit ────────────────────────────────────────────
    const msgCipher = await encrypt(encKey, new TextEncoder().encode(message));
    const commitObj = {
        schema:       'commit_v2',
        parents:      parentCommitIds,
        tree_id:      treeId,
        timestamp_ms: Date.now(),
        message_enc:  toHex(msgCipher),
        branch_id:    branchId,
    };
    const commitCipher = await encryptJson(encKey, commitObj);
    const commitId     = 'obj-cas-imm-' + await sha256Hex(commitCipher);
    await writeRawObject(vfs, vaultId, commitId, commitCipher);

    // ── Step 7: Update ref ────────────────────────────────────────────────
    const refObj    = { schema: 'ref_v1', head: commitId, branch_id: branchId };
    const refCipher = await encryptJson(encKey, refObj);
    await writeRawObject(vfs, vaultId, keys.refFileId, refCipher);

    return { blobId, treeId, commitId, refFileId: keys.refFileId };
}

/**
 * Read and decrypt a vault object by its file ID.
 *
 * @param {SimVault} simVault
 * @param {string} fileId — self-describing ID or bare/ path
 * @returns {Promise<ArrayBuffer>} Decrypted content
 */
export async function readSimFile(simVault, fileId) {
    const { vfs, keys, vaultId } = simVault;
    const cipher = await readRawObject(vfs, vaultId, fileId);
    return decrypt(keys.readKey, cipher);
}

/**
 * Read, decrypt, and JSON-parse a vault object.
 *
 * @param {SimVault} simVault
 * @param {string} fileId
 * @returns {Promise<object>}
 */
export async function readSimFileAsJson(simVault, fileId) {
    const data = await readSimFile(simVault, fileId);
    return JSON.parse(new TextDecoder().decode(data));
}

/**
 * Get the current HEAD ref object (or null if vault is empty).
 *
 * @param {SimVault} simVault
 * @returns {Promise<{ schema: string, head: string, branch_id: string } | null>}
 */
export async function getSimHead(simVault) {
    const { vfs, keys, vaultId } = simVault;
    try {
        return await readDecryptJson(vfs, keys.readKey, vaultId, keys.refFileId);
    } catch {
        return null;
    }
}

/**
 * Get the full commit chain from HEAD back to the root commit.
 *
 * @param {SimVault} simVault
 * @returns {Promise<Array<{ id: string, obj: object }>>} Commits newest-first
 */
export async function getSimCommitLog(simVault) {
    const { vfs, keys, vaultId } = simVault;
    const commits = [];
    try {
        const ref    = await readDecryptJson(vfs, keys.readKey, vaultId, keys.refFileId);
        let   headId = ref.head || ref.commit_id;
        const seen   = new Set();
        while (headId && !seen.has(headId)) {
            seen.add(headId);
            const obj = await readDecryptJson(vfs, keys.readKey, vaultId, headId);
            const msgBytes = obj.message_enc
                ? await decrypt(keys.readKey, fromHex(obj.message_enc)).catch(() => null)
                : null;
            commits.push({
                id:      headId,
                obj,
                message: msgBytes ? new TextDecoder().decode(msgBytes) : '(no message)',
            });
            headId = (obj.parents || [])[0] || null;
        }
    } catch { /* empty vault */ }
    return commits;
}

/**
 * List all object paths stored for a vault.
 *
 * @param {SimVault} simVault
 * @param {string} [prefix=''] — optional prefix filter on bare/ path
 * @returns {Promise<string[]>} VFS paths
 */
export async function listSimObjects(simVault, prefix = '') {
    const { vfs, vaultId } = simVault;
    const results = [];
    await _walkFolder(vfs, `${SIM_VFS_ROOT}/${vaultId}/bare`, results);
    if (!prefix) return results;
    const fullPrefix = `${SIM_VFS_ROOT}/${vaultId}/${prefix}`;
    return results.filter(p => p.startsWith(fullPrefix));
}

/**
 * Decrypt an encrypted entry field (hex-encoded IV+ciphertext → plaintext string).
 * Useful for decoding name_enc / message_enc fields from tree/commit objects.
 *
 * @param {SimVault} simVault
 * @param {string} encHex — hex-encoded encrypted field
 * @returns {Promise<string>}
 */
export async function decryptSimEntry(simVault, encHex) {
    const plain = await decrypt(simVault.keys.readKey, fromHex(encHex));
    return new TextDecoder().decode(plain);
}

/**
 * Get a human-readable summary of the vault state.
 *
 * @param {SimVault} simVault
 * @returns {Promise<{
 *   isEmpty: boolean,
 *   headCommitId: string | null,
 *   fileCount: number,
 *   files: Array<{ name: string, blob_id: string, size: number }>,
 *   branchId: string
 * }>}
 */
export async function getSimVaultState(simVault) {
    const { vfs, keys, vaultId } = simVault;
    try {
        const ref    = await readDecryptJson(vfs, keys.readKey, vaultId, keys.refFileId);
        const headId = ref.head || ref.commit_id;
        if (!headId) return { isEmpty: true, headCommitId: null, fileCount: 0, files: [], branchId: ref.branch_id || 'main' };

        const commit = await readDecryptJson(vfs, keys.readKey, vaultId, headId);
        const tree   = commit.tree_id
            ? await readDecryptJson(vfs, keys.readKey, vaultId, commit.tree_id)
            : { entries: [] };

        const files = await Promise.all((tree.entries || []).map(async e => {
            const nameBytes = await decrypt(keys.readKey, fromHex(e.name_enc)).catch(() => null);
            return {
                name:    nameBytes ? new TextDecoder().decode(nameBytes) : '(encrypted)',
                blob_id: e.blob_id,
                size:    e.size,
            };
        }));

        return {
            isEmpty:      false,
            headCommitId: headId,
            fileCount:    files.length,
            files,
            branchId:     ref.branch_id || 'main',
        };
    } catch {
        return { isEmpty: true, headCommitId: null, fileCount: 0, files: [], branchId: 'main' };
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Recursively walk a VFS folder, collecting all file paths.
 *
 * @param {import('/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js').VirtualFileSystem} vfs
 * @param {string} folderPath
 * @param {string[]} results
 */
async function _walkFolder(vfs, folderPath, results) {
    const entries = await vfs.listFolder(folderPath).catch(() => []);
    for (const e of entries) {
        if (e.type === 'folder') {
            await _walkFolder(vfs, e.path, results);
        } else {
            results.push(e.path);
        }
    }
}

/**
 * @typedef {object} SimVault
 * @property {import('/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js').VirtualFileSystem} vfs
 * @property {object} keys — output of deriveVaultKeys()
 * @property {CryptoKey} encKey — AES-GCM encrypt key
 * @property {string} vaultId
 */
