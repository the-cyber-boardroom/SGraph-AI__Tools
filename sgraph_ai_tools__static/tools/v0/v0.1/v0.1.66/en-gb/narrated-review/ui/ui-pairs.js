/**
 * ui-pairs.js
 * The ordered pair list — thumbnail · text (clean leads, raw fallback) ·
 * status. Clicking a row selects it for the Review panel (via an internal
 * window event, so panels stay decoupled).
 * @module ui-pairs
 */

import { fmtTime } from '../api/nr-document.js';

const STATUS_GLYPH = {
    marked: '○', transcribing: '◌', raw: '◑', cleaning: '◌', clean: '✓', error: '⚠',
};

export function initPairs(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="nr-pairs">
        <div class="nr-pairs__bar">
          <button id="nr-insert-end" class="nr-btn nr-btn--sm">+ Add capture</button>
          <span class="nr-muted">reorder with ↑ ↓ · a capture is an image, some words, or both</span>
        </div>
        <div class="nr-pairs__empty nr-muted">
        No captures yet — share a screen, narrate, and press a key at each moment that matters.
      </div><div id="nr-pair-list"></div></div>`;
    const list = el.querySelector('#nr-pair-list');
    const empty = el.querySelector('.nr-pairs__empty');
    const thumbs = new Map();   // pairId -> objectURL (revoked on re-render)

    function render() {
        empty.style.display = state.pairs.length ? 'none' : 'block';
        for (const url of thumbs.values()) URL.revokeObjectURL(url);
        thumbs.clear();
        list.innerHTML = '';
        for (const p of [...state.pairs].sort((a, b) => a.seq - b.seq)) {
            const row = document.createElement('div');
            row.className = 'nr-pair-row';
            row.dataset.pairId = p.id;

            let thumbHtml = '<div class="nr-pair-row__thumb nr-pair-row__thumb--none">no image</div>';
            if (p.screenshot) {
                const url = URL.createObjectURL(p.screenshot);
                thumbs.set(p.id, url);
                thumbHtml = `<img class="nr-pair-row__thumb" src="${url}" alt="Moment ${p.seq + 1}">`;
            }
            const text = (p.clean && p.clean.text) || (p.raw && p.raw.text) || '';
            const snippet = text ? text.slice(0, 140) + (text.length > 140 ? '…' : '') : '<i>awaiting transcript</i>';
            row.innerHTML = `
                ${thumbHtml}
                <div class="nr-pair-row__body">
                  <div class="nr-pair-row__head">
                    <b>${p.seq + 1}</b> · ${p.tPress == null ? 'added' : fmtTime(p.tPress)}
                    <span class="nr-pair-row__status" title="${p.status}">${STATUS_GLYPH[p.status] || '○'}</span>
                    ${p.clean && p.clean.marks && p.clean.marks.length ? `<span class="nr-pair-row__unsure">${p.clean.marks.length} unsure</span>` : ''}
                    ${p.notes ? '<span class="nr-pair-row__note">note</span>' : ''}
                    ${p.source === 'inserted' ? '<span class="nr-pair-row__added">added</span>' : ''}
                    <span class="nr-pair-row__ord">
                      <button data-move="-1" title="move earlier">↑</button>
                      <button data-move="1" title="move later">↓</button>
                      <button data-insert="1" title="insert a capture after this one">+</button>
                    </span>
                  </div>
                  <div class="nr-pair-row__text">${snippet}</div>
                </div>`;
            row.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', ev => {
                ev.stopPropagation();
                api.movePair({ id: p.id, by: Number(b.dataset.move) });
            }));
            row.querySelector('[data-insert]').addEventListener('click', ev => {
                ev.stopPropagation();
                api.insertPair({ afterId: p.id, text: '', notes: '' })
                   .then(np => window.dispatchEvent(new CustomEvent('nr:ui:select-pair', { detail: { id: np.id } })));
            });
            row.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('nr:ui:select-pair', { detail: { id: p.id } }));
                for (const r of list.children) r.classList.toggle('is-selected', r === row);
            });
            list.appendChild(row);
        }
    }

    el.querySelector('#nr-insert-end').addEventListener('click', () => {
        api.insertPair({ text: '', notes: '' })
           .then(np => window.dispatchEvent(new CustomEvent('nr:ui:select-pair', { detail: { id: np.id } })));
    });

    for (const ev of ['nr:pair:added', 'nr:pair:updated', 'nr:pair:removed', 'nr:pairs:reordered',
                      'nr:transcribe:complete', 'nr:transcribe:error',
                      'nr:clean:complete', 'nr:clean:error', 'nr:reset', 'nr:session:ended']) {
        window.addEventListener(ev, render);
    }
    render();
}
