/**
 * ui-capture-tab.js
 * One capture, opened as its own sg-layout tab: the screenshot, the raw and
 * clean text, the notes, and an INNER chat scoped to just this capture.
 *
 * Tabs are unlocked and closable, so sg-layout's drag-to-dock applies — several
 * captures can sit side by side, or below each other, while the Captures list
 * stays where it is. That is the review's ask: "I should be able even to see
 * multiple pairs, and each pair … contains the review, the chat".
 *
 * @module ui-capture-tab
 */

import { renderMarkdown } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js';
import { getPairById } from '../api/nr-state.js';
import { fmtTime } from '../api/nr-document.js';

/** Short tab title for a capture. */
export function tabTitle(pair) {
    return `#${pair.seq + 1} ${pair.tPress == null ? 'added' : fmtTime(pair.tPress)}`;
}

/**
 * Mount the editor for one capture into a panel element.
 * @param {HTMLElement} el
 * @param {string} id  pair id
 * @param {object} api
 */
export function initCaptureTab(el, id, api) {
    if (!el) return;
    el.innerHTML = `<div class="nr-ct">
        <img class="nr-ct__img" alt="capture screenshot">
        <div class="nr-ct__bar">
          <span class="nr-ct__when nr-muted"></span>
          <button data-act="up"   class="nr-btn nr-btn--sm">↑ earlier</button>
          <button data-act="down" class="nr-btn nr-btn--sm">↓ later</button>
          <button data-act="retx" class="nr-btn nr-btn--sm">↻ Re-transcribe</button>
          <button data-act="reclean" class="nr-btn nr-btn--sm">✨ Re-clean</button>
          <button data-act="remove" class="nr-btn nr-btn--sm nr-btn--danger">🗑 Remove</button>
        </div>
        <div class="nr-ct__cols">
          <div><h4>Raw (source — immutable)</h4><pre class="nr-ct__raw"></pre></div>
          <div><h4>Clean (editable)</h4>
            <textarea class="nr-ct__clean" rows="6"></textarea>
            <div class="nr-ct__marks nr-muted"></div>
            <button data-act="save-clean" class="nr-btn nr-btn--sm">Save text</button>
          </div>
        </div>
        <h4>Extra comments (notes)</h4>
        <textarea class="nr-ct__notes" rows="2" placeholder="Commentary added after the fact — shown as a note in the document."></textarea>
        <button data-act="save-notes" class="nr-btn nr-btn--sm">Save notes</button>
        <h4>Chat about this capture</h4>
        <div class="nr-ct__chatlog nr-chat__log"></div>
        <div class="nr-chat__row">
          <textarea class="nr-ct__chatin" rows="2" placeholder="Ask about this capture…"></textarea>
          <button data-act="ask" class="nr-btn nr-btn--primary">Send</button>
        </div>
        <div class="nr-ct__status nr-muted"></div>
      </div>`;

    const q = s => el.querySelector(s);
    let imgUrl = null;

    function render() {
        const p = getPairById(id);
        if (!p) { el.innerHTML = '<div class="nr-muted">This capture was removed.</div>'; return; }
        if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
        const img = q('.nr-ct__img');
        if (p.screenshot) { imgUrl = URL.createObjectURL(p.screenshot); img.src = imgUrl; img.style.display = ''; }
        else img.style.display = 'none';
        q('.nr-ct__when').textContent = `${p.id} · ${p.tPress == null ? 'added' : fmtTime(p.tPress)}` +
            (p.tEnd != null ? ` · ${((p.tEnd - p.tStart) / 1000).toFixed(1)}s of audio` : '');
        q('.nr-ct__raw').textContent = (p.raw && p.raw.text) || '(no raw transcript)';
        const clean = q('.nr-ct__clean');
        if (document.activeElement !== clean) clean.value = (p.clean && p.clean.text) || '';
        const notes = q('.nr-ct__notes');
        if (document.activeElement !== notes) notes.value = p.notes || '';
        const marks = (p.clean && p.clean.marks) || [];
        q('.nr-ct__marks').textContent = marks.length
            ? `Unsure: ${marks.map(m => `"${m.span}" (${m.note})`).join(' · ')}` : '';
    }

    el.addEventListener('click', async (e) => {
        const act = e.target && e.target.dataset && e.target.dataset.act;
        if (!act) return;
        const status = q('.nr-ct__status');
        try {
            if (act === 'up')      await api.movePair({ id, by: -1 });
            if (act === 'down')    await api.movePair({ id, by: 1 });
            if (act === 'retx')  { status.textContent = 'transcribing…'; await api.retranscribePair({ id }); status.textContent = ''; }
            if (act === 'reclean') { status.textContent = 'cleaning…'; await api.cleanPair({ id }); status.textContent = ''; }
            if (act === 'remove')  await api.removePair({ id });
            if (act === 'save-clean') await api.setText({ id, text: q('.nr-ct__clean').value });
            if (act === 'save-notes') await api.setNotes({ id, notes: q('.nr-ct__notes').value });
            if (act === 'ask') {
                const input = q('.nr-ct__chatin');
                const text = input.value.trim();
                if (!text) return;
                input.value = '';
                const log = q('.nr-ct__chatlog');
                log.insertAdjacentHTML('beforeend', `<div class="nr-chat__msg nr-chat__msg--you"><b>You</b><div>${
                    text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</div></div>`);
                status.textContent = 'thinking…';
                const r = await api.askPair({ id, text });
                log.insertAdjacentHTML('beforeend', `<div class="nr-chat__msg nr-chat__msg--bot"><b>Assistant</b><div>${
                    renderMarkdown(r.text || '')}</div></div>`);
                log.scrollTop = log.scrollHeight;
                status.textContent = typeof r.costUsd === 'number' ? `$${r.costUsd.toFixed(4)}` : '';
            }
        } catch (err) {
            status.textContent = `${err.code || 'error'}: ${err.message}`;
        }
    });
    q('.nr-ct__chatin').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('[data-act="ask"]').click(); }
    });

    const onUpdate = (e) => { if (!e.detail || e.detail.id === id) render(); };
    for (const ev of ['nr:pair:updated', 'nr:transcribe:complete', 'nr:clean:complete', 'nr:pairs:reordered']) {
        window.addEventListener(ev, onUpdate);
    }
    render();
}
