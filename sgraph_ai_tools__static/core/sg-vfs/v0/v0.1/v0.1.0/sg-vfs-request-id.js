/**
 * sg-vfs-request-id — Unique request ID generation for VFS operations.
 *
 * Each VFS operation gets a short, readable, unique ID used to correlate
 * request and response events. IDs are intentionally short (readable in logs)
 * and monotonically increasing within a page session.
 *
 * Format: `vfs-{counter}-{4 random hex chars}`
 * Example: `vfs-0001-a3f9`
 *
 * @module sg-vfs-request-id
 * @version 0.1.0
 */

let _counter = 0;

/**
 * Generate a unique VFS request ID.
 *
 * @returns {string}
 */
export function newRequestId() {
    _counter += 1;
    const count = String(_counter).padStart(4, '0');
    const rand  = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return `vfs-${count}-${rand}`;
}

/**
 * Return the current monotonic counter (useful for debugging / display).
 *
 * @returns {number}
 */
export function requestCount() {
    return _counter;
}
