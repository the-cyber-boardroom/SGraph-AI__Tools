/**
 * mp-events.js
 * Frozen window-event names for media-probe. The public contract — embedders,
 * SKILL files and the manifest event catalogue depend on these. All events fire
 * on window; detail always carries `instanceId` (injected by SgToolApi._emit).
 *
 * @module mp-events
 */

export const MP_EVENTS = Object.freeze({
    READY:              'tool:ready',

    SOURCE_LOADED:      'mp:source:loaded',      // { name, durationMs, width, height, hasAudio }

    ANALYSE_STARTED:    'mp:analyse:started',    // { lane }
    ANALYSE_PROGRESS:   'mp:analyse:progress',   // { lane, done, total, pass }
    ANALYSE_COMPLETE:   'mp:analyse:complete',   // { lane, summary }

    THRESHOLD_CHANGED:  'mp:threshold:changed',  // { value, segments, capped, topicGaps }
    PLAN_READY:         'mp:plan:ready',         // { strategy, cuts, captures, estimateUsd }

    // A limit was hit, or a figure is less trustworthy than it looks. Never
    // silent: an unreliable measurement that looks reliable is the defect this
    // tool exists to prevent.
    WARNING:            'mp:warning',            // { code, message }

    FFMPEG_LOADING:     'mp:ffmpeg:loading',     // { ratio }
    FFMPEG_READY:       'mp:ffmpeg:ready',       // { what, rows }

    ERROR:              'mp:error',              // { code, step, message }
    RESET:              'mp:reset',              // {}
});
