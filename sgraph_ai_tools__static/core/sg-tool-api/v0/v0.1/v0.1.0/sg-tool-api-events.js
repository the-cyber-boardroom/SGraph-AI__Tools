/**
 * SgToolApi — Standard Event Constants
 *
 * Frozen event name constants for the JavaScript API Primitive.
 * All events are dispatched on `window` with `instanceId` in the detail.
 *
 * Usage:
 *   import { SGA_TOOL } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api-events.js';
 *   window.addEventListener(SGA_TOOL.TOOL_READY, e => console.log(e.detail));
 *
 * Also exposed as `window.SGA_TOOL` for console and Playwright use.
 *
 * @module sg-tool-api-events
 * @version 0.1.0
 */

const SGA_TOOL = Object.freeze({
    /** Fired when a tool has registered and is ready for API calls.
     *  detail: { instanceId, tool, version } */
    TOOL_READY:            'tool:ready',

    /** Fired when a tool successfully connects to an external service (e.g. OpenRouter).
     *  detail: { instanceId, model, models[] } */
    TOOL_CONNECTED:        'tool:connected',

    /** Fired when a tool loses its connection.
     *  detail: { instanceId, reason } */
    TOOL_DISCONNECTED:     'tool:disconnected',

    /** Fired when a generation begins.
     *  detail: { instanceId, generationId, model, prompt } */
    GENERATION_STARTED:    'tool:generation:started',

    /** Fired when a generation completes successfully.
     *  detail: { instanceId, generationId, model, image?, duration } */
    GENERATION_COMPLETE:   'tool:generation:complete',

    /** Fired when a generation fails.
     *  detail: { instanceId, generationId, model, error } */
    GENERATION_ERROR:      'tool:generation:error',

    /** Fired when a generation is cancelled by the user.
     *  detail: { instanceId, generationId } */
    GENERATION_CANCELLED:  'tool:generation:cancelled',
});

if (typeof window !== 'undefined') {
    window.SGA_TOOL = SGA_TOOL;
}

export { SGA_TOOL };
