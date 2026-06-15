/**
 * audio-transcribe-events — frozen event-name constants emitted by the tool.
 *
 * All events are dispatched on `window` via SgToolApi._emit (which injects
 * `instanceId` into `detail`). UI consumers subscribe via
 * `window.addEventListener('at:item:added', ...)`.
 *
 * @module audio-transcribe-events
 */

export const AT_EVENTS = Object.freeze({
    /** A mic recording started. detail: { mimeType } */
    RECORDING_STARTED:  'at:recording:started',
    /** A mic recording stopped and was added as one item. detail: { id } */
    RECORDING_STOPPED:  'at:recording:stopped',
    /** An item was added to the queue. detail: { id } */
    ITEM_ADDED:         'at:item:added',
    /** An item was removed. detail: { id } */
    ITEM_REMOVED:       'at:item:removed',
    /** The active (or one item's) model changed. detail: { model, id? } */
    MODEL_CHANGED:      'at:model:changed',
    /** A single transcription started. detail: { id } */
    TRANSCRIBE_STARTED: 'at:transcribe:started',
    /** Transcription progress for a single item. detail: { id, stage } */
    TRANSCRIBE_PROGRESS:'at:transcribe:progress',
    /** A single transcription completed. detail: { id, model } */
    TRANSCRIBE_COMPLETE:'at:transcribe:complete',
    /** A single transcription failed. detail: { id, error } */
    TRANSCRIBE_ERROR:   'at:transcribe:error',
    /** One LLM request/response (provenance). detail: the exchange record. */
    LLM_EXCHANGE:       'at:llm:exchange',
    /** Live transcription started. detail: { mimeType } */
    LIVE_STARTED:       'at:live:started',
    /** Live transcript refined. detail: { text, elapsedMs, final } */
    LIVE_UPDATE:        'at:live:update',
    /** One live segment was sent to the server + answered (then again when its
     *  exact cost resolves). detail: { seq, sizeBytes, elapsedMs, latencyMs,
     *  text, final, ok, error?, generationId?, costUsd?, costPending? } */
    LIVE_SEGMENT:       'at:live:segment',
    /** Live transcription stopped (item added). detail: { id, text } */
    LIVE_STOPPED:       'at:live:stopped',
    /** Live transcription error. detail: { error } */
    LIVE_ERROR:         'at:live:error',
    /** Batch transcription started. detail: { total } */
    BATCH_STARTED:      'at:batch:started',
    /** Batch progress (one item finished). detail: { done, total } */
    BATCH_PROGRESS:     'at:batch:progress',
    /** Batch transcription finished. detail: { done, total, errors } */
    BATCH_COMPLETE:     'at:batch:complete',
    /** A session bundle (.zip) was created. detail: { count, zipSize, name } */
    BUNDLE_CREATED:     'at:bundle:created',
    /** A send via SG/Send started. detail: {} */
    SEND_STARTED:       'at:send:started',
    /** A send via SG/Send completed. detail: { shareUrl, token } */
    SEND_COMPLETE:      'at:send:complete',
    /** A send via SG/Send failed. detail: { error } */
    SEND_ERROR:         'at:send:error',
    /** Queue + session reset. detail: {} */
    RESET:              'at:reset',
});
