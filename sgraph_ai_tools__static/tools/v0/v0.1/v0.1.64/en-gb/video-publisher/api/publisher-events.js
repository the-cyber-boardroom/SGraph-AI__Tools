/**
 * publisher-events.js
 * Frozen event-name constants for the video-publisher tool.
 * The recorder engine's own SGA_RECORDER events (tool:record:*) fire
 * unchanged alongside these — the publisher listens, it does not wrap.
 * @module publisher-events
 */

export const VP_EVENTS = Object.freeze({
    READY:             'tool:ready',
    JOB_LOADED:        'vp:job:loaded',        // { source: 'record'|'import'|'handoff', filename, byteSize, hasAudioBlob }
    JOB_RESET:         'vp:job:reset',         // {}
    STEP_CHANGED:      'vp:step:changed',      // { step, status } — mirrors every job.steps transition
    AUDIO_START:       'vp:audio:start',       // {}
    AUDIO_COMPLETE:    'vp:audio:complete',    // { route: 'native'|'remux'|'decode', bytes, mime }
    TRANSCRIBE_START:  'vp:transcribe:start',  // { model }
    TRANSCRIBE_COMPLETE: 'vp:transcribe:complete', // { model, costUsd, chars }
    METADATA_START:    'vp:metadata:start',    // { model }
    METADATA_COMPLETE: 'vp:metadata:complete', // { title, tags, costUsd }
    UPLOAD_START:      'vp:upload:start',      // { fileName, fileSize, metadata }
    UPLOAD_PROGRESS:   'vp:upload:progress',   // { loaded, total, percent }
    UPLOAD_COMPLETE:   'vp:upload:complete',   // { id, url }
    YT_CONNECTED:      'vp:youtube:connected', // { expiresAt, fromCache }
    YT_DISCONNECTED:   'vp:youtube:disconnected', // {}
    HANDOFF_RECEIVED:  'vp:handoff-received',  // { sourceTool, filename, byteSize, hasAudioBlob }
    AUTOPUBLISH_COUNTDOWN: 'vp:autopublish:countdown', // { secondsLeft } — grace window before auto upload
    RUN_CANCELLED:     'vp:run:cancelled',     // { during: 'recording'|'steps'|'countdown'|'upload' }
    STEP_ERROR:        'vp:step:error',        // { step, code, message }
});
