/**
 * youtube-upload-events.js
 * Frozen event-name constants for the YouTube Upload tool.
 * @module youtube-upload-events
 */

export const SGA_YT = Object.freeze({
    READY:            'tool:ready',
    CONNECTED:        'tool:youtube:connected',
    DISCONNECTED:     'tool:youtube:disconnected',
    FILE_SET:         'tool:youtube:file-set',
    UPLOAD_START:     'tool:youtube:upload:start',
    UPLOAD_PROGRESS:  'tool:youtube:upload:progress',
    UPLOAD_COMPLETE:  'tool:youtube:upload:complete',
    ERROR:            'tool:error',
});
