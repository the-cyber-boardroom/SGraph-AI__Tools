/**
 * sg-whatsapp-parse.js
 * Webhook payload → normalized events. One shape for the whole stack:
 * the relay stores raw payloads; this normalizer runs wherever they're
 * consumed (desk tool, Tier-2 responder, tests).
 * @module sg-whatsapp-parse
 */

/**
 * @typedef {Object} WaInboundMessage
 * @property {'message'} kind
 * @property {string} conversationId   the counterparty number (E.164, no '+')
 * @property {string} messageId
 * @property {string} from
 * @property {string} [name]           contact profile name, when present
 * @property {number} timestamp        ms epoch
 * @property {'text'|'audio'|'image'|'video'|'document'|'sticker'|'location'|'unknown'} type
 * @property {string} [text]           text body or media caption
 * @property {string} [mediaId]
 * @property {string} [mimeType]
 * @property {boolean} [voice]         true for voice notes (audio.voice)
 *
 * @typedef {Object} WaReceipt
 * @property {'receipt'} kind
 * @property {string} messageId
 * @property {string} conversationId
 * @property {'sent'|'delivered'|'read'|'failed'} status
 * @property {number} timestamp
 * @property {object} [error]          present on failed
 */

const MEDIA_TYPES = ['audio', 'image', 'video', 'document', 'sticker'];

/**
 * Normalize one webhook payload (the JSON Meta POSTs) into a flat event list.
 * Tolerant of unknown fields/types — never throws on shape surprises.
 * @param {object} payload
 * @returns {Array<WaInboundMessage|WaReceipt>}
 */
export function parseWebhookPayload(payload) {
    const out = [];
    for (const entry of payload?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
            const v = change?.value;
            if (!v || change?.field !== 'messages') continue;
            const names = new Map((v.contacts ?? []).map(c => [c.wa_id, c?.profile?.name]));

            for (const m of v.messages ?? []) {
                const type = m.type && (m.type === 'text' || MEDIA_TYPES.includes(m.type) || m.type === 'location')
                    ? m.type : 'unknown';
                const media = MEDIA_TYPES.includes(type) ? m[type] : null;
                out.push({
                    kind: 'message',
                    conversationId: m.from,
                    messageId: m.id,
                    from: m.from,
                    name: names.get(m.from),
                    timestamp: Number(m.timestamp) * 1000 || Date.now(),
                    type,
                    text: type === 'text' ? m.text?.body : media?.caption,
                    mediaId: media?.id,
                    mimeType: media?.mime_type,
                    voice: type === 'audio' ? !!media?.voice : undefined,
                });
            }

            for (const s of v.statuses ?? []) {
                out.push({
                    kind: 'receipt',
                    messageId: s.id,
                    conversationId: s.recipient_id,
                    status: ['sent', 'delivered', 'read', 'failed'].includes(s.status) ? s.status : 'sent',
                    timestamp: Number(s.timestamp) * 1000 || Date.now(),
                    ...(s.errors ? { error: s.errors[0] } : {}),
                });
            }
        }
    }
    return out;
}

/**
 * The 24h service window opens/refreshes on each inbound customer message.
 * @param {number} lastInboundTs  ms epoch of the customer's latest message
 * @returns {number} windowExpiresAt (ms epoch)
 */
export function windowExpiry(lastInboundTs) {
    return lastInboundTs + 24 * 60 * 60 * 1000;
}
