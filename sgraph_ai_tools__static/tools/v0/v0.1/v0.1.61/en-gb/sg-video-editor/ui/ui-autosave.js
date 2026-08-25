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
 * named save, the user is asked once (via an in-page modal) whether to restore.
 * Restore = `api.setProject` with the autosave payload, then
 * `api.hydrateAssets()` to pull blob pixels back from IDB. Discard = clear.
 *
 * Round-9-J: every SgToolApi call goes through `await` because
 * SgToolApi._invoke is async-by-default.
 */

import { editorConfig } from './editor-config.js';
import { showConfirm } from './ui-confirm.js';

const DEBOUNCE_MS = 750;


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

    /** Re-sync the "UNSAVED CHANGES" banner with the actual dirty state.
     *  api.autosave() calls state.markSaved() — flipping hasUnsavedChanges()
     *  to false — but nothing re-renders the banner (ui-shell only dispatches
     *  `sgve:state-changed` on state mutations). Without this, the banner
     *  turned on by the last edit stays visible forever even though every
     *  edit is persisted — the "sticky UNSAVED CHANGES" bug. Recompute (not
     *  hard-code false): a mutation landing mid-flush must keep it dirty. */
    async function syncDirtyBanner() {
        try {
            const r = await api.hasUnsavedChanges();
            const isDirty = !!(r && (r.hasUnsavedChanges === true || r === true));
            document.dispatchEvent(new CustomEvent('sgve:state-changed', { detail: { isDirty } }));
        } catch (_) { /* banner sync is best-effort */ }
    }

    let warnedAutosaveFail = false;

    async function flush() {
        if (destroyed) return;
        if (timer) { clearTimeout(timer); timer = null; }
        try {
            const r = await api.autosave();
            if (r && r.savedAt) lastFlushAt = r.savedAt;
            if (r && r.ok === false && !warnedAutosaveFail) {
                // Autosave failing silently leaves the UNSAVED CHANGES banner
                // on forever with no clue why — surface it once per session.
                warnedAutosaveFail = true;
                document.dispatchEvent(new CustomEvent('tool:toast', {
                    detail: { message: `Autosave failed: ${r.error || 'unknown error'}`, kind: 'error' },
                }));
            }
            if (r && r.ok !== false) {
                // Diagnostic: a successful autosave must leave the project
                // clean. If it doesn't, the saved-baseline hash and the live
                // hash recipe have diverged — log loudly so it's debuggable.
                const d = await api.hasUnsavedChanges();
                if (d && d.hasUnsavedChanges === true) {
                    console.warn('[sgve] autosave succeeded but hasUnsavedChanges() is still true — dirty-hash divergence; banner will stay on');
                }
            }
            await syncDirtyBanner();
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
            const ok = await showConfirm(`Found unsaved work from ${ago}. Restore it?`, {
                title: 'Restore unsaved work?',
                confirmLabel: 'Restore',
                cancelLabel: 'Discard',
            });
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
                //
                // The restored project IS the persisted autosave bytes, so it
                // must start life clean. setProject (unlike loadProject's
                // replaceProject) never resets the dirty baseline, and its
                // 'change' event turns the banner ON — flushing re-persists
                // the identical content, marks it saved, and re-syncs the
                // banner OFF. Fixes "new tab shows UNSAVED CHANGES right
                // after restoring".
                await flush();
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
