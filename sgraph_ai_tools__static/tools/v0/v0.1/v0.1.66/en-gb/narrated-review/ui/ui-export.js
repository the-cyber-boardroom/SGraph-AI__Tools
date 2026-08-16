/**
 * ui-export.js
 * Export: session zip download + SG/Send encrypted link (sg-send-drop —
 * offerFile then the component's own token/upload flow).
 * @module ui-export
 */

import { buildSessionZip } from '../api/nr-zip.js';

export function initExport(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="nr-export">
        <label class="nr-export__opt"><input id="nr-ex-audio" type="checkbox" checked> segment WAVs</label>
        <label class="nr-export__opt"><input id="nr-ex-take" type="checkbox" checked> continuous take</label>
        <div class="nr-export__row">
          <button id="nr-ex-zip" class="nr-btn nr-btn--primary">⬇ Download session zip</button>
          <button id="nr-ex-send" class="nr-btn">🔐 Share via SG/Send</button>
        </div>
        <div id="nr-ex-status" class="nr-muted"></div>
        <div id="nr-ex-drop"></div>
      </div>`;

    const q = s => el.querySelector(s);
    const include = () => ({ audio: q('#nr-ex-audio').checked, take: q('#nr-ex-take').checked });

    q('#nr-ex-zip').addEventListener('click', async () => {
        try {
            const r = await api.downloadZip({ include: include() });
            q('#nr-ex-status').textContent = `✓ ${r.name} (${(r.zipSize / 1024).toFixed(0)} KB, ${r.count} pairs)`;
        } catch (err) { q('#nr-ex-status').textContent = `zip failed: ${err.message}`; }
    });

    q('#nr-ex-send').addEventListener('click', async () => {
        try {
            const { blob, name } = await buildSessionZip({ include: include() });
            let drop = q('#nr-ex-drop sg-send-drop');
            if (!drop) {
                drop = document.createElement('sg-send-drop');
                q('#nr-ex-drop').appendChild(drop);
            }
            if (typeof drop.offerFile === 'function') {
                drop.offerFile(blob, name);
                q('#nr-ex-status').textContent = 'Zip offered to SG/Send — complete the share below.';
            } else {
                q('#nr-ex-status').textContent = 'sg-send-drop not available.';
            }
        } catch (err) { q('#nr-ex-status').textContent = `send failed: ${err.message}`; }
    });
}
