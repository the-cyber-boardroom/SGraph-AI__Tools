/**
 * publisher-autopublish.js
 * Persisted publish preferences (remembered privacy, auto-publish opt-in),
 * the auto-publish continuation (cancellable grace countdown → silent
 * connect → upload), and the big cancelRun(). Pipeline-side effects
 * (upload, engine stop/reset) are injected via initAutoPublish() so the
 * dependency graph stays one-directional — this module never imports the
 * pipeline.
 * @module publisher-autopublish
 */

import { state, resetJob } from './publisher-state.js';
import { VP_EVENTS } from './publisher-events.js';
import * as Steps from './publisher-steps.js';
import * as YT from './publisher-youtube.js';

// ── Remembered privacy (Metadata-tab checkbox) ───────────────────────────────
// The tool default stays 'unlisted'; a user who always publishes public can
// opt in to remembering their choice.

const PRIVACY_STORAGE = 'sg-video-publisher-privacy';
const PRIVACY_VALUES  = ['public', 'unlisted', 'private'];

/** The stored preference, or null when the user hasn't opted in. */
export function getStoredPrivacy() {
    const v = localStorage.getItem(PRIVACY_STORAGE);
    return PRIVACY_VALUES.includes(v) ? v : null;
}

/** The effective default: stored preference, else 'unlisted'. */
export function getDefaultPrivacy() { return getStoredPrivacy() || 'unlisted'; }

/** Persist (privacy value) or clear (null) the remembered default. */
export function setDefaultPrivacy(privacy) {
    if (privacy == null) { localStorage.removeItem(PRIVACY_STORAGE); return { stored: null }; }
    if (!PRIVACY_VALUES.includes(privacy)) throw Object.assign(new Error(`Invalid privacy: ${privacy}`), { code: 'bad-params' });
    localStorage.setItem(PRIVACY_STORAGE, privacy);
    return { stored: privacy };
}

// ── Auto-publish after recording (Record-tab checkbox) ───────────────────────
// Two-click publish: Start → Stop, then the pipeline runs AND uploads —
// after a cancellable grace countdown. Opt-in; requires a previously
// granted YouTube sign-in (the silent token path needs no user gesture).

const AUTOPUBLISH_STORAGE = 'sg-video-publisher-autopublish';
export const AUTOPUBLISH_GRACE_S = 5;

export function getAutoPublish()  { return localStorage.getItem(AUTOPUBLISH_STORAGE) === '1'; }
export function setAutoPublish(enabled) {
    if (enabled) localStorage.setItem(AUTOPUBLISH_STORAGE, '1');
    else         localStorage.removeItem(AUTOPUBLISH_STORAGE);
    return { autoPublish: !!enabled };
}

// ── Flow + cancel (deps injected from the pipeline) ──────────────────────────

let _ctx = { emit: () => {}, upload: null, stopEngine: null, resetEngine: null };

/** Inject runtime dependencies. Called once from publisher-pipeline.boot(). */
export function initAutoPublish(ctx) { _ctx = { ..._ctx, ...ctx }; }

/** Cancellable grace countdown, then silent connect + upload. */
export async function autoPublishFlow() {
    for (let s = AUTOPUBLISH_GRACE_S; s > 0; s--) {
        if (state.cancelRequested) return;
        _ctx.emit(VP_EVENTS.AUTOPUBLISH_COUNTDOWN, { secondsLeft: s });
        await new Promise(r => setTimeout(r, 1000));
    }
    if (state.cancelRequested) return;
    _ctx.emit(VP_EVENTS.AUTOPUBLISH_COUNTDOWN, { secondsLeft: 0 });
    if (!state.youtube.connected) {
        try { await YT.connect({ silent: true, emit: _ctx.emit }); }
        catch (_e) {
            Steps.setStep('publish', 'error', { error: 'Sign in to YouTube once, then auto-publish can finish on its own.', code: 'auth-required' });
            _ctx.emit(VP_EVENTS.STEP_ERROR, { step: 'publish', code: 'auth-required', message: 'Auto-publish paused — sign in from the Publish tab (a one-time grant; afterwards the silent token path needs no clicks).' });
            return;
        }
    }
    if (state.cancelRequested) return;
    await _ctx.upload().catch(() => { /* recorded on the publish step */ });
}

/**
 * The big cancel — stops the entire workflow wherever it is:
 * recording (discards it), running steps, the grace countdown, or the
 * upload itself. The loaded blob and any finished transcript are kept.
 */
export async function cancelRun() {
    const during = state.phase === 'recording' ? 'recording'
        : state.phase === 'uploading' ? 'upload'
        : 'steps';
    state.cancelRequested = true;
    Steps.cancelTranscribe();
    YT.abortUpload();
    if (during === 'recording') {
        try { await _ctx.stopEngine(); } catch (_e) { /* not recording */ }
        resetJob();
        _ctx.resetEngine();
        state.metadata.privacy = getDefaultPrivacy();
        _ctx.emit(VP_EVENTS.JOB_RESET, {});
    }
    _ctx.emit(VP_EVENTS.RUN_CANCELLED, { during });
    // The flag is consumed: a fresh action (re-run, upload, new job) starts clean.
    if (during !== 'recording') setTimeout(() => { state.cancelRequested = false; }, 0);
    return { cancelled: true, during };
}
