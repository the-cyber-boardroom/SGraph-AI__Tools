/**
 * sg-whatsapp-relay.js
 * Client for the whatsapp_relay worker: bearer-authed pull of the webhook
 * payloads Meta delivered while no tab was listening. The relay is a dumb
 * pipe — all parsing happens here via sg-whatsapp-parse.
 * @module sg-whatsapp-relay
 */

import { parseWebhookPayload } from './sg-whatsapp-parse.js';

export class RelayClient {
    /**
     * @param {object} opts
     * @param {string} opts.url         relay base URL (no trailing slash)
     * @param {string} opts.token       relay bearer token
     * @param {Function} [opts.fetchImpl]
     */
    constructor({ url, token, fetchImpl } = {}) {
        this.url    = (url || '').replace(/\/$/, '');
        this.token  = token;
        this._fetch = fetchImpl || ((...a) => fetch(...a));
    }

    /**
     * Pull stored webhook payloads after a cursor.
     * @param {string} [since]  opaque cursor from the previous pull ('' = all retained)
     * @returns {Promise<{ events: Array, cursor: string }>}
     * @throws {Error & { code: 'relay-unreachable'|'relay-auth' }}
     */
    async pull(since = '') {
        let res;
        try {
            res = await this._fetch(`${this.url}/messages?since=${encodeURIComponent(since)}`, {
                headers: { Authorization: `Bearer ${this.token}` },
            });
        } catch (err) {
            throw Object.assign(new Error(`Relay unreachable: ${err.message}`), { code: 'relay-unreachable' });
        }
        if (res.status === 401 || res.status === 403) {
            throw Object.assign(new Error('Relay rejected the token'), { code: 'relay-auth', status: res.status });
        }
        if (!res.ok) {
            throw Object.assign(new Error(`Relay HTTP ${res.status}`), { code: 'relay-unreachable', status: res.status });
        }
        const body = await res.json();
        const events = [];
        for (const item of body?.items ?? []) {
            events.push(...parseWebhookPayload(item.payload));
        }
        return { events, cursor: body?.cursor ?? since };
    }
}
