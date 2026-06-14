/**
 * ui-model — curated model selector + OpenRouter key capture + connect.
 *
 * The OpenRouter key is PERSISTED (decision §11.1) under the same localStorage
 * key the key-manager component uses (`sg-openrouter-mgmt-key`), the allowed
 * CLAUDE.md rule-7 exception for tools that need persistence. `connect()` reads
 * the persisted key and fires `llm:connected` (via the api action).
 *
 * @module audio-transcribe/ui-model
 */

import { listModels } from '../api/audio-models.js';

const STORAGE_KEY = 'sg-openrouter-mgmt-key';

/** Escape for HTML attribute/text. */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/**
 * Mount the model + connect panel.
 * @param {{ root: HTMLElement, state: object, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountModel({ root, state, api }) {
    // Render from the pure, synchronous model list. NB: api.listModels() (the
    // SgToolApi action) returns a Promise — every registered action is async —
    // so it must not be used directly where a synchronous array is expected.
    const models = listModels();
    const active = state.getActiveModel();

    const options = models.map((m) => {
        const badge = `${m.cost}/${m.speed}${m.available ? '' : ' — coming soon'}`;
        return `<option value="${esc(m.id)}" ${m.id === active ? 'selected' : ''} ${m.available ? '' : 'disabled'}>${esc(m.label)} (${esc(badge)})</option>`;
    }).join('');

    let storedKey = '';
    try { storedKey = localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { /* */ }

    root.innerHTML = `
        <h2 class="at-panel__title">Model &amp; OpenRouter key</h2>
        <div class="at-model-row">
            <label for="at-model-select">Model</label>
            <select class="at-select" id="at-model-select">${options}</select>
        </div>
        <div class="at-model-row">
            <input class="at-key-input" id="at-key" type="password" autocomplete="off" spellcheck="false"
                   placeholder="OpenRouter API key (sk-or-...)" value="${esc(storedKey)}">
            <button type="button" class="at-btn primary" id="at-connect">Connect</button>
        </div>
        <div class="at-status-line" id="at-conn-status">${storedKey ? 'Key saved — click Connect to use it.' : 'Enter your OpenRouter API key. It is stored only in this browser.'}</div>
    `;

    const select = root.querySelector('#at-model-select');
    const keyInput = root.querySelector('#at-key');
    const connectBtn = root.querySelector('#at-connect');
    const status = root.querySelector('#at-conn-status');

    function onModelChange() {
        api.setModel({ model: select.value });
    }

    async function onConnect() {
        const apiKey = keyInput.value.trim();
        try {
            if (apiKey) localStorage.setItem(STORAGE_KEY, apiKey);
            else localStorage.removeItem(STORAGE_KEY);
        } catch (_) { /* storage may be unavailable */ }
        try {
            await api.connect({ apiKey, model: select.value });
            status.textContent = apiKey ? 'Connected to OpenRouter.' : 'No key set — transcription will fail until you connect.';
        } catch (err) { status.textContent = `Connect failed: ${err.message}`; }
    }

    // Auto-connect on load if a key is already persisted.
    if (storedKey) { api.connect({ apiKey: storedKey, model: select.value }).catch(() => {}); }

    select.addEventListener('change', onModelChange);
    connectBtn.addEventListener('click', onConnect);

    return {
        destroy() {
            select.removeEventListener('change', onModelChange);
            connectBtn.removeEventListener('click', onConnect);
        },
    };
}
