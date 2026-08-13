/**
 * wa-pipeline.js
 * Orchestration: credentials, connect, the relay poll loop, sends with
 * client-side 24h-window enforcement, receipts. Composes core/sg-whatsapp;
 * the UI never imports core directly.
 * @module wa-pipeline
 */

import { WhatsAppApi } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-api.js';
import { RelayClient } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-relay.js';
import { BridgeClient } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-bridge.js';
import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { state, getConversation, windowOpen, applyEvents, recordOutbound, resetState } from './wa-state.js';

const KEYS = Object.freeze({
    token:       'sg-whatsapp-token',
    phoneId:     'sg-whatsapp-phone-id',
    wabaId:      'sg-whatsapp-waba-id',
    relayUrl:    'sg-whatsapp-relay-url',
    relayToken:  'sg-whatsapp-relay-token',
    bridgeUrl:   'sg-whatsapp-bridge-url',
    bridgeToken: 'sg-whatsapp-bridge-token',
});

const POLL_MS = 10_000;

let _emit = () => {};
let _api = null, _relay = null, _bridge = null, _source = null, _pollTimer = null;

export function boot({ emit }) {
    _emit = emit;
    // Pause polling in hidden tabs (unattended flows are Tier-2's job, not ours).
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) _stopPoll();
        else if (state.connected && _source) _startPoll();
    });
}

// ── Credentials ──────────────────────────────────────────────────────────────

export function getCreds() {
    const g = k => localStorage.getItem(k) || '';
    return { token: g(KEYS.token), phoneNumberId: g(KEYS.phoneId), wabaId: g(KEYS.wabaId),
             relayUrl: g(KEYS.relayUrl), relayToken: g(KEYS.relayToken),
             bridgeUrl: g(KEYS.bridgeUrl), bridgeToken: g(KEYS.bridgeToken) };
}

export function setCreds({ token, phoneNumberId, wabaId, relayUrl, relayToken, bridgeUrl, bridgeToken } = {}) {
    const s = (k, v) => { if (v !== undefined) { v ? localStorage.setItem(k, String(v).trim()) : localStorage.removeItem(k); } };
    s(KEYS.token, token); s(KEYS.phoneId, phoneNumberId); s(KEYS.wabaId, wabaId);
    s(KEYS.relayUrl, relayUrl); s(KEYS.relayToken, relayToken);
    s(KEYS.bridgeUrl, bridgeUrl); s(KEYS.bridgeToken, bridgeToken);
    return maskedCreds();
}

export function maskedCreds() {
    const c = getCreds();
    return { tokenSet: !!c.token, phoneNumberId: c.phoneNumberId, wabaId: c.wabaId,
             relayUrl: c.relayUrl, relayTokenSet: !!c.relayToken,
             bridgeUrl: c.bridgeUrl, bridgeTokenSet: !!c.bridgeToken };
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
    state.mode          = 'cloud';
    state.demo          = false;
    state.displayNumber = info?.display_phone_number ?? null;
    state.verifiedName  = info?.verified_name ?? null;

    if (c.relayUrl && c.relayToken) {
        _relay = new RelayClient({ url: c.relayUrl, token: c.relayToken });
        _source = _relay;
        state.relayOk = true;
        _startPoll();
    }
    _emit(WA_EVENTS.CONNECTED, { phoneNumberId: c.phoneNumberId, displayNumber: state.displayNumber });
    return { displayNumber: state.displayNumber, verifiedName: state.verifiedName, relay: state.relayOk };
}

/**
 * Connect in Bridge (companion) mode — inbound + outbound both via the local
 * whatsapp_bridge. No 24h window, no templates; a normal client.
 * ⚠️ Unofficial route — expendable-number use only (whatsapp_bridge/README.md).
 */
export async function connectBridge() {
    const c = getCreds();
    if (!c.bridgeUrl || !c.bridgeToken) {
        throw Object.assign(new Error('Set the bridge URL and token first (Accounts).'), { code: 'bridge-auth' });
    }
    _bridge = new BridgeClient({ url: c.bridgeUrl, token: c.bridgeToken });
    const st = await _bridge.status();            // throws typed if unreachable
    state.connected     = true;
    state.mode          = 'bridge';
    state.demo          = false;
    state.relayOk       = false;
    state.displayNumber = st?.me?.id ?? null;
    state.verifiedName  = st?.me?.name ?? 'Bridge (companion)';
    _source = _bridge;
    _startPoll();
    _emit(WA_EVENTS.CONNECTED, { mode: 'bridge', displayNumber: state.displayNumber, linked: !!st?.linked, qr: st?.qr ?? null });
    return { mode: 'bridge', linked: !!st?.linked, qr: st?.qr ?? null, me: st?.me ?? null };
}

/** Poll the bridge's link status (QR → linked) while the user scans. */
export async function bridgeStatus() {
    if (!_bridge) throw Object.assign(new Error('Bridge not connected.'), { code: 'bridge-auth' });
    return _bridge.status();
}

export function disconnect() {
    _stopPoll();
    _api = null; _relay = null; _bridge = null; _source = null;
    resetState();
    _emit(WA_EVENTS.DISCONNECTED, {});
}

export function getApi() {
    if (!_api) throw Object.assign(new Error('Not connected.'), { code: 'auth-invalid' });
    return _api;
}

// ── Inbound (relay or bridge poll — same pull() contract) ────────────────────

export async function syncInbound() {
    if (!_source) throw Object.assign(new Error('No inbound source (configure the relay or bridge in Accounts).'), { code: 'relay-unreachable' });
    const { events, cursor } = await _source.pull(state.cursor);
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
    const { messageId } = state.mode === 'bridge'
        ? await _bridge.sendText(target, body)
        : await getApi().sendText(target, body);
    recordOutbound(target, { messageId, type: 'text', text: body });
    _emit(WA_EVENTS.MESSAGE_OUT, { conversationId: target, messageId });
    return { messageId };
}

/** Fetch a media blob via whichever source is active (bridge or Cloud API). */
export async function fetchMedia(messageId, mediaId) {
    if (state.mode === 'bridge') return _bridge.fetchMedia(messageId);
    return getApi().fetchMedia(mediaId);
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
