/* =============================================================================
   SGraph — PBKDF2 Key Derivation Module
   v1.0.0 — Derives AES-256-GCM keys from human-friendly passphrases

   Converts passphrases like "apple-mango-56" into 256-bit AES keys using
   PBKDF2 with a fixed well-known salt. The fixed salt is intentional —
   friendly keys are shared out-of-band, so sender and receiver both derive
   the same key from the same words.

   Usage:
     import { deriveKey, deriveKeyFromWords, calculateEntropy } from './sg-pbkdf2.js';

     const { key, derivationTimeMs } = await deriveKey('apple-mango-56');
     const { key, passphrase }       = await deriveKeyFromWords(['apple', 'mango'], '56');
     const { bits, rating }          = calculateEntropy('apple-mango-56', 2000);
   ============================================================================= */

/** @type {string} Well-known fixed salt for friendly key derivation */
const FIXED_SALT = 'sgraph-send-v1'

/** @type {number} Default PBKDF2 iteration count */
const DEFAULT_ITERATIONS = 600000

/**
 * Derive an AES-256-GCM key from a passphrase using PBKDF2.
 *
 * @param {string} passphrase - The passphrase (e.g. "apple-mango-56")
 * @param {object} [options]
 * @param {number} [options.iterations=600000] - PBKDF2 iteration count
 * @param {Uint8Array} [options.salt] - Salt bytes (default: well-known fixed salt)
 * @returns {Promise<{key: CryptoKey, derivationTimeMs: number}>}
 */
export async function deriveKey(passphrase, options = {}) {
    const iterations = options.iterations || DEFAULT_ITERATIONS
    const salt       = options.salt || new TextEncoder().encode(FIXED_SALT)
    const start      = performance.now()

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    )

    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    )

    return { key, derivationTimeMs: performance.now() - start }
}

/**
 * Derive an AES-256-GCM key from an array of words + suffix.
 * Normalises to lowercase, joins with "-", then calls deriveKey().
 *
 * @param {string[]} words - Words (e.g. ["Apple", "Mango"])
 * @param {string} suffix - Numeric suffix (e.g. "56")
 * @param {object} [options] - Same options as deriveKey()
 * @returns {Promise<{key: CryptoKey, passphrase: string, derivationTimeMs: number}>}
 */
export async function deriveKeyFromWords(words, suffix, options = {}) {
    const normalised = words.map(w => w.toLowerCase())
    const passphrase = [...normalised, suffix].join('-')
    const { key, derivationTimeMs } = await deriveKey(passphrase, options)
    return { key, passphrase, derivationTimeMs }
}

/**
 * Calculate entropy bits for a passphrase.
 *
 * @param {string} passphrase - The passphrase to evaluate
 * @param {number} [wordListSize=2000] - Size of the word list
 * @returns {{ bits: number, combinations: number, rating: string }}
 *   rating is one of: "weak", "fair", "good", "strong"
 */
export function calculateEntropy(passphrase, wordListSize = 2000) {
    const segments = passphrase.split(/[-\s]+/).filter(s => s.length > 0)
    let totalBits = 0

    for (const segment of segments) {
        if (/^\d+$/.test(segment)) {
            totalBits += Math.log2(Math.pow(10, segment.length))
        } else if (/^[a-z]+$/i.test(segment)) {
            if (segment.length <= 10 && wordListSize > 0) {
                totalBits += Math.log2(wordListSize)
            } else {
                totalBits += Math.log2(Math.pow(26, segment.length))
            }
        } else if (/^[a-z0-9]+$/i.test(segment)) {
            totalBits += Math.log2(Math.pow(62, segment.length))
        } else {
            totalBits += Math.log2(Math.pow(95, segment.length))
        }
    }

    const bits = Math.round(totalBits * 10) / 10
    const combinations = Math.pow(2, bits)

    let rating
    if (bits < 20)      rating = 'weak'
    else if (bits < 30) rating = 'fair'
    else if (bits < 40) rating = 'good'
    else                rating = 'strong'

    return { bits, combinations, rating }
}
