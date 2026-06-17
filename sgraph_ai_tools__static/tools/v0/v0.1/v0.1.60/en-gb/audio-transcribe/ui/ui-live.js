/**
 * ui-live — Live transcribe panel.
 *
 * One big button: start talking, watch the transcript appear and refine. Audio
 * is split by Voice Activity Detection (energy VAD) — each clip is a complete
 * phrase cut at a pause, sent as a clean WAV — so the transcript reads naturally
 * and the segments play back. A VAD timeline (ui-live-viz) shows the loudness,
 * the speech threshold, and a marker each time a clip is cut. The "Segments
 * sent" strip lists every clip with size, latency, cost + a ▶ to hear it. All
 * orchestration is in api/live.js; this panel drives startLive/stopLive and
 * listens for at:live:* events.
 *
 * @module audio-transcribe/ui-live
 */

import { AT_EVENTS } from '../api/audio-transcribe-events.js';
import { friendlyLlmError } from '../api/llm-errors.js';
import { mountLiveViz } from './ui-live-viz.js';

function fmt(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function fmtSize(b) { if (!b && b !== 0) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(1)} MB`; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * @param {{ root: HTMLElement, api: object, getLiveStream?: Function, getLiveLevel?: Function, getLiveThreshold?: Function }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountLive({ root, api, getLiveLevel, getLiveThreshold }) {
    root.innerHTML = `
        <h2 class="at-panel__title">Live transcribe</h2>
        <p class="at-meta-note">Speak — the transcript appears phrase by phrase. Audio is split at natural pauses (voice-activity detection), so each clip is a whole phrase. On stop, one full-quality pass cleans up the saved transcript.</p>
        <div class="at-live__controls">
            <button type="button" class="at-btn primary at-live__btn" data-live-btn>🔴 Start live</button>
            <span class="at-rec-timer" data-live-timer hidden>00:00</span>
        </div>
        <label class="at-live__clean"><input type="checkbox" data-live-clean checked> Clean up on stop <span class="at-muted">(one full-quality re-transcription — costs ~1× more; off = keep the cheaper live text)</span></label>
        <div class="at-live__vadrow">
            <label class="at-live__chunk">Mic sensitivity
                <select data-vad-sens>
                    <option value="0.012">High — quiet room</option>
                    <option value="0.02" selected>Normal</option>
                    <option value="0.035">Low — noisy</option>
                </select>
            </label>
            <label class="at-live__chunk">Pause to split
                <select data-vad-pause>
                    <option value="400">0.4s — snappy</option>
                    <option value="600" selected>0.6s — natural</option>
                    <option value="900">0.9s — relaxed</option>
                </select>
            </label>
        </div>
        <div class="at-viz" data-live-viz hidden></div>
        <h3 class="at-item__txh">Live transcript</h3>
        <div class="at-live__tx" data-live-tx><span class="at-muted">Not started.</span></div>
        <div class="at-status-line" data-live-status></div>
        <div class="at-live__segwrap" data-live-segwrap hidden>
            <h3 class="at-item__txh">Segments sent <span class="at-muted at-live__segtot" data-live-segtot></span></h3>
            <p class="at-meta-note" style="margin-top:2px;">Each clip is a phrase cut at a pause (▶ to hear exactly what was sent). On stop, one full-quality pass cleans up the saved transcript.</p>
            <div class="at-live__segs" data-live-segs></div>
        </div>
    `;

    const btn   = root.querySelector('[data-live-btn]');
    const timer = root.querySelector('[data-live-timer]');
    const vizWrap = root.querySelector('[data-live-viz]');
    const txEl  = root.querySelector('[data-live-tx]');
    const cleanChk = root.querySelector('[data-live-clean]');
    const sensSel = root.querySelector('[data-vad-sens]');
    const pauseSel = root.querySelector('[data-vad-pause]');
    const statusEl = root.querySelector('[data-live-status]');
    const segWrap = root.querySelector('[data-live-segwrap]');
    const segsEl  = root.querySelector('[data-live-segs]');
    const segTot  = root.querySelector('[data-live-segtot]');
    const ctrls = [sensSel, pauseSel];

    const viz = mountLiveViz({ root: vizWrap, getLiveLevel, getLiveThreshold });

    let running = false, startedAt = 0, tick = null;
    const segCost = new Map();   // seq -> { cost, pending }
    const segBlobs = new Map();  // seq -> Blob of exactly what was sent
    let playCtx = null, playSrc = null;

    /** Play exactly the audio that was sent for a clip (clean WAV → decodes fine). */
    async function playSeg(seqStr) {
        const blob = segBlobs.get(Number(seqStr));
        if (!blob) return;
        try {
            if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (playCtx.state === 'suspended') await playCtx.resume();
            if (playSrc) { try { playSrc.stop(); } catch (_) { /* */ } }
            const audio = await playCtx.decodeAudioData(await blob.arrayBuffer());
            playSrc = playCtx.createBufferSource();
            playSrc.buffer = audio; playSrc.connect(playCtx.destination); playSrc.start();
        } catch (_) { statusEl.textContent = 'Could not play that clip.'; }
    }

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
        segTot.textContent = n ? `· ${n} clip${n === 1 ? '' : 's'} · 💰 $${usd.toFixed(4)}${pending ? '…' : ''}` : '';
    }

    function upsertSegment(s) {
        let row = segsEl.querySelector(`[data-seg="${s.seq}"]`);
        if (!row) {
            row = document.createElement('div');
            row.className = 'at-live__seg';
            row.setAttribute('data-seg', String(s.seq));
            segsEl.insertBefore(row, segsEl.firstChild); // newest on top
        }
        if (s.blob) segBlobs.set(s.seq, s.blob);
        const cost = typeof s.costUsd === 'number' ? `💰 $${s.costUsd.toFixed(4)}` : (s.costPending !== false && s.ok ? '💰 …' : '');
        const meta = [`#${s.seq}${s.final ? ' (final)' : ''}`, `@${(s.elapsedMs / 1000).toFixed(1)}s`, fmtSize(s.sizeBytes),
            s.latencyMs ? `${(s.latencyMs / 1000).toFixed(1)}s` : '', cost].filter(Boolean).join(' · ');
        const body = s.ok === false ? `<span class="at-muted">⚠ ${esc(friendlyLlmError(s.code, s.error || 'failed'))}</span>` : esc(s.text || '');
        const play = segBlobs.has(s.seq) ? `<button type="button" class="at-btn small at-live__play" data-seg-play="${s.seq}" title="Play exactly what was sent">▶</button>` : '';
        row.innerHTML = `<div class="at-live__seg-meta">${esc(meta)} ${play}</div><div class="at-live__seg-tx">${body}</div>`;
        segCost.set(s.seq, { cost: typeof s.costUsd === 'number' ? s.costUsd : null, pending: !!(s.ok && s.costPending !== false && typeof s.costUsd !== 'number') });
        renderTotal();
    }

    function resetSegments() {
        segCost.clear(); segBlobs.clear(); segsEl.innerHTML = ''; segTot.textContent = ''; segWrap.hidden = false;
    }

    /** Build the VAD config from the two controls. */
    function vadConfig() {
        const speech = Number(sensSel.value) || 0.02;
        return { vad: { speechThreshold: speech, silenceThreshold: speech * 0.5, endpointMs: Number(pauseSel.value) || 600 } };
    }

    async function toggle() {
        btn.disabled = true;
        if (!running) {
            try {
                resetSegments();
                ctrls.forEach((c) => c && (c.disabled = true));
                await api.startLive(vadConfig());
                startedAt = Date.now(); setRunning(true); viz.start();
                tick = setInterval(() => { timer.textContent = fmt(Date.now() - startedAt); }, 250);
                statusEl.textContent = 'Listening…';
                txEl.innerHTML = '<span class="at-muted">…</span>';
            } catch (err) { statusEl.textContent = `Could not start: ${err.message}`; ctrls.forEach((c) => c && (c.disabled = false)); }
        } else {
            statusEl.textContent = cleanChk && cleanChk.checked ? 'Finishing… (full-quality pass)' : 'Finishing…';
            try { const r = await api.stopLive({ finalPass: !cleanChk || cleanChk.checked }); statusEl.textContent = r && r.id ? 'Saved to the Queue — open it there.' : 'Stopped.'; }
            catch (err) { statusEl.textContent = `Stop failed: ${err.message}`; }
            finally {
                setRunning(false); viz.stop();
                ctrls.forEach((c) => c && (c.disabled = false));
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
    function onError(e) { const d = e.detail || {}; statusEl.textContent = `⚠ ${friendlyLlmError(d.code, d.error || 'error')}`; }
    function onSegClick(e) { const b = e.target.closest('[data-seg-play]'); if (b) playSeg(b.getAttribute('data-seg-play')); }

    btn.addEventListener('click', toggle);
    segsEl.addEventListener('click', onSegClick);
    window.addEventListener(AT_EVENTS.LIVE_UPDATE, onUpdate);
    window.addEventListener(AT_EVENTS.LIVE_SEGMENT, onSegment);
    window.addEventListener(AT_EVENTS.LIVE_ERROR, onError);

    return {
        destroy() {
            window.removeEventListener(AT_EVENTS.LIVE_UPDATE, onUpdate);
            window.removeEventListener(AT_EVENTS.LIVE_SEGMENT, onSegment);
            window.removeEventListener(AT_EVENTS.LIVE_ERROR, onError);
            if (tick) clearInterval(tick);
            try { if (playSrc) playSrc.stop(); } catch (_) { /* */ }
            try { if (playCtx) playCtx.close(); } catch (_) { /* */ }
            try { viz.destroy(); } catch (_) { /* */ }
            root.innerHTML = '';
        },
    };
}
