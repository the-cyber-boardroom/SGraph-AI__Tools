/**
 * wa-draft.js
 * Draft-only AI replies (Decision 5): thread context (+ any transcripts)
 * → sg-llm-request via the isolated transport → composer. NEVER sends.
 * @module wa-draft
 */

import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { getConversation } from './wa-state.js';
import { getSendToLlm, getOpenRouterKey, addAuxCost } from './wa-voice.js';

/** Same curated set as the publisher's metadata models; Sonnet writes best. */
export const DRAFT_MODELS = [
    { id: 'anthropic/claude-sonnet-4-6',  label: 'Claude Sonnet 4.6 (best replies)' },
    { id: 'google/gemini-3.5-flash',      label: 'Gemini 3.5 Flash (fast + cheap)' },
    { id: 'anthropic/claude-haiku-4.5',   label: 'Claude Haiku 4.5' },
];
export const DRAFT_DEFAULT_MODEL = DRAFT_MODELS[0].id;

const SYSTEM_PROMPT = [
    'You draft a WhatsApp reply on behalf of the business account owner.',
    'Reply with ONLY the message text to send — no preamble, no quotes, no sign-off unless asked.',
    'Match the conversation\'s language and tone; WhatsApp-appropriate length (short).',
].join('\n');

const CONTEXT_LIMIT = 30;   // most recent messages

function threadContext(conv) {
    return conv.messages.slice(-CONTEXT_LIMIT).map(m => {
        const who = m.direction === 'in' ? (conv.name || 'Customer') : 'Me';
        const body = m.text
            || (m.transcript ? `(voice note) ${m.transcript}` : '')
            || `(${m.type}${m.voice ? ' voice note — not transcribed yet' : ''})`;
        return `${who}: ${body}`;
    }).join('\n');
}

/**
 * Draft a reply for a conversation. Fills nothing itself — the UI puts the
 * returned draft in the composer; sending stays a separate explicit action.
 * @param {object} deps  { emit }
 * @param {{ conversationId: string, guidance?: string, model?: string }} params
 * @returns {Promise<{ draft: string, model: string, costUsd?: number }>}
 */
export async function draftReply({ emit }, { conversationId, guidance, model } = {}) {
    const conv = getConversation(conversationId);
    if (!conv) throw Object.assign(new Error(`Unknown conversation: ${conversationId}`), { code: 'wa-error' });
    if (!getOpenRouterKey()) throw Object.assign(new Error('No OpenRouter key set (Accounts).'), { code: 'key-missing' });

    const useModel = model || DRAFT_DEFAULT_MODEL;
    const messages = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCONVERSATION:\n${threadContext(conv)}` },
        { role: 'user', content: guidance
            ? `Draft the reply. Guidance: ${guidance}`
            : 'Draft the reply.' },
    ];
    const res = await getSendToLlm()({ messages, model: useModel });
    const draft = String(res.content ?? '').trim();
    const costUsd = typeof res.responseCost === 'number' ? res.responseCost : undefined;
    addAuxCost({ kind: 'draft', usd: costUsd ?? null, generationId: res.generationId });
    emit(WA_EVENTS.DRAFT_READY, { conversationId });
    return { draft, model: useModel, costUsd };
}
