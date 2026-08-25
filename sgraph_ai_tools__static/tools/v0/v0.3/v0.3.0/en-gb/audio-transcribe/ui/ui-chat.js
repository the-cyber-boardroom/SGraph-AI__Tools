/**
 * ui-chat — reusable "chat with transcript(s)" panel.
 *
 * Reuses the chat components: a [data-llm-bus] cell with a hidden
 * <sg-llm-request> + <sg-llm-chat-history> + <sg-llm-chat-input>. The history
 * component maintains the conversation; we just set the SYSTEM PROMPT =
 * instruction + `getContext()` (the transcript(s)), connect with the saved
 * OpenRouter key + a text model, and show the chat cost.
 *
 * `getContext()` makes this reusable: the session tab passes ALL transcripts;
 * a per-recording panel passes just that recording's transcript.
 *
 * Cost: each turn runs non-streaming so the response carries the generation id;
 * we look up the exact charged cost and accumulate a per-chat-session total.
 *
 * @module audio-transcribe/ui-chat
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import { fetchGenerationCostDeferred } from '../api/openrouter-cost.js';

const KEY_STORAGE = 'sg-openrouter-mgmt-key';
const CHAT_MODELS = ['google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5', 'google/gemini-3.1-flash-lite', 'anthropic/claude-sonnet-4-6'];

function buildSystemPrompt(ctx) {
    const body = ctx && ctx.trim() ? ctx : '(No transcript yet — transcribe some audio first.)';
    return `You are a helpful assistant working with the user's audio transcript(s) shown below. Answer questions about them, summarise, extract, translate, or reformat as asked. Be concise and quote relevant lines when useful.\n\nTRANSCRIPTS:\n${body}`;
}

/**
 * @param {{ root: HTMLElement, getContext: () => string, compact?: boolean }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountChat({ root, getContext, compact = false }) {
    root.innerHTML = `
        <div class="at-chat">
            <div class="at-chat__bar">
                <label class="at-tts__lbl" for="at-chat-model">Model</label>
                <select class="at-select" data-chat-model>${CHAT_MODELS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
                <button type="button" class="at-btn small" data-chat-refresh>↻ Context</button>
                <span class="at-chat__cost" data-chat-cost></span>
            </div>
            ${compact ? '' : `<details class="at-chat__sys"><summary>System prompt / context (editable)</summary><textarea class="at-tts__text" data-chat-sys rows="6"></textarea></details>`}
            <div class="at-chat__convo" data-llm-bus data-chat-bus>
                <sg-llm-request style="display:none"></sg-llm-request>
                <sg-llm-chat-history data-chat-hist></sg-llm-chat-history>
                <sg-llm-chat-input data-chat-in></sg-llm-chat-input>
            </div>
        </div>
    `;

    const bus      = root.querySelector('[data-chat-bus]');
    const hist     = root.querySelector('[data-chat-hist]');
    const modelSel = root.querySelector('[data-chat-model]');
    const refreshBtn = root.querySelector('[data-chat-refresh]');
    const costEl   = root.querySelector('[data-chat-cost]');
    const sysEl    = root.querySelector('[data-chat-sys]'); // null in compact mode

    const key = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (_) { return ''; } };
    let sysPrompt = buildSystemPrompt(getContext());

    function applySys() { if (hist && hist.setSystemPrompt) hist.setSystemPrompt(sysPrompt); }
    function refreshContext() {
        sysPrompt = buildSystemPrompt(getContext());
        if (sysEl) sysEl.value = sysPrompt;
        applySys();
    }
    function connect() {
        if (bus) {
            bus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, { detail: { provider: 'openrouter', model: modelSel.value, apiKey: key(), baseUrl: '' }, bubbles: true, composed: true }));
            // Non-streaming so each reply carries the generation id (for cost).
            bus.dispatchEvent(new CustomEvent(SGL_LLM.STREAMING_CHANGED, { detail: { streaming: false }, bubbles: true, composed: true }));
        }
    }

    // ── Cost tracking ─────────────────────────────────────────────────────────
    let sessionUsd = 0, turns = 0, lastUsd = null, pending = 0;
    function renderCost() {
        if (!turns) { costEl.textContent = ''; return; }
        const last = lastUsd != null ? ` · last $${lastUsd.toFixed(4)}` : '';
        costEl.textContent = `💰 $${sessionUsd.toFixed(4)} · ${turns} turn${turns === 1 ? '' : 's'}${last}${pending ? ' …' : ''}`;
    }
    function onComplete(e) {
        const d = e.detail || {};
        const genId = (d.rawResponse && d.rawResponse.id) || (d.rawChunks && d.rawChunks[0] && d.rawChunks[0].id);
        turns += 1; renderCost();
        if (genId) {
            pending += 1; renderCost();
            Promise.resolve(fetchGenerationCostDeferred(genId, key())).then((c) => {
                if (typeof c === 'number') { sessionUsd += c; lastUsd = c; }
            }).catch(() => {}).finally(() => { pending = Math.max(0, pending - 1); renderCost(); });
        }
    }

    function onModel() { connect(); }
    function onRefresh() { refreshContext(); connect(); }
    function onSysEdit() { if (sysEl) { sysPrompt = sysEl.value; applySys(); } }

    modelSel.addEventListener('change', onModel);
    refreshBtn.addEventListener('click', onRefresh);
    if (sysEl) sysEl.addEventListener('change', onSysEdit);
    bus.addEventListener(SGL_LLM.REQUEST_COMPLETE, onComplete);

    (async () => {
        try {
            if (typeof customElements !== 'undefined' && customElements.whenDefined) {
                await customElements.whenDefined('sg-llm-chat-history');
                await customElements.whenDefined('sg-llm-request');
            }
        } catch (_) { /* */ }
        refreshContext();
        connect();
    })();

    return {
        destroy() {
            modelSel.removeEventListener('change', onModel);
            refreshBtn.removeEventListener('click', onRefresh);
            if (sysEl) sysEl.removeEventListener('change', onSysEdit);
            bus.removeEventListener(SGL_LLM.REQUEST_COMPLETE, onComplete);
            root.innerHTML = '';
        },
    };
}
