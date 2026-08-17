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
          <button id="nr-ex-pdf" class="nr-btn">📕 Download PDF</button>
          <button id="nr-ex-send" class="nr-btn">🔐 Share via SG/Send</button>
        </div>
        <h4>Save to a vault</h4>
        <div class="nr-export__row nr-vault">
          <input id="nr-vault-id" placeholder="vault id" autocomplete="off">
          <input id="nr-vault-secret" type="password" placeholder="write passphrase or token" autocomplete="off">
          <label class="nr-export__opt"><input id="nr-vault-audio" type="checkbox"> include raw audio</label>
          <button id="nr-vault-save" class="nr-btn">💾 Save to vault</button>
        </div>
        <div class="nr-muted">Audio is off by default: it is the bulk of the size, and only needed to
          re-transcribe later, re-cut a boundary, or build something else from the same materials.</div>
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

    q('#nr-ex-pdf').addEventListener('click', async () => {
        q('#nr-ex-status').textContent = 'building PDF…';
        try {
            const r = await api.downloadPdf({});
            q('#nr-ex-status').textContent = `✓ ${r.name} (${r.pages} pages)`;
        } catch (err) { q('#nr-ex-status').textContent = `pdf failed: ${err.message}`; }
    });

    q('#nr-vault-save').addEventListener('click', async () => {
        const vaultId = q('#nr-vault-id').value.trim();
        const secret = q('#nr-vault-secret').value;
        if (!vaultId || !secret) { q('#nr-ex-status').textContent = 'vault id and passphrase/token are required'; return; }
        q('#nr-ex-status').textContent = 'writing to vault…';
        try {
            const r = await api.saveToVault({
                vaultId,
                [/^[a-z]+-[a-z]+-\d{4}$/.test(secret) ? 'token' : 'passphrase']: secret,
                includeAudio: q('#nr-vault-audio').checked,
            });
            q('#nr-ex-status').textContent = `✓ wrote ${r.written} files to ${r.base}`;
        } catch (err) { q('#nr-ex-status').textContent = `vault failed: ${err.code || ''} ${err.message}`; }
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
