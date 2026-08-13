/**
 * wa-demo.js
 * Credential-free demo data: lets the UI (and the boot smoke, and anyone
 * evaluating the tool before Meta verification clears) exercise the full
 * conversation surface. Clearly marked; sends stay blocked in demo mode.
 * @module wa-demo
 */

import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { state, getConversation, recordOutbound } from './wa-state.js';

/** A short synthetic "voice note" WAV (250ms of soft tone) for transcribe demos. */
function demoVoiceBlob() {
    const rate = 8000, len = rate / 4, data = new Int16Array(len);
    for (let i = 0; i < len; i++) data[i] = Math.round(Math.sin(i / 8) * 4000);
    const buf = new ArrayBuffer(44 + data.byteLength);
    const dv  = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + data.byteLength, true); w(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data');
    dv.setUint32(40, data.byteLength, true);
    new Int16Array(buf, 44).set(data);
    return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Load demo conversations. Idempotent-ish (clears previous demo state).
 * @returns {{ conversations: number }}
 */
export function loadDemo({ emit }) {
    state.conversations.clear();
    state.demo = true;
    state.connected = true;
    state.displayNumber = '+44 7700 900000 (demo)';
    state.verifiedName = 'Voice Debrief (demo)';
    state.templates = [{ name: 'hello_world', lang: 'en_GB', label: 'hello_world (en_GB)' }];

    const now = Date.now();

    // Ana — inside the 24h window, with a voice note to transcribe.
    const ana = getConversation('447700900001', { create: true, name: 'Ana P.' });
    ana.messages.push(
        { id: 'demo-a1', direction: 'in',  type: 'text',  text: 'Hello :) can you help with the report?', timestamp: now - 3 * 3_600_000, senderName: 'Ana P.' },
        { id: 'demo-a2', direction: 'out', type: 'text',  text: 'Of course — send the details over.',      timestamp: now - 2.8 * 3_600_000, status: 'read' },
        { id: 'demo-a3', direction: 'in',  type: 'audio', voice: true, mimeType: 'audio/wav',
          demoBlob: demoVoiceBlob(), timestamp: now - 2 * 3_600_000, senderName: 'Ana P.' },
    );
    ana.windowExpiresAt = now + 22 * 3_600_000;
    ana.unread = 2;
    ana.lastActivity = now - 2 * 3_600_000;

    // Supplier — window closed → template-only composer.
    const sup = getConversation('447700900002', { create: true, name: 'Supplier X' });
    sup.messages.push(
        { id: 'demo-s1', direction: 'in',  type: 'text', text: 'Invoice attached, due Friday.', timestamp: now - 30 * 3_600_000, senderName: 'Supplier X' },
        { id: 'demo-s2', direction: 'out', type: 'text', text: 'Received, thanks.',             timestamp: now - 29 * 3_600_000, status: 'delivered' },
    );
    sup.windowExpiresAt = now - 6 * 3_600_000;   // expired
    sup.lastActivity = now - 29 * 3_600_000;

    emit(WA_EVENTS.SYNC, { newMessages: 3, cursor: 'demo' });
    return { conversations: state.conversations.size };
}

/** Demo-mode "send": records locally, no network. */
export function demoSend(conversationId, body, { emit }) {
    recordOutbound(conversationId, { messageId: `demo-out-${Date.now()}`, text: body });
    emit(WA_EVENTS.MESSAGE_OUT, { conversationId, messageId: 'demo' });
    return { messageId: 'demo', demo: true };
}
