/**
 * youtube-upload-state.js
 * Mutable state container shared between API methods and UI.
 * @module youtube-upload-state
 */

/**
 * @typedef {Object} YouTubeUploadState
 * @property {File|Blob|null} file        Current selected file
 * @property {boolean} connected          Whether a valid token is cached
 * @property {number|null} expiresAt      Token expiry (ms epoch) when connected
 * @property {string} status              'idle' | 'uploading' | 'done' | 'error'
 * @property {number} progress            0..100
 * @property {string|null} lastVideoId    YouTube video id of the last successful upload
 * @property {string|null} lastVideoUrl   Full YouTube watch URL
 * @property {string|null} lastError      Last error message, if any
 */

/** @type {YouTubeUploadState} */
export const state = {
    file:          null,
    connected:     false,
    expiresAt:     null,
    status:        'idle',
    progress:      0,
    lastVideoId:   null,
    lastVideoUrl:  null,
    lastError:     null,
};

/** Reset progress / result fields back to idle (does not clear connection). */
export function resetUpload() {
    state.status        = 'idle';
    state.progress      = 0;
    state.lastVideoId   = null;
    state.lastVideoUrl  = null;
    state.lastError     = null;
}
