/**
 * wa-api.js
 * Entry point — SgToolApi registration, activate, then UI mount.
 * Sending actions are granular by design (Decision 5): no auto-send exists.
 * @module wa-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { state, conversationRows, getConversation, windowOpen } from './wa-state.js';
import * as P from './wa-pipeline.js';
import * as Voice from './wa-voice.js';
import { draftReply, DRAFT_MODELS } from './wa-draft.js';
import { loadDemo, demoSend } from './wa-demo.js';
import { init as initShell } from '../ui/ui-shell.js';

const api = new SgToolApi({
    name:     'whatsapp-desk',
    version:  { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(eventName, detail = {}) { api._emit(eventName, detail); }

P.boot({ emit });
Voice.bootVoice({ emit });

function getStatus() {
    return {
        connected: state.connected, mode: state.mode, demo: state.demo,
        displayNumber: state.displayNumber, verifiedName: state.verifiedName,
        relayOk: state.relayOk, cursor: state.cursor,
        conversations: state.conversations.size,
        unread: [...state.conversations.values()].reduce((s, c) => s + (c.unread || 0), 0),
        creds: P.maskedCreds(),
        keySet: !!Voice.getOpenRouterKey(),
        costs: Voice.getCostSummary(),
    };
}

function getMessages({ conversationId, limit = 50 } = {}) {
    const conv = getConversation(conversationId);
    if (!conv) throw Object.assign(new Error(`Unknown conversation: ${conversationId}`), { code: 'wa-error' });
    return {
        conversationId, name: conv.name,
        windowOpen: windowOpen(conv), windowExpiresAt: conv.windowExpiresAt,
        messages: conv.messages.slice(-limit).map(({ demoBlob, ...m }) => m),
    };
}

async function downloadMedia({ messageId }) {
    const { message } = Voice.findMessage(messageId);
    if (!message) throw Object.assign(new Error(`Unknown message: ${messageId}`), { code: 'wa-error' });
    const { blob, mimeType } = message.demoBlob
        ? { blob: message.demoBlob, mimeType: message.mimeType }
        : await P.fetchMedia(message.id, message.mediaId);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${messageId}.${(mimeType || '').split('/')[1]?.split(';')[0] || 'bin'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return { messageId, byteSize: blob.size };
}

api
    // Account
    .register('setCreds',   (p = {}) => P.setCreds(p), { async: false,
        sanitiseParams: p => ({ ...p, token: p.token ? '••••' : undefined, relayToken: p.relayToken ? '••••' : undefined }) })
    .register('connect',       async () => await P.connect(),       { async: true,  events: [WA_EVENTS.CONNECTED, WA_EVENTS.ERROR] })
    .register('connectBridge', async () => await P.connectBridge(), { async: true,  events: [WA_EVENTS.CONNECTED, WA_EVENTS.ERROR] })
    .register('bridgeStatus',  async () => await P.bridgeStatus(),  { async: true })
    .register('disconnect', () => { P.disconnect(); return { ok: true }; }, { async: false, events: [WA_EVENTS.DISCONNECTED] })
    .register('setOpenRouterKey', ({ apiKey }) => { Voice.setOpenRouterKey(apiKey); return { ok: true }; },
        { async: false, sanitiseParams: p => ({ ...p, apiKey: '••••' }) })
    // Inbound
    .register('syncInbound',       async () => await P.syncInbound(), { async: true, events: [WA_EVENTS.SYNC, WA_EVENTS.MESSAGE_IN, WA_EVENTS.RECEIPT] })
    .register('listConversations', () => conversationRows(),          { async: false })
    .register('openConversation',  ({ conversationId }) => {
        window.dispatchEvent(new CustomEvent('wa-desk:open-conversation', { detail: { conversationId } }));
        return { conversationId };
    }, { async: false })
    .register('getMessages', (p = {}) => getMessages(p),              { async: false })
    .register('markRead',    async (p = {}) => state.demo ? { ok: true, demo: true } : await P.markRead(p), { async: true })
    // Send (demo mode records locally, never touches the network)
    .register('sendText',     async (p = {}) => state.demo ? demoSend(p.conversationId || p.to, p.body, { emit }) : await P.sendText(p),
        { async: true, events: [WA_EVENTS.MESSAGE_OUT, WA_EVENTS.ERROR] })
    .register('sendTemplate', async (p = {}) => state.demo ? demoSend(p.to || p.conversationId, `[template: ${p.name}]`, { emit }) : await P.sendTemplate(p),
        { async: true, events: [WA_EVENTS.MESSAGE_OUT, WA_EVENTS.ERROR] })
    .register('sendMedia',    async (p = {}) => await P.sendMedia(p), { async: true, events: [WA_EVENTS.MESSAGE_OUT, WA_EVENTS.ERROR] })
    .register('listTemplates', async () => state.demo ? state.templates : await P.listTemplates(), { async: true })
    // Voice + AI (draft-only)
    .register('transcribeVoiceNote', async (p = {}) => await Voice.transcribeVoiceNote(p),
        { async: true, events: [WA_EVENTS.TRANSCRIPT_COMPLETE, WA_EVENTS.ERROR] })
    .register('draftReply',  async (p = {}) => await draftReply({ emit }, p), { async: true, events: [WA_EVENTS.DRAFT_READY, WA_EVENTS.ERROR] })
    .register('listDraftModels', () => DRAFT_MODELS,                  { async: false })
    .register('getCostSummary',  () => Voice.getCostSummary(),        { async: false })
    // Media + demo + standard
    .register('downloadMedia', async (p = {}) => await downloadMedia(p), { async: true })
    .register('loadDemo',   () => loadDemo({ emit }),                 { async: false, events: [WA_EVENTS.SYNC] })
    .register('getStatus',  getStatus,                                { async: false })
    .register('health',     () => ({
        ok: !state.lastError, connected: state.connected, demo: state.demo,
        relayOk: state.relayOk, keySet: !!Voice.getOpenRouterKey(),
    }), { async: false });

api.activate();

await initShell(state, api, emit);
