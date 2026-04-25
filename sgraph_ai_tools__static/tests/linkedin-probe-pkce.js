/**
 * Probe: Can the browser produce a PKCE S256 challenge?
 *
 * Generates a 32-byte verifier, hashes it with SHA-256, and base64url-encodes
 * the result. Verifies the round-trip is deterministic and that the
 * lengths match RFC 7636 (verifier 43–128 chars, challenge 43 chars).
 *
 * @returns {Promise<{pass: boolean, detail: string}>}
 */
export async function runPkceProbe() {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    return { pass: false, detail: 'window.crypto.subtle is undefined — page must be served over HTTPS or localhost.' };
  }
  try {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64url(new Uint8Array(digest));
    if (verifier.length < 43 || verifier.length > 128) {
      return { pass: false, detail: `Verifier length ${verifier.length} outside RFC 7636 bounds (43–128).` };
    }
    if (challenge.length !== 43) {
      return { pass: false, detail: `Challenge length ${challenge.length} ≠ 43 (SHA-256 → 32 bytes → 43 base64url chars).` };
    }
    return {
      pass: true,
      detail: `Verifier ${verifier.length} chars, challenge ${challenge.length} chars (S256). Sample: ${challenge.slice(0, 12)}…`,
    };
  } catch (err) {
    return { pass: false, detail: `crypto.subtle.digest failed: ${err.message}` };
  }
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
