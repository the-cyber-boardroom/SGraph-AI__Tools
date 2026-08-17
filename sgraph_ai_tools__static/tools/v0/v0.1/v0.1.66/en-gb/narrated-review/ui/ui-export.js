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
        <h4>Saved sessions</h4>
        <div class="nr-export__row nr-sessions">
          <input id="nr-sess-name" placeholder="name this session (optional)" autocomplete="off">
          <label class="nr-export__opt"><input id="nr-sess-audio" type="checkbox"> keep audio</label>
          <button id="nr-sess-save" class="nr-btn">💾 Save session</button>
          <button id="nr-sess-refresh" class="nr-btn nr-btn--sm">↻</button>
        </div>
        <div id="nr-sess-list" class="nr-sessions__list nr-muted">not loaded</div>
        <div id="nr-ex-status" class="nr-muted"></div>
        <div id="nr-ex-drop"></div>
      </div>`;

    const q = s => el.querySelector(s);
    const include = () => ({ audio: q('#nr-ex-audio').checked, take: q('#nr-ex-take').checked });

    q('#nr-ex-zip').addEventListener('click', async () => {
        try {
            const r = await api.downloadZip({ include: include() });
            q('#nr-ex-status').textContent = `✓ ${r.name} (${(r.zipSize / 1024).toFixed(0)} KB, ${r.count} captures)`;
        } catch (err) { q('#nr-ex-status').textContent = `zip failed: ${err.message}`; }
    });

    async function refreshSessions() {
        const list = q('#nr-sess-list');
        try {
            const rows = await api.listSessions();
            if (!rows.length) { list.textContent = 'no saved sessions yet'; return; }
            list.innerHTML = '';
            for (const r of rows) {
                const row = document.createElement('div');
                row.className = 'nr-sessions__row';
                const when = new Date(r.savedAt || 0).toISOString().replace('T', ' ').slice(0, 16);
                row.innerHTML = `<span>${r.name || r.sessionId}</span>
                    <span class="nr-muted">${r.pairs} captures · ${when}${r.hasAudio ? ' · audio' : ''}</span>
                    <button data-load="${r.sessionId}" class="nr-btn nr-btn--sm">open</button>
                    <button data-del="${r.sessionId}" class="nr-btn nr-btn--sm nr-btn--danger">✕</button>`;
                list.appendChild(row);
            }
        } catch (err) { list.textContent = `could not list sessions: ${err.message}`; }
    }
    q('#nr-sess-refresh').addEventListener('click', refreshSessions);
    q('#nr-sess-save').addEventListener('click', async () => {
        q('#nr-ex-status').textContent = 'saving…';
        try {
            const r = await api.saveSession({ name: q('#nr-sess-name').value.trim() || undefined,
                                              includeAudio: q('#nr-sess-audio').checked });
            q('#nr-ex-status').textContent = `✓ saved "${r.name}" (${r.pairs} captures)`;
            refreshSessions();
        } catch (err) { q('#nr-ex-status').textContent = `save failed: ${err.code || ''} ${err.message}`; }
    });
    q('#nr-sess-list').addEventListener('click', async (e) => {
        const load = e.target.dataset && e.target.dataset.load;
        const del  = e.target.dataset && e.target.dataset.del;
        try {
            if (load) {
                q('#nr-ex-status').textContent = 'loading…';
                const r = await api.loadSession({ sessionId: load });
                q('#nr-ex-status').textContent = `✓ loaded ${r.pairs} captures` +
                    (r.hasAudio ? '' : ' — audio not stored, so re-transcribe is unavailable');
            }
            if (del) { await api.deleteSession({ sessionId: del }); refreshSessions(); }
        } catch (err) { q('#nr-ex-status').textContent = `${err.code || 'error'}: ${err.message}`; }
    });
    refreshSessions();

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
