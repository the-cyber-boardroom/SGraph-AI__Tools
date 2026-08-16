/**
 * nr-events.js
 * Frozen window-event names for narrated-review. The public contract —
 * embedders, SKILL files, and the manifest event catalogue depend on these.
 * All events fire on window; detail always carries `instanceId` (injected by
 * SgToolApi._emit).
 *
 * @module nr-events
 */

export const NR_EVENTS = Object.freeze({
    READY:               'tool:ready',

    KEY_SET:             'nr:key:set',             // { present } — key changed (UI or API)

    SESSION_STARTED:     'nr:session:started',    // { screen:{width,height}, sampleRate, mimeType }
    SESSION_ENDED:       'nr:session:ended',      // { pairs, durationMs, takeSizeBytes }
    MARK:                'nr:mark',               // { id, seq, tPress }
    SUGGESTION:          'nr:suggestion',         // { t }  (VAD-detected silence, unmarked)

    PAIR_ADDED:          'nr:pair:added',          // { id, seq, tPress }
    PAIR_UPDATED:        'nr:pair:updated',        // { id, field }
    PAIR_REMOVED:        'nr:pair:removed',        // { id }

    TRANSCRIBE_STARTED:  'nr:transcribe:started',  // { id, model }
    TRANSCRIBE_COMPLETE: 'nr:transcribe:complete', // { id, chars, costUsd }
    TRANSCRIBE_ERROR:    'nr:transcribe:error',    // { id, code }

    CLEAN_STARTED:       'nr:clean:started',       // { id, model, mode }
    CLEAN_COMPLETE:      'nr:clean:complete',      // { id, marks, costUsd }
    CLEAN_ERROR:         'nr:clean:error',         // { id, code }
    SUMMARY_UPDATED:     'nr:summary:updated',     // { length, atSeq }

    DOCUMENT_BUILT:      'nr:document:built',      // { pairs, bytes }
    BUNDLE_CREATED:      'nr:bundle:created',      // { zipSize, name }
    SEND_STARTED:        'nr:send:started',        // {}
    SEND_COMPLETE:       'nr:send:complete',       // { shareUrl }
    SEND_ERROR:          'nr:send:error',          // { code }

    ERROR:               'nr:error',               // { code, step, message }
    RESET:               'nr:reset',               // {}
});
