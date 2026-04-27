/**
 * Frozen event-name constants for <sg-vault-manifest>.
 *
 * @module events
 */

/** @type {Readonly<{MANIFEST_LOADED: string, MANIFEST_ERROR: string, SLOT_READY: string}>} */
export const SGVM_EVENTS = Object.freeze({
    MANIFEST_LOADED: 'sg-vault-manifest:manifest-loaded',
    MANIFEST_ERROR:  'sg-vault-manifest:manifest-error',
    SLOT_READY:      'sg-vault-manifest:slot-ready',
})
