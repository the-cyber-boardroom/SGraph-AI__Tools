/**
 * Frozen event-name constants for <sg-vault-fetch>.
 *
 * @module events
 */

/** @type {Readonly<{FETCH_STARTED: string, FETCH_COMPLETED: string, DECRYPT_STARTED: string, DECRYPT_COMPLETED: string, CONTENT_READY: string, FETCH_ERROR: string}>} */
export const SGVF_EVENTS = Object.freeze({
    FETCH_STARTED:     'sg-vault-fetch:fetch-started',
    FETCH_COMPLETED:   'sg-vault-fetch:fetch-completed',
    DECRYPT_STARTED:   'sg-vault-fetch:decrypt-started',
    DECRYPT_COMPLETED: 'sg-vault-fetch:decrypt-completed',
    CONTENT_READY:     'sg-vault-fetch:content-ready',
    FETCH_ERROR:       'sg-vault-fetch:fetch-error',
})
