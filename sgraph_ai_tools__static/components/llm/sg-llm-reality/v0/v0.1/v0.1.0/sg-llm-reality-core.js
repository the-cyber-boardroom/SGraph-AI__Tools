/**
 * sg-llm-reality-core — Pure data logic for the sg-llm-reality component.
 *
 * No DOM. No events. No custom elements.
 * Only block schemas, factory, token estimation, and messages array assembly.
 *
 * Import this from sg-llm-block.js and sg-llm-reality.js.
 *
 * @module sg-llm-reality-core
 * @version 0.1.0
 */

/**
 * Metadata for each block type.
 * Frozen — do not mutate.
 *
 * @type {Readonly<{
 *   system:  { label: string, icon: string, role: string,  collapsible: boolean },
 *   context: { label: string, icon: string, role: string,  collapsible: boolean },
 *   history: { label: string, icon: string, role: null,    collapsible: boolean },
 *   memory:  { label: string, icon: string, role: string,  collapsible: boolean },
 *   question:{ label: string, icon: string, role: string,  collapsible: boolean },
 * }>}
 */
export const BLOCK_TYPES = Object.freeze({
    system:   { label: 'System',   icon: '⚙️',  role: 'system', collapsible: false },
    context:  { label: 'Context',  icon: '📎',  role: 'user',   collapsible: true  },
    history:  { label: 'History',  icon: '💬',  role: null,     collapsible: true  },
    memory:   { label: 'Memory',   icon: '🧠',  role: 'user',   collapsible: false },
    question: { label: 'Question', icon: '❓',  role: 'user',   collapsible: false },
});

/**
 * Returns the default data fields for a given block type.
 *
 * @param {string} type - One of the BLOCK_TYPES keys.
 * @returns {object}
 */
function _typeDefaults(type) {
    switch (type) {
        case 'system':   return { content: '' };
        case 'context':  return { label: '', content: '' };
        case 'history':  return { pairs: [{ user: '', assistant: '' }] };
        case 'memory':   return { content: '' };
        case 'question': return { content: '', _imageCount: 0 };
        default:         return { content: '' };
    }
}

/**
 * Creates a new block data object.
 *
 * @param {string} type - One of the BLOCK_TYPES keys.
 * @param {object} [overrides={}] - Optional fields to override the defaults.
 * @returns {{ id: string, type: string, enabled: boolean, [key: string]: any }}
 */
export function createBlock(type, overrides = {}) {
    const id = `block-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    return {
        id,
        type,
        enabled: true,
        ..._typeDefaults(type),
        ...overrides,
    };
}

/**
 * Estimates the token count for a piece of text using the length/4 heuristic.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Calculates the total estimated token count for all enabled blocks.
 *
 * @param {Array<object>} blocks
 * @returns {number}
 */
export function totalTokens(blocks) {
    let total = 0;
    for (const block of blocks) {
        if (!block.enabled) continue;
        total += blockTokens(block);
    }
    return total;
}

/**
 * Estimates the token count for a single block (all text fields combined).
 *
 * @param {object} block
 * @returns {number}
 */
export function blockTokens(block) {
    switch (block.type) {
        case 'system':
        case 'memory':
        case 'question':
            return estimateTokens(block.content);
        case 'context':
            return estimateTokens(block.label) + estimateTokens(block.content);
        case 'history': {
            let t = 0;
            for (const pair of (block.pairs || [])) {
                t += estimateTokens(pair.user) + estimateTokens(pair.assistant);
            }
            return t;
        }
        default:
            return estimateTokens(block.content || '');
    }
}

/**
 * Assembles the messages array for a Mode 1 (Build) request.
 *
 * Only enabled blocks are included. The Question block becomes a multimodal
 * content array when imageAttachments are present.
 *
 * @param {Array<object>} blocks - Array of block data objects.
 * @param {Array<{ dataUrl: string }>} [imageAttachments=[]] - Image attachments.
 * @returns {Array<{ role: string, content: string|Array }>}
 */
export function assembleMessages(blocks, imageAttachments = []) {
    const messages = [];

    for (const block of blocks) {
        if (!block.enabled) continue;

        switch (block.type) {
            case 'system':
                messages.push({ role: 'system', content: block.content });
                break;

            case 'context': {
                const content = `--- CONTEXT: ${block.label} ---\n${block.content}`;
                messages.push({ role: 'user', content });
                break;
            }

            case 'history':
                for (const pair of (block.pairs || [])) {
                    if (pair.user)      messages.push({ role: 'user',      content: pair.user });
                    if (pair.assistant) messages.push({ role: 'assistant', content: pair.assistant });
                }
                break;

            case 'memory': {
                const content = `--- SESSION MEMORY ---\n${block.content}`;
                messages.push({ role: 'user', content });
                break;
            }

            case 'question':
                if (imageAttachments.length > 0) {
                    const parts = [{ type: 'text', text: block.content }];
                    for (const img of imageAttachments) {
                        parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
                    }
                    messages.push({ role: 'user', content: parts });
                } else {
                    messages.push({ role: 'user', content: block.content });
                }
                break;
        }
    }

    return messages;
}

/**
 * Assembles the messages array for a Mode 2 (Update Memory) request.
 *
 * Sends the current memory content + the latest question/response to the LLM,
 * asking it to produce a condensed updated memory block.
 *
 * @param {object|null} memoryBlock - The current memory block (or null if none).
 * @param {string} lastQuestion - The last question sent (from the question block content).
 * @param {string} lastResponse - The last LLM response text.
 * @returns {Array<{ role: string, content: string }>}
 */
export function assembleMemoryUpdateMessages(memoryBlock, lastQuestion, lastResponse) {
    return [
        {
            role: 'system',
            content: 'You are a memory manager. Consolidate the session memory below. Remove stale decisions. Add key learnings from the latest exchange. Keep the result under 500 tokens. Return ONLY the updated memory text, no preamble.',
        },
        {
            role: 'user',
            content: `CURRENT MEMORY:\n${memoryBlock?.content || '(empty)'}\n\nLATEST QUESTION:\n${lastQuestion}\n\nLATEST RESPONSE:\n${lastResponse}`,
        },
    ];
}
