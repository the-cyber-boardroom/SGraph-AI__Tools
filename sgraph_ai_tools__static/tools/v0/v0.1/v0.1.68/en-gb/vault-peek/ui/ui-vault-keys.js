/**
 * ui-vault-keys — build a vault handle from demo config.
 *
 * Supports two input modes:
 *   1. vaultKey (passphrase:vaultId) — full key derivation via PBKDF2
 *   2. readKey + vaultId — reconstruct all file IDs from the read key bytes
 *
 * @module ui-vault-keys
 */

import {
    parseVaultKey,
    deriveVaultKeys,
    importReadKey,
    deriveFileIdHex,
    openVault,
    SALT_PREFIX,
} from '/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js'
import { formatFileId } from '/core/vault-client/v1/v1.2/v1.2.3/vault-id-utils.js'

/**
 * Decode a base64url string to Uint8Array.
 * @param {string} b64url
 * @returns {Uint8Array}
 */
function base64UrlToBytes(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

/**
 * Encode a Uint8Array to a base64url string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64Url(bytes) {
    const b64 = btoa(String.fromCharCode(...bytes))
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Build a vault handle from a demo config object.
 *
 * If config.vaultKey is set, derives keys from passphrase via PBKDF2.
 * Otherwise uses config.readKey (base64url) + config.vaultId directly,
 * reconstructing all deterministic file IDs via HMAC-SHA-256.
 *
 * @param {{ vaultKey?: string, readKey?: string, vaultId?: string, endpoint: string }} config
 * @returns {Promise<{ keys: object, apiBaseUrl: string, vaultId: string }>}
 */
export async function buildVaultHandle(config) {
    const apiBaseUrl = config.endpoint || 'https://send.sgraph.ai'

    if (config.vaultKey) {
        const { passphrase, vaultId } = parseVaultKey(config.vaultKey)
        const keys = await deriveVaultKeys(passphrase, vaultId)
        return openVault(keys, { apiBaseUrl })
    }

    // readKey + vaultId mode
    const { vaultId } = config
    const readKeyBytes = base64UrlToBytes(config.readKey)
    const readKey = await importReadKey(config.readKey)

    const [refHex, indexHex, branchIndexHex, settingsHex] = await Promise.all([
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:ref:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:index:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:branch-index:${vaultId}`),
        deriveFileIdHex(readKeyBytes, `${SALT_PREFIX}:file-id:settings:${vaultId}`),
    ])

    const keys = {
        vaultId,
        readKey,
        readKeyBytes,
        refFileId:          formatFileId('ref', 'pid', 'muw', refHex),
        indexFileId:         formatFileId('idx', 'pid', 'muw', indexHex),
        branchIndexFileId:  formatFileId('idx', 'pid', 'muw', branchIndexHex),
        settingsFileId:     formatFileId('idx', 'pid', 'muw', settingsHex),
    }

    return openVault(keys, { apiBaseUrl })
}
