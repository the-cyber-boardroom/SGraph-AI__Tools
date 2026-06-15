/**
 * ui-tts — "Create voice" panel: text → speech, local (Kokoro) or OpenRouter.
 *
 * Calls the tts module directly (it needs the audio Blob to play/download), and
 * uses api.addFiles for the round-trip "Add to queue" (synth → transcribe). The
 * OpenRouter key is read from the same localStorage slot the model panel uses.
 *
 * @module audio-transcribe/ui-tts
 */

import { synthesize, TTS_VOICES, TTS_OPENROUTER_DEFAULT_MODEL } from '../api/tts.js';
import { fetchGenerationCostDeferred } from '../api/openrouter-cost.js';

const KEY_STORAGE = 'sg-openrouter-mgmt-key';

/**
 * @param {{ root: HTMLElement, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountTts({ root, api }) {
    let objUrl = null;
    let lastBlob = null;
    let synthSeq = 0; // guards a late cost from overwriting a newer synth

    root.innerHTML = `
        <h2 class="at-panel__title">Create voice (text → speech)</h2>
        <div class="at-tts">
            <div class="at-tts__row">
                <span class="at-tts__lbl">Engine</span>
                <label class="at-adv__chk"><input type="radio" name="at-tts-mode" value="local" checked> Local · free (Kokoro)</label>
                <label class="at-adv__chk"><input type="radio" name="at-tts-mode" value="openrouter"> OpenRouter · key</label>
            </div>
            <div class="at-tts__row">
                <label class="at-tts__lbl" for="at-tts-voice">Voice</label>
                <select class="at-select" id="at-tts-voice"></select>
            </div>
            <textarea class="at-tts__text" id="at-tts-text" rows="4" placeholder="Type text to speak…"></textarea>
            <div class="at-tts__actions">
                <button type="button" class="at-btn primary" id="at-tts-go">Synthesize</button>
                <span class="at-status-line" id="at-tts-status"></span>
            </div>
            <div class="at-tts__result" id="at-tts-result" hidden>
                <audio class="at-item__audio" id="at-tts-audio" controls></audio>
                <div class="at-tts__actions">
                    <button type="button" class="at-btn small" id="at-tts-dl">Download .wav</button>
                    <button type="button" class="at-btn small" id="at-tts-add">Add to queue ▸</button>
                </div>
            </div>
        </div>
    `;

    const modeRadios = [...root.querySelectorAll('input[name="at-tts-mode"]')];
    const voiceSel = root.querySelector('#at-tts-voice');
    const textEl   = root.querySelector('#at-tts-text');
    const goBtn    = root.querySelector('#at-tts-go');
    const statusEl = root.querySelector('#at-tts-status');
    const resultEl = root.querySelector('#at-tts-result');
    const audioEl  = root.querySelector('#at-tts-audio');
    const dlBtn    = root.querySelector('#at-tts-dl');
    const addBtn   = root.querySelector('#at-tts-add');

    const mode = () => (modeRadios.find((r) => r.checked) || {}).value || 'local';
    function fillVoices() {
        const vs = TTS_VOICES[mode()] || [];
        voiceSel.innerHTML = vs.map((v) => `<option value="${v}">${v}</option>`).join('');
    }
    fillVoices();
    modeRadios.forEach((r) => r.addEventListener('change', fillVoices));

    async function onGo() {
        const text = textEl.value.trim();
        if (!text) { statusEl.textContent = 'Enter some text.'; return; }
        goBtn.disabled = true;
        const seq = ++synthSeq;
        statusEl.textContent = mode() === 'local'
            ? 'Synthesising… (first local run downloads the ~160 MB voice model)'
            : 'Synthesising via OpenRouter…';
        try {
            let apiKey = '';
            try { apiKey = localStorage.getItem(KEY_STORAGE) || ''; } catch (_) { /* */ }
            const r = await synthesize({
                text, mode: mode(), voice: voiceSel.value, apiKey,
                model: mode() === 'openrouter' ? TTS_OPENROUTER_DEFAULT_MODEL : undefined,
            });
            lastBlob = r.blob;
            if (objUrl) URL.revokeObjectURL(objUrl);
            objUrl = URL.createObjectURL(r.blob);
            audioEl.src = objUrl;
            resultEl.hidden = false;
            const base = `Done · ${(r.blob.size / 1024).toFixed(0)} KB${r.durationMs ? `, ${(r.durationMs / 1000).toFixed(1)}s` : ''} (${r.mode})`;
            if (r.mode === 'local') {
                statusEl.textContent = `${base} · 💰 free (on-device)`;
            } else if (r.generationId && apiKey) {
                // Cost of this synthesis — resolved a couple of seconds later by id.
                statusEl.textContent = `${base} · 💰 …`;
                Promise.resolve(fetchGenerationCostDeferred(r.generationId, apiKey)).then((cost) => {
                    if (seq !== synthSeq) return; // a newer synth has replaced this one
                    statusEl.textContent = `${base} · ${cost != null ? `💰 $${cost.toFixed(4)}` : '💰 cost n/a'}`;
                }).catch(() => { if (seq === synthSeq) statusEl.textContent = `${base} · 💰 cost n/a`; });
            } else {
                statusEl.textContent = `${base}.`;
            }
        } catch (err) { statusEl.textContent = `Failed: ${err.message}`; }
        finally { goBtn.disabled = false; }
    }
    function onDl() {
        if (!lastBlob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(lastBlob); a.download = 'voice.wav';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 0);
    }
    async function onAdd() {
        if (!lastBlob) return;
        addBtn.disabled = true;
        try {
            await api.addFiles({ files: [new File([lastBlob], `voice-${Date.now()}.wav`, { type: 'audio/wav' })] });
            statusEl.textContent = 'Added to the queue — switch to Queue to transcribe it.';
        } catch (err) { statusEl.textContent = `Add failed: ${err.message}`; }
        finally { addBtn.disabled = false; }
    }

    goBtn.addEventListener('click', onGo);
    dlBtn.addEventListener('click', onDl);
    addBtn.addEventListener('click', onAdd);

    return { destroy() { if (objUrl) URL.revokeObjectURL(objUrl); root.innerHTML = ''; } };
}
