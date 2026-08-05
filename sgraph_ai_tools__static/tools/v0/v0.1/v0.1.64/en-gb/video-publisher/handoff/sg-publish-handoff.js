/**
 * sg-publish-handoff.js
 * Producer/receiver helper for handing a recording to the Video Publisher.
 * Same protocol as sg-youtube-handoff.js (transient object stashed on the
 * producer window, read via window.opener, consume-once, same-origin only)
 * with one addition: an optional separate audioBlob so the publisher's
 * audio step is free (route 1 — no extraction run).
 *
 * @module sg-publish-handoff
 */

const PUBLISHER_URL = '/en-gb/video-publisher/';
const STASH_KEY     = '__sgPublishHandoff';

/**
 * @typedef {Object} PublishHandoffPayload
 * @property {Blob} blob                Video bytes (any MediaRecorder output)
 * @property {Blob} [audioBlob]         Separate audio-only stream, when recorded
 * @property {string} [suggestedTitle]  Pre-fills the metadata title
 * @property {string} [filename]
 * @property {string} [sourceUrl]
 * @property {string} [sourceTool]      e.g. 'video-recorder'
 */

/**
 * Send a recording to the Video Publisher in a new tab.
 * Must be called from a user-gesture handler (popup blockers).
 * @param {PublishHandoffPayload} payload
 * @returns {Window|null} the opened window handle (null if popup blocker fired)
 */
export function sendToPublisher(payload) {
    if (!payload?.blob) throw new Error('sendToPublisher: blob required');
    window[STASH_KEY] = {
        blob:           payload.blob,
        audioBlob:      payload.audioBlob      || null,
        suggestedTitle: payload.suggestedTitle || payload.filename || '',
        filename:       payload.filename       || 'recording.webm',
        sourceUrl:      payload.sourceUrl      || location.href,
        sourceTool:     payload.sourceTool     || 'unknown',
        timestamp:      Date.now(),
    };
    return window.open(PUBLISHER_URL, '_blank');
}

/**
 * Receiver — call from inside the publisher tab on boot. Returns the stashed
 * payload (and consumes it from the opener) or null if none.
 * @returns {PublishHandoffPayload|null}
 */
export function pickupHandoff() {
    try {
        const data = window.opener?.[STASH_KEY];
        if (!data?.blob) return null;
        try { delete window.opener[STASH_KEY]; } catch { /* cross-origin or null */ }
        return data;
    } catch {
        return null;
    }
}
