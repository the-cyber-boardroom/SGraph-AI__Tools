/**
 * sg-whatsapp-bridge.js
 * Client for the local whatsapp_bridge service (companion/Bridge mode).
 * Mirrors RelayClient's pull() contract so the desk's poll loop and
 * applyEvents() work unchanged; adds send/status/media since — unlike the
 * Cloud API — outbound and inbound share one local process.
 *
 * ⚠️ Bridge mode is the UNOFFICIAL companion route (see whatsapp_bridge/
 *    README.md). Expendable-number use only.
 * @module sg-whatsapp-bridge
 */

export class BridgeClient {
    /**
     * @param {object} opts
     * @param {string} opts.url         bridge base URL (default localhost)
     * @param {string} opts.token       bearer token the bridge requires
     * @param {Function} [opts.fetchImpl]
     */
    constructor({ url, token, fetchImpl } = {}) {
        this.url    = (url || 'http://127.0.0.1:8787').replace(/\/$/, '');
        this.token  = token;
        this._fetch = fetchImpl || ((...a) => fetch(...a));
    }

    async _req(path, { method = 'GET', body } = {}) {
        let res;
        try {
            res = await this._fetch(`${this.url}${path}`, {
                method,
                headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
        } catch (err) {
            throw Object.assign(new Error(`Bridge unreachable: ${err.message}`), { code: 'bridge-unreachable' });
        }
        if (res.status === 401) throw Object.assign(new Error('Bridge rejected the token'), { code: 'bridge-auth' });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw Object.assign(new Error(data?.error || `Bridge HTTP ${res.status}`), { code: data?.code || 'bridge-error', status: res.status });
        return data;
    }

    /** { linked, qr, me } — poll while linking to pick up the QR / linked flip. */
    async status() { return this._req('/status'); }

    /**
     * Pull normalized events after a cursor (same contract as RelayClient).
     * @returns {Promise<{ events: Array, cursor: string }>}
     */
    async pull(since = '') {
        const r = await this._req(`/pull?since=${encodeURIComponent(since)}`);
        return { events: r?.events ?? [], cursor: r?.cursor ?? since };
    }

    /** @returns {Promise<{ messageId: string }>} */
    async sendText(chatId, body) {
        return this._req('/send', { method: 'POST', body: { chatId, body } });
    }

    /** @returns {Promise<{ blob: Blob, mimeType: string }>} */
    async fetchMedia(messageId) {
        const r = await this._req(`/media?messageId=${encodeURIComponent(messageId)}`);
        const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
        return { blob: new Blob([bytes], { type: r.mimeType }), mimeType: r.mimeType };
    }
}
