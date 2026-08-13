/**
 * normalize.js
 * Map a companion-protocol message (Baileys shape, or the mock's mimic of it)
 * into the SAME normalized event shape core/sg-whatsapp's parseWebhookPayload
 * produces — so the desk's applyEvents() and chat components render bridge
 * and Cloud-API messages identically.
 * @module whatsapp_bridge/normalize
 */

/** '4479...@s.whatsapp.net' → '4479...' */
export function jidToNumber(jid) {
    return String(jid || '').split('@')[0].split(':')[0];
}

const MEDIA_KIND = {
    audioMessage: 'audio', imageMessage: 'image', videoMessage: 'video',
    documentMessage: 'document', stickerMessage: 'sticker',
};

/**
 * @param {object} m  a Baileys-style message ({ key, message, messageTimestamp, pushName })
 * @param {string} me the linked account's own number (to set direction)
 * @returns {object|null} normalized message event, or null if unrenderable
 */
export function normalizeMessage(m, me) {
    if (!m?.key) return null;
    const chatId = jidToNumber(m.key.remoteJid);
    if (!chatId || m.key.remoteJid?.endsWith('@g.us')) return null;   // skip groups in v0.1
    const fromMe = !!m.key.fromMe;
    const content = m.message || {};

    let type = 'text', text, mediaId, mimeType, voice;
    if (content.conversation || content.extendedTextMessage) {
        text = content.conversation || content.extendedTextMessage?.text;
    } else {
        const mk = Object.keys(content).find(k => MEDIA_KIND[k]);
        if (mk) {
            type = MEDIA_KIND[mk];
            const node = content[mk];
            mediaId = m.key.id;            // bridge resolves media by message id
            mimeType = node?.mimetype;
            text = node?.caption;
            voice = mk === 'audioMessage' ? !!node?.ptt : undefined;
        } else {
            type = 'unknown';
        }
    }

    return {
        kind: 'message',
        conversationId: chatId,
        messageId: m.key.id,
        from: fromMe ? me : chatId,
        direction: fromMe ? 'out' : 'in',
        name: m.pushName,
        timestamp: Number(m.messageTimestamp) * 1000 || Date.now(),
        type, text, mediaId, mimeType, voice,
    };
}
