/**
 * send.mjs
 * Minimal Graph API text sender. Zero dependencies — uses the global `fetch`
 * built into the Node 18+ Lambda runtimes. `fetchImpl` is injectable so tests
 * never touch the network.
 *
 * This is deliberately a hand-rolled 30 lines rather than an import of
 * core/sg-whatsapp: the MVP's promise is a dependency-free, single-directory
 * deployable. When milestone 3 needs media, templates and typed errors, swap
 * in the core module (it is pure ESM and runs in Node unchanged).
 *
 * @module whatsapp_lambda/send
 */

export const GRAPH_VERSION = 'v21.0';

/**
 * @param {object} opts
 * @param {string} opts.token          Meta system-user access token
 * @param {string} opts.phoneNumberId  Cloud API phone-number id
 * @param {Function} [opts.fetchImpl]
 * @param {string} [opts.version]
 * @returns {(to: string, body: string) => Promise<{ messageId: string }>}
 */
export function makeSender({ token, phoneNumberId, fetchImpl, version = GRAPH_VERSION }) {
    const doFetch = fetchImpl || globalThis.fetch;
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

    return async function sendText(to, body) {
        const res = await doFetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body },
            }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const detail = data?.error?.message || `HTTP ${res.status}`;
            throw Object.assign(new Error(`Graph send failed: ${detail}`), {
                status: res.status,
                graphCode: data?.error?.code,
            });
        }
        return { messageId: data?.messages?.[0]?.id };
    };
}
