/**
 * wa-voice.js
 * Voice-note transcription: fetch the media blob from Meta, run it through
 * core/sg-transcribe (the WhatsApp-opus engine — decode handled inside),
 * cache the transcript on the message. Multi-item store keyed by messageId
 * implements the engine's state contract.
 * @module wa-voice
 */

import { buildTranscribeMethods } from '/core/sg-transcribe/v0/v0.1/v0.1.0/api-transcribe.js';
import { makeIsolatedTransport } from '/core/sg-transcribe/v0/v0.1/v0.1.0/llm-transport.js';
import { fetchGenerationCostDeferred } from '/core/sg-transcribe/v0/v0.1/v0.1.0/openrouter-cost.js';
import { DEFAULT_MODEL } from '/core/sg-transcribe/v0/v0.1/v0.1.0/audio-models.js';
import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { state, getConversation } from './wa-state.js';
import { getApi } from './wa-pipeline.js';

export const KEY_STORAGE = 'sg-openrouter-mgmt-key';   // shared across the tools family

let _vidSeq = 0;
const itemStore = {
    items: [],                       // one item per transcribed messageId
    auxCosts: [],
    activeModel: DEFAULT_MODEL,
    getItems()      { return this.items; },
    getRawItem(id)  { return this.items.find(i => i.id === id) || null; },
    updateItem(id, patch) { const it = this.getRawItem(id); if (it) Object.assign(it, patch); },
    addVersion(id, obj) {
        const it = this.getRawItem(id);
        if (!it) return null;
        const vid = `v${++_vidSeq}`;
        it.versions.push({ vid, ...obj });
        return vid;
    },
    updateVersion(id, vid, patch) {
        const v = this.getRawItem(id)?.versions.find(x => x.vid === vid);
        if (v) Object.assign(v, patch);
    },
    setActiveModel(m) { this.activeModel = m; },
    getAuxCosts()     { return this.auxCosts; },
    getSpendCap()     { return null; },
};

let _emit = () => {}, _methods = null, _sendToLlm = null;

export function bootVoice({ emit }) {
    _emit = emit;
    const host = document.createElement('div');
    host.setAttribute('data-wa-llm-host', '');
    host.hidden = true;
    document.body.appendChild(host);
    _sendToLlm = makeIsolatedTransport(host, getOpenRouterKey);
    _methods = buildTranscribeMethods({
        state: itemStore,
        emit: (n, d) => _emit(n, d),
        sendToLlm: _sendToLlm,
        getActiveModel: () => itemStore.activeModel,
        fetchCost: fetchGenerationCostDeferred,
    });
}

export function getOpenRouterKey()  { return localStorage.getItem(KEY_STORAGE) || ''; }
export function setOpenRouterKey(k) {
    if (k) localStorage.setItem(KEY_STORAGE, k.trim());
    else   localStorage.removeItem(KEY_STORAGE);
}
export function getSendToLlm() { return _sendToLlm; }

/** Find a message (and its conversation) by message id across state. */
export function findMessage(messageId) {
    for (const conv of state.conversations.values()) {
        const m = conv.messages.find(x => x.id === messageId);
        if (m) return { conv, message: m };
    }
    return { conv: null, message: null };
}

/**
 * Transcribe one voice note / audio message. Result cached on the message.
 * @param {{ messageId: string, model?: string }} params
 * @returns {Promise<{ text: string, costUsd?: number, cached?: boolean }>}
 */
export async function transcribeVoiceNote({ messageId, model } = {}) {
    const { conv, message } = findMessage(messageId);
    if (!message) throw Object.assign(new Error(`Unknown message: ${messageId}`), { code: 'wa-error' });
    if (message.transcript) return { text: message.transcript, cached: true };
    if (message.type !== 'audio') throw Object.assign(new Error('Not an audio message.'), { code: 'wa-error' });
    if (!getOpenRouterKey()) throw Object.assign(new Error('No OpenRouter key set (Accounts).'), { code: 'key-missing' });

    // Demo messages carry their blob directly; live ones fetch from Meta.
    const { blob, mimeType } = message.demoBlob
        ? { blob: message.demoBlob, mimeType: message.mimeType }
        : await getApi().fetchMedia(message.mediaId);

    const ext  = (mimeType || '').includes('ogg') ? 'ogg' : 'bin';
    const name = `${messageId}.${ext}`;
    if (!itemStore.getRawItem(messageId)) {
        itemStore.items.push({ id: messageId, name, blob,
            mimeType: mimeType || blob.type, sizeBytes: blob.size, model: null, versions: [] });
    }
    const r = await _methods.transcribeItem({ id: messageId, model });
    message.transcript = r.text;
    if (conv) conv.lastActivity = Math.max(conv.lastActivity, Date.now());
    _emit(WA_EVENTS.TRANSCRIPT_COMPLETE, { messageId, costUsd: r.usage?.costUsd });
    return { text: r.text, costUsd: r.usage?.costUsd };
}

/** Session cost roll-up (transcriptions + drafts via aux). */
export function getCostSummary() {
    let usd = 0;
    for (const it of itemStore.items) for (const v of it.versions) if (typeof v.costUsd === 'number') usd += v.costUsd;
    let aux = 0;
    for (const a of itemStore.auxCosts) if (typeof a.usd === 'number') aux += a.usd;
    return { transcriptionUsd: usd, draftUsd: aux, totalUsd: usd + aux };
}

export function addAuxCost(entry) { itemStore.auxCosts.push(entry); }
