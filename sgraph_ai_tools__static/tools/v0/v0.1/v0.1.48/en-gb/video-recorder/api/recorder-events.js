/**
 * recorder-events.js
 * Frozen event-name constants for the video recorder tool.
 * @module recorder-events
 */

export const SGA_RECORDER = Object.freeze({
    READY:            'tool:ready',
    MODE_SET:         'tool:mode:set',
    PREVIEW_START:    'tool:preview:start',
    PREVIEW_STOP:     'tool:preview:stop',
    RECORD_START:     'tool:record:start',
    RECORD_PROGRESS:  'tool:record:progress',
    RECORD_STOP:      'tool:record:stop',
    TRACK_LOST:       'tool:track:lost',   // video/audio track ended unexpectedly during recording
    RESET:            'tool:reset',
    ENCRYPT_PROGRESS: 'tool:encrypt:progress',
    SAVE_PROGRESS:    'tool:save:progress',
    SAVE_COMPLETE:    'tool:save:complete',
    ERROR:            'tool:error',
});
