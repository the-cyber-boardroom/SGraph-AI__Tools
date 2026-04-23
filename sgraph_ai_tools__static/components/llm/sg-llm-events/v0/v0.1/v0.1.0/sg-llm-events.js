/**
 * sg-llm-events — Shared event constants for the sg-llm component family.
 *
 * This is the contract between all LLM components. Frozen at v0.1.0.
 * New events are ADDITIONS ONLY — never rename or remove an existing event.
 *
 * All events bubble and are composed (cross Shadow DOM boundaries).
 * Components communicate by dispatching and listening to these events on a
 * shared container element (typically the sg-layout root or document).
 *
 * @module sg-llm-events
 * @version 0.1.0
 */

/**
 * All event name constants for the sg-llm component family.
 * Import this and use SGL_LLM.SEND etc. — never use raw strings.
 *
 * @type {Readonly<{
 *   CONNECTED: string,
 *   DISCONNECTED: string,
 *   MODEL_CHANGED: string,
 *   MODELS_LOADED: string,
 *   REALITY_CHANGED: string,
 *   BLOCK_ADDED: string,
 *   BLOCK_REMOVED: string,
 *   BLOCK_REORDERED: string,
 *   SEND: string,
 *   CANCEL: string,
 *   REQUEST_START: string,
 *   REQUEST_CHUNK: string,
 *   REQUEST_COMPLETE: string,
 *   REQUEST_ERROR: string,
 *   REQUEST_CANCEL: string,
 *   OUTPUT_READY: string,
 *   OUTPUT_COPIED: string,
 *   STREAMING_CHANGED: string,
 *   INFOGRAPHIC_READY: string,
 *   INFOGRAPHIC_EXPORTED: string,
 *   MEMORY_UPDATED: string,
 *   ATTACHMENT_ADDED: string,
 *   ATTACHMENT_REMOVED: string,
 *   ATTACHMENTS_CLEARED: string,
 *   BUNDLE_SAVE_REQUESTED: string,
 *   BUNDLE_SAVED: string,
 *   BUNDLE_LOAD_REQUESTED: string,
 *   BUNDLE_LOADED: string,
 *   BUNDLE_DELETED: string,
 *   BUNDLE_LIST_CHANGED: string,
 * }>}
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
    /** Fired to initiate a request. detail: { messages[], model, provider, mode: 'build'|'memory-update' } */
    SEND:                   'llm:send',
    /** Fired to cancel an in-flight request. detail: {} */
    CANCEL:                 'llm:cancel',
    /** Fired when a request starts. detail: { provider, model, streaming, tokenEstimate } */
    REQUEST_START:          'llm:request-start',
    /** Fired for each streaming chunk. detail: { chunk, accumulated } */
    REQUEST_CHUNK:          'llm:request-chunk',
    /** Fired when a request completes. detail: { content, promptTokens, completionTokens, cost, latencyMs, model, finishReason } */
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
});

// Expose on window for surgical overrides that can't import ES modules
window.SGL_LLM = SGL_LLM;
