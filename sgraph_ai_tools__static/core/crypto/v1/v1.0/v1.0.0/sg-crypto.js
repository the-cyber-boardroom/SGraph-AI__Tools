/* =============================================================================
   SGraph Crypto — Client-Side Encryption Module
   v1.0.0 — Extracted from SG/Send (v0.2.0), converted to ES module

   AES-256-GCM via Web Crypto API. All encryption and decryption happens
   in the browser. The key never leaves the user's device.

   Usage:
     import { generateKey, exportKey, importKey, encryptFile, decryptFile } from './sg-crypto.js';

     const key       = await generateKey();
     const keyStr    = await exportKey(key);
     const imported  = await importKey(keyStr);
     const encrypted = await encryptFile(key, plaintext);
     const decrypted = await decryptFile(key, encrypted);
   ============================================================================= */

/** @type {string} Algorithm used for encryption */
export const ALGORITHM  = 'AES-GCM';

/** @type {number} Key length in bits */
export const KEY_LENGTH = 256;

/** @type {number} Initialisation vector length in bytes */
export const IV_LENGTH  = 12;

/**
 * Check whether the Web Crypto API is available.
 * @returns {boolean} True if Web Crypto is available
 */
export function isAvailable() {
    return !!(globalThis.crypto && globalThis.crypto.subtle);
}

/**
 * Throw if Web Crypto API is not available (requires secure context).
 * @throws {Error} If Web Crypto is not available
 */
export function requireSecureContext() {
    if (!isAvailable()) {
        throw new Error(
            'Web Crypto API is not available. ' +
            'It requires a secure context (HTTPS or localhost). ' +
            'If running locally, use "localhost" instead of "127.0.0.1".'
        );
    }
}

/**
 * Generate a new AES-256-GCM encryption key.
 * @returns {Promise<CryptoKey>} A new encryption key
 */
export async function generateKey() {
    return await globalThis.crypto.subtle.generateKey(
        { name: ALGORITHM, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Export a CryptoKey to a base64url-encoded string.
 * @param {CryptoKey} key - The key to export
 * @returns {Promise<string>} Base64url-encoded key
 */
export async function exportKey(key) {
    const raw = await globalThis.crypto.subtle.exportKey('raw', key);
    return bufferToBase64Url(raw);
}

/**
 * Import a base64url-encoded key string as a CryptoKey.
 * @param {string} base64Key - Base64url-encoded key
 * @returns {Promise<CryptoKey>} Imported key (decrypt-only)
 */
export async function importKey(base64Key) {
    const raw = base64UrlToBuffer(base64Key);
    return await globalThis.crypto.subtle.importKey(
        'raw', raw,
        { name: ALGORITHM, length: KEY_LENGTH },
        false,
        ['decrypt']
    );
}

/**
 * Encrypt data using AES-256-GCM. Returns IV prepended to ciphertext.
 * @param {CryptoKey} key - Encryption key
 * @param {ArrayBuffer|Uint8Array} plaintext - Data to encrypt
 * @returns {Promise<ArrayBuffer>} IV (12 bytes) + ciphertext
 */
export async function encryptFile(key, plaintext) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        plaintext
    );
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.length);
    return result.buffer;
}

/**
 * Decrypt data encrypted with encryptFile(). Expects IV prepended to ciphertext.
 * @param {CryptoKey} key - Decryption key
 * @param {ArrayBuffer|Uint8Array} encrypted - IV (12 bytes) + ciphertext
 * @returns {Promise<ArrayBuffer>} Decrypted plaintext
 */
export async function decryptFile(key, encrypted) {
    const data = new Uint8Array(encrypted);
    const iv         = data.slice(0, IV_LENGTH);
    const ciphertext = data.slice(IV_LENGTH);
    return await globalThis.crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        ciphertext
    );
}

/**
 * Convert an ArrayBuffer to a base64url-encoded string.
 * @param {ArrayBuffer} buffer - Buffer to encode
 * @returns {string} Base64url-encoded string
 */
export function bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Convert a base64url-encoded string to an ArrayBuffer.
 * @param {string} base64url - Base64url-encoded string
 * @returns {ArrayBuffer} Decoded buffer
 */
export function base64UrlToBuffer(base64url) {
    let base64 = base64url
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
