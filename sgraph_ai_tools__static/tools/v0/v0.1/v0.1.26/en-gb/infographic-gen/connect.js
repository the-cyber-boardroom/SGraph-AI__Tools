/**
 * Infographic Generator — connect handler.
 * Validates an OpenRouter API key and fires SGL_LLM.CONNECTED on the bus.
 *
 * @version 0.1.26
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

/**
 * Wire up the Connect button for the given DOM refs.
 *
 * @param {object} refs
 * @param {HTMLElement}  refs.bus
 * @param {HTMLInputElement} refs.apiKeyEl
 * @param {HTMLButtonElement} refs.connectBtn
 * @param {HTMLElement}  refs.statusEl
 * @param {object}       refs.modelPicker   sg-infographic-model-picker element
 * @param {Function}     refs.savePrefs
 */
function wireConnect({ bus, apiKeyEl, connectBtn, statusEl, modelPicker, savePrefs }) {
    function setStatus(text, type) { statusEl.textContent = text; statusEl.className = type; }

    connectBtn.addEventListener('click', async () => {
        const apiKey = apiKeyEl.value.trim();
        const model  = modelPicker.getModel();
        if (!apiKey) { setStatus('OpenRouter key required', 'error'); return; }

        setStatus('Connecting\u2026', '');
        connectBtn.disabled = true;

        try {
            const res = await fetch('https://openrouter.ai/api/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            savePrefs({ apiKey, model });
            setStatus(`Connected \u2713  (${model.split('/').pop()})`, 'ok');

            bus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
                detail: { provider: 'openrouter', model, apiKey, baseUrl: '' },
                bubbles: true,
            }));
        } catch (err) {
            setStatus(`Error: ${err.message}`, 'error');
        }
        connectBtn.disabled = false;
    });

    // Re-connect + save when model changes
    modelPicker.addEventListener('infographic:model-changed', e => {
        savePrefs({ model: e.detail.model });
        if (apiKeyEl.value.trim()) connectBtn.click();
    });
}

export { wireConnect };
