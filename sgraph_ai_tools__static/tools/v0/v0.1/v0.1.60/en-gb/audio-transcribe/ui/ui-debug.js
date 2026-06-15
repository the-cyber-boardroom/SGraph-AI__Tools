/**
 * ui-debug — provenance panel: every LLM request/response, newest first.
 *
 * For explainability — see exactly which model was asked, with which prompt +
 * audio file, and what came back (transcript, tokens, cost, generation id, and
 * the raw OpenRouter response). Fed by the `at:llm:exchange` event + the
 * getExchanges() API; the audio bytes are never shown (only the file name).
 *
 * @module audio-transcribe/ui-debug
 */

import { AT_EVENTS } from '../api/audio-transcribe-events.js';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtTime(ts) { try { return new Date(ts).toLocaleTimeString(); } catch (_) { return ''; } }
function fmtSize(b) { if (!b && b !== 0) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(1)} MB`; }

/**
 * @param {{ root: HTMLElement, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountDebug({ root, api }) {
    root.innerHTML = `
        <div class="at-dbg">
            <div class="at-dbg__head">
                <h2 class="at-panel__title" style="margin:0">Debug · provenance</h2>
                <button type="button" class="at-btn small" data-dbg-clear>Clear view</button>
            </div>
            <p class="at-muted" style="font-size:0.8rem;margin:0 0 10px;">Every LLM request &amp; response this session. Audio bytes are never shown.</p>
            <div class="at-dbg__list" data-dbg-list></div>
        </div>
    `;
    const listEl = root.querySelector('[data-dbg-list]');
    /** @type {object[]} */
    let log = [];

    function card(x) {
        const r = x.response || {};
        const tok = (r.promptTokens || 0) + (r.completionTokens || 0);
        const cost = typeof r.costUsd === 'number' ? `💰 $${r.costUsd.toFixed(4)}` : '';
        const meta = [cost, tok ? `${tok} tok` : '', r.latencyMs ? `${(r.latencyMs / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ');
        const req = x.request || {};
        const audio = (req.audio && `${req.audio.name} (${req.audio.mime || 'audio'}${req.audio.sizeBytes ? ', ' + fmtSize(req.audio.sizeBytes) : ''})`) || '—';
        let body;
        if (x.status === 'pending') { const e = x.ts ? Math.round((Date.now() - x.ts) / 1000) : 0; body = `<span class="at-muted">⏳ in flight · ${e}s…</span>`; }
        else if (x.status === 'cancelled') body = '<span class="at-muted">⊘ cancelled</span>';
        else if (x.status === 'error') body = `<span class="at-muted">⚠ ${esc(x.error || 'failed')}</span>`;
        else body = esc(r.content || '');
        const raw = x.raw ? `<details class="at-xch__raw"><summary>raw response</summary><pre>${esc(JSON.stringify(x.raw, null, 2))}</pre></details>` : '';
        return `
            <div class="at-xch at-xch--${esc(x.status)}">
                <div class="at-xch__head">
                    <span class="at-xch__time">${esc(fmtTime(x.ts))}</span>
                    <span class="at-xch__model">${esc(x.model)}</span>
                    <span class="at-chip at-chip--${esc(x.status)}">${esc(x.status)}</span>
                    <span class="at-xch__file">${esc(x.itemName || '')}</span>
                    <span class="at-xch__meta">${esc(meta)}</span>
                </div>
                <div class="at-xch__kv"><span>request</span> prompt + audio: <code>${esc(audio)}</code></div>
                <div class="at-xch__kv"><span>response</span> ${body}</div>
                ${r.generationId ? `<div class="at-xch__kv"><span>generation</span> <code>${esc(r.generationId)}</code></div>` : ''}
                ${raw}
            </div>`;
    }

    let ticker = null;
    function ensureTicker() {
        const pending = log.some((l) => l.status === 'pending');
        if (pending && !ticker) ticker = setInterval(render, 500);
        else if (!pending && ticker) { clearInterval(ticker); ticker = null; }
    }

    function render() {
        listEl.innerHTML = log.length
            ? log.map(card).join('')
            : '<div class="at-empty">No requests yet — connect a key and transcribe.</div>';
        ensureTicker();
    }

    // Records are keyed by vid: the 'pending' entry logged at request time is
    // updated in place when the response (or cancel) arrives.
    function onExchange(e) {
        if (!e || !e.detail) return;
        const x = e.detail;
        const i = x.vid ? log.findIndex((l) => l.vid === x.vid) : -1;
        if (i >= 0) log[i] = x;
        else { log.unshift(x); if (log.length > 100) log.length = 100; }
        render();
    }
    function onClear() { log = []; render(); }

    root.querySelector('[data-dbg-clear]').addEventListener('click', onClear);
    window.addEventListener(AT_EVENTS.LLM_EXCHANGE, onExchange);

    // Seed from anything already logged before this panel opened.
    if (typeof api.getExchanges === 'function') {
        Promise.resolve(api.getExchanges()).then((rows) => { if (Array.isArray(rows) && rows.length) { log = rows.concat(log); render(); } }).catch(() => {});
    }
    render();

    return {
        destroy() {
            if (ticker) clearInterval(ticker);
            window.removeEventListener(AT_EVENTS.LLM_EXCHANGE, onExchange);
            root.innerHTML = '';
        },
    };
}
