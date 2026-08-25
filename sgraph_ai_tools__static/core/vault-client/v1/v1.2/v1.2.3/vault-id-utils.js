/* =============================================================================
   SGraph — Vault ID Utilities
   v1.2.3 — Self-describing file ID helpers

   Changes from v1.2.1/v1.2.2:
     - idx-* now resolves to bare/indexes/ — where sgit actually writes branch
       indexes (BARE_INDEXES = 'indexes', sgit_ai/storage/Vault__Storage.py).
       v1.2.1 moved it to bare/idx/ to match a vault-team tech-ref that
       disagrees with the CLI; every read of a CLI-written index 404'd as a
       result. v1.1.0 and v1.2.0 had it right. No browser module has ever
       WRITTEN an index, so nothing is orphaned by moving it back.
     - stripKeyPrefix(): mirrors sgit's strip_key_prefix(), so a key pasted
       exactly as sgit prints it derives the same material here as it does
       there.

   Provides parsing, formatting, and routing for the self-describing ID format:
     {type}-{derivation}-{mutability}-{hex}

   Type prefixes:
     obj — content-addressed object (blob, commit, tree)
     ref — mutable reference (branch head pointer)
     key — random key object (PKI keys)
     idx — mutable index (branch index)

   Derivation:
     cas — content-addressed (SHA-256 of content)
     pid — passphrase-id derived (HMAC of vault passphrase)
     rnd — random (crypto.getRandomValues)

   Mutability:
     imm — immutable (content-addressed, never changes)
     muw — mutable-write (can be updated by write-key holder)
     snw — single-writer (clone/session ref, one writer at a time)

   Usage:
     import { parseFileId, formatFileId, fileIdToPath, shortId, looksLikeRef } from './vault-id-utils.js';
   ============================================================================= */

/**
 * @type {string[]} Self-identifying prefixes sgit stamps onto credentials.
 * The value AFTER the prefix is byte-identical to the historical bare key, so
 * stripping is the only thing needed to stay wire-compatible.
 */
export const SGIT_KEY_PREFIXES = Object.freeze([
    'sgit_private_vault_',   // read AND write capability
    'sgit_private_read_',    // read-only, secret
    'sgit_public_read_',     // read-only, deliberately published
    'sgit_vk1_',             // legacy, accepted forever, never emitted again
    'sgit_rk1_',             // legacy
])

/**
 * Remove a self-identifying sgit key prefix, if present.
 *
 * Mirrors strip_key_prefix() in sgit_ai/crypto/Vault__Crypto.py — the single
 * normalisation point for key input, so no caller has to know the prefix list.
 * A key with no prefix (every key minted before sgit started stamping them, and
 * every browser-minted key) passes through untouched.
 *
 * @param {string} key — a vault key, read key, or bare passphrase
 * @returns {string} The same string with any known sgit prefix removed
 */
export function stripKeyPrefix(key) {
    key = (key || '').trim()
    for (const prefix of SGIT_KEY_PREFIXES) {
        if (key.startsWith(prefix)) return key.slice(prefix.length)
    }
    return key
}

/** @type {Set<string>} Valid type prefixes */
const VALID_TYPES = new Set(['obj', 'ref', 'key', 'idx'])

/** @type {Set<string>} Valid derivation methods */
const VALID_DERIVATIONS = new Set(['cas', 'pid', 'rnd'])

/** @type {Set<string>} Valid mutability flags */
const VALID_MUTABILITIES = new Set(['imm', 'muw', 'snw'])

/** @type {Object<string, string>} Type prefix to bare/ path segment mapping */
const TYPE_TO_PATH = {
    obj: 'bare/data',
    ref: 'bare/refs',
    key: 'bare/keys',
    idx: 'bare/indexes'
}

/**
 * Parse a self-describing file ID into its components.
 *
 * @param {string} id — e.g. "ref-pid-muw-a1b2c3d4e5f6"
 * @returns {{ type: string, derivation: string, mutability: string, hex: string } | null}
 *   Returns null if the ID does not match the self-describing format.
 */
export function parseFileId(id) {
    if (!id || typeof id !== 'string') return null

    const parts = id.split('-')
    if (parts.length < 4) return null

    const type       = parts[0]
    const derivation = parts[1]
    const mutability = parts[2]
    const hex        = parts.slice(3).join('-')  // hex portion may not contain dashes but be safe

    if (!VALID_TYPES.has(type)) return null
    if (!VALID_DERIVATIONS.has(derivation)) return null
    if (!VALID_MUTABILITIES.has(mutability)) return null
    if (!hex) return null

    return { type, derivation, mutability, hex }
}

/**
 * Format a self-describing file ID from components.
 *
 * @param {string} type — 'obj', 'ref', 'key', or 'idx'
 * @param {string} derivation — 'cas', 'pid', or 'rnd'
 * @param {string} mutability — 'imm' or 'muw'
 * @param {string} hex — hex string portion
 * @returns {string} e.g. "ref-pid-muw-a1b2c3d4e5f6"
 */
export function formatFileId(type, derivation, mutability, hex) {
    return `${type}-${derivation}-${mutability}-${hex}`
}

/**
 * Convert a self-describing file ID (or legacy ID) to its API storage path.
 *
 * @param {string} val — a self-describing ID or legacy bare/ path
 * @returns {string} Full path like "bare/data/obj-cas-imm-abc123"
 */
export function fileIdToPath(val) {
    if (!val) return val
    if (val.startsWith('bare/')) return val

    const parsed = parseFileId(val)
    if (parsed) {
        const pathSegment = TYPE_TO_PATH[parsed.type]
        return `${pathSegment}/${val}`
    }

    // Legacy fallback: try common prefixes
    if (val.startsWith('obj-'))            return `bare/data/${val}`
    if (val.startsWith('ref-'))            return `bare/refs/${val}`
    if (val.startsWith('key-'))            return `bare/keys/${val}`
    if (val.startsWith('idx-'))            return `bare/indexes/${val}`

    // Default: assume data object
    return `bare/data/${val}`
}

/**
 * Check if a string value looks like a vault object reference.
 *
 * @param {string} val — string to check
 * @returns {boolean}
 */
export function looksLikeRef(val) {
    if (!val || typeof val !== 'string') return false
    return /^(obj-|ref-|key-|idx-|bare\/)/.test(val)
}

/**
 * Produce a short display-friendly version of a file ID.
 * Preserves the type prefix and shows truncated hex.
 *
 * @param {string} id — full file ID
 * @param {number} [maxLen=24] — maximum output length
 * @returns {string} e.g. "ref-pid-muw-a1b2c3.."
 */
export function shortId(id, maxLen = 24) {
    if (!id) return ''
    // Strip bare/ path prefix if present
    const parts = id.split('/')
    const name  = parts[parts.length - 1]
    if (name.length <= maxLen) return name
    return name.slice(0, maxLen - 2) + '..'
}

/**
 * Decrypt an individual encrypted metadata field.
 * Encrypted fields use the same AES-256-GCM format as file payloads:
 * base64(IV + ciphertext).
 *
 * @param {CryptoKey} readKey — AES-GCM decryption key
 * @param {string} encryptedBase64 — base64-encoded IV + ciphertext
 * @returns {Promise<string>} Decrypted UTF-8 string
 */
export async function decryptField(readKey, encryptedBase64) {
    const IV_LENGTH = 12
    const raw   = base64ToBytes(encryptedBase64)
    const iv    = raw.slice(0, IV_LENGTH)
    const ct    = raw.slice(IV_LENGTH)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, readKey, ct)
    return new TextDecoder().decode(plain)
}

/**
 * Decrypt all *_enc fields in a JSON object in-place, adding the
 * decrypted value under the un-suffixed key.
 * e.g. { message_enc: "..." } => { message_enc: "...", message: "decrypted text" }
 *
 * @param {object} obj — parsed JSON object
 * @param {CryptoKey} readKey — AES-GCM decryption key
 * @returns {Promise<object>} Same object with decrypted fields added
 */
export async function decryptEncFields(obj, readKey) {
    if (!obj || typeof obj !== 'object') return obj

    try {
        const promises = []

        for (const key of Object.keys(obj)) {
            if (key.endsWith('_enc') && typeof obj[key] === 'string') {
                const plainKey = key.slice(0, -4)  // remove _enc suffix
                promises.push(
                    decryptField(readKey, obj[key])
                        .then(val => {
                            // Try to parse as number for size fields
                            if (plainKey === 'size') {
                                const n = Number(val)
                                obj[plainKey] = Number.isFinite(n) ? n : val
                            } else {
                                obj[plainKey] = val
                            }
                        })
                        .catch(err => {
                            console.warn(`decryptEncFields: failed to decrypt ${key}:`, err)
                            obj[plainKey] = `[decrypt failed]`
                        })
                )
            }
        }

        // Recurse into entries arrays (tree objects)
        if (Array.isArray(obj.entries)) {
            for (const entry of obj.entries) {
                promises.push(decryptEncFields(entry, readKey))
            }
        }

        // Recurse into branches arrays (branch index)
        if (Array.isArray(obj.branches)) {
            for (const branch of obj.branches) {
                promises.push(decryptEncFields(branch, readKey))
            }
        }

        await Promise.all(promises)
    } catch (err) {
        console.warn('decryptEncFields: unexpected error:', err)
    }
    return obj
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string to Uint8Array.
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
