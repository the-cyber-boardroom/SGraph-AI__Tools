/**
 * @file SG/Send upload client — handles the 3-step upload API, including
 *       presigned multipart for large files.
 * @module sg-send-upload
 *
 * Pure ES module. Imports crypto primitives from sg-send-crypto.js.
 * No Node.js, no frameworks.
 */

import {
  generateToken,
  deriveTransferId,
  deriveKey,
  buildSgmetaEnvelope,
  encrypt,
} from './sg-send-crypto.js';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Files at or below this size (5 MB) are uploaded via a single direct PUT.
 * Files above this threshold use presigned multipart upload.
 * @type {number}
 */
export const DIRECT_UPLOAD_LIMIT = 5 * 1024 * 1024;

/** @type {number} Default part size for multipart uploads (5 MB) */
const PART_SIZE = 5 * 1024 * 1024;

/** @type {number} Maximum concurrent part uploads */
const MAX_CONCURRENT = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Notify the caller via the optional onProgress callback.
 *
 * @param {Function|undefined} cb       - Progress callback.
 * @param {number}             percent  - Completion percentage (0–100).
 * @param {string}             stage    - Current stage label.
 */
function progress(cb, percent, stage) {
  if (typeof cb === 'function') {
    cb({ percent, stage });
  }
}

/**
 * Upload a single part to a presigned URL and return its ETag.
 *
 * @param {string}     url   - Presigned PUT URL.
 * @param {Uint8Array} chunk - Part payload.
 * @returns {Promise<string>} ETag header value from the response.
 */
async function uploadPart(url, chunk) {
  const res = await fetch(url, {
    method: 'PUT',
    body:   chunk,
    headers: { 'Content-Type': 'application/octet-stream' },
  });

  if (!res.ok) {
    throw new Error(`Part upload failed: ${res.status} ${res.statusText}`);
  }

  const etag = res.headers.get('ETag');
  if (!etag) {
    throw new Error('Part upload response missing ETag header');
  }
  return etag;
}

/**
 * Run an array of async tasks with bounded concurrency.
 *
 * @param {Array<() => Promise<T>>} tasks   - Factory functions that return promises.
 * @param {number}                  limit   - Maximum concurrent tasks.
 * @returns {Promise<T[]>} Results in the same order as the input tasks.
 * @template T
 */
async function parallelLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let   next    = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Direct upload (≤ 5 MB) ──────────────────────────────────────────────────

/**
 * Perform a direct (single-request) upload via the 3-step transfer API.
 *
 * Steps:
 *   1. POST /api/transfers/create   → { id }
 *   2. POST /api/transfers/upload/{id}  (raw binary body)
 *   3. POST /api/transfers/complete/{id}
 *
 * @param {Uint8Array} ciphertext   - Encrypted payload.
 * @param {string}     transferId   - Derived transfer ID.
 * @param {string}     sendUrl      - Base URL of the SG/Send API.
 * @param {string}     accessToken  - Access token (sent as x-sgraph-access-token header).
 * @param {Function}   onProgress   - Progress callback.
 * @returns {Promise<void>}
 */
async function directUpload(ciphertext, transferId, sendUrl, accessToken, onProgress) {
  const headers = {
    'x-sgraph-access-token': accessToken,
    'Content-Type':          'application/json',
  };

  // Step 1 — create transfer
  const createRes = await fetch(`${sendUrl}/api/transfers/create`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ transferId, size: ciphertext.byteLength }),
  });
  if (!createRes.ok) {
    throw new Error(`Transfer create failed: ${createRes.status} ${createRes.statusText}`);
  }
  const createData = await createRes.json();
  // API may return { id } (legacy) or { transfer_id, upload_url } (current)
  const id = createData.id ?? createData.transfer_id;
  if (!id) throw new Error('Transfer create response missing id / transfer_id');

  progress(onProgress, 60, 'uploading');

  // Step 2 — upload raw bytes
  const uploadRes = await fetch(`${sendUrl}/api/transfers/upload/${id}`, {
    method:  'POST',
    headers: {
      'x-sgraph-access-token': accessToken,
      'Content-Type':          'application/octet-stream',
    },
    body: ciphertext,
  });
  if (!uploadRes.ok) {
    throw new Error(`Transfer upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
  }

  progress(onProgress, 85, 'uploading');

  // Step 3 — complete
  const completeRes = await fetch(`${sendUrl}/api/transfers/complete/${id}`, {
    method:  'POST',
    headers,
  });
  if (!completeRes.ok) {
    throw new Error(`Transfer complete failed: ${completeRes.status} ${completeRes.statusText}`);
  }
}

// ── Multipart upload (> 5 MB) ────────────────────────────────────────────────

/**
 * Perform a presigned multipart upload for large files.
 *
 * Steps:
 *   1. POST /api/presigned/initiate    → { uploadId, urls: [...] }
 *   2. PUT each part to its presigned URL (max 5 concurrent)
 *   3. POST /api/presigned/complete    → done
 *
 * @param {Uint8Array} ciphertext   - Encrypted payload.
 * @param {string}     transferId   - Derived transfer ID.
 * @param {string}     sendUrl      - Base URL of the SG/Send API.
 * @param {string}     accessToken  - Access token (sent as x-sgraph-access-token header).
 * @param {Function}   onProgress   - Progress callback.
 * @returns {Promise<void>}
 */
async function multipartUpload(ciphertext, transferId, sendUrl, accessToken, onProgress) {
  const headers = {
    'x-sgraph-access-token': accessToken,
    'Content-Type':          'application/json',
  };

  const totalSize = ciphertext.byteLength;
  const partCount = Math.ceil(totalSize / PART_SIZE);

  // Step 1 — initiate
  const initRes = await fetch(`${sendUrl}/api/presigned/initiate`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ transferId, size: totalSize, parts: partCount }),
  });
  if (!initRes.ok) {
    throw new Error(`Multipart initiate failed: ${initRes.status} ${initRes.statusText}`);
  }
  const { uploadId, urls } = await initRes.json();

  // Step 2 — upload parts in parallel (max MAX_CONCURRENT)
  let completedParts = 0;
  const tasks = urls.map((url, i) => () => {
    const start = i * PART_SIZE;
    const end   = Math.min(start + PART_SIZE, totalSize);
    const chunk = ciphertext.slice(start, end);

    return uploadPart(url, chunk).then(etag => {
      completedParts++;
      const uploadPercent = 50 + Math.round((completedParts / partCount) * 40);
      progress(onProgress, uploadPercent, 'uploading');
      return { partNumber: i + 1, etag };
    });
  });

  const parts = await parallelLimit(tasks, MAX_CONCURRENT);

  // Step 3 — complete multipart
  const completeRes = await fetch(`${sendUrl}/api/presigned/complete`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ transferId, uploadId, parts }),
  });
  if (!completeRes.ok) {
    throw new Error(`Multipart complete failed: ${completeRes.status} ${completeRes.statusText}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload a file through SG/Send: generate a token, encrypt the file inside
 * an SGMETA envelope, and push it to the API.
 *
 * For files **<= 5 MB** the direct 3-step API is used.
 * For files **> 5 MB** a presigned multipart upload is used with up to 5
 * concurrent part uploads.
 *
 * @param {Blob}     blob         - The file content as a Blob.
 * @param {string}   filename     - Original filename (embedded in SGMETA metadata).
 * @param {string}   sendUrl      - Base URL of the SG/Send API (no trailing slash).
 * @param {string}   accessToken  - Access token (sent as x-sgraph-access-token header).
 * @param {Function} [onProgress] - Optional callback receiving `{ percent: number, stage: string }`.
 *                                  Stages: `'generating'` | `'packaging'` | `'encrypting'` | `'uploading'` | `'complete'`.
 * @returns {Promise<{ token: string, transferId: string, url: string }>}
 *          The friendly token, the derived transfer ID, and the download URL.
 */
export async function uploadFile(blob, filename, sendUrl, accessToken, onProgress) {
  // 1. Generate token + derive transfer ID and key
  progress(onProgress, 0, 'generating');

  const token      = generateToken();
  const [transferId, key] = await Promise.all([
    deriveTransferId(token),
    deriveKey(token),
  ]);

  progress(onProgress, 10, 'generating');

  // 2. Build SGMETA envelope
  progress(onProgress, 15, 'packaging');

  const rawBytes = new Uint8Array(await blob.arrayBuffer());
  const envelope = buildSgmetaEnvelope(rawBytes, filename);

  progress(onProgress, 30, 'packaging');

  // 3. Encrypt
  progress(onProgress, 35, 'encrypting');

  const ciphertext = await encrypt(envelope, key);

  // ── Debug info ────────────────────────────────────────────────────────────
  // IV is the first 12 bytes prepended by encrypt(); extract for logging.
  const ivHex = Array.from(ciphertext.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');

  console.group('[SG/Send] Upload debug');
  console.log('Token (share with recipient):', token);
  console.log('Transfer ID (SHA-256 of token, first 6 bytes):', transferId);
  console.log('Key derivation:', {
    algorithm:  'PBKDF2-SHA-256',
    salt:       'sgraph-send-v1',
    iterations: 600_000,
    keyLength:  '256-bit AES-GCM',
    password:   token,
  });
  console.log('SGMETA envelope:', {
    magic:          'SGMETA (0x53 47 4D 45 54 41)',
    metadataJson:   JSON.stringify({ filename }),
    rawFileBytes:   rawBytes.byteLength,
    envelopeBytes:  envelope.byteLength,
  });
  console.log('Encryption:', {
    cipher:          'AES-256-GCM',
    ivHex,
    ivBytes:         12,
    ciphertextBytes: ciphertext.byteLength,
    layout:          'IV (12 bytes) || ciphertext',
  });
  console.log('Upload target:', `${sendUrl}/api/transfers/upload/${transferId}`);
  console.groupEnd();
  // ─────────────────────────────────────────────────────────────────────────

  progress(onProgress, 50, 'encrypting');

  // 4. Upload
  progress(onProgress, 50, 'uploading');

  if (ciphertext.byteLength <= DIRECT_UPLOAD_LIMIT) {
    await directUpload(ciphertext, transferId, sendUrl, accessToken, onProgress);
  } else {
    await multipartUpload(ciphertext, transferId, sendUrl, accessToken, onProgress);
  }

  // 5. Done
  const url = `${sendUrl}/${transferId}`;
  progress(onProgress, 100, 'complete');

  return { token, transferId, url };
}
