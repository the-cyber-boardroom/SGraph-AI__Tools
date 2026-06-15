/**
 * ui-live-first — the minimal "big button" page for Live Transcribe.
 *
 * Hero = the reused audio-transcribe Live panel (mountLive): one big button to
 * start talking, with the live transcript + per-segment cost. Below it, a small
 * "or drop an audio file" zone and a list of finished transcripts. Deliberately
 * tiny — this is the max-simplicity experience variation.
 *
 * @module live-transcribe/ui-live-first
 */

import { AT_EVENTS } from '../../audio-transcribe/api/audio-transcribe-events.js';
import { mountLive } from '../../audio-transcribe/ui/ui-live.js';

const KEY_STORAGE = 'sg-openrouter-mgmt-key';
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * @param {{ host: HTMLElement, state: object, api: object, getLiveStream: () => MediaStream|null }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountLiveFirst({ host, state, api, getLiveStream }) {
    host.innerHTML = '';
    host.style.cssText = 'flex:1;min-height:0;display:block;';

    const wrap = document.createElement('div');
    wrap.className = 'lt-wrap';
    wrap.innerHTML = `
        <header class="lt-head">
            <h1 class="lt-title">🔴 Live Transcribe</h1>
            <p class="lt-sub">Press the button and talk. The transcript appears and refines as you go — in your browser.</p>
        </header>
        <div class="lt-keybar" data-key-bar>
            <input type="password" class="lt-key" data-key placeholder="Paste your OpenRouter key (sk-or-…)" autocomplete="off">
            <button type="button" class="at-btn primary" data-key-save>Save key</button>
            <span class="at-muted" data-key-status></span>
        </div>
        <section class="lt-hero" data-live></section>
        <section class="lt-drop-wrap">
            <div class="lt-drop" data-drop tabindex="0">
                <div class="lt-drop__icon">📂</div>
                <div>…or drop an audio file here <span class="at-muted">(incl. WhatsApp .opus)</span></div>
            </div>
            <input type="file" accept="audio/*,.opus,.m4a,.webm,.ogg" multiple hidden data-file>
            <div class="at-status-line" data-drop-status></div>
        </section>
        <section class="lt-list-wrap">
            <h3 class="at-item__txh">Transcripts</h3>
            <div class="lt-list" data-list><span class="at-muted">Nothing yet.</span></div>
        </section>
        <p class="lt-foot at-muted">A minimal variation of the full <a href="../audio-transcribe/" class="lt-link">Audio Transcribe</a> tool (queue, voice, chat, bundle &amp; send).</p>
    `;
    host.appendChild(wrap);

    const keyEl = wrap.querySelector('[data-key]');
    const keySaveBtn = wrap.querySelector('[data-key-save]');
    const keyStatus = wrap.querySelector('[data-key-status]');
    const liveRoot = wrap.querySelector('[data-live]');
    const dropEl = wrap.querySelector('[data-drop]');
    const fileEl = wrap.querySelector('[data-file]');
    const dropStatus = wrap.querySelector('[data-drop-status]');
    const listEl = wrap.querySelector('[data-list]');

    // ── Key bar ───────────────────────────────────────────────────────────────
    try { const k = localStorage.getItem(KEY_STORAGE); if (k) { keyEl.value = k; keyStatus.textContent = 'key set ✓'; } } catch (_) { /* */ }
    async function saveKey() {
        const apiKey = keyEl.value.trim();
        try { await api.setApiKey({ apiKey }); keyStatus.textContent = apiKey ? 'key set ✓' : 'no key'; }
        catch (err) { keyStatus.textContent = `key error: ${err.message}`; }
    }
    keySaveBtn.addEventListener('click', saveKey);
    keyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey(); });

    // ── Live hero (reused panel) ───────────────────────────────────────────────
    const liveMount = mountLive({ root: liveRoot, api, getLiveStream });

    // ── Drop / transcribe a file ───────────────────────────────────────────────
    async function ingest(files) {
        if (!files || !files.length) return;
        dropStatus.textContent = 'Adding…';
        try {
            const r = await api.addFiles({ files });
            const added = (r && r.added && r.added.length) || 0;
            if (!added) { dropStatus.textContent = 'No audio added (not an audio file?).'; return; }
            dropStatus.textContent = `Transcribing ${added} file${added === 1 ? '' : 's'}…`;
            await api.transcribeAll();
            dropStatus.textContent = 'Done.';
        } catch (err) { dropStatus.textContent = `Failed: ${err.message}`; }
    }
    dropEl.addEventListener('click', () => fileEl.click());
    dropEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); } });
    fileEl.addEventListener('change', () => { ingest(fileEl.files); fileEl.value = ''; });
    dropEl.addEventListener('dragover', (e) => { e.preventDefault(); dropEl.classList.add('lt-drop--over'); });
    dropEl.addEventListener('dragleave', () => dropEl.classList.remove('lt-drop--over'));
    dropEl.addEventListener('drop', (e) => { e.preventDefault(); dropEl.classList.remove('lt-drop--over'); ingest(e.dataTransfer && e.dataTransfer.files); });

    // ── Transcripts list ───────────────────────────────────────────────────────
    function render() {
        const items = state.getItems();
        if (!items.length) { listEl.innerHTML = '<span class="at-muted">Nothing yet.</span>'; return; }
        listEl.innerHTML = items.map((it) => {
            const body = it.status === 'done'
                ? `<div class="lt-card__tx">${esc(it.transcript || '')}</div>`
                : (it.status === 'error'
                    ? `<div class="lt-card__tx at-row__error">⚠ ${esc(it.error || 'failed')}</div>`
                    : `<div class="at-muted">${esc(it.status)}…</div>`);
            return `<div class="lt-card"><div class="lt-card__name">${esc(it.name || 'audio')}${it.status === 'done' ? ` <button type="button" class="at-btn small" data-copy="${esc(it.id)}">Copy</button>` : ''}</div>${body}</div>`;
        }).join('');
    }
    function onCopy(e) {
        const id = e.target && e.target.getAttribute && e.target.getAttribute('data-copy');
        if (!id) return;
        const it = state.getItem(id);
        if (it && it.transcript && navigator.clipboard) { navigator.clipboard.writeText(it.transcript).then(() => { e.target.textContent = 'Copied ✓'; }).catch(() => {}); }
    }
    const onChange = () => render();
    state.addEventListener('change', onChange);
    listEl.addEventListener('click', onCopy);
    render();

    return {
        destroy() {
            state.removeEventListener('change', onChange);
            if (liveMount && liveMount.destroy) liveMount.destroy();
            host.innerHTML = '';
        },
    };
}
