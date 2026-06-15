/**
 * ui-live — Live transcribe panel (Phase 1).
 *
 * One big button: start talking, watch the transcript appear and refine. Shows a
 * live waveform (sg-audio-viz) + an elapsed timer, AND a "segments sent" strip —
 * each poll re-sends the growing take as a real (separately-billed) request, so
 * we list every segment with its size, latency and cost, plus a running total so
 * the live-mode spend is visible. All orchestration is in api/live.js via the
 * startLive/stopLive actions; this panel listens for at:live:* events.
 *
 * @module audio-transcribe/ui-live
 */

import { AT_EVENTS } from '../api/audio-transcribe-events.js';

function fmt(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function fmtSize(b) { if (!b && b !== 0) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(1)} MB`; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * @param {{ root: HTMLElement, api: object, getLiveStream: () => MediaStream|null }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountLive({ root, api, getLiveStream }) {
    root.innerHTML = `
        <h2 class="at-panel__title">Live transcribe</h2>
        <p class="at-meta-note">Speak — the transcript appears and refines as you go. Uses your OpenRouter key + the active model (set in Model &amp; Cost). On stop, the take is saved to the Queue.</p>
        <div class="at-live__controls">
            <button type="button" class="at-btn primary at-live__btn" data-live-btn>🔴 Start live</button>
            <span class="at-rec-timer" data-live-timer hidden>00:00</span>
        </div>
        <div class="at-viz" data-live-viz hidden><sg-audio-viz mode="smooth-eq"></sg-audio-viz></div>
        <h3 class="at-item__txh">Live transcript</h3>
        <div class="at-live__tx" data-live-tx><span class="at-muted">Not started.</span></div>
        <div class="at-status-line" data-live-status></div>
        <div class="at-live__segwrap" data-live-segwrap hidden>
            <h3 class="at-item__txh">Segments sent <span class="at-muted at-live__segtot" data-live-segtot></span></h3>
            <p class="at-meta-note" style="margin-top:2px;">Each segment re-sends the growing audio — a real request you're billed for.</p>
            <div class="at-live__segs" data-live-segs></div>
        </div>
    `;

    const btn   = root.querySelector('[data-live-btn]');
    const timer = root.querySelector('[data-live-timer]');
    const vizWrap = root.querySelector('[data-live-viz]');
    const vizEl = root.querySelector('[data-live-viz] sg-audio-viz');
    const txEl  = root.querySelector('[data-live-tx]');
    const statusEl = root.querySelector('[data-live-status]');
    const segWrap = root.querySelector('[data-live-segwrap]');
    const segsEl  = root.querySelector('[data-live-segs]');
    const segTot  = root.querySelector('[data-live-segtot]');

    let running = false, startedAt = 0, tick = null;
    /** seq -> { cost:number|null, pending:boolean } for the running total. */
    const segCost = new Map();

    function setRunning(on) {
        running = on;
        btn.textContent = on ? '■ Stop live' : '🔴 Start live';
        btn.classList.toggle('danger', on);
        timer.hidden = !on;
        vizWrap.hidden = !on;
    }

    function renderTotal() {
        let usd = 0, pending = false, n = 0;
        for (const c of segCost.values()) { n += 1; if (typeof c.cost === 'number') usd += c.cost; if (c.pending) pending = true; }
        segTot.textContent = n ? `· ${n} segment${n === 1 ? '' : 's'} · 💰 $${usd.toFixed(4)}${pending ? '…' : ''}` : '';
    }

    function upsertSegment(s) {
        let row = segsEl.querySelector(`[data-seg="${s.seq}"]`);
        if (!row) {
            row = document.createElement('div');
            row.className = 'at-live__seg';
            row.setAttribute('data-seg', String(s.seq));
            segsEl.insertBefore(row, segsEl.firstChild); // newest on top
        }
        const cost = typeof s.costUsd === 'number' ? `💰 $${s.costUsd.toFixed(4)}` : (s.costPending !== false && s.ok ? '💰 …' : '');
        const meta = [`#${s.seq}${s.final ? ' (final)' : ''}`, `@${(s.elapsedMs / 1000).toFixed(1)}s`, fmtSize(s.sizeBytes),
            s.latencyMs ? `${(s.latencyMs / 1000).toFixed(1)}s` : '', cost].filter(Boolean).join(' · ');
        const body = s.ok === false ? `<span class="at-muted">⚠ ${esc(s.error || 'failed')}</span>` : esc(s.text || '');
        row.innerHTML = `<div class="at-live__seg-meta">${esc(meta)}</div><div class="at-live__seg-tx">${body}</div>`;
        segCost.set(s.seq, { cost: typeof s.costUsd === 'number' ? s.costUsd : null, pending: !!(s.ok && s.costPending !== false && typeof s.costUsd !== 'number') });
        renderTotal();
    }

    function resetSegments() {
        segCost.clear(); segsEl.innerHTML = ''; segTot.textContent = ''; segWrap.hidden = false;
    }

    async function startViz() {
        try {
            const stream = getLiveStream && getLiveStream();
            if (!stream || !vizEl) return;
            if (vizEl.whenReady) await vizEl.whenReady();
            vizEl.setMode && vizEl.setMode('smooth-eq');
            if (vizEl.setSource) await vizEl.setSource(stream);
            vizEl.start && vizEl.start();
        } catch (_) { /* viz is decorative */ }
    }
    function stopViz() { try { vizEl && vizEl.stop && vizEl.stop(); } catch (_) { /* */ } }

    async function toggle() {
        btn.disabled = true;
        if (!running) {
            try {
                resetSegments();
                await api.startLive();
                startedAt = Date.now(); setRunning(true); startViz();
                tick = setInterval(() => { timer.textContent = fmt(Date.now() - startedAt); }, 250);
                statusEl.textContent = 'Listening…';
                txEl.innerHTML = '<span class="at-muted">…</span>';
            } catch (err) { statusEl.textContent = `Could not start: ${err.message}`; }
        } else {
            statusEl.textContent = 'Finishing…';
            try { const r = await api.stopLive(); statusEl.textContent = r && r.id ? 'Saved to the Queue — open it there.' : 'Stopped.'; }
            catch (err) { statusEl.textContent = `Stop failed: ${err.message}`; }
            finally {
                setRunning(false); stopViz();
                if (tick) { clearInterval(tick); tick = null; }
            }
        }
        btn.disabled = false;
    }

    function onUpdate(e) {
        const d = e.detail || {};
        if (d.text) txEl.textContent = d.text;
        txEl.classList.toggle('at-live__tx--live', !d.final);
    }
    function onSegment(e) { if (e && e.detail) upsertSegment(e.detail); }
    function onError(e) { statusEl.textContent = `⚠ ${(e.detail && e.detail.error) || 'error'}`; }

    btn.addEventListener('click', toggle);
    window.addEventListener(AT_EVENTS.LIVE_UPDATE, onUpdate);
    window.addEventListener(AT_EVENTS.LIVE_SEGMENT, onSegment);
    window.addEventListener(AT_EVENTS.LIVE_ERROR, onError);

    return {
        destroy() {
            window.removeEventListener(AT_EVENTS.LIVE_UPDATE, onUpdate);
            window.removeEventListener(AT_EVENTS.LIVE_SEGMENT, onSegment);
            window.removeEventListener(AT_EVENTS.LIVE_ERROR, onError);
            if (tick) clearInterval(tick);
            try { vizEl && vizEl.destroy && vizEl.destroy(); } catch (_) { /* */ }
            root.innerHTML = '';
        },
    };
}
