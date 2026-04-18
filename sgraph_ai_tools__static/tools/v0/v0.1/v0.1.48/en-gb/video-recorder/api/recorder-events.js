/**
 * recorder-events.js
 * Frozen event-name constants for the video recorder tool.
 * @module recorder-events
 */

export const SGA_RECORDER = Object.freeze({
    READY:            'tool:ready',
    MODE_SET:         'tool:mode:set',
    RECORD_START:     'tool:record:start',
    RECORD_STOP:      'tool:record:stop',
    ENCRYPT_PROGRESS: 'tool:encrypt:progress',
    SAVE_PROGRESS:    'tool:save:progress',
    SAVE_COMPLETE:    'tool:save:complete',
    ERROR:            'tool:error',
});
