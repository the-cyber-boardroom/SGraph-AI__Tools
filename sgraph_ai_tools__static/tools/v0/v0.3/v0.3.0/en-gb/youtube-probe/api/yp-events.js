/**
 * yp-events.js
 * Frozen window-event names. All fire on window; detail carries `instanceId`
 * (injected by SgToolApi._emit).
 * @module yp-events
 */
export const YP_EVENTS = Object.freeze({
    READY:          'tool:ready',
    TEST_STARTED:   'yp:test:started',    // { id, title }
    TEST_PROGRESS:  'yp:test:progress',   // { message?, done?, total? }
    TEST_COMPLETE:  'yp:test:complete',   // the full result record
    SUITE_COMPLETE: 'yp:suite:complete',  // { total, pass, fail, info, blocked, results }
    AUTH_CHANGED:   'yp:auth:changed',    // { present, scopes? }
    RESET:          'yp:reset',           // {}
});
