/**
 * ui-item-panel — self-contained per-recording detail panel.
 *
 * Opened as its own (closable) sg-layout tab from the Queue. Each audio item
 * gets a rich view: an audio player, the transcript, and a per-item model
 * selector + Re-transcribe (so you can re-run one file against a different model
 * to debug a bad transcription). Built once, then patched on state changes so
 * the <audio> element is never torn down mid-playback.
 *
 * Future homes (wired-ready): per-item cost (the bus transport exposes the
 * OpenRouter rawResponse + generation id), waveform viz, request/response trace.
 *
 * @module audio-transcribe/ui-item-panel
 */

import { listModels } from '../api/audio-models.js';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtSize(b) { if (!b && b !== 0) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(1)} MB`; }

/**
 * Mount the per-item detail panel.
 * @param {{ root: HTMLElement, id: string, state: object, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountItemPanel({ root, id, state, api }) {
    let objUrl = null;

    const raw = state.getRawItem(id);
    const it0 = state.getItem(id);
    if (!it0) { root.innerHTML = '<div class="at-empty">This item was removed.</div>'; return { destroy() {} }; }

    if (raw && raw.blob) objUrl = URL.createObjectURL(raw.blob);

    const models = listModels();
    const modelOpts = models.map((m) =>
        `<option value="${esc(m.id)}" ${m.available ? '' : 'disabled'}>${esc(m.label)}${m.available ? '' : ' — soon'}</option>`).join('');

    root.innerHTML = `
        <div class="at-item">
            <div class="at-item__head">
                <h2 class="at-panel__title" style="margin:0">${esc(it0.name)}</h2>
                <span class="at-chip" data-item-chip></span>
            </div>
            <div class="at-item__meta">${fmtSize(it0.sizeBytes)} · ${esc(it0.mimeType || 'audio')} · ${esc(it0.origin)}</div>
            ${objUrl ? `<audio class="at-item__audio" controls preload="metadata" src="${objUrl}"></audio>` : ''}
            <div class="at-item__controls">
                <label for="at-item-model-${esc(id)}">Model</label>
                <select class="at-select" id="at-item-model-${esc(id)}" data-item-model>${modelOpts}</select>
                <button type="button" class="at-btn primary" data-item-retx>Re-transcribe</button>
            </div>
            <h3 class="at-item__txh">Transcript</h3>
            <div class="at-item__tx" data-item-tx></div>
            <div class="at-item__actions">
                <button type="button" class="at-btn small" data-item-copy>Copy</button>
                <button type="button" class="at-btn small" data-item-dl>Download .txt</button>
            </div>
        </div>
    `;

    const chip    = root.querySelector('[data-item-chip]');
    const modelSel = root.querySelector('[data-item-model]');
    const retxBtn = root.querySelector('[data-item-retx]');
    const txEl    = root.querySelector('[data-item-tx]');
    const copyBtn = root.querySelector('[data-item-copy]');
    const dlBtn   = root.querySelector('[data-item-dl]');

    /** Patch the dynamic parts from current state (never rebuilds the audio). */
    function update() {
        const it = state.getItem(id);
        if (!it) { chip.textContent = 'removed'; chip.className = 'at-chip at-chip--error'; retxBtn.disabled = true; txEl.innerHTML = '<span class="at-muted">This item was removed.</span>'; return; }
        chip.textContent = it.status;
        chip.className = `at-chip at-chip--${it.status}`;
        if (modelSel.value !== it.model) modelSel.value = it.model;
        const busy = it.status === 'transcribing';
        retxBtn.disabled = busy;
        retxBtn.textContent = busy ? 'Transcribing…' : 'Re-transcribe';
        if (it.transcript) txEl.textContent = it.transcript;
        else if (it.status === 'error') txEl.innerHTML = `<span class="at-muted">⚠ ${esc(it.error || 'failed')}</span>`;
        else txEl.innerHTML = '<span class="at-muted">Not transcribed yet — pick a model and Re-transcribe.</span>';
    }

    function onModelChange() { api.setModel({ id, model: modelSel.value }); }
    async function onRetx() {
        retxBtn.disabled = true; retxBtn.textContent = 'Transcribing…';
        try { await api.transcribeItem({ id, model: modelSel.value }); } catch (_) { /* surfaced via state */ }
    }
    function onCopy() { const it = state.getItem(id); if (it && it.transcript && navigator.clipboard) navigator.clipboard.writeText(it.transcript).catch(() => {}); }
    function onDl() {
        const it = state.getItem(id); if (!it || !it.transcript) return;
        const blob = new Blob([it.transcript], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(it.name || 'transcript').replace(/\.[^.]+$/, '')}.txt`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 0);
    }

    function onChange(e) { const d = e && e.detail; if (!d || d.id === id || d.kind === 'reset' || d.kind === 'removed') update(); }

    modelSel.value = it0.model;
    modelSel.addEventListener('change', onModelChange);
    retxBtn.addEventListener('click', onRetx);
    copyBtn.addEventListener('click', onCopy);
    dlBtn.addEventListener('click', onDl);
    state.addEventListener('change', onChange);
    update();

    return {
        destroy() {
            state.removeEventListener('change', onChange);
            if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
            root.innerHTML = '';
        },
    };
}
