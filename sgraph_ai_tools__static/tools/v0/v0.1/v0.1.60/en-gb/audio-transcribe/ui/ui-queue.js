/**
 * ui-queue — the batch queue: per-row status, transcript, retry/remove, plus a
 * "Transcribe all" header button and overall progress bar.
 *
 * Re-renders from `state` on every `change` event and listens for batch
 * progress events on `window`. All actions route through the SgToolApi.
 *
 * @module audio-transcribe/ui-queue
 */

import { AT_EVENTS } from '../api/audio-transcribe-events.js';

/** Escape text for safe insertion into HTML. */
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Human-readable byte size. */
function fmtSize(b) {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/**
 * Mount the queue panel.
 * @param {{ root: HTMLElement, state: object, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountQueue({ root, state, api, openItem }) {
    root.innerHTML = `
        <div class="at-queue-head">
            <h2 class="at-panel__title" style="margin:0">Queue <span id="at-q-count"></span></h2>
            <button type="button" class="at-btn primary" id="at-transcribe-all">Transcribe all</button>
        </div>
        <div class="at-progress"><div class="at-progress__bar" id="at-progress-bar"></div></div>
        <div id="at-rows"></div>
    `;

    const rowsEl = root.querySelector('#at-rows');
    const countEl = root.querySelector('#at-q-count');
    const transcribeAllBtn = root.querySelector('#at-transcribe-all');
    const progressBar = root.querySelector('#at-progress-bar');

    /** Seconds since the currently-transcribing version started. */
    function elapsedSecs(it) {
        const v = (it.versions || []).find((x) => x.status === 'transcribing');
        return v && v.ts ? Math.round((Date.now() - v.ts) / 1000) : 0;
    }

    let ticker = null;
    function ensureTicker(items) {
        const busy = items.some((i) => i.status === 'transcribing');
        if (busy && !ticker) ticker = setInterval(render, 500);
        else if (!busy && ticker) { clearInterval(ticker); ticker = null; }
    }

    function render() {
        const items = state.getItems();
        countEl.textContent = items.length ? `(${items.length})` : '';
        transcribeAllBtn.disabled = items.length === 0;
        if (items.length === 0) {
            rowsEl.innerHTML = `<div class="at-empty">No audio yet — record or drop files above.</div>`;
        } else {
            rowsEl.innerHTML = items.map((it) => rowHtml(it)).join('');
        }
        ensureTicker(items);
    }

    function rowHtml(it) {
        const dur = it.durationMs ? ` · ${Math.round(it.durationMs / 1000)}s` : '';
        const cost = typeof it.costUsd === 'number' ? ` · 💰 $${it.costUsd.toFixed(4)}` : (it.costPending ? ' · 💰 cost…' : '');
        const transcript = it.status === 'done' && it.transcript != null
            ? `<div class="at-row__transcript" id="tx-${it.id}">${esc(it.transcript)}</div>`
            : (it.status === 'error' ? `<div class="at-row__transcript">⚠ ${esc(it.error || 'failed')}</div>` : '');
        const actions = [];
        actions.push(`<button class="at-btn small" data-act="open" data-id="${it.id}">Open ▸</button>`);
        if (it.status === 'transcribing') {
            actions.push(`<button class="at-btn small danger" data-act="stop" data-id="${it.id}">■ Stop</button>`);
        }
        if (it.status === 'done') {
            actions.push(`<button class="at-btn small" data-act="copy" data-id="${it.id}">Copy</button>`);
            actions.push(`<button class="at-btn small" data-act="dl" data-id="${it.id}">Download .txt</button>`);
        }
        if (it.status === 'error' || it.status === 'queued' || it.status === 'cancelled') {
            actions.push(`<button class="at-btn small" data-act="retry" data-id="${it.id}">${it.status === 'queued' ? 'Transcribe' : 'Retry'}</button>`);
        }
        actions.push(`<button class="at-btn small" data-act="remove" data-id="${it.id}">Remove</button>`);
        const elapsed = it.status === 'transcribing' ? `<span class="at-row__elapsed">${elapsedSecs(it)}s</span>` : '';
        return `
            <div class="at-row" data-id="${it.id}">
                <div class="at-row__top">
                    <span class="at-row__name">${esc(it.name)}</span>
                    <span class="at-chip at-chip--${it.status}">${it.status}</span>${elapsed}
                    <span class="at-row__meta">${fmtSize(it.sizeBytes)}${dur} · ${esc(it.model || '')}${cost}</span>
                </div>
                ${transcript}
                <div class="at-row__actions">${actions.join('')}</div>
            </div>`;
    }

    async function onClick(e) {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        try {
            if (act === 'open') { if (openItem) openItem(id); }
            else if (act === 'stop') api.cancelItem({ id });
            else if (act === 'remove') api.removeItem({ id });
            else if (act === 'retry') await api.transcribeItem({ id });
            else if (act === 'copy') {
                const it = state.getItem(id);
                if (it && navigator.clipboard) await navigator.clipboard.writeText(it.transcript || '');
            } else if (act === 'dl') {
                const it = state.getItem(id);
                downloadText(it.transcript || '', `${(it.name || id).replace(/\.[a-z0-9]+$/i, '')}.txt`);
            }
        } catch (_) { /* errors surface via row status */ }
    }

    function downloadText(text, name) {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* */ } }, 2000);
    }

    async function onTranscribeAll() {
        transcribeAllBtn.disabled = true;
        try { await api.transcribeAll({}); }
        catch (_) { /* per-row errors show in the queue */ }
        finally { transcribeAllBtn.disabled = false; }
    }

    function onBatchProgress(e) {
        const { done, total } = e.detail || {};
        progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
    }
    function onBatchStarted() { progressBar.style.width = '0'; }
    function onBatchComplete() { setTimeout(() => { progressBar.style.width = '0'; }, 1200); }

    const onChange = () => render();
    state.addEventListener('change', onChange);
    rowsEl.addEventListener('click', onClick);
    transcribeAllBtn.addEventListener('click', onTranscribeAll);
    window.addEventListener(AT_EVENTS.BATCH_PROGRESS, onBatchProgress);
    window.addEventListener(AT_EVENTS.BATCH_STARTED, onBatchStarted);
    window.addEventListener(AT_EVENTS.BATCH_COMPLETE, onBatchComplete);

    render();

    return {
        destroy() {
            if (ticker) clearInterval(ticker);
            state.removeEventListener('change', onChange);
            rowsEl.removeEventListener('click', onClick);
            transcribeAllBtn.removeEventListener('click', onTranscribeAll);
            window.removeEventListener(AT_EVENTS.BATCH_PROGRESS, onBatchProgress);
            window.removeEventListener(AT_EVENTS.BATCH_STARTED, onBatchStarted);
            window.removeEventListener(AT_EVENTS.BATCH_COMPLETE, onBatchComplete);
        },
    };
}
