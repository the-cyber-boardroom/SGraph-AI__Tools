/**
 * Probes for the two LinkedIn OAuth endpoints.
 *
 * `oauth/v2/authorization` is normally hit via top-level navigation in a
 * popup (so CORS doesn't apply); the probe exists only to record the
 * fetch behaviour for the architect note.
 *
 * `oauth/v2/accessToken` is the load-bearing one — if it accepts
 * cross-origin POST, the browser can complete the PKCE token exchange
 * itself; if not, the proxy has to do it.
 */

/** @returns {Promise<{pass: boolean, detail: string}>} */
export async function runOauthAuthorizeProbe() {
  const scope = encodeURIComponent('openid profile email w_member_social');
  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=probe&redirect_uri=https%3A%2F%2Fdev.tools.sgraph.ai%2Fen-gb%2Flinkedin-publisher%2Foauth-callback.html&scope=${scope}&state=phase0`;
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    return {
      pass: true,
      detail: `Reached server. HTTP ${res.status} — note: the production flow uses popup navigation, not fetch, so this result is diagnostic only.`,
    };
  } catch (err) {
    return {
      pass: false,
      detail: `fetch() rejected: ${err.message}. Expected — authorize is a top-level redirect endpoint. Production flow uses window.open() + postMessage from oauth-callback.html.`,
    };
  }
}

/** @returns {Promise<{pass: boolean, detail: string}>} */
export async function runOauthTokenProbe() {
  const url = 'https://www.linkedin.com/oauth/v2/accessToken';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: 'phase0-probe-fake-code',
    redirect_uri: 'https://tools.sgraph.ai/',
    client_id: 'phase0-probe',
    code_verifier: 'phase0-probe-verifier-just-long-enough-to-pass-format-checks-aaaa',
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return {
      pass: true,
      detail: `Reached server. HTTP ${res.status} — a 400 'invalid_grant' is the expected and welcome answer (CORS is permissive; PKCE exchange can run browser-side).`,
    };
  } catch (err) {
    return {
      pass: false,
      detail: `fetch() rejected: ${err.message}. Token exchange must go through a proxy (Option A or B from brief 2/5).`,
    };
  }
}
