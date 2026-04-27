/**
 * <sg-vault-manifest> — slot manifest loader.
 *
 * Loads a manifest JSON file from a URL, validates its schema, and emits
 * one slot-ready event per slot. Rejects any manifest that contains a
 * write_key field anywhere in the document.
 *
 * Attributes:
 *   src       — URL of the manifest JSON (required)
 *   vault-id  — Vault ID fallback if not in manifest (required)
 *   read-key  — base64url read key fallback if not in manifest (required)
 *
 * Events:
 *   sg-vault-manifest:manifest-loaded — { src, slotCount }
 *   sg-vault-manifest:manifest-error  — { src, error }
 *   sg-vault-manifest:slot-ready      — { slotName, objectId, render, vaultId, readKey }
 *
 * @module sg-vault-manifest
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'
import { SGVM_EVENTS } from './events.js'

const WRITE_KEY_ERROR = 'Manifest validation error: write_key is forbidden in manifests.'
const VALID_RENDER_TYPES = new Set(['markdown', 'image', 'json'])

class SgVaultManifest extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-vault-manifest' }

    async onReady() {
        const src     = this.getAttribute('src')
        const vaultId = this.getAttribute('vault-id') || ''
        const readKey = this.getAttribute('read-key') || ''

        if (!src) {
            this.#emitError(src || '', 'sg-vault-manifest: src attribute is required')
            return
        }

        await this.#loadManifest(src, vaultId, readKey)
    }

    /**
     * Fetch and process the manifest.
     * @param {string} src
     * @param {string} fallbackVaultId
     * @param {string} fallbackReadKey
     */
    async #loadManifest(src, fallbackVaultId, fallbackReadKey) {
        let manifest
        try {
            const response = await fetch(src)
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`)
            }
            manifest = await response.json()
        } catch (err) {
            this.#emitError(src, `Failed to load manifest: ${err.message}`)
            return
        }

        // Schema validation
        const validationError = this.#validate(manifest)
        if (validationError) {
            this.#emitError(src, validationError)
            return
        }

        const slots    = manifest.slots
        const vaultId  = manifest.vault_id || fallbackVaultId
        const readKey  = manifest.read_key  || fallbackReadKey
        const slotNames = Object.keys(slots)

        this.emit(SGVM_EVENTS.MANIFEST_LOADED, { src, slotCount: slotNames.length })

        for (const slotName of slotNames) {
            const slot = slots[slotName]

            // Warn on unknown fields (forward compatibility)
            const knownFields = new Set(['object_id', 'render'])
            for (const field of Object.keys(slot)) {
                if (!knownFields.has(field)) {
                    console.warn(`[sg-vault-manifest] Unknown field "${field}" in slot "${slotName}" (ignored)`)
                }
            }

            this.emit(SGVM_EVENTS.SLOT_READY, {
                slotName,
                objectId: slot.object_id,
                render:   slot.render,
                vaultId,
                readKey,
            })
        }
    }

    /**
     * Validate the manifest JSON against the v1 schema.
     * Returns an error string or null if valid.
     * @param {unknown} manifest
     * @returns {string|null}
     */
    #validate(manifest) {
        if (!manifest || typeof manifest !== 'object') {
            return 'Manifest must be a JSON object'
        }

        // write_key check — recursive, anywhere in the document
        if (this.#containsWriteKey(manifest)) {
            return WRITE_KEY_ERROR
        }

        if (manifest.version !== '1.0') {
            return `Manifest version "${manifest.version}" is not supported. Expected "1.0".`
        }

        if (!manifest.slots || typeof manifest.slots !== 'object' || Array.isArray(manifest.slots)) {
            return 'Manifest must have a "slots" object'
        }

        for (const [name, slot] of Object.entries(manifest.slots)) {
            if (!slot.object_id || typeof slot.object_id !== 'string') {
                return `Slot "${name}" missing required "object_id" string`
            }
            if (!slot.object_id.startsWith('obj-cas-imm-')) {
                return `Slot "${name}" object_id must start with "obj-cas-imm-"`
            }
            if (!VALID_RENDER_TYPES.has(slot.render)) {
                return `Slot "${name}" has invalid render type "${slot.render}". Expected markdown, image, or json.`
            }
        }

        return null
    }

    /**
     * Recursively check whether any key named 'write_key' exists in the object.
     * @param {unknown} value
     * @returns {boolean}
     */
    #containsWriteKey(value) {
        if (!value || typeof value !== 'object') return false
        for (const key of Object.keys(value)) {
            if (key === 'write_key') return true
            if (typeof value[key] === 'object' && this.#containsWriteKey(value[key])) return true
        }
        return false
    }

    /**
     * Emit a manifest-error event and show user-visible error.
     * @param {string} src
     * @param {string} error
     */
    #emitError(src, error) {
        this.emit(SGVM_EVENTS.MANIFEST_ERROR, { src: src || '', error })
        this.showError(error)
    }
}

if (!customElements.get('sg-vault-manifest')) {
    customElements.define('sg-vault-manifest', SgVaultManifest)
}

export { SgVaultManifest }
