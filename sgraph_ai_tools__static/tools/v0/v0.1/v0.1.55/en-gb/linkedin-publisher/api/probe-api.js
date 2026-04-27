/**
 * Probe: Can the browser call api.linkedin.com directly?
 *
 * The diagnostic trick: a fake bearer token forces LinkedIn to return 401
 * IF the request actually reaches them. If we get back any HTTP response
 * at all, CORS is permissive enough for a YouTube-style direct architecture.
 * If `fetch()` rejects with a TypeError, the browser blocked it.
 *
 * @returns {Promise<{pass: boolean, detail: string}>}
 */
export async function runApiCorsProbe() {
    const url = 'https://api.linkedin.com/rest/posts?q=author&author=urn%3Ali%3Aperson%3Aprobe&count=1';
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer phase0-probe-fake-token',
                'Linkedin-Version': '202604',
                'X-Restli-Protocol-Version': '2.0.0',
            },
        });
        return {
            pass: true,
            detail: `Reached server. HTTP ${res.status} ${res.statusText} — 401 is the expected and welcome answer (token is fake; CORS is open).`,
        };
    } catch (err) {
        return {
            pass: false,
            detail: `fetch() rejected: ${err.message}. Almost certainly CORS — open DevTools Network tab to confirm Access-Control-Allow-Origin is missing.`,
        };
    }
}
