/**
 * video-events.js
 * Frozen object of all event name constants for the video-creator tool.
 * Import this wherever you dispatch or listen for tool events.
 *
 * @module video-events
 */

export const SGA_VIDEO = Object.freeze({
    /** Fired when activate() is called — API live on window.__tool */
    TOOL_READY:        'tool:ready',
    /** Fired when loadSlides() completes — detail: { count, slides } */
    SLIDES_LOADED:     'tool:slides:loaded',
    /** Fired after each slide's TTS audio is generated — detail: { slideIndex, total } */
    AUDIO_PROGRESS:    'tool:audio:progress',
    /** Fired when all slides have audio — detail: { durations: number[] } */
    AUDIO_COMPLETE:    'tool:audio:complete',
    /** Fired when MediaRecorder starts — detail: { fps } */
    RECORD_START:      'tool:record:start',
    /** Fired when MediaRecorder stops — detail: { durationMs } */
    RECORD_STOP:       'tool:record:stop',
    /** Fired when FFmpeg conversion begins — detail: {} */
    CONVERT_START:     'tool:convert:start',
    /** Fired on FFmpeg progress — detail: { ratio } */
    CONVERT_PROGRESS:  'tool:convert:progress',
    /** Fired when MP4 is ready — detail: { mp4Blob } */
    CONVERT_COMPLETE:  'tool:convert:complete',
    /** Fired on any pipeline error — detail: { step, message } */
    ERROR:             'tool:error',
});
