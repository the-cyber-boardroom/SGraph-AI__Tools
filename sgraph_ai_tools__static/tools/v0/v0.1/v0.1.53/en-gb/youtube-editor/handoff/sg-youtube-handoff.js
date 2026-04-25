/**
 * sg-youtube-handoff.js
 * Tiny producer-side helper that any sibling tool (e.g. video-recorder)
 * can import to hand a video blob off to the YouTube Editor.
 *
 * Protocol: the producer stashes a transient handoff object on `window`
 * BEFORE opening the editor URL. The opened editor reads it via
 * `window.opener.__sgYtHandoff` and consumes it (delete the property).
 * Same-origin only — works because both tools live on tools.sgraph.ai.
 *
 * @module sg-youtube-handoff
 */

const EDITOR_URL = '/en-gb/youtube-editor/';

/**
 * @typedef {Object} HandoffPayload
 * @property {Blob} blob                 Video bytes (any MediaRecorder output)
 * @property {string} [suggestedTitle]   Pre-fills the title field
 * @property {string} [suggestedDescription]
 * @property {string} [filename]         Used as fallback title and download name
 * @property {string} [sourceUrl]        Where the blob came from (audit/log)
 * @property {string} [sourceTool]       e.g. 'video-recorder'
 */

/**
 * Send a video blob to the YouTube Editor in a new tab.
 * @param {HandoffPayload} payload
 * @returns {Window|null} the opened window handle (null if popup blocker fired)
 */
export function sendToYouTubeEditor(payload) {
    if (!payload?.blob) throw new Error('sendToYouTubeEditor: blob required');
    window.__sgYtHandoff = {
        blob:                  payload.blob,
        suggestedTitle:        payload.suggestedTitle    || payload.filename || '',
        suggestedDescription:  payload.suggestedDescription || '',
        filename:              payload.filename          || 'recording.webm',
        sourceUrl:             payload.sourceUrl         || location.href,
        sourceTool:            payload.sourceTool        || 'unknown',
        timestamp:             Date.now(),
    };
    return window.open(EDITOR_URL, '_blank');
}

/**
 * Receiver helper — call from inside the editor tab on boot. Returns the
 * stashed payload (and consumes it from the opener) or null if none.
 * @returns {HandoffPayload|null}
 */
export function pickupHandoff() {
    try {
        const data = window.opener?.__sgYtHandoff;
        if (!data?.blob) return null;
        try { delete window.opener.__sgYtHandoff; } catch { /* cross-origin or null */ }
        return data;
    } catch {
        return null;
    }
}
