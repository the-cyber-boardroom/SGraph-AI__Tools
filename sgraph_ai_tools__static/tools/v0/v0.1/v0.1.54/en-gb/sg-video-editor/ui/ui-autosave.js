/** ui-autosave.js — debounced autosave + on-init restore prompt.
 *
 * Builds on the storage methods registered on the SgToolApi
 * (`api.autosave`, `api.getAutosave`, `api.discardAutosave`,
 * `api.isAutosaveNewer`, `api.loadProject`). Pure DOM glue — no direct
 * `localStorage` access from this file.
 *
 * Debounce: every non-transient mutation schedules a `flushAutosave()` call
 * after `DEBOUNCE_MS` ms of idle. Mid-drag / transient edits skip the
 * autosave so we don't spam writes during scrubbing.
 *
 * Restore prompt: on init, if an autosave exists and is newer than every
 * named save, the user is asked once via `confirm()` whether to restore.
 * Restore = `api.loadProject` against the autosave payload (we round-trip
 * via setProject because the autosave isn't a named-save). Discard = clear.
 */

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
 * @returns {{ flush: () => void, destroy: () => void, lastFlushAt: () => number }}
 */
export function attachAutosave({ state, api, debounceMs }) {
    const wait = Number.isFinite(debounceMs) ? debounceMs : DEBOUNCE_MS;
    let timer = null;
    let lastFlushAt = 0;
    let destroyed = false;

    function flush() {
        if (destroyed) return;
        if (timer) { clearTimeout(timer); timer = null; }
        try {
            const r = api.autosave();
            if (r && r.savedAt) lastFlushAt = r.savedAt;
        } catch (_) { /* don't propagate — autosave is best-effort */ }
    }

    function onChange(e) {
        if (destroyed) return;
        // Skip transient mutations (drag scrubs etc) — saving every tick
        // would drown localStorage and produce no useful checkpoint.
        if (e && e.detail && e.detail.transient) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, wait);
    }

    state.addEventListener('change', onChange);

    /** On-init restore prompt. Only runs once. */
    function maybePromptRestore() {
        try {
            const slot = api.getAutosave();
            if (!slot || !slot.project) return;
            const newer = api.isAutosaveNewer({ savedAt: slot.savedAt });
            const isNewer = !!(newer && (newer.newer === true || newer === true));
            if (!isNewer) return;
            const ago = timeAgo(slot.savedAt);
            const ok = confirm(`Restore unsaved work from ${ago}?`);
            if (ok) {
                // Restore via setProject — the autosave payload IS a wrapped
                // project (with __missingBlob tags on assets).
                try { api.setProject({ project: slot.project }); }
                catch (_) {}
                // Don't discard yet — the user might refresh again before
                // saving manually; the next mutation will overwrite anyway.
            } else {
                try { api.discardAutosave(); } catch (_) {}
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
