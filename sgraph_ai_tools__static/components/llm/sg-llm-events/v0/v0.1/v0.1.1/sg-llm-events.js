/**
 * sg-llm-events — Shared event constants for the sg-llm component family.
 *
 * This is the contract between all LLM components. Frozen at each version.
 * New events are ADDITIONS ONLY — never rename or remove an existing event.
 *
 * All events bubble and are composed (cross Shadow DOM boundaries).
 * Components communicate by dispatching and listening to these events on a
 * shared container element (typically the sg-layout root or document).
 *
 * @module sg-llm-events
 * @version 0.1.1
 *
 * Changelog:
 *   v0.1.1: Added tool calling and agentic loop events:
 *     TOOL_CALLS, TOOL_RESULT, TOOL_RESULTS_COMPLETE,
 *     AGENTIC_START, AGENTIC_STEP, AGENTIC_DONE, AGENTIC_ABORT
 */

/**
 * All event name constants for the sg-llm component family.
 * Import this and use SGL_LLM.SEND etc. — never use raw strings.
 */
export const SGL_LLM = Object.freeze({

    // --- Connection ---
    /** Fired when provider connection is established. detail: { provider, model, baseUrl } */
    CONNECTED:              'llm:connected',
    /** Fired when provider is disconnected. detail: {} */
    DISCONNECTED:           'llm:disconnected',
    /** Fired when the active model changes. detail: { model } */
    MODEL_CHANGED:          'llm:model-changed',
    /** Fired when available models list is loaded. detail: { models: string[] } */
    MODELS_LOADED:          'llm:models-loaded',

    // --- Reality construction ---
    /** Fired on every change to the reality (blocks, content, toggles). detail: { messages[], tokenCount, estimatedCost, imageCount } */
    REALITY_CHANGED:        'llm:reality-changed',
    /** Fired when a block is added to the reality. detail: { block } */
    BLOCK_ADDED:            'llm:block-added',
    /** Fired when a block is removed from the reality. detail: { blockId } */
    BLOCK_REMOVED:          'llm:block-removed',
    /** Fired when blocks are reordered. detail: { blockIds: string[] } */
    BLOCK_REORDERED:        'llm:block-reordered',

    // --- Request lifecycle ---
    /** Fired to initiate a request. detail: { messages[], model?, provider?, mode?, tools?, tool_choice?, response_format? } */
    SEND:                   'llm:send',
    /** Fired to cancel an in-flight request. detail: {} */
    CANCEL:                 'llm:cancel',
    /** Fired when a request starts. detail: { provider, model, streaming, tokenEstimate } */
    REQUEST_START:          'llm:request-start',
    /** Fired for each streaming chunk. detail: { chunk, accumulated } */
    REQUEST_CHUNK:          'llm:request-chunk',
    /** Fired when a request completes. detail: { content, promptTokens, completionTokens, cost, latencyMs, model, finishReason, toolCalls } */
    REQUEST_COMPLETE:       'llm:request-complete',
    /** Fired when a request fails. detail: { error, status, provider } */
    REQUEST_ERROR:          'llm:request-error',
    /** Fired when a request is cancelled. detail: {} */
    REQUEST_CANCEL:         'llm:request-cancel',

    // --- Output ---
    /** Fired when the output is finalised and ready. detail: { content, format } */
    OUTPUT_READY:           'llm:output-ready',
    /** Fired when the user copies the output. detail: {} */
    OUTPUT_COPIED:          'llm:output-copied',

    // --- Stats ---
    /** Fired when the streaming preference changes. detail: { streaming: boolean } */
    STREAMING_CHANGED:      'llm:streaming-changed',

    // --- Infographic ---
    /** Fired when an SVG infographic is extracted from a response. detail: { svg, width, height } */
    INFOGRAPHIC_READY:      'llm:infographic-ready',
    /** Fired when an infographic is exported. detail: { format } */
    INFOGRAPHIC_EXPORTED:   'llm:infographic-exported',

    // --- Memory ---
    /** Fired after Mode 2 (Update Memory) replaces the memory block. detail: { content, tokenCount } */
    MEMORY_UPDATED:         'llm:memory-updated',

    // --- Attachments ---
    /** Fired when a file/image/text is added to the attachment cache. detail: { attachment: { id, type, name, size, dataUrl?, textContent? } } */
    ATTACHMENT_ADDED:       'llm:attachment-added',
    /** Fired when an attachment is removed. detail: { id } */
    ATTACHMENT_REMOVED:     'llm:attachment-removed',
    /** Fired when all attachments are cleared. detail: {} */
    ATTACHMENTS_CLEARED:    'llm:attachments-cleared',

    // --- Bundles ---
    /** Fired to request a bundle save. detail: {} */
    BUNDLE_SAVE_REQUESTED:  'llm:bundle-save-requested',
    /** Fired when a bundle is successfully saved. detail: { bundle } */
    BUNDLE_SAVED:           'llm:bundle-saved',
    /** Fired to request loading a specific bundle. detail: { bundleId } */
    BUNDLE_LOAD_REQUESTED:  'llm:bundle-load-requested',
    /** Fired when a bundle is loaded (restores all component state). detail: { bundle } */
    BUNDLE_LOADED:          'llm:bundle-loaded',
    /** Fired when a bundle is deleted. detail: { bundleId } */
    BUNDLE_DELETED:         'llm:bundle-deleted',
    /** Fired when the bundle list changes (save/delete). detail: {} */
    BUNDLE_LIST_CHANGED:    'llm:bundle-list-changed',

    // --- Tool calling (v0.1.1) ---
    /**
     * Fired by sg-llm-request when the LLM response contains tool calls.
     * Fired in addition to REQUEST_COMPLETE (which also carries toolCalls[]).
     * detail: {
     *   toolCalls: [{ id: string, type: 'function', function: { name: string, arguments: string } }],
     *   messages: Array  — the messages that were sent (for extending the history)
     * }
     */
    TOOL_CALLS:             'llm:tool-calls',

    /**
     * Fired by sg-tool-runner after each individual tool has been executed.
     * detail: { toolCallId: string, name: string, result?: any, error?: string }
     */
    TOOL_RESULT:            'llm:tool-result',

    /**
     * Fired by sg-tool-runner after all tool calls in a batch are resolved.
     * The `messages` array is the extended conversation ready for the next llm:send.
     * detail: {
     *   results: [{ toolCallId: string, name: string, result?: any, error?: string }],
     *   messages: Array  — original messages + assistant tool_calls msg + tool result msgs
     * }
     */
    TOOL_RESULTS_COMPLETE:  'llm:tool-results-complete',

    // --- Agentic loop (v0.1.1) ---
    /**
     * Fired to start an agentic loop. sg-agentic-loop listens for this.
     * detail: { task: string, tools: Array, maxIterations?: number, costBudget?: number }
     */
    AGENTIC_START:          'llm:agentic-start',

    /**
     * Fired after each step in the agentic loop.
     * detail: { step: number, type: 'llm'|'tool', data: any }
     */
    AGENTIC_STEP:           'llm:agentic-step',

    /**
     * Fired when the agentic loop completes successfully.
     * detail: { steps: Array, content: string, iterations: number }
     */
    AGENTIC_DONE:           'llm:agentic-done',

    /**
     * Fired when the agentic loop is aborted (max iterations, cost budget, or cancel).
     * detail: { reason: 'max_iterations'|'cost_budget'|'cancelled'|'rejected'|'error', steps: Array, iterations: number }
     */
    AGENTIC_ABORT:          'llm:agentic-abort',

    // --- Human-in-the-loop approval (v0.1.1 addition) ---
    /**
     * Fired by sg-agentic-loop when human-approval is enabled and tool results arrived.
     * Loop is paused; dispatch AGENTIC_APPROVED or AGENTIC_REJECTED to resume/stop.
     * detail: { step: number, results: Array, messages: Array, iterations: number }
     */
    AGENTIC_APPROVAL_REQUIRED:  'llm:agentic-approval-required',

    /**
     * Dispatch to approve continuing the loop after AGENTIC_APPROVAL_REQUIRED.
     * detail: {}
     */
    AGENTIC_APPROVED:           'llm:agentic-approved',

    /**
     * Dispatch to reject (abort) the loop after AGENTIC_APPROVAL_REQUIRED.
     * detail: {}
     */
    AGENTIC_REJECTED:           'llm:agentic-rejected',

    // --- Tool definition changes ---
    /**
     * Fired by sg-tool-definition when the active tool set changes.
     * sg-agentic-loop listens to keep its cached tools in sync.
     * detail: { tools: Array<ToolDefinition> }
     */
    TOOL_DEFS_CHANGED:          'llm:tool-defs-changed',
});

// Expose on window for surgical overrides that can't import ES modules
window.SGL_LLM = SGL_LLM;
