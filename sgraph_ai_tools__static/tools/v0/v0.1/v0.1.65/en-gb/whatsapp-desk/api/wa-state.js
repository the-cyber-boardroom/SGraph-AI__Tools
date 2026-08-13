/**
 * wa-state.js
 * Mutable state for WhatsApp Desk: conversations keyed by counterparty
 * number, messages per conversation, relay cursor, connection status.
 * In-memory only (v0.1 — history durability is the relay's 72h TTL; the
 * vault archive is the flagged v0.2). No DOM, no side-effects.
 * @module wa-state
 */

import { windowExpiry } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-parse.js';

export const state = {
    connected:     false,
    displayNumber: null,
    verifiedName:  null,
    relayOk:       false,
    cursor:        '',
    demo:          false,

    /** Map<conversationId, Conversation>
     *  Conversation: { id, name, messages: [], windowExpiresAt: number|null,
     *                  unread: number, lastActivity: number } */
    conversations: new Map(),

    templates:     [],       // approved templates [{name, lang, label}]
    lastError:     null,
};

export function resetState() {
    state.connected = false;
    state.displayNumber = null;
    state.verifiedName = null;
    state.relayOk = false;
    state.cursor = '';
    state.demo = false;
    state.conversations.clear();
    state.templates = [];
    state.lastError = null;
}

export function getConversation(id, { create = false, name } = {}) {
    let c = state.conversations.get(id);
    if (!c && create) {
        c = { id, name: name || id, messages: [], windowExpiresAt: null, unread: 0, lastActivity: 0 };
        state.conversations.set(id, c);
    }
    if (c && name && c.name === c.id) c.name = name;
    return c ?? null;
}

/** True while the free-form 24h service window is open. */
export function windowOpen(conv, now = Date.now()) {
    return !!conv?.windowExpiresAt && conv.windowExpiresAt > now;
}

/**
 * Apply normalized inbound events (from the relay) to state.
 * @param {Array} events  parseWebhookPayload output
 * @returns {{ newMessages: number, receipts: number, windowChanges: Array<{conversationId, windowExpiresAt}> }}
 */
export function applyEvents(events) {
    let newMessages = 0, receipts = 0;
    const windowChanges = [];
    for (const ev of events) {
        if (ev.kind === 'message') {
            const conv = getConversation(ev.conversationId, { create: true, name: ev.name });
            if (conv.messages.some(m => m.id === ev.messageId)) continue;   // dedupe re-pulls
            conv.messages.push({
                id: ev.messageId, direction: 'in', type: ev.type,
                text: ev.text, timestamp: ev.timestamp,
                mediaId: ev.mediaId, mimeType: ev.mimeType, voice: ev.voice,
                senderName: conv.name,
            });
            conv.messages.sort((a, b) => a.timestamp - b.timestamp);
            conv.unread += 1;
            conv.lastActivity = Math.max(conv.lastActivity, ev.timestamp);
            const expiry = windowExpiry(ev.timestamp);
            if (expiry !== conv.windowExpiresAt && expiry > (conv.windowExpiresAt ?? 0)) {
                conv.windowExpiresAt = expiry;
                windowChanges.push({ conversationId: conv.id, windowExpiresAt: expiry });
            }
            newMessages++;
        } else if (ev.kind === 'receipt') {
            const conv = getConversation(ev.conversationId);
            const m = conv?.messages.find(x => x.id === ev.messageId);
            if (m && !(m.status === 'read' && ev.status !== 'failed')) m.status = ev.status;
            receipts++;
        }
    }
    return { newMessages, receipts, windowChanges };
}

/** Record an outbound message locally (after a successful send). */
export function recordOutbound(conversationId, { messageId, type = 'text', text }) {
    const conv = getConversation(conversationId, { create: true });
    conv.messages.push({
        id: messageId || `local-${Date.now()}`, direction: 'out', type,
        text, timestamp: Date.now(), status: 'sent',
    });
    conv.lastActivity = Date.now();
    return conv;
}

/** Rows for <sg-conversation-list>, most recent first. */
export function conversationRows(now = Date.now()) {
    return [...state.conversations.values()]
        .sort((a, b) => b.lastActivity - a.lastActivity)
        .map(c => {
            const last = c.messages[c.messages.length - 1];
            const open = windowOpen(c, now);
            const hoursLeft = open ? Math.max(1, Math.round((c.windowExpiresAt - now) / 3_600_000)) : 0;
            return {
                id: c.id, name: c.name,
                snippet: last ? (last.text || (last.voice ? '🎙 voice note' : last.type)) : '',
                unread: c.unread || undefined,
                chip: open ? { label: `⏱ ${hoursLeft}h`, tone: 'ok' }
                           : { label: '📋 template', tone: 'warn' },
            };
        });
}
