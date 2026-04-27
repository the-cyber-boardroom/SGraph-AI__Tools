/**
 * Frozen event-name constants for <sg-vault-key>.
 *
 * @module events
 */

/** @type {Readonly<{KEY_READY: string, KEY_ERROR: string}>} */
export const SGVK_EVENTS = Object.freeze({
    KEY_READY: 'sg-vault-key:key-ready',
    KEY_ERROR: 'sg-vault-key:key-error',
})
