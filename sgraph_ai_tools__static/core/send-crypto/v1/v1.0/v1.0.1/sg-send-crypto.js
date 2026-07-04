/**
 * @file SG/Send cryptographic primitives — token generation, key derivation,
 *       SGMETA envelope construction, and AES-256-GCM encryption.
 * @module sg-send-crypto
 *
 * Pure ES module. Uses Web Crypto API only. No Node.js, no frameworks.
 */

import { WORDLIST } from './wordlist.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** @type {string} Fixed salt used for PBKDF2 key derivation */
export const SALT = 'sgraph-send-v1';

/** @type {number} PBKDF2 iteration count */
export const ITERATIONS = 600_000;

/**
 * Pattern that matches a friendly token: word-word-NNNN
 * @type {RegExp}
 */
export const TOKEN_PATTERN = /^[a-z]+-[a-z]+-\d{4}$/;

/** @type {Uint8Array} SGMETA magic bytes — ASCII "SGMETA" */
const SGMETA_MAGIC = new Uint8Array([0x53, 0x47, 0x4D, 0x45, 0x54, 0x41]);

// ── Token helpers ────────────────────────────────────────────────────────────

/**
 * Check whether a string matches the friendly-token format `word-word-NNNN`.
 *
 * @param {string} str - The string to test.
 * @returns {boolean} `true` if `str` matches the token pattern.
 */
export function isFriendlyToken(str) {
  return typeof str === 'string' && TOKEN_PATTERN.test(str);
}

/**
 * Generate a random friendly token in the form `word-word-NNNN`.
 *
 * Two words are drawn independently from the 320-word wordlist using
 * `crypto.getRandomValues`, and the numeric suffix is a zero-padded
 * random integer in [0, 9999].
 *
 * @returns {string} A token like `"apple-brave-0742"`.
 */
export function generateToken() {
  const buf = new Uint32Array(3);
  crypto.getRandomValues(buf);

  const word1 = WORDLIST[buf[0] % WORDLIST.length];
  const word2 = WORDLIST[buf[1] % WORDLIST.length];
  const num   = (buf[2] % 10_000).toString().padStart(4, '0');

  return `${word1}-${word2}-${num}`;
}

// ── Key / ID derivation ──────────────────────────────────────────────────────

/**
 * Derive a short transfer ID from a token by SHA-256-hashing it and taking
 * the first 12 hex characters (6 bytes).
 *
 * @param {string} token - The friendly token.
 * @returns {Promise<string>} 12-character lowercase hex string.
 */
export async function deriveTransferId(token) {
  const encoded = new TextEncoder().encode(token);
  const hash    = await crypto.subtle.digest('SHA-256', encoded);
  const bytes   = new Uint8Array(hash, 0, 6);

  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a 256-bit AES-GCM CryptoKey from a token using PBKDF2-SHA-256.
 *
 * The token is imported as raw key material, then run through PBKDF2 with
 * the fixed {@link SALT} and {@link ITERATIONS} iterations.
 *
 * @param {string} token - The friendly token used as the password.
 * @returns {Promise<CryptoKey>} An AES-GCM key suitable for encrypt/decrypt.
 */
export async function deriveKey(token) {
  const enc      = new TextEncoder();
  const keyMat   = await crypto.subtle.importKey(
    'raw',
    enc.encode(token),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt:       enc.encode(SALT),
      iterations: ITERATIONS,
      hash:       'SHA-256',
    },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── SGMETA envelope ──────────────────────────────────────────────────────────

/**
 * Build an SGMETA envelope: a binary blob that bundles file metadata with
 * the raw file content.
 *
 * Layout (big-endian):
 * ```
 * [SGMETA magic — 6 bytes]
 * [metadata-length — 4 bytes, big-endian uint32]
 * [JSON metadata — variable length]
 * [file bytes — remainder]
 * ```
 *
 * @param {Uint8Array|ArrayBuffer} content  - Raw file bytes.
 * @param {string}                 filename - Original filename to embed.
 * @returns {Uint8Array} The assembled SGMETA envelope.
 */
export function buildSgmetaEnvelope(content, filename) {
  const fileBytes    = content instanceof Uint8Array ? content : new Uint8Array(content);
  const metaJson     = JSON.stringify({ filename });
  const metaBytes    = new TextEncoder().encode(metaJson);
  const metaLen      = metaBytes.byteLength;

  // 6 (magic) + 4 (length) + metaLen + fileBytes
  const envelope = new Uint8Array(6 + 4 + metaLen + fileBytes.byteLength);

  // Magic
  envelope.set(SGMETA_MAGIC, 0);

  // Metadata length — 4 bytes big-endian
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  view.setUint32(6, metaLen, false); // false = big-endian

  // Metadata JSON
  envelope.set(metaBytes, 10);

  // File bytes
  envelope.set(fileBytes, 10 + metaLen);

  return envelope;
}

// ── Encryption ───────────────────────────────────────────────────────────────

/**
 * Encrypt plaintext bytes with AES-256-GCM.
 *
 * A random 12-byte IV is generated and prepended to the ciphertext so the
 * result is self-contained: `IV (12 bytes) || ciphertext`.
 *
 * @param {Uint8Array|ArrayBuffer} plaintext - Data to encrypt.
 * @param {CryptoKey}              key       - AES-GCM CryptoKey (from {@link deriveKey}).
 * @returns {Promise<Uint8Array>} `IV (12 bytes) || ciphertext`.
 */
export async function encrypt(plaintext, key) {
  const iv         = crypto.getRandomValues(new Uint8Array(12));
  const ptBytes    = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
  const cipherBuf  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    ptBytes,
  );

  const cipher = new Uint8Array(cipherBuf);
  const result = new Uint8Array(iv.byteLength + cipher.byteLength);
  result.set(iv, 0);
  result.set(cipher, iv.byteLength);

  return result;
}
