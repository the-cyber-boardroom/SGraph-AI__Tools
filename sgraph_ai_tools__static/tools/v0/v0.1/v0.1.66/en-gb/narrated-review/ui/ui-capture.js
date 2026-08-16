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
          <input id="nr-key" type="password" placeholder="OpenRouter key (BYOK, shared slot)" autocomplete="off">
          <button id="nr-key-save" class="nr-btn nr-btn--sm">Save</button>
          <span id="nr-key-state" class="nr-muted"></span>
        </div>
        <div id="nr-mark" class="nr-mark" tabindex="0">
          <div class="nr-mark__dot">⬤</div>
          <div class="nr-mark__label">MARK</div>
          <div class="nr-mark__hint">press any key while narrating</div>
        </div>
        <div class="nr-cap__meter"><div id="nr-meter" class="nr-cap__meter-fill"></div></div>
        <div class="nr-cap__status">
          <span id="nr-clock">00:00</span>
          <span id="nr-count">0 pairs</span>
          <span id="nr-cost">$0.000</span>
        </div>
        <div class="nr-cap__row nr-muted nr-privacy">
          Cleanup sends each pair's screenshot to your model (BYOK).
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
    function refreshKey() {
        let has = false;
        try { has = !!localStorage.getItem('sg-openrouter-mgmt-key'); } catch (_) { /* */ }
        q('#nr-key-state').textContent = has ? '✓ key set' : 'no key — capture works, transcription won\'t';
    }
    q('#nr-key-save').addEventListener('click', () => {
        const v = q('#nr-key').value.trim();
        if (v) { api.setApiKey({ apiKey: v }); q('#nr-key').value = ''; }
        refreshKey();
    });
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
        countEl.textContent = `${state.pairs.length} pair${state.pairs.length === 1 ? '' : 's'}`;
        const c = costSummary();
        costEl.textContent = `$${c.sessionUsd.toFixed(3)}${c.pending ? '…' : ''}`;
    }
    window.addEventListener('nr:session:started', () => { setCapturing(true); refreshCounts(); });
    window.addEventListener('nr:session:ended', () => setCapturing(false));
    window.addEventListener('nr:reset', () => { setCapturing(false); refreshCounts(); clockEl.textContent = '00:00'; });
    for (const ev of ['nr:pair:added', 'nr:pair:removed', 'nr:transcribe:complete', 'nr:clean:complete']) {
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
