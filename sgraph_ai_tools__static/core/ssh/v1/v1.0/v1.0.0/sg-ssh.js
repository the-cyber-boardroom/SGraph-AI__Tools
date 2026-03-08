/* =============================================================================
   SGraph SSH — Browser-Based SSH Key Generation
   v1.0.0 — Ed25519 key pair generation via Web Crypto API

   Generates SSH key pairs entirely in the browser. No server involvement.
   The private key never leaves the user's device.

   Usage:
     import { generateSSHKeyPair } from './sg-ssh.js';

     const { publicKey, privateKey } = await generateSSHKeyPair({
       comment: 'user@example.com'
     });
   ============================================================================= */

/**
 * Generate an Ed25519 SSH key pair.
 *
 * @param {Object} [options]
 * @param {string} [options.comment=''] - Comment to append to the public key
 * @returns {Promise<{publicKey: string, privateKey: string}>} SSH-formatted key pair
 */
export async function generateSSHKeyPair(options = {}) {
    const { comment = '' } = options;

    const keyPair = await globalThis.crypto.subtle.generateKey(
        { name: 'Ed25519' },
        true,
        ['sign', 'verify']
    );

    const publicKeyRaw  = await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey);
    const privateKeyPkcs8 = await globalThis.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    const publicKeySSH  = formatSSHPublicKey(new Uint8Array(publicKeyRaw), comment);
    const privateKeyPEM = formatSSHPrivateKey(
        new Uint8Array(publicKeyRaw),
        new Uint8Array(privateKeyPkcs8)
    );

    return { publicKey: publicKeySSH, privateKey: privateKeyPEM };
}

/**
 * Format a raw Ed25519 public key as an OpenSSH public key string.
 *
 * @param {Uint8Array} publicKeyRaw - 32-byte raw public key
 * @param {string} comment - Comment to append
 * @returns {string} OpenSSH-formatted public key
 */
function formatSSHPublicKey(publicKeyRaw, comment) {
    const keyType = 'ssh-ed25519';
    const keyTypeBytes = new TextEncoder().encode(keyType);

    // SSH wire format: length-prefixed strings
    const blob = concatBuffers([
        uint32BE(keyTypeBytes.length),
        keyTypeBytes,
        uint32BE(publicKeyRaw.length),
        publicKeyRaw,
    ]);

    const b64 = arrayBufferToBase64(blob);
    return comment
        ? `${keyType} ${b64} ${comment}`
        : `${keyType} ${b64}`;
}

/**
 * Format an Ed25519 key pair as an OpenSSH PEM private key.
 *
 * @param {Uint8Array} publicKeyRaw - 32-byte raw public key
 * @param {Uint8Array} privateKeyPkcs8 - PKCS#8-encoded private key
 * @returns {string} OpenSSH PEM-formatted private key
 */
function formatSSHPrivateKey(publicKeyRaw, privateKeyPkcs8) {
    // PKCS#8 for Ed25519: the last 32 bytes are the raw private key seed
    const privateSeed = privateKeyPkcs8.slice(privateKeyPkcs8.length - 32);

    const keyType = 'ssh-ed25519';
    const keyTypeBytes = new TextEncoder().encode(keyType);

    // Generate check integers (random, must match)
    const checkInt = globalThis.crypto.getRandomValues(new Uint8Array(4));

    // Build the public key section (for the "publickeys" list in the private key format)
    const pubSection = concatBuffers([
        uint32BE(keyTypeBytes.length),
        keyTypeBytes,
        uint32BE(publicKeyRaw.length),
        publicKeyRaw,
    ]);

    // ed25519 private key = seed (32) + public (32) = 64 bytes
    const ed25519Key = concatBuffers([privateSeed, publicKeyRaw]);

    // Build private section (unencrypted)
    const noComment = new Uint8Array(0);
    let privateSection = concatBuffers([
        checkInt,       // check1
        checkInt,       // check2 (must match check1)
        uint32BE(keyTypeBytes.length),
        keyTypeBytes,
        uint32BE(publicKeyRaw.length),
        publicKeyRaw,
        uint32BE(ed25519Key.length),
        ed25519Key,
        uint32BE(noComment.length),
        noComment,
    ]);

    // Pad to block size (8 bytes for none cipher)
    const blockSize = 8;
    const padLen = blockSize - (privateSection.length % blockSize);
    if (padLen < blockSize) {
        const padding = new Uint8Array(padLen);
        for (let i = 0; i < padLen; i++) padding[i] = i + 1;
        privateSection = concatBuffers([privateSection, padding]);
    }

    // Build the full private key blob
    const authMagic = new TextEncoder().encode('openssh-key-v1\0');
    const cipherName = new TextEncoder().encode('none');
    const kdfName    = new TextEncoder().encode('none');
    const kdfOptions = new Uint8Array(0); // empty string for none
    const numKeys    = 1;

    const blob = concatBuffers([
        authMagic,
        uint32BE(cipherName.length), cipherName,
        uint32BE(kdfName.length), kdfName,
        uint32BE(kdfOptions.length), kdfOptions,
        uint32BE(numKeys),
        uint32BE(pubSection.length), pubSection,
        uint32BE(privateSection.length), privateSection,
    ]);

    const b64 = arrayBufferToBase64(blob);
    const lines = [];
    for (let i = 0; i < b64.length; i += 70) {
        lines.push(b64.slice(i, i + 70));
    }

    return [
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        ...lines,
        '-----END OPENSSH PRIVATE KEY-----',
        '',
    ].join('\n');
}

/**
 * Encode a number as a 4-byte big-endian Uint8Array.
 * @param {number} n
 * @returns {Uint8Array}
 */
function uint32BE(n) {
    const buf = new Uint8Array(4);
    buf[0] = (n >>> 24) & 0xff;
    buf[1] = (n >>> 16) & 0xff;
    buf[2] = (n >>>  8) & 0xff;
    buf[3] =  n         & 0xff;
    return buf;
}

/**
 * Concatenate multiple Uint8Arrays into one.
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
function concatBuffers(arrays) {
    let totalLength = 0;
    for (const arr of arrays) totalLength += arr.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/**
 * Convert a Uint8Array to standard base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function arrayBufferToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
