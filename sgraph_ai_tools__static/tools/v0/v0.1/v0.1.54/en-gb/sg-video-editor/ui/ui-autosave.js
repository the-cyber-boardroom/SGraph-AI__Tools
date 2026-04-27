/** ui-autosave.js — debounced autosave + on-init restore prompt.
 *
 * Builds on the storage methods registered on the SgToolApi
 * (`api.autosave`, `api.getAutosave`, `api.discardAutosave`,
 * `api.isAutosaveNewer`, `api.loadProject`, `api.hydrateAssets`). Pure
 * DOM glue — no direct `localStorage` / `IndexedDB` access from this file.
 *
 * Debounce: every non-transient mutation schedules a `flushAutosave()` call
 * after `DEBOUNCE_MS` ms of idle. Mid-drag / transient edits skip the
 * autosave so we don't spam writes during scrubbing.
 *
 * Restore prompt: on init, if an autosave exists and is newer than every
 * named save, the user is asked once via `confirm()` whether to restore.
 * Restore = `api.setProject` with the autosave payload, then
 * `api.hydrateAssets()` to pull blob pixels back from IDB. Discard = clear.
 *
 * Round-9-J: every SgToolApi call goes through `await` because
 * SgToolApi._invoke is async-by-default.
 */

import { editorConfig } from './editor-config.js';

const DEBOUNCE_MS = 750;

/** Non-blocking in-page replacement for confirm(). Returns Promise<boolean>. */
function showRestorePrompt(msg) {
    return new Promise(resolve => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center';
        const box = document.createElement('div');
        box.style.cssText = 'background:#1e2535;color:#e2e8f0;border-radius:12px;padding:24px 28px;max-width:360px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.6);font-family:system-ui,sans-serif';
        const h = document.createElement('div');
        h.style.cssText = 'font-weight:600;font-size:15px;margin-bottom:8px';
        h.textContent = 'Restore unsaved work?';
        const p = document.createElement('div');
        p.style.cssText = 'font-size:13px;color:#94a3b8;margin-bottom:20px;line-height:1.5';
        p.textContent = msg;
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
        function done(v) {
            document.removeEventListener('keydown', onKey);
            try { document.body.removeChild(ov); } catch (_) {}
            resolve(v);
        }
        const discardBtn = document.createElement('button');
        discardBtn.textContent = 'Discard';
        discardBtn.style.cssText = 'padding:7px 16px;border-radius:6px;border:1px solid #334155;background:transparent;color:#94a3b8;cursor:pointer;font-size:13px';
        discardBtn.onclick = () => done(false);
        const restoreBtn = document.createElement('button');
        restoreBtn.textContent = 'Restore';
        restoreBtn.style.cssText = 'padding:7px 16px;border-radius:6px;border:none;background:#22c55e;color:#052e16;cursor:pointer;font-size:13px;font-weight:600';
        restoreBtn.onclick = () => done(true);
        function onKey(e) {
            if (e.key === 'Escape') done(false);
            else if (e.key === 'Enter') done(true);
        }
        document.addEventListener('keydown', onKey);
        btns.appendChild(discardBtn);
        btns.appendChild(restoreBtn);
        box.appendChild(h); box.appendChild(p); box.appendChild(btns);
        ov.appendChild(box);
        document.body.appendChild(ov);
        restoreBtn.focus();
    });
}

function timeAgo(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return 'a moment ago';
    const dMs = Date.now() - ts;
    if (dMs < 60_000) return `${Math.max(1, Math.floor(dMs / 1000))} seconds ago`;
    if (dMs < 3_600_000) return `${Math.floor(dMs / 60_000)} minutes ago`;
    if (dMs < 86_400_000) return `${Math.floor(dMs / 3_600_000)} hours ago`;
    return `${Math.floor(dMs / 86_400_000)} days ago`;
}

/**
 * Attach the debounced autosave + on-init restore prompt to a state +
 * api pair. Call the returned `destroy()` to remove all listeners.
 *
 * @param {{
 *   state: object,
 *   api: object,
 *   debounceMs?: number,
 * }} cfg
 * @returns {{ flush: () => void, destroy: () => void, lastFlushAt: () => number,
 *            promptRestore: () => Promise<void> }}
 */
export function attachAutosave({ state, api, debounceMs }) {
    const wait = Number.isFinite(debounceMs) ? debounceMs : DEBOUNCE_MS;
    let timer = null;
    let lastFlushAt = 0;
    let destroyed = false;

    async function flush() {
        if (destroyed) return;
        if (timer) { clearTimeout(timer); timer = null; }
        try {
            const r = await api.autosave();
            if (r && r.savedAt) lastFlushAt = r.savedAt;
        } catch (_) { /* don't propagate — autosave is best-effort */ }
    }

    function onChange(e) {
        if (destroyed) return;
        // Skip transient mutations (drag scrubs etc) — saving every tick
        // would drown localStorage and produce no useful checkpoint.
        if (e && e.detail && e.detail.transient) return;
        if (!editorConfig.get('autosaveEnabled')) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            // Best-effort fire-and-forget — flush() returns a Promise but
            // we don't await it here (we're inside a setTimeout callback).
            flush();
        }, wait);
    }

    state.addEventListener('change', onChange);

    /** On-init restore prompt. Only runs once. */
    async function maybePromptRestore() {
        try {
            const slot = await api.getAutosave();
            if (!slot || !slot.project) return;
            const newer = await api.isAutosaveNewer({ savedAt: slot.savedAt });
            const isNewer = !!(newer && (newer.newer === true || newer === true));
            if (!isNewer) return;
            const ago = timeAgo(slot.savedAt);
            const ok = await showRestorePrompt(`Found unsaved work from ${ago}. Restore it?`);
            if (ok) {
                // Restore via setProject — the autosave payload IS a wrapped
                // project (with __missingBlob tags on assets).
                try { await api.setProject({ project: slot.project }); }
                catch (_) {}
                // Round-9-J: hydrate asset blobs from IDB so pixels reappear.
                // hydrateAssets is best-effort — missing blobs leave the
                // __missingBlob flag in place for the asset panel.
                try { await api.hydrateAssets(); } catch (_) {}
                // Don't discard yet — the user might refresh again before
                // saving manually; the next mutation will overwrite anyway.
            } else {
                try { await api.discardAutosave(); } catch (_) {}
            }
        } catch (_) { /* never block init on a prompt error */ }
    }

    return {
        flush,
        promptRestore: maybePromptRestore,
        lastFlushAt: () => lastFlushAt,
        destroy() {
            destroyed = true;
            if (timer) { clearTimeout(timer); timer = null; }
            try { state.removeEventListener('change', onChange); } catch (_) {}
        },
    };
}
