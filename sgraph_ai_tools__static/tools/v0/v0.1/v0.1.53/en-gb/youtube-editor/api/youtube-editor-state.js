/**
 * youtube-editor-state.js
 * Mutable state container shared between API methods, pipeline, and UI.
 * @module youtube-editor-state
 */

/**
 * @typedef {Object} YouTubeEditorState
 * @property {boolean} connected
 * @property {string|null} accessToken
 * @property {number|null} expiresAt
 * @property {object|null} channel       result of getMyChannel()
 * @property {object[]} videos           accumulated rows from list pages
 * @property {string|null} selectedId    last clicked / opened video id
 * @property {object|null} editingVideo  full video resource currently in editor
 * @property {string} uploadStatus       'idle' | 'uploading' | 'done' | 'error'
 * @property {number} uploadProgress     0..100
 * @property {string|null} lastUploadId
 * @property {string|null} lastError
 */

/** @type {YouTubeEditorState} */
export const state = {
    connected:       false,
    accessToken:     null,
    expiresAt:       null,
    channel:         null,
    videos:          [],
    selectedId:      null,
    editingVideo:    null,
    uploadStatus:    'idle',
    uploadProgress:  0,
    lastUploadId:    null,
    lastError:       null,
};
