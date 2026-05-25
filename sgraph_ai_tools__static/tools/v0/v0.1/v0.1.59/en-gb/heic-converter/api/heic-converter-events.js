/**
 * heic-converter-events — frozen event-name constants emitted by the tool.
 *
 * All events are dispatched on `window` via SgToolApi._emit (which injects
 * `instanceId` into `detail`). UI consumers subscribe via
 * `window.addEventListener('hc:item:complete', ...)`.
 *
 * @module heic-converter-events
 */

export const HC_EVENTS = Object.freeze({
    /** Files were added to the queue. detail: { addedIds, skipped } */
    ITEMS_ADDED:       'hc:items:added',
    /** A single conversion started. detail: { id } */
    ITEM_STARTED:      'hc:item:started',
    /** Conversion progress for a single item. detail: { id, stage, pct } */
    ITEM_PROGRESS:     'hc:item:progress',
    /** A single conversion completed. detail: { id, outputSize, outputType } */
    ITEM_COMPLETE:     'hc:item:complete',
    /** A single conversion failed. detail: { id, error } */
    ITEM_ERROR:        'hc:item:error',
    /** Batch conversion started. detail: { count } */
    BATCH_STARTED:     'hc:batch:started',
    /** Batch conversion finished. detail: { ok, failed } */
    BATCH_COMPLETE:    'hc:batch:complete',
    /** Output format changed. detail: { format } */
    FORMAT_CHANGED:    'hc:format:changed',
    /** Quality slider changed. detail: { quality } */
    QUALITY_CHANGED:   'hc:quality:changed',
    /** Live Photo dedup toggle changed. detail: { enabled } */
    LIVE_PHOTO_DEDUP:  'hc:livephoto:dedup',
    /** An item was skipped (not converted). detail: { id, reason } */
    ITEM_SKIPPED:      'hc:item:skipped',
    /** Items queue reset. detail: {} */
    RESET:             'hc:reset',
});
