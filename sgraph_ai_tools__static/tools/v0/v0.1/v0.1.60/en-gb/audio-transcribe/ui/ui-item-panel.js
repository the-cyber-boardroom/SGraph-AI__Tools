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
import { mountChat } from './ui-chat.js';

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
            <div class="at-item__cost" data-item-cost hidden></div>
            ${objUrl ? `<audio class="at-item__audio" controls preload="metadata" src="${objUrl}"></audio>` : ''}
            <div class="at-item__controls">
                <label for="at-item-model-${esc(id)}">Model</label>
                <select class="at-select" id="at-item-model-${esc(id)}" data-item-model>${modelOpts}</select>
                <button type="button" class="at-btn primary" data-item-retx>Re-transcribe</button>
                <button type="button" class="at-btn small danger" data-item-stop hidden>■ Stop</button>
            </div>
            <h3 class="at-item__txh">Transcript</h3>
            <div class="at-item__tx" data-item-tx></div>
            <div class="at-item__actions">
                <button type="button" class="at-btn small" data-item-copy>Copy</button>
                <button type="button" class="at-btn small" data-item-dl>Download .txt</button>
            </div>

            <details class="at-adv">
                <summary class="at-adv__summary">⚙ Advanced — multiple models &amp; version history</summary>
                <div class="at-adv__body">
                    <div class="at-adv__block">
                        <div class="at-adv__label">Transcribe with several models in parallel:</div>
                        <div class="at-adv__models" data-item-models>${
                            models.filter((m) => m.available).map((m) =>
                                `<label class="at-adv__chk"><input type="checkbox" value="${esc(m.id)}" ${m.id === it0.model ? 'checked' : ''}> ${esc(m.label)}</label>`).join('')
                        }</div>
                        <button type="button" class="at-btn primary" data-item-multi>Transcribe selected</button>
                    </div>
                    <div class="at-adv__block">
                        <div class="at-adv__label">Versions <span class="at-adv__fcost" data-item-fcost></span></div>
                        <div class="at-adv__vlist" data-item-vlist></div>
                    </div>
                </div>
            </details>

            <details class="at-adv at-chat-wrap" data-item-chatwrap>
                <summary class="at-adv__summary">💬 Chat about this recording</summary>
                <div data-item-chat style="margin-top:12px;"></div>
            </details>
        </div>
    `;

    const chip    = root.querySelector('[data-item-chip]');
    const costEl  = root.querySelector('[data-item-cost]');
    const modelSel = root.querySelector('[data-item-model]');
    const retxBtn = root.querySelector('[data-item-retx]');
    const stopBtn = root.querySelector('[data-item-stop]');
    const txEl    = root.querySelector('[data-item-tx]');
    const copyBtn = root.querySelector('[data-item-copy]');
    const dlBtn   = root.querySelector('[data-item-dl]');
    const multiBtn = root.querySelector('[data-item-multi]');
    const modelsEl = root.querySelector('[data-item-models]');
    const vlistEl  = root.querySelector('[data-item-vlist]');
    const fcostEl  = root.querySelector('[data-item-fcost]');

    const labelOf = Object.fromEntries(models.map((m) => [m.id, m.label]));

    /** Render the version history list + per-file cost total. */
    function renderVersions(it) {
        const vs = it.versions || [];
        let fileUsd = 0; let pending = false;
        for (const v of vs) { if (typeof v.costUsd === 'number') fileUsd += v.costUsd; if (v.costPending) pending = true; }
        fcostEl.textContent = vs.length ? `· file total 💰 $${fileUsd.toFixed(4)}${pending ? '…' : ''} (${vs.length})` : '';
        if (!vs.length) { vlistEl.innerHTML = '<span class="at-muted">No transcriptions yet.</span>'; return; }
        vlistEl.innerHTML = vs.slice().reverse().map((v) => {
            const sel = v.vid === it.selectedVid;
            const cost = typeof v.costUsd === 'number' ? `💰 $${v.costUsd.toFixed(4)}` : (v.costPending ? '💰 cost…' : '');
            const tok = (v.promptTokens || 0) + (v.completionTokens || 0);
            const meta = [cost, tok ? `${tok} tok` : '', v.latencyMs ? `${(v.latencyMs / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ');
            const body = v.status === 'error' ? `<span class="at-muted">⚠ ${esc(v.error || 'failed')}</span>`
                : v.status === 'transcribing' ? '<span class="at-muted">transcribing…</span>'
                : esc(v.text || '');
            return `<div class="at-ver ${sel ? 'at-ver--sel' : ''}">
                <div class="at-ver__head">
                    <span class="at-ver__model">${esc(labelOf[v.model] || v.model)}</span>
                    <span class="at-chip at-chip--${v.status}">${v.status}</span>
                    <span class="at-ver__meta">${meta}</span>
                    ${sel ? '<span class="at-ver__cur">current</span>' : `<button type="button" class="at-link-btn" data-use="${v.vid}">use this</button>`}
                </div>
                <div class="at-ver__tx">${body}</div>
            </div>`;
        }).join('');
    }

    async function onMulti() {
        const picked = [...modelsEl.querySelectorAll('input:checked')].map((c) => c.value);
        if (!picked.length) return;
        multiBtn.disabled = true; multiBtn.textContent = `Transcribing ${picked.length}…`;
        try { await api.transcribeModels({ id, models: picked }); } catch (_) { /* per-version errors surface in the list */ }
        finally { multiBtn.disabled = false; multiBtn.textContent = 'Transcribe selected'; }
    }
    function onVlistClick(e) {
        const b = e.target.closest('[data-use]');
        if (b) state.setSelectedVersion(id, b.dataset.use);
    }

    /** "$0.0012 · 1,240 tok · 2.3s" — cost shows pending then the exact value. */
    function usageLine(it) {
        const parts = [];
        if (typeof it.costUsd === 'number') parts.push(`💰 $${it.costUsd.toFixed(4)}`);
        else if (it.costPending) parts.push('💰 cost…');
        const tok = (it.promptTokens || 0) + (it.completionTokens || 0);
        if (tok) parts.push(`${tok.toLocaleString()} tok`);
        if (it.latencyMs) parts.push(`${(it.latencyMs / 1000).toFixed(1)}s`);
        return parts.join('  ·  ');
    }

    /** Patch the dynamic parts from current state (never rebuilds the audio). */
    function update() {
        const it = state.getItem(id);
        if (!it) { chip.textContent = 'removed'; chip.className = 'at-chip at-chip--error'; retxBtn.disabled = true; txEl.innerHTML = '<span class="at-muted">This item was removed.</span>'; return; }
        chip.textContent = it.status;
        chip.className = `at-chip at-chip--${it.status}`;
        if (modelSel.value !== it.model) modelSel.value = it.model;
        const busy = it.status === 'transcribing';
        retxBtn.disabled = busy;
        if (busy) {
            const v = (it.versions || []).find((x) => x.status === 'transcribing');
            const secs = v && v.ts ? Math.round((Date.now() - v.ts) / 1000) : 0;
            retxBtn.textContent = `Transcribing… ${secs}s`;
        } else {
            retxBtn.textContent = 'Re-transcribe';
        }
        stopBtn.hidden = !busy;
        ensureTicker(busy);
        const usage = usageLine(it);
        costEl.hidden = !usage;
        costEl.textContent = usage;
        if (it.transcript) txEl.textContent = it.transcript;
        else if (it.status === 'error') txEl.innerHTML = `<span class="at-muted">⚠ ${esc(it.error || 'failed')}</span>`;
        else txEl.innerHTML = '<span class="at-muted">Not transcribed yet — pick a model and Re-transcribe.</span>';
        renderVersions(it);
    }

    let ticker = null;
    function ensureTicker(busy) {
        if (busy && !ticker) ticker = setInterval(() => update(), 500);
        else if (!busy && ticker) { clearInterval(ticker); ticker = null; }
    }
    function onModelChange() { api.setModel({ id, model: modelSel.value }); }
    async function onRetx() {
        retxBtn.disabled = true; retxBtn.textContent = 'Transcribing…';
        try { await api.transcribeItem({ id, model: modelSel.value }); } catch (_) { /* surfaced via state */ }
    }
    function onStop() { try { api.cancelItem({ id }); } catch (_) { /* */ } }
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
    stopBtn.addEventListener('click', onStop);
    copyBtn.addEventListener('click', onCopy);
    dlBtn.addEventListener('click', onDl);
    multiBtn.addEventListener('click', onMulti);
    vlistEl.addEventListener('click', onVlistClick);

    // Per-recording chat — lazy-mounted on first open; context = THIS transcript.
    const chatWrap = root.querySelector('[data-item-chatwrap]');
    const chatHost = root.querySelector('[data-item-chat]');
    let chatMount = null;
    function onChatToggle() {
        if (chatWrap.open && !chatMount) {
            chatMount = mountChat({
                root: chatHost, compact: true,
                getContext: () => { const it = state.getItem(id); return it && it.transcript ? `### ${it.name}\n${it.transcript}` : ''; },
            });
        }
    }
    chatWrap.addEventListener('toggle', onChatToggle);

    state.addEventListener('change', onChange);
    update();

    return {
        destroy() {
            if (ticker) clearInterval(ticker);
            if (chatMount && chatMount.destroy) chatMount.destroy();
            chatWrap.removeEventListener('toggle', onChatToggle);
            state.removeEventListener('change', onChange);
            if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
            root.innerHTML = '';
        },
    };
}
