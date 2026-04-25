/**
 * youtube-editor-events.js
 * Frozen event-name constants for the YouTube Editor tool.
 * @module youtube-editor-events
 */

export const SGA_YT = Object.freeze({
    READY:            'tool:ready',
    CONNECTED:        'tool:youtube:connected',
    DISCONNECTED:     'tool:youtube:disconnected',
    CHANNEL_LOADED:   'tool:youtube:channel-loaded',
    VIDEOS_LOADED:    'tool:youtube:videos-loaded',
    VIDEO_SELECTED:   'tool:youtube:video-selected',
    VIDEO_LOADED:     'tool:youtube:video-loaded',
    VIDEO_SAVED:      'tool:youtube:video-saved',
    VIDEO_DELETED:    'tool:youtube:video-deleted',
    THUMBNAIL_SET:    'tool:youtube:thumbnail-set',
    UPLOAD_START:     'tool:youtube:upload:start',
    UPLOAD_PROGRESS:  'tool:youtube:upload:progress',
    UPLOAD_COMPLETE:  'tool:youtube:upload:complete',
    PLAYLISTS_LOADED: 'tool:youtube:playlists-loaded',
    PLAYLIST_EXPANDED:'tool:youtube:playlist-expanded',
    PLAYLISTS_CHANGED:'tool:youtube:playlists-changed',
    HANDOFF_RECEIVED: 'tool:youtube:handoff-received',
    ERROR:            'tool:error',
});
