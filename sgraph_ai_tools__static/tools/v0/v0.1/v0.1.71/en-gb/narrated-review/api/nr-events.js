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

    VIDEO_STARTED:       'nr:video:started',       // { name, durationMs, width, height }
    VIDEO_PROGRESS:      'nr:video:progress',      // { step:'audio'|'segments'|'frames'|'captures', done?, total?, message? }
    VIDEO_WARNING:       'nr:video:warning',       // { code, message, capped, segments, calibration }
    VIDEO_COMPLETE:      'nr:video:complete',      // { pairs, segments, durationMs, via, capped, calibration }

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

    PAIRS_REORDERED:     'nr:pairs:reordered',     // { id?, from?, to?, order? }
    CHAT_STARTED:        'nr:chat:started',        // { scope:'pair'|'session', id?, model }
    CHAT_COMPLETE:       'nr:chat:complete',       // { scope, id?, chars?, steps?, changes?, costUsd }

    STORE_SAVING:        'nr:store:saving',        // { sessionId }
    STORE_SAVED:         'nr:store:saved',         // { sessionId, name, savedAt, pairs }
    STORE_LOADED:        'nr:store:loaded',        // { sessionId, pairs, hasAudio }
    STORE_DELETED:       'nr:store:deleted',       // { sessionId }

    BILLING_RECORDED:    'nr:billing:recorded',    // { id, scope, pairId } — a generation id captured
    BILLING_FETCHING:    'nr:billing:fetching',    // { pending }
    BILLING_RESOLVED:    'nr:billing:resolved',    // { id, usd } — one receipt in
    BILLING_COMPLETE:    'nr:billing:complete',    // { resolved, unresolved, failed, totals }

    DOCUMENT_BUILT:      'nr:document:built',      // { pairs, bytes }
    PDF_CREATED:         'nr:pdf:created',         // { name, pages, bytes }
    VAULT_STARTED:       'nr:vault:started',       // { vaultId, files, includeAudio }
    VAULT_PROGRESS:      'nr:vault:progress',      // { written, total, path }
    VAULT_COMPLETE:      'nr:vault:complete',      // { vaultId, base, written, includeAudio }
    BUNDLE_CREATED:      'nr:bundle:created',      // { zipSize, name }
    SEND_STARTED:        'nr:send:started',        // {}
    SEND_COMPLETE:       'nr:send:complete',       // { shareUrl }
    SEND_ERROR:          'nr:send:error',          // { code }

    AUTOSAVE_STATUS:     'nr:autosave:status',     // { enabled, saving, unsaved, lastSavedAt, pendingMs }
    AUTOSAVE_SAVED:      'nr:autosave:saved',      // { sessionId, at, includeAudio, reason }
    AUTOSAVE_ERROR:      'nr:autosave:error',      // { code, message } — never silent
    AUTOSAVE_DISMISSED:  'nr:autosave:dismissed',  // {}
    UNSAVED_FOUND:       'nr:unsaved:found',       // { sessionId, pairs, words, ageMs, recoverable }

    ACTION_RECORDED:     'nr:action:recorded',     // { n, action, kind }
    HISTORY_CHANGED:     'nr:history:changed',     // { canUndo, canRedo, depth, actions }

    STREAM_CLEANING:     'nr:stream:cleaning',     // { id, seq } — cleanup running DURING capture
    STREAM_PROGRESS:     'nr:stream:progress',     // { cleaned, remaining }
    CLEANUP_TIMING:      'nr:cleanup:timing',      // { timing, order, note }

    INPUT_STARTED:       'nr:input:started',       // { tabId } — a recorded tab is attached
    INPUT_BATCH:         'nr:input:batch',         // { added, total }
    INPUT_STOPPED:       'nr:input:stopped',       // { total }

    ERROR:               'nr:error',               // { code, step, message }
    RESET:               'nr:reset',               // {}
});
