/**
 * nr-autosave.js
 * Keep the session on disk without being asked, and notice when one was lost.
 *
 * WHY. A review is not reproducible. The transcript can be re-run from the
 * audio; the ordering, the notes, the corrections and the judgement cannot. A
 * stray gesture that reloads the tab throws away the only copy of the part that
 * took the longest — which is exactly what nearly happened after a good session.
 *
 * THREE GUARDS, cheapest first, because each catches what the one before misses:
 *
 * 1. **`beforeunload`** — the browser's own "Leave site?" prompt, the only thing
 *    that can stop a reload *before* it happens. It fires when there are unsaved
 *    changes, and **also while capturing**, because a recording in progress
 *    cannot be resumed by any amount of saving: the microphone stream dies with
 *    the page. (`sg-video-editor` guards on unsaved changes alone, which is
 *    right for a tool with nothing live attached to it.)
 * 2. **Autosave to the VFS** — debounced after a change, with a ceiling so a
 *    steady stream of edits still lands. Writes into the session it was loaded
 *    from, or mints a new one on first save.
 * 3. **A crash beacon in localStorage** — tiny, synchronous, written on every
 *    change. localStorage survives what IndexedDB writes in flight do not, so
 *    on the next boot the tool can say "there was a session in progress, here
 *    is what was in it" rather than opening blank as if nothing had happened.
 *
 * WHAT AUTOSAVE DOES NOT WRITE WHILE CAPTURING: the audio take. It grows for
 * the whole recording and the VFS stores text, so every pass would base64 the
 * entire take again — minutes of audio rewritten every few seconds. The take is
 * written once, on the first save after capture stops. **A crash mid-recording
 * therefore keeps the captures, the screenshots and any transcripts, and loses
 * the audio.** That is a real gap and it is stated rather than papered over.
 *
 * @module nr-autosave
 */

import { state, config } from './nr-state.js';
import { saveSession } from './nr-store.js';

const BEACON_KEY = 'nr-session-beacon';

/**
 * Quiet period after a change before writing.
 *
 * Much longer than `sg-video-editor`'s 750 ms, and for a concrete reason: that
 * tool writes a few KB of JSON to localStorage, while this one base64s every
 * screenshot into IndexedDB. Writing that every three-quarters of a second
 * during a fast edit pass would make the tool feel worse than the risk it is
 * insuring against. `MAX_INTERVAL_MS` is what keeps the debounce honest.
 */
const DEBOUNCE_MS = 3500;
/** However busy the session, never go longer than this without a write. */
const MAX_INTERVAL_MS = 30_000;

let emitFn = () => {};
let enabled = true;
let timer = null;
let lastWriteAt = 0;
let dirtySince = 0;
let writing = false;
let takeWritten = false;
let armed = false;
let lastResult = null;

/** @param {{ emit: Function }} deps */
export function initAutosave({ emit } = {}) {
    if (typeof emit === 'function') emitFn = emit;
    try {
        const saved = localStorage.getItem('nr-autosave');
        if (saved != null) enabled = saved !== 'off';
    } catch (_) { /* storage blocked — default on, just not remembered */ }
    armUnloadGuard();
    return status();
}

// ── The unload guard ────────────────────────────────────────────────────────

function armUnloadGuard() {
    if (armed) return;
    armed = true;
    window.addEventListener('beforeunload', ev => {
        if (!state.pairs.length) return undefined;           // nothing to lose
        // Saved and idle is not worth interrupting anyone for. Mid-recording is,
        // even with everything on disk — the take cannot be resumed.
        if (!dirtySince && state.status !== 'capturing') return undefined;
        ev.preventDefault();
        // Chrome ignores the string and shows its own wording; returnValue is
        // still what actually triggers the prompt in several engines.
        ev.returnValue = '';
        return '';
    });
}

// ── The beacon ──────────────────────────────────────────────────────────────

/**
 * A few hundred bytes describing what is in progress. Never the content — the
 * content is in the VFS, and duplicating it here would put a session's worth of
 * text into a 5 MB store that other tools share.
 */
function writeBeacon() {
    try {
        localStorage.setItem(BEACON_KEY, JSON.stringify({
            sessionId: state.sessionId,
            status: state.status,
            pairs: state.pairs.length,
            words: state.pairs.reduce((n, p) => n + ((p.clean?.text || p.raw?.text || '').split(/\s+/).filter(Boolean).length), 0),
            startedAt: state.startedAt,
            at: Date.now(),
            savedAt: lastWriteAt || null,
        }));
    } catch (_) { /* */ }
}

function clearBeacon() {
    try { localStorage.removeItem(BEACON_KEY); } catch (_) { /* */ }
}

/**
 * Was a session in progress when this page last went away?
 *
 * "Recoverable" means the VFS should still hold it: it had an id and had been
 * written at least once. A beacon with no `savedAt` is the honest bad case —
 * something was in progress and nothing reached disk — and it says so rather
 * than offering a restore that would come back empty.
 *
 * @returns {{ found: boolean, recoverable?: boolean, … }}
 */
export function findUnsaved() {
    let beacon = null;
    try { beacon = JSON.parse(localStorage.getItem(BEACON_KEY) || 'null'); } catch (_) { /* */ }
    if (!beacon || !beacon.pairs) return { found: false };
    // A session already open in this tab is not a lost one.
    if (state.sessionId && state.sessionId === beacon.sessionId && state.pairs.length) return { found: false };
    return {
        found: true,
        recoverable: !!(beacon.sessionId && beacon.savedAt),
        sessionId: beacon.sessionId || null,
        pairs: beacon.pairs,
        words: beacon.words || 0,
        at: beacon.at,
        savedAt: beacon.savedAt || null,
        ageMs: Date.now() - (beacon.at || Date.now()),
        unsavedForMs: beacon.savedAt ? Math.max(0, beacon.at - beacon.savedAt) : null,
    };
}

/** The user chose to forget it. */
export function dismissUnsaved() {
    clearBeacon();
    emitFn('nr:autosave:dismissed', {});
    return { ok: true };
}

// ── The save loop ───────────────────────────────────────────────────────────

/**
 * Something changed. Cheap and synchronous — safe to call from any mutation.
 * The beacon is written every time; the disk write is scheduled.
 */
export function markDirty(reason = 'edit') {
    if (!state.pairs.length) return;
    if (!dirtySince) dirtySince = Date.now();
    writeBeacon();
    if (!enabled) { emitFn('nr:autosave:status', status()); return; }
    const waited = Date.now() - dirtySince;
    const delay = waited >= MAX_INTERVAL_MS ? 0 : Math.min(DEBOUNCE_MS, MAX_INTERVAL_MS - waited);
    clearTimeout(timer);
    timer = setTimeout(() => { flush(reason).catch(() => {}); }, delay);
    emitFn('nr:autosave:status', status());
}

/**
 * Write now. Safe to call at any time; overlapping calls collapse.
 * @param {string} [reason]
 */
export async function flush(reason = 'manual') {
    clearTimeout(timer); timer = null;
    if (!enabled && reason !== 'manual') return status();
    if (writing || !state.pairs.length) return status();
    writing = true;
    emitFn('nr:autosave:status', { ...status(), saving: true });
    try {
        // The take is heavy and immutable once capture stops — write it once,
        // and never during capture. See the module note.
        const canWriteTake = !!state.take && state.status !== 'capturing';
        const includeAudio = canWriteTake && !takeWritten;
        const r = await saveSession({ includeAudio }, () => {});
        if (includeAudio) takeWritten = true;
        lastWriteAt = Date.now();
        dirtySince = 0;
        lastResult = { sessionId: r.sessionId || state.sessionId, at: lastWriteAt, includeAudio };
        writeBeacon();
        emitFn('nr:autosave:saved', { ...lastResult, reason });
    } catch (err) {
        // A failed autosave must be visible. Silence here is how a user learns
        // at the worst possible moment that nothing had been saved for an hour.
        emitFn('nr:autosave:error', { code: err.code || 'save-failed', message: err.message });
    } finally {
        writing = false;
        emitFn('nr:autosave:status', status());
    }
    return status();
}

/** @param {{ on?: boolean }} p */
export function setAutosave(p = {}) {
    enabled = p.on !== false;
    try { localStorage.setItem('nr-autosave', enabled ? 'on' : 'off'); } catch (_) { /* */ }
    if (enabled) markDirty('enabled'); else clearTimeout(timer);
    emitFn('nr:autosave:status', status());
    return status();
}

export function status() {
    return {
        enabled,
        saving: writing,
        sessionId: state.sessionId,
        lastSavedAt: lastWriteAt || null,
        pendingMs: dirtySince ? Date.now() - dirtySince : 0,
        unsaved: !!dirtySince,
        takeSaved: takeWritten,
        // Named so a UI does not have to know the rule to explain it.
        takeNote: state.status === 'capturing'
            ? 'the audio take is written once recording stops — captures and transcripts are saved continuously'
            : null,
    };
}

/**
 * A new, freshly loaded, or explicitly saved session starts a new save cycle.
 *
 * `takeSaved` must reflect what actually reached disk. Assuming it from
 * `loaded` alone is how a manual "save without audio" would convince autosave
 * the take was safe and stop it ever writing one.
 *
 * @param {{ loaded?: boolean, takeSaved?: boolean }} p
 */
export function resetAutosave({ loaded = false, takeSaved } = {}) {
    clearTimeout(timer); timer = null;
    dirtySince = 0;
    takeWritten = takeSaved !== undefined ? !!takeSaved : loaded;
    lastWriteAt = loaded ? Date.now() : 0;
    lastResult = null;
    if (loaded) writeBeacon(); else clearBeacon();
    emitFn('nr:autosave:status', status());
}

/** The session was explicitly discarded — stop offering to restore it. */
export function forgetSession() {
    clearTimeout(timer); timer = null;
    dirtySince = 0; lastWriteAt = 0; takeWritten = false; lastResult = null;
    clearBeacon();
    emitFn('nr:autosave:status', status());
}

export { config };
