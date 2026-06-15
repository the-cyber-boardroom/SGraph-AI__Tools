/**
 * ui-chat — "Chat with your transcripts".
 *
 * Reuses the existing chat components: a [data-llm-bus] cell holds a hidden
 * <sg-llm-request> + <sg-llm-chat-history> + <sg-llm-chat-input>. The history
 * component maintains the conversation and assembles each turn's messages
 * (system prompt + turns); we just set the SYSTEM PROMPT = context + the
 * transcript(s), connect with the saved OpenRouter key + a text model, and let
 * the components do the rest. Chat is sequential, so this persistent bus is safe
 * (no isolated transport needed).
 *
 * @module audio-transcribe/ui-chat
 */

import { SGL_LLM } from '../../../../../../../components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const KEY_STORAGE = 'sg-openrouter-mgmt-key';
/** Small curated TEXT-model list for chat (not the audio-input list). */
const CHAT_MODELS = ['google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5', 'google/gemini-3.1-flash-lite', 'anthropic/claude-sonnet-4-6'];

function buildSystemPrompt(done) {
    const body = done.length
        ? done.map((it, i) => `### Transcript ${i + 1} — ${it.name}\n${it.transcript}`).join('\n\n')
        : '(No transcripts yet — transcribe some audio, then click "↻ Context".)';
    return `You are a helpful assistant working with the user's audio transcript(s) shown below. Answer questions about them, summarise, extract, translate, or reformat as asked. Be concise and quote relevant lines when useful.\n\nTRANSCRIPTS:\n${body}`;
}

/**
 * @param {{ root: HTMLElement, state: object, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountChat({ root, state }) {
    root.innerHTML = `
        <div class="at-chat">
            <div class="at-chat__bar">
                <label class="at-tts__lbl" for="at-chat-model">Model</label>
                <select class="at-select" id="at-chat-model">${CHAT_MODELS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
                <button type="button" class="at-btn small" id="at-chat-refresh">↻ Context (<span id="at-chat-n">0</span>)</button>
            </div>
            <details class="at-chat__sys">
                <summary>System prompt / context (editable)</summary>
                <textarea class="at-tts__text" id="at-chat-sys" rows="6"></textarea>
            </details>
            <div class="at-chat__convo" data-llm-bus id="at-chat-bus">
                <sg-llm-request style="display:none"></sg-llm-request>
                <sg-llm-chat-history id="at-chat-hist"></sg-llm-chat-history>
                <sg-llm-chat-input id="at-chat-in"></sg-llm-chat-input>
            </div>
        </div>
    `;

    const bus      = root.querySelector('#at-chat-bus');
    const hist     = root.querySelector('#at-chat-hist');
    const modelSel = root.querySelector('#at-chat-model');
    const refreshBtn = root.querySelector('#at-chat-refresh');
    const nEl      = root.querySelector('#at-chat-n');
    const sysEl    = root.querySelector('#at-chat-sys');

    const key = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (_) { return ''; } };

    function refreshContext() {
        const done = state.getItems().filter((i) => i.status === 'done' && i.transcript);
        nEl.textContent = String(done.length);
        sysEl.value = buildSystemPrompt(done);
        if (hist && hist.setSystemPrompt) hist.setSystemPrompt(sysEl.value);
    }
    function connect() {
        if (bus) bus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
            detail: { provider: 'openrouter', model: modelSel.value, apiKey: key(), baseUrl: '' },
            bubbles: true, composed: true,
        }));
    }

    function onModel() { connect(); }
    function onRefresh() { refreshContext(); connect(); }
    function onSysEdit() { if (hist && hist.setSystemPrompt) hist.setSystemPrompt(sysEl.value); }

    modelSel.addEventListener('change', onModel);
    refreshBtn.addEventListener('click', onRefresh);
    sysEl.addEventListener('change', onSysEdit);

    // Wait for the chat components to upgrade, then seed the system prompt +
    // connect with the saved key (guarded so it's a no-op under the Node DOM).
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
            sysEl.removeEventListener('change', onSysEdit);
            root.innerHTML = '';
        },
    };
}
