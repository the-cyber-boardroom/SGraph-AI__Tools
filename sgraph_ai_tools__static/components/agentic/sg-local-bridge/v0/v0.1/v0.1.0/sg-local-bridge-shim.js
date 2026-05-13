/**
 * sg-local-bridge-shim — JSON-in-content tool-call fallback for Ollama models
 * that do not emit native `tool_calls` (e.g. mistral:7b, codellama:7b).
 *
 * Some models embed tool calls as JSON inside the `content` string, optionally
 * wrapped in a fenced code block. This shim detects that pattern and normalises
 * the message to the native tool_calls format so the rest of the agentic loop
 * is unaffected.
 *
 * Named exports only. No default export. No DOM/Web Component dependency.
 *
 * @module sg-local-bridge-shim
 * @version 0.1.0
 */

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Strip fenced code block wrappers from a string.
 * Handles ```json ... ``` and ``` ... ```.
 * Returns the inner content if a fence is found; otherwise returns the original.
 *
 * @param {string} text
 * @returns {string}
 */
function _stripFence(text) {
    const trimmed = text.trim();
    // Match ```json or ``` opener, then capture body, then ``` closer
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    if (fenced) return fenced[1].trim();

    // Handle prose prefix + fenced block: extract the LAST fenced block
    const lastFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```(?:\s*)$/);
    if (lastFence) return lastFence[1].trim();

    return trimmed;
}

/**
 * Try JSON.parse on text; return parsed value or null on failure.
 *
 * @param {string} text
 * @returns {*|null}
 */
function _tryParse(text) {
    try { return JSON.parse(text); } catch { return null; }
}

/**
 * Return true if value is a plain object (not array, not null).
 *
 * @param {*} v
 * @returns {boolean}
 */
function _isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Given a parsed JSON value, return an array of raw tool-call items
 * (objects with a `tool` key), or null if the value has no `tool` key.
 *
 * @param {*} parsed
 * @returns {Array<{tool:string,parameters?:Object,id?:string}>|null}
 */
function _extractItems(parsed) {
    if (Array.isArray(parsed)) {
        const valid = parsed.filter(item => _isPlainObject(item) && typeof item.tool === 'string');
        return valid.length > 0 ? valid : null;
    }
    if (_isPlainObject(parsed) && typeof parsed.tool === 'string') {
        return [parsed];
    }
    return null;
}

/**
 * Map a raw item to an OpenAI-format tool_call entry.
 *
 * @param {{ tool: string, parameters?: Object, id?: string }} item
 * @param {number} index
 * @returns {{ id: string, type: 'function', function: { name: string, arguments: string } }}
 */
function _mapItem(item, index) {
    return {
        id:   item.id ?? `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
            name:      item.tool,
            arguments: JSON.stringify(item.parameters ?? {}),
        },
    };
}

// ── Public exports ────────────────────────────────────────────────────────────

/**
 * Normalise an LLM response message object.
 *
 * If the message already has a non-empty `tool_calls` array, it is returned
 * unchanged (same reference). Otherwise the shim attempts to extract JSON from
 * `content` and normalise it to native `tool_calls` format.
 *
 * Returns a NEW message object if normalisation succeeds; the original object
 * if the message is unchanged. Never mutates the input.
 *
 * @param {{ tool_calls?: Array, content?: string, [key: string]: * }} message
 * @returns {{ tool_calls?: Array, content: null|string, [key: string]: * }}
 */
export function normaliseToolCalls(message) {
    // 1. Already has native tool_calls — return unchanged.
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        return message;
    }

    // 2. No content to parse — return unchanged.
    const content = message.content;
    if (!content || typeof content !== 'string' || !content.trim()) {
        return message;
    }

    // 3. Strip fenced code block wrappers if present.
    const stripped = _stripFence(content);

    // 4. Attempt JSON.parse.
    const parsed = _tryParse(stripped);
    if (parsed === null) return message; // plain text or non-JSON

    // 5–7. Extract items — requires a `tool` key.
    const items = _extractItems(parsed);
    if (!items) return message;

    // 8. Map to native tool_calls format.
    const toolCalls = items.map(_mapItem);

    // 9. Return a new message with content: null and the normalised tool_calls.
    return { ...message, content: null, tool_calls: toolCalls };
}

/**
 * Return true if `normaliseToolCalls` would modify the given message —
 * i.e. the message has JSON-in-content tool calls but no native tool_calls.
 * Useful for logging and debugging.
 *
 * @param {{ tool_calls?: Array, content?: string, [key: string]: * }} message
 * @returns {boolean}
 */
export function isJsonInContent(message) {
    const result = normaliseToolCalls(message);
    return result !== message;
}
