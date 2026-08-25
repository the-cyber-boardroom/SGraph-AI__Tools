/**
 * sg-whatsapp-api.js
 * Meta WhatsApp Cloud API client (Graph API). Pure JS, no DOM; `fetchImpl`
 * injectable so Node tests and the desk tool share one contract
 * (the core/sg-transcribe pattern).
 *
 * Browser-direct by design (Phase-0 probe pending); if CORS disappoints,
 * point `baseUrl` at the relay's proxy path — the contract is unchanged.
 *
 * @module sg-whatsapp-api
 */

import { classifyGraphError } from './sg-whatsapp-errors.js';

export const GRAPH_VERSION = 'v21.0';
export const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class WhatsAppApi {
    /**
     * @param {object} opts
     * @param {string} opts.token          system-user access token
     * @param {string} opts.phoneNumberId  Cloud API phone-number id
     * @param {string} [opts.wabaId]       WhatsApp Business Account id (templates)
     * @param {Function} [opts.fetchImpl]  injectable fetch (tests/mocks)
     * @param {string} [opts.baseUrl]      override for relay-proxied mode
     */
    constructor({ token, phoneNumberId, wabaId, fetchImpl, baseUrl } = {}) {
        this.token         = token;
        this.phoneNumberId = phoneNumberId;
        this.wabaId        = wabaId || null;
        this._fetch        = fetchImpl || ((...a) => fetch(...a));
        this.baseUrl       = baseUrl || GRAPH_BASE;
    }

    async _request(path, { method = 'GET', json, headers = {} } = {}) {
        let res;
        try {
            res = await this._fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    ...(json ? { 'Content-Type': 'application/json' } : {}),
                    ...headers,
                },
                ...(json ? { body: JSON.stringify(json) } : {}),
            });
        } catch (err) {
            throw Object.assign(new Error(`Network error: ${err.message}`), { code: 'wa-error' });
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) throw classifyGraphError({ status: res.status, body });
        return body;
    }

    /** Validate credentials + fetch the display number. */
    async getPhoneNumber() {
        return this._request(`/${this.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
    }

    /**
     * Send a free-form text message (only valid inside a 24h service window —
     * enforce client-side first; the API returns 131047 otherwise).
     * @param {string} to    E.164 without '+', e.g. '4479…'
     * @param {string} body
     * @returns {Promise<{ messageId: string }>}
     */
    async sendText(to, body) {
        const r = await this._request(`/${this.phoneNumberId}/messages`, {
            method: 'POST',
            json: { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
        });
        return { messageId: r?.messages?.[0]?.id };
    }

    /**
     * Send an approved template message (valid anytime; may open a billed
     * conversation).
     * @param {string} to
     * @param {string} name       template name
     * @param {string} lang       e.g. 'en_GB'
     * @param {object[]} [components]  Graph template components (params)
     */
    async sendTemplate(to, name, lang, components) {
        const r = await this._request(`/${this.phoneNumberId}/messages`, {
            method: 'POST',
            json: {
                messaging_product: 'whatsapp', to, type: 'template',
                template: { name, language: { code: lang }, ...(components ? { components } : {}) },
            },
        });
        return { messageId: r?.messages?.[0]?.id };
    }

    /**
     * Send media by uploaded id or public link.
     * @param {string} to
     * @param {{ type: 'image'|'audio'|'video'|'document', mediaId?: string, link?: string, caption?: string, filename?: string }} media
     */
    async sendMedia(to, { type, mediaId, link, caption, filename }) {
        const payload = mediaId ? { id: mediaId } : { link };
        if (caption)  payload.caption  = caption;
        if (filename) payload.filename = filename;
        const r = await this._request(`/${this.phoneNumberId}/messages`, {
            method: 'POST',
            json: { messaging_product: 'whatsapp', to, type, [type]: payload },
        });
        return { messageId: r?.messages?.[0]?.id };
    }

    /**
     * Upload a media blob; returns the media id to use in sendMedia.
     * @param {Blob} blob
     */
    async uploadMedia(blob) {
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', blob);
        let res;
        try {
            res = await this._fetch(`${this.baseUrl}/${this.phoneNumberId}/media`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.token}` },
                body: form,
            });
        } catch (err) {
            throw Object.assign(new Error(`Network error: ${err.message}`), { code: 'wa-error' });
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) throw classifyGraphError({ status: res.status, body });
        return { mediaId: body?.id };
    }

    /** Resolve a media id to its (short-lived, token-authed) CDN URL + mime. */
    async getMediaUrl(mediaId) {
        const r = await this._request(`/${mediaId}`);
        return { url: r?.url, mimeType: r?.mime_type, sizeBytes: r?.file_size };
    }

    /**
     * Download a media id as a Blob (two-step: resolve URL, then authed GET).
     * The CDN host's CORS is a Phase-0 probe; on failure the relay grows a
     * media proxy path and `mediaBaseUrl` gets pointed there.
     * @param {string} mediaId
     * @returns {Promise<{ blob: Blob, mimeType: string }>}
     */
    async fetchMedia(mediaId) {
        const { url, mimeType } = await this.getMediaUrl(mediaId);
        let res;
        try {
            res = await this._fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
        } catch (err) {
            throw Object.assign(new Error(`Media fetch failed: ${err.message}`), { code: 'media-error' });
        }
        if (!res.ok) throw Object.assign(new Error(`Media fetch HTTP ${res.status}`), { code: 'media-error', status: res.status });
        return { blob: await res.blob(), mimeType };
    }

    /** Mark an inbound message as read (blue ticks on the sender's side). */
    async markRead(messageId) {
        await this._request(`/${this.phoneNumberId}/messages`, {
            method: 'POST',
            json: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
        });
        return { ok: true };
    }

    /** List message templates on the WABA (approved and otherwise; caller filters). */
    async listTemplates() {
        if (!this.wabaId) throw Object.assign(new Error('wabaId required for listTemplates'), { code: 'wa-error' });
        const r = await this._request(`/${this.wabaId}/message_templates?fields=name,status,language,category,components&limit=100`);
        return { templates: r?.data ?? [] };
    }
}
