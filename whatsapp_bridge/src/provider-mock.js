/**
 * provider-mock.js
 * Companion-protocol provider stand-in: canned chats, no WhatsApp, no
 * network. Lets the HTTP layer and the desk's Bridge mode be developed and
 * tested with zero risk and zero setup. `--mock` on the server selects it.
 * Implements the provider interface consumed by handlers.js.
 * @module whatsapp_bridge/provider-mock
 */

import { normalizeMessage } from './normalize.js';

const ME = '447700900500';

function baileysMsg({ id, jid, fromMe, text, tsSecs, ptt, pushName }) {
    return {
        key: { id, remoteJid: `${jid}@s.whatsapp.net`, fromMe },
        pushName,
        messageTimestamp: tsSecs,
        message: ptt
            ? { audioMessage: { ptt: true, mimetype: 'audio/ogg; codecs=opus' } }
            : { conversation: text },
    };
}

export function createMockProvider() {
    const nowS = Math.floor(Date.now() / 1000);
    const raw = [
        baileysMsg({ id: 'mb1', jid: '447700900701', fromMe: false, text: 'Hey, are the slides ready?', tsSecs: nowS - 3600, pushName: 'Jordan' }),
        baileysMsg({ id: 'mb2', jid: '447700900701', fromMe: true,  text: 'Almost — 10 min.',            tsSecs: nowS - 3500, pushName: 'Jordan' }),
        baileysMsg({ id: 'mb3', jid: '447700900702', fromMe: false, ptt: true,                            tsSecs: nowS - 1800, pushName: 'Priya' }),
    ];
    // Provider keeps an append-only log; `since` is an index cursor.
    const log = raw.map(m => normalizeMessage(m, ME)).filter(Boolean);
    let linked = true;

    return {
        name: 'mock',
        async getStatus() { return { linked, qr: linked ? null : 'MOCK-QR-STRING', me: { id: ME, name: 'Bridge Demo' } }; },
        async link()   { linked = true;  return { linked }; },
        async unlink() { linked = false; return { linked }; },
        async listChats() {
            const byChat = new Map();
            for (const e of log) {
                const c = byChat.get(e.conversationId) || { id: e.conversationId, name: e.name || e.conversationId, unread: 0, lastTimestamp: 0, snippet: '' };
                c.lastTimestamp = Math.max(c.lastTimestamp, e.timestamp);
                c.snippet = e.text || (e.voice ? '🎙 voice note' : e.type);
                if (e.direction === 'in') c.unread += 1;
                byChat.set(e.conversationId, c);
            }
            return [...byChat.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        },
        async getMessages(chatId, limit = 50) {
            return log.filter(e => e.conversationId === chatId).slice(-limit);
        },
        /** since = last-seen index (string); returns events after it + new cursor. */
        async pull(since = '') {
            const from = since ? Number(since) : 0;
            const events = log.slice(from);
            return { events, cursor: String(log.length) };
        },
        async sendText(chatId, body) {
            const id = `mb-out-${Date.now()}`;
            log.push({ kind: 'message', conversationId: chatId, messageId: id, from: ME,
                direction: 'out', timestamp: Date.now(), type: 'text', text: body });
            return { messageId: id };
        },
        async fetchMedia(_messageId) {
            // 250ms synthetic tone WAV — proves the transcribe pipeline, not content.
            const rate = 8000, n = rate / 4, data = new Int16Array(n);
            for (let i = 0; i < n; i++) data[i] = Math.round(Math.sin(i / 8) * 4000);
            return { base64: Buffer.from(data.buffer).toString('base64'), mimeType: 'audio/wav' };
        },
    };
}
