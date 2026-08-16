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

export function initPairs(el, state) {
    if (!el) return;
    el.innerHTML = `<div class="nr-pairs"><div class="nr-pairs__empty nr-muted">
        No pairs yet — share a screen, narrate, and press a key at each moment that matters.
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
                    <b>${p.seq + 1}</b> · ${fmtTime(p.tPress)}
                    <span class="nr-pair-row__status" title="${p.status}">${STATUS_GLYPH[p.status] || '○'}</span>
                    ${p.clean && p.clean.marks && p.clean.marks.length ? `<span class="nr-pair-row__unsure">${p.clean.marks.length} unsure</span>` : ''}
                  </div>
                  <div class="nr-pair-row__text">${snippet}</div>
                </div>`;
            row.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('nr:ui:select-pair', { detail: { id: p.id } }));
                for (const r of list.children) r.classList.toggle('is-selected', r === row);
            });
            list.appendChild(row);
        }
    }

    for (const ev of ['nr:pair:added', 'nr:pair:updated', 'nr:pair:removed',
                      'nr:transcribe:complete', 'nr:transcribe:error',
                      'nr:clean:complete', 'nr:clean:error', 'nr:reset', 'nr:session:ended']) {
        window.addEventListener(ev, render);
    }
    render();
}
