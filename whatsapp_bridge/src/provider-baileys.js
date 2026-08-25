/**
 * provider-baileys.js
 * Companion-protocol provider using @whiskeysockets/baileys — links the
 * bridge number as a WhatsApp companion device (like an iPad) and exposes
 * the provider interface handlers.js consumes.
 *
 * ⚠️ UNOFFICIAL + UNVERIFIED IN THIS ENVIRONMENT. This file is written to the
 *    documented Baileys API but has NOT been run against a real WhatsApp
 *    account here (no npm install, no phone to link). Treat it as a starting
 *    implementation to validate on first real link, not as tested code.
 *    Use ONLY on an expendable number (see whatsapp_bridge/README.md).
 *
 * @module whatsapp_bridge/provider-baileys
 */

import { normalizeMessage, jidToNumber } from './normalize.js';

/**
 * @param {{ authDir?: string }} [opts]  where to persist the linked session
 * @returns {Promise<object>} provider
 */
export async function createBaileysProvider({ authDir = './.baileys-auth' } = {}) {
    // Lazy imports so the service can run --mock without these installed.
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let sock, currentQr = null, me = null, linked = false;
    const log = [];                    // normalized message events, append-only
    const rawById = new Map();        // messageId → raw message (for media download)

    function start() {
        sock = makeWASocket({ auth: state, printQRInTerminal: true });
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', (u) => {
            if (u.qr) currentQr = u.qr;
            if (u.connection === 'open') {
                linked = true; currentQr = null;
                me = { id: jidToNumber(sock.user?.id), name: sock.user?.name };
            }
            if (u.connection === 'close') {
                linked = false;
                const shouldReconnect = u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) start();
            }
        });
        sock.ev.on('messages.upsert', ({ messages }) => {
            for (const m of messages) {
                rawById.set(m.key.id, m);
                const ev = normalizeMessage(m, me?.id || '');
                if (ev) log.push(ev);
            }
        });
    }
    start();

    return {
        name: 'baileys',
        async getStatus() { return { linked, qr: currentQr, me }; },
        async link()   { if (!linked && !sock) start(); return { linked, qr: currentQr }; },
        async unlink() { try { await sock?.logout(); } catch { /* */ } linked = false; return { linked }; },
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
        async pull(since = '') {
            const from = since ? Number(since) : 0;
            return { events: log.slice(from), cursor: String(log.length) };
        },
        async sendText(chatId, body) {
            const jid = `${chatId}@s.whatsapp.net`;
            const sent = await sock.sendMessage(jid, { text: body });
            return { messageId: sent?.key?.id };
        },
        async fetchMedia(messageId) {
            const raw = rawById.get(messageId);
            if (!raw) throw Object.assign(new Error('media not in cache'), { code: 'media-error' });
            const buf = await downloadMediaMessage(raw, 'buffer', {});
            const node = Object.values(raw.message || {})[0];
            return { base64: Buffer.from(buf).toString('base64'), mimeType: node?.mimetype || 'application/octet-stream' };
        },
    };
}
