/**
 * ui-capture.js
 * The capture panel — designed to live in a narrow side window (Decision 3):
 * share/finish controls, the key chip, and THE MARK SURFACE. While a session is
 * live, ANY key or click on the panel (outside real controls) is markMoment(),
 * and a document-level keydown listener catches keys anywhere in the window.
 * @module ui-capture
 */

import { fmtTime } from '../api/nr-document.js';
import { costSummary } from '../api/nr-state.js';

export function initCapture(el, state, config, api, emit, marker) {
    if (!el) return;
    el.innerHTML = `
      <div class="nr-cap">
        <div class="nr-cap__row">
          <button id="nr-share" class="nr-btn nr-btn--primary">🖥 Share screen &amp; start</button>
          <button id="nr-finish" class="nr-btn" disabled>⏹ Finish</button>
        </div>
        <div class="nr-cap__row nr-key">
          <span id="nr-key-set" class="nr-key__set" style="display:none">
            <span class="nr-key__ok">✓ OpenRouter key set</span>
            <button id="nr-key-change" class="nr-btn nr-btn--sm">change</button>
          </span>
          <span id="nr-key-entry" class="nr-key__entry">
            <input id="nr-key" type="password" placeholder="OpenRouter key (BYOK, shared slot)" autocomplete="off">
            <button id="nr-key-save" class="nr-btn nr-btn--sm">Save</button>
            <span id="nr-key-state" class="nr-muted"></span>
          </span>
        </div>
        <div id="nr-video-drop" class="nr-vdrop" tabindex="0">
          <span class="nr-vdrop__label">🎬 …or drop a video recording here</span>
          <span id="nr-video-state" class="nr-muted"></span>
          <input id="nr-video-file" type="file" accept="video/*" hidden>
          <div class="nr-vdrop__bar"><div id="nr-video-bar" class="nr-vdrop__fill"></div></div>
        </div>
        <div id="nr-mark" class="nr-mark" tabindex="0">
          <div class="nr-mark__dot">⬤</div>
          <div class="nr-mark__label">NEXT</div>
          <div class="nr-mark__hint">press any key when you move to the next thing</div>
        </div>
        <div class="nr-cap__meter"><div id="nr-meter" class="nr-cap__meter-fill"></div></div>
        <div class="nr-cap__status">
          <span id="nr-clock">00:00</span>
          <span id="nr-count">0 captures</span>
          <span id="nr-cost">$0.000</span>
        </div>
        <div class="nr-cap__row nr-muted nr-privacy">
          Cleanup sends each capture's screenshot to your model (BYOK).
          <select id="nr-cleanup-mode">
            <option value="grounded">grounded (screenshot)</option>
            <option value="text-only">text-only</option>
            <option value="off">off</option>
          </select>
        </div>
      </div>`;

    const q = s => el.querySelector(s);
    const shareBtn = q('#nr-share'), finishBtn = q('#nr-finish');
    const markEl = q('#nr-mark'), meter = q('#nr-meter');
    const clockEl = q('#nr-clock'), countEl = q('#nr-count'), costEl = q('#nr-cost');

    // Key chip — shared BYOK slot.
    let keyEditing = false;
    function refreshKey() {
        let has = false;
        try { has = !!localStorage.getItem('sg-openrouter-mgmt-key'); } catch (_) { /* */ }
        // Once a key is set, collapse the input: leaving an empty password box on
        // screen reads as "no key", which caused a real misdiagnosis in review.
        const showEntry = !has || keyEditing;
        q('#nr-key-entry').style.display = showEntry ? '' : 'none';
        q('#nr-key-set').style.display = showEntry ? 'none' : '';
        q('#nr-key-state').textContent = has ? '' : 'no key — capture works, transcription won\'t';
    }
    q('#nr-key-save').addEventListener('click', () => {
        const v = q('#nr-key').value.trim();
        if (v) { api.setApiKey({ apiKey: v }); q('#nr-key').value = ''; keyEditing = false; }
        refreshKey();
    });
    q('#nr-key-change').addEventListener('click', () => { keyEditing = true; refreshKey(); q('#nr-key').focus(); });
    refreshKey();
    // The key can also arrive via the JS API (agents, embedders) — keep the chip honest.
    window.addEventListener('nr:key:set', refreshKey);

    q('#nr-cleanup-mode').value = config.cleanup;
    q('#nr-cleanup-mode').addEventListener('change', e => api.setCleanupMode({ mode: e.target.value }));

    // ── Session controls (gesture-direct: getDisplayMedia constraint) ─────────
    shareBtn.addEventListener('click', async () => {
        try {
            await api.startSession({});
        } catch (err) {
            emit('nr:error', { code: err.code || 'screen-unavailable', step: 'start', message: err.message });
            markEl.querySelector('.nr-mark__hint').textContent = err.message;
        }
    });
    finishBtn.addEventListener('click', () => api.endSession().catch(() => {}));

    // ── Video import (the third ingest path) ──────────────────────────────────
    // Same destination as a live share: the capture list. The difference is only
    // who does the pressing — here the pauses in the recording do it.
    const drop = q('#nr-video-drop'), vState = q('#nr-video-state'), vBar = q('#nr-video-bar');
    const vFile = q('#nr-video-file');

    async function runImport(file) {
        if (!file) return;
        drop.classList.add('is-busy');
        vState.textContent = `${file.name} — extracting audio…`;
        try {
            const r = await api.importVideo({ file });
            vState.textContent = `${r.pairs} captures from ${r.segments} segments`;
        } catch (err) {
            vState.textContent = err.message || 'Import failed';
            emit('nr:error', { code: err.code || 'not-video', step: 'import-video', message: err.message });
        } finally {
            drop.classList.remove('is-busy');
            vBar.style.width = '0%';
        }
    }

    drop.addEventListener('click', () => { if (state.status !== 'capturing') vFile.click(); });
    vFile.addEventListener('change', () => { runImport(vFile.files && vFile.files[0]); vFile.value = ''; });
    for (const ev of ['dragenter', 'dragover']) {
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); });
    }
    for (const ev of ['dragleave', 'drop']) {
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); });
    }
    drop.addEventListener('drop', e => runImport(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));

    window.addEventListener('nr:video:progress', e => {
        const d = e.detail || {};
        if (d.message) vState.textContent = d.message;
        else if (d.total) vState.textContent = `${d.step}: ${d.done}/${d.total}`;
        vBar.style.width = d.total ? `${Math.round(100 * (d.done || 0) / d.total)}%` : '10%';
    });

    // ── The mark surface ──────────────────────────────────────────────────────
    function mark() {
        if (state.status !== 'capturing') return;
        marker.markMoment().catch(() => {});
        markEl.classList.add('is-flash');
        setTimeout(() => markEl.classList.remove('is-flash'), 180);
    }
    markEl.addEventListener('click', mark);
    document.addEventListener('keydown', (e) => {
        if (state.status !== 'capturing') return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        e.preventDefault();
        mark();
    });

    // ── Live status ───────────────────────────────────────────────────────────
    let clockTimer = null;
    function setCapturing(on) {
        shareBtn.disabled = on;
        finishBtn.disabled = !on;
        markEl.classList.toggle('is-live', on);
        if (on) {
            clockTimer = setInterval(() => {
                clockEl.textContent = fmtTime(state.startedAt ? Date.now() - state.startedAt : 0);
            }, 500);
        } else if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    }
    function refreshCounts() {
        countEl.textContent = `${state.pairs.length} capture${state.pairs.length === 1 ? '' : 's'}`;
        const c = costSummary();
        costEl.textContent = `$${c.sessionUsd.toFixed(3)}${c.pending ? '…' : ''}`;
    }
    window.addEventListener('nr:session:started', () => { setCapturing(true); refreshCounts(); });
    window.addEventListener('nr:session:ended', () => setCapturing(false));
    window.addEventListener('nr:reset', () => { setCapturing(false); refreshCounts(); clockEl.textContent = '00:00'; });
    for (const ev of ['nr:pair:added', 'nr:pair:removed', 'nr:transcribe:complete', 'nr:clean:complete',
                      'nr:store:loaded', 'nr:video:complete']) {
        window.addEventListener(ev, refreshCounts);
    }

    // Liveness meter from the session's suggestion/energy path is overkill for
    // v0.1 — pulse the meter on marks + transcribe events instead.
    for (const ev of ['nr:mark', 'nr:transcribe:complete']) {
        window.addEventListener(ev, () => {
            meter.style.width = '100%';
            setTimeout(() => { meter.style.width = '12%'; }, 250);
        });
    }
}
