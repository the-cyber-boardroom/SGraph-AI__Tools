/**
 * wa-pipeline.js
 * Orchestration: credentials, connect, the relay poll loop, sends with
 * client-side 24h-window enforcement, receipts. Composes core/sg-whatsapp;
 * the UI never imports core directly.
 * @module wa-pipeline
 */

import { WhatsAppApi } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-api.js';
import { RelayClient } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-relay.js';
import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { state, getConversation, windowOpen, applyEvents, recordOutbound, resetState } from './wa-state.js';

const KEYS = Object.freeze({
    token:      'sg-whatsapp-token',
    phoneId:    'sg-whatsapp-phone-id',
    wabaId:     'sg-whatsapp-waba-id',
    relayUrl:   'sg-whatsapp-relay-url',
    relayToken: 'sg-whatsapp-relay-token',
});

const POLL_MS = 10_000;

let _emit = () => {};
let _api = null, _relay = null, _pollTimer = null;

export function boot({ emit }) {
    _emit = emit;
    // Pause polling in hidden tabs (unattended flows are Tier-2's job, not ours).
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) _stopPoll();
        else if (state.connected && state.relayOk) _startPoll();
    });
}

// ── Credentials ──────────────────────────────────────────────────────────────

export function getCreds() {
    const g = k => localStorage.getItem(k) || '';
    return { token: g(KEYS.token), phoneNumberId: g(KEYS.phoneId), wabaId: g(KEYS.wabaId),
             relayUrl: g(KEYS.relayUrl), relayToken: g(KEYS.relayToken) };
}

export function setCreds({ token, phoneNumberId, wabaId, relayUrl, relayToken } = {}) {
    const s = (k, v) => { if (v !== undefined) { v ? localStorage.setItem(k, String(v).trim()) : localStorage.removeItem(k); } };
    s(KEYS.token, token); s(KEYS.phoneId, phoneNumberId); s(KEYS.wabaId, wabaId);
    s(KEYS.relayUrl, relayUrl); s(KEYS.relayToken, relayToken);
    return maskedCreds();
}

export function maskedCreds() {
    const c = getCreds();
    return { tokenSet: !!c.token, phoneNumberId: c.phoneNumberId, wabaId: c.wabaId,
             relayUrl: c.relayUrl, relayTokenSet: !!c.relayToken };
}

// ── Connect ──────────────────────────────────────────────────────────────────

/** Validate the Meta creds (live GET on the number) + arm the relay poll. */
export async function connect() {
    const c = getCreds();
    if (!c.token || !c.phoneNumberId) {
        throw Object.assign(new Error('Set the WhatsApp token and phone-number id first (Accounts).'), { code: 'auth-invalid' });
    }
    _api = new WhatsAppApi({ token: c.token, phoneNumberId: c.phoneNumberId, wabaId: c.wabaId });
    const info = await _api.getPhoneNumber();     // throws typed on bad creds
    state.connected     = true;
    state.demo          = false;
    state.displayNumber = info?.display_phone_number ?? null;
    state.verifiedName  = info?.verified_name ?? null;

    if (c.relayUrl && c.relayToken) {
        _relay = new RelayClient({ url: c.relayUrl, token: c.relayToken });
        state.relayOk = true;
        _startPoll();
    }
    _emit(WA_EVENTS.CONNECTED, { phoneNumberId: c.phoneNumberId, displayNumber: state.displayNumber });
    return { displayNumber: state.displayNumber, verifiedName: state.verifiedName, relay: state.relayOk };
}

export function disconnect() {
    _stopPoll();
    _api = null; _relay = null;
    resetState();
    _emit(WA_EVENTS.DISCONNECTED, {});
}

export function getApi() {
    if (!_api) throw Object.assign(new Error('Not connected.'), { code: 'auth-invalid' });
    return _api;
}

// ── Inbound (relay poll) ─────────────────────────────────────────────────────

export async function syncInbound() {
    if (!_relay) throw Object.assign(new Error('Relay not configured (Accounts).'), { code: 'relay-unreachable' });
    const { events, cursor } = await _relay.pull(state.cursor);
    state.cursor = cursor;
    const summary = applyEvents(events);
    for (const ev of events) {
        if (ev.kind === 'message') _emit(WA_EVENTS.MESSAGE_IN, { conversationId: ev.conversationId, messageId: ev.messageId, type: ev.type });
        else _emit(WA_EVENTS.RECEIPT, { messageId: ev.messageId, status: ev.status });
    }
    for (const w of summary.windowChanges) _emit(WA_EVENTS.WINDOW_CHANGED, { ...w, open: true });
    _emit(WA_EVENTS.SYNC, { newMessages: summary.newMessages, cursor });
    return { newMessages: summary.newMessages, receipts: summary.receipts };
}

function _startPoll() {
    if (_pollTimer) return;
    _pollTimer = setInterval(() => { syncInbound().catch(() => { /* surfaced via wa:error on demand */ }); }, POLL_MS);
}
function _stopPoll() { clearInterval(_pollTimer); _pollTimer = null; }

// ── Sends (client-side window enforcement first — Decision 4) ────────────────

export async function sendText({ conversationId, to, body }) {
    const target = conversationId || to;
    if (!target || !body) throw Object.assign(new Error('conversationId/to and body required'), { code: 'wa-error' });
    const conv = getConversation(target);
    if (conv && !windowOpen(conv)) {
        throw Object.assign(new Error('24h window closed — use sendTemplate.'), { code: 'window-expired' });
    }
    const { messageId } = await getApi().sendText(target, body);
    recordOutbound(target, { messageId, type: 'text', text: body });
    _emit(WA_EVENTS.MESSAGE_OUT, { conversationId: target, messageId });
    return { messageId };
}

export async function sendTemplate({ to, conversationId, name, lang = 'en_GB', components }) {
    const target = to || conversationId;
    const { messageId } = await getApi().sendTemplate(target, name, lang, components);
    recordOutbound(target, { messageId, type: 'text', text: `[template: ${name}]` });
    _emit(WA_EVENTS.MESSAGE_OUT, { conversationId: target, messageId });
    return { messageId };
}

export async function sendMedia({ conversationId, to, file, mediaId, type, caption }) {
    const target = conversationId || to;
    const conv = getConversation(target);
    if (conv && !windowOpen(conv)) {
        throw Object.assign(new Error('24h window closed — media needs an open window.'), { code: 'window-expired' });
    }
    let id = mediaId;
    const kind = type || (file?.type?.split('/')[0] ?? 'document');
    if (!id && file) ({ mediaId: id } = await getApi().uploadMedia(file));
    const { messageId } = await getApi().sendMedia(target, { type: kind, mediaId: id, caption });
    recordOutbound(target, { messageId, type: kind, text: caption || `[${kind}]` });
    _emit(WA_EVENTS.MESSAGE_OUT, { conversationId: target, messageId });
    return { messageId };
}

export async function markRead({ messageId, conversationId }) {
    await getApi().markRead(messageId);
    const conv = getConversation(conversationId);
    if (conv) conv.unread = 0;
    return { ok: true };
}

export async function listTemplates() {
    const { templates } = await getApi().listTemplates();
    state.templates = templates
        .filter(t => t.status === 'APPROVED')
        .map(t => ({ name: t.name, lang: t.language, label: `${t.name} (${t.language})` }));
    return state.templates;
}
