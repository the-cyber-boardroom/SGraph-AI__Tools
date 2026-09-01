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
        <div class="nr-cap__row nr-muted nr-privacy">
          Clean
          <select id="nr-clean-timing" title="Cleanup only ever looks backwards, so running it during the recording gives the same result — it is just finished sooner.">
            <option value="streaming">while recording (same result, ready sooner)</option>
            <option value="after">after I press Finish</option>
            <option value="parallel">all at once (faster, loses cross-capture context)</option>
          </select>
        </div>
        <div id="nr-save" class="nr-save">
          <span id="nr-save-state" class="nr-save__state">Autosave on</span>
          <button id="nr-save-now" class="nr-btn nr-btn--sm" title="Save now">Save now</button>
          <button id="nr-save-toggle" class="nr-btn nr-btn--sm" title="Turn autosave off">on</button>
        </div>
        <div class="nr-cap__row nr-hist">
          <button id="nr-undo" class="nr-btn nr-btn--sm" disabled title="Undo (⌘/Ctrl-Z)">↶ Undo</button>
          <button id="nr-redo" class="nr-btn nr-btn--sm" disabled title="Redo (⌘/Ctrl-⇧-Z)">↷ Redo</button>
          <span id="nr-hist-state" class="nr-muted"></span>
        </div>
        <div id="nr-input" class="nr-input">
          <div class="nr-input__head">
            <b>Page recorder</b>
            <span id="nr-input-state" class="nr-muted"></span>
          </div>
          <label class="nr-export__opt"><input id="nr-in-mouse" type="checkbox" checked disabled> capture mouse movements</label>
          <label class="nr-export__opt"><input id="nr-in-keys" type="checkbox" disabled> capture keyboard</label>
          <label class="nr-export__opt"><input id="nr-in-console" type="checkbox" checked disabled> capture console</label>
          <label class="nr-export__opt"><input id="nr-in-net" type="checkbox" checked disabled> capture network</label>
          <div id="nr-input-why" class="nr-muted"></div>
          <div class="nr-cap__row">
            <button id="nr-in-attach" class="nr-btn nr-btn--sm" disabled>Attach recorded tab</button>
            <button id="nr-in-detach" class="nr-btn nr-btn--sm" hidden>Detach</button>
          </div>
        </div>
        <div id="nr-restore" class="nr-restore" hidden>
          <div class="nr-restore__title">⚠ An unfinished session was found</div>
          <div id="nr-restore__what" class="nr-muted"></div>
          <div class="nr-cap__row">
            <button id="nr-restore-yes" class="nr-btn nr-btn--primary nr-btn--sm">Restore it</button>
            <button id="nr-restore-no" class="nr-btn nr-btn--sm">Discard</button>
          </div>
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
            vState.textContent = `${r.pairs} captures from ${r.segments} segments`
                + (r.capped ? ` · ${r.capped} cut at the length limit, not at a pause` : '');
            drop.classList.toggle('is-warn', r.capped > r.segments / 2);
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

    // A segmentation that found no pauses produced a plausible-looking document
    // built on arbitrary boundaries once already. It says so now.
    window.addEventListener('nr:video:warning', e => {
        const d = e.detail || {};
        vState.textContent = d.message || 'segmentation may be unreliable';
        drop.classList.add('is-warn');
    });
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

    // ── Autosave, visibly ───────────────────────────────────────────────────
    //
    // Autosave that works silently is indistinguishable from autosave that is
    // broken, and the person who most needs to know is the one who has just
    // finished a long review. So the state is always on screen: when it last
    // wrote, whether something is pending, and — the case worth shouting about —
    // if a write failed.
    const saveState = q('#nr-save-state'), saveBox = q('#nr-save');
    const toggleBtn = q('#nr-save-toggle');
    let saveError = null;

    function ago(ts) {
        if (!ts) return 'not yet';
        const s2 = Math.round((Date.now() - ts) / 1000);
        if (s2 < 5) return 'just now';
        if (s2 < 60) return `${s2}s ago`;
        return `${Math.round(s2 / 60)}m ago`;
    }

    async function refreshSave() {
        let st;
        try { st = await api.getAutosave(); } catch (_) { return; }
        toggleBtn.textContent = st.enabled ? 'on' : 'off';
        toggleBtn.title = st.enabled ? 'Turn autosave off' : 'Turn autosave on';
        saveBox.classList.toggle('is-off', !st.enabled);
        saveBox.classList.toggle('is-error', !!saveError);
        saveBox.classList.toggle('is-pending', !!st.unsaved && !saveError);
        if (saveError) {
            saveState.textContent = `⚠ Autosave failed — ${saveError}`;
        } else if (!st.enabled) {
            saveState.textContent = 'Autosave OFF — this session is not being saved';
        } else if (st.saving) {
            saveState.textContent = 'Saving…';
        } else if (st.unsaved) {
            saveState.textContent = `Autosave on · unsaved changes · last saved ${ago(st.lastSavedAt)}`;
        } else {
            saveState.textContent = `✓ Autosave on · saved ${ago(st.lastSavedAt)}`;
        }
        // The one thing a user cannot infer: the take is not written until the
        // recording stops, so a crash mid-recording loses the audio.
        saveState.title = st.takeNote || 'Captures, text and screenshots are saved automatically.';
    }

    q('#nr-save-now').addEventListener('click', () => { saveError = null; api.flushAutosave().catch(() => {}); });
    toggleBtn.addEventListener('click', async () => {
        const st = await api.getAutosave();
        await api.setAutosave({ on: !st.enabled });
        refreshSave();
    });
    window.addEventListener('nr:autosave:status', refreshSave);
    window.addEventListener('nr:autosave:saved', () => { saveError = null; refreshSave(); });
    window.addEventListener('nr:autosave:error', e => { saveError = e.detail?.message || e.detail?.code || 'unknown'; refreshSave(); });
    setInterval(refreshSave, 15000);            // keep "saved 2m ago" honest
    refreshSave();

    // ── Undo / redo ─────────────────────────────────────────────────────────
    const undoBtn = q('#nr-undo'), redoBtn = q('#nr-redo'), histState = q('#nr-hist-state');
    async function refreshHistory() {
        let h;
        try { h = await api.getHistory(); } catch (_) { return; }
        undoBtn.disabled = !h.canUndo;
        redoBtn.disabled = !h.canRedo;
        histState.textContent = h.actions ? `${h.actions} actions logged` : '';
    }
    undoBtn.addEventListener('click', () => { api.undo(); refreshHistory(); });
    redoBtn.addEventListener('click', () => { api.redo(); refreshHistory(); });
    window.addEventListener('nr:history:changed', refreshHistory);
    window.addEventListener('nr:action:recorded', refreshHistory);
    // Bound on the document, but ONLY outside a live session: while capturing,
    // every key is a capture mark, and stealing ⌘Z from that would be worse
    // than not having the shortcut at all.
    document.addEventListener('keydown', ev => {
        if (!(ev.metaKey || ev.ctrlKey) || String(ev.key).toLowerCase() !== 'z') return;
        if (state.status === 'capturing') return;
        ev.preventDefault();
        if (ev.shiftKey) api.redo(); else api.undo();
        refreshHistory();
    });
    refreshHistory();

    // ── Cleanup timing ──────────────────────────────────────────────────────
    (async () => {
        try {
            const t = await api.getCleanupTiming();
            q('#nr-clean-timing').value = t.order === 'parallel' ? 'parallel' : t.timing;
        } catch (_) { /* */ }
    })();
    q('#nr-clean-timing').addEventListener('change', e => {
        const v = e.target.value;
        api.setCleanupTiming(v === 'parallel'
            ? { timing: 'streaming', order: 'parallel' }
            : { timing: v, order: 'sequential' });
    });

    // ── The page recorder ───────────────────────────────────────────────────
    //
    // The checkboxes are shown even when they cannot be used, and say WHY. A
    // hidden feature teaches nobody it exists; a disabled one with no reason is
    // indistinguishable from a broken one — the same failure this project keeps
    // writing tests about.
    //
    // They are ticked here but the actual settings live in the extension's own
    // popup, because arming a tab requires a click on the extension: a page
    // cannot start recording another page, and should not be able to.
    const inputWhy = q('#nr-input-why'), inputState = q('#nr-input-state');
    const attachBtn = q('#nr-in-attach'), detachBtn = q('#nr-in-detach');

    async function refreshInput() {
        let avail;
        try { avail = await api.inputAvailability(); } catch (_) { return; }
        const boxes = ['#nr-in-mouse', '#nr-in-keys', '#nr-in-console', '#nr-in-net'].map(q);
        for (const b of boxes) b.disabled = true;          // always set in the extension popup
        if (!avail.available) {
            inputWhy.textContent = avail.reason;
            inputWhy.className = 'nr-muted nr-input__why';
            attachBtn.disabled = true;
            inputState.textContent = 'not installed';
            return;
        }
        inputWhy.textContent = avail.note;
        attachBtn.disabled = false;
        let st;
        try { st = await api.getInput(); } catch (_) { return; }
        if (st.total || st.polling) {
            attachBtn.hidden = true; detachBtn.hidden = false;
            const bits = Object.entries(st.byKind).map(([k, n]) => `${n} ${k}`);
            inputState.textContent = `${st.polling ? '● recording' : 'attached'} — ${bits.join(', ') || 'nothing yet'}`
                + (st.redacted ? ` · ${st.redacted} keystrokes redacted` : '');
            inputState.className = st.polling ? 'nr-ok' : 'nr-muted';
        } else {
            inputState.textContent = `extension v${avail.version} ready`;
        }
    }

    attachBtn.addEventListener('click', async () => {
        try { await api.attachInput({}); refreshInput(); }
        catch (err) { inputWhy.textContent = err.message; }
    });
    detachBtn.addEventListener('click', async () => {
        try { await api.detachInput(); } catch (_) { /* */ }
        attachBtn.hidden = false; detachBtn.hidden = true;
        refreshInput();
    });
    for (const ev of ['nr:input:batch', 'nr:input:started', 'nr:input:stopped', 'nr:session:started', 'nr:reset']) {
        window.addEventListener(ev, refreshInput);
    }
    setInterval(refreshInput, 4000);
    refreshInput();

    // ── "You had a session open when the page went away" ────────────────────
    const restoreBox = q('#nr-restore');
    (async () => {
        let found;
        try { found = await api.findUnsaved(); } catch (_) { return; }
        if (!found.found) return;
        const mins = Math.round(found.ageMs / 60000);
        q('#nr-restore__what').textContent = found.recoverable
            ? `${found.pairs} capture${found.pairs === 1 ? '' : 's'}, ~${found.words} words, from ${mins < 1 ? 'less than a minute' : `${mins} minute${mins === 1 ? '' : 's'}`} ago.`
            : `${found.pairs} capture${found.pairs === 1 ? '' : 's'} were in progress, but nothing reached disk — there is nothing to restore.`;
        q('#nr-restore-yes').disabled = !found.recoverable;
        restoreBox.hidden = false;
    })();
    q('#nr-restore-yes').addEventListener('click', async () => {
        q('#nr-restore-yes').disabled = true;
        try { await api.restoreUnsaved(); restoreBox.hidden = true; refreshCounts(); }
        catch (err) { q('#nr-restore__what').textContent = `Could not restore: ${err.message}`; }
    });
    q('#nr-restore-no').addEventListener('click', () => { api.dismissUnsaved(); restoreBox.hidden = true; });

    // Liveness meter from the session's suggestion/energy path is overkill for
    // v0.1 — pulse the meter on marks + transcribe events instead.
    for (const ev of ['nr:mark', 'nr:transcribe:complete']) {
        window.addEventListener(ev, () => {
            meter.style.width = '100%';
            setTimeout(() => { meter.style.width = '12%'; }, 250);
        });
    }
}
