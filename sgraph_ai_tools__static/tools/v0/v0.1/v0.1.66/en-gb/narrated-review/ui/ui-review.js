/**
 * ui-review.js
 * Per-pair detail: image beside text — raw (read-only, the source) and clean
 * (editable, the derived) — bound nudge inputs, re-transcribe / re-clean.
 * MVP boundary editing is numeric (ms); the draggable take timeline is the
 * pack's Phase-5 follow-up.
 * @module ui-review
 */

import { getPairById } from '../api/nr-state.js';

export function initReview(el, state, config, api) {
    if (!el) return;
    el.innerHTML = `<div class="nr-review">
        <div id="nr-review-empty" class="nr-muted">Select a pair in the Pairs tab.</div>
        <div id="nr-review-body" style="display:none">
          <img id="nr-rv-img" class="nr-review__img" alt="screenshot">
          <div class="nr-review__bounds">
            <label>start <input id="nr-rv-start" type="number" step="100" min="0"> ms</label>
            <label>end <input id="nr-rv-end" type="number" step="100" min="0"> ms</label>
            <button id="nr-rv-apply" class="nr-btn nr-btn--sm">Apply bounds</button>
            <button id="nr-rv-retranscribe" class="nr-btn nr-btn--sm">↻ Re-transcribe</button>
            <button id="nr-rv-reclean" class="nr-btn nr-btn--sm">✨ Re-clean</button>
            <button id="nr-rv-up" class="nr-btn nr-btn--sm">↑ earlier</button>
            <button id="nr-rv-down" class="nr-btn nr-btn--sm">↓ later</button>
            <button id="nr-rv-remove" class="nr-btn nr-btn--sm nr-btn--danger">🗑 Remove</button>
          </div>
          <div class="nr-review__cols">
            <div><h4>Raw (source — immutable)</h4><pre id="nr-rv-raw" class="nr-review__raw"></pre></div>
            <div><h4>Clean (editable)</h4><textarea id="nr-rv-clean" class="nr-review__clean" rows="8"></textarea>
              <div id="nr-rv-marks" class="nr-muted"></div>
              <button id="nr-rv-save" class="nr-btn nr-btn--sm">Save text</button></div>
          </div>
          <div class="nr-review__notes">
            <h4>Extra comments (notes)</h4>
            <textarea id="nr-rv-notes" class="nr-review__clean" rows="3"
              placeholder="Commentary added after the fact — kept separate from the transcript, and marked as a note in the document."></textarea>
            <button id="nr-rv-notes-save" class="nr-btn nr-btn--sm">Save notes</button>
          </div>
        </div>
      </div>`;

    const q = s => el.querySelector(s);
    let currentId = null;
    let imgUrl = null;

    function show(id) {
        const p = getPairById(id);
        currentId = p ? id : null;
        q('#nr-review-empty').style.display = p ? 'none' : 'block';
        q('#nr-review-body').style.display = p ? 'block' : 'none';
        if (!p) return;
        if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
        const img = q('#nr-rv-img');
        if (p.screenshot) { imgUrl = URL.createObjectURL(p.screenshot); img.src = imgUrl; img.style.display = 'block'; }
        else img.style.display = 'none';
        q('#nr-rv-start').value = p.tStart ?? 0;
        q('#nr-rv-end').value = p.tEnd ?? '';
        q('#nr-rv-raw').textContent = (p.raw && p.raw.text) || '(no raw transcript yet)';
        q('#nr-rv-clean').value = (p.clean && p.clean.text) || '';
        const marks = (p.clean && p.clean.marks) || [];
        q('#nr-rv-notes').value = p.notes || '';
        q('#nr-rv-marks').textContent = marks.length
            ? `Unsure: ${marks.map(m => `"${m.span}" (${m.note})`).join(' · ')}`
            : '';
    }

    window.addEventListener('nr:ui:select-pair', e => show(e.detail.id));
    window.addEventListener('nr:pair:updated', e => { if (e.detail.id === currentId) show(currentId); });
    window.addEventListener('nr:transcribe:complete', e => { if (e.detail.id === currentId) show(currentId); });
    window.addEventListener('nr:clean:complete', e => { if (e.detail.id === currentId) show(currentId); });
    window.addEventListener('nr:reset', () => show(null));

    q('#nr-rv-apply').addEventListener('click', () => {
        if (!currentId) return;
        api.setBoundary({ id: currentId, tStart: Number(q('#nr-rv-start').value), tEnd: Number(q('#nr-rv-end').value) });
    });
    q('#nr-rv-retranscribe').addEventListener('click', () => currentId && api.retranscribePair({ id: currentId }).catch(() => {}));
    q('#nr-rv-reclean').addEventListener('click', () => currentId && api.cleanPair({ id: currentId }).catch(() => {}));
    q('#nr-rv-remove').addEventListener('click', () => {
        if (!currentId) return;
        api.removePair({ id: currentId });
        show(null);
    });
    q('#nr-rv-save').addEventListener('click', () => {
        if (!currentId) return;
        api.setText({ id: currentId, text: q('#nr-rv-clean').value });
    });
    q('#nr-rv-notes-save').addEventListener('click', () => {
        if (!currentId) return;
        api.setNotes({ id: currentId, notes: q('#nr-rv-notes').value });
    });
    q('#nr-rv-up').addEventListener('click',   () => currentId && api.movePair({ id: currentId, by: -1 }));
    q('#nr-rv-down').addEventListener('click', () => currentId && api.movePair({ id: currentId, by:  1 }));
}
