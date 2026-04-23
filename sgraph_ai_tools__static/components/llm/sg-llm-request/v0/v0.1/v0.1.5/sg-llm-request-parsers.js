/**
 * sg-llm-request-parsers — Response parsing for all supported LLM providers.
 *
 * Extracts text deltas, token usage, images, and tool calls from streaming SSE
 * lines and non-streaming JSON response bodies. Provider-neutral where possible;
 * provider-specific branches are clearly labelled.
 *
 * @module sg-llm-request-parsers
 * @version 0.1.5
 */

/**
 * Parse a single SSE data line and return the text delta, or '' if none.
 *
 * @param {string} line   Raw SSE line from the stream buffer.
 * @param {string} provider
 * @returns {string}
 */
export function parseSseDelta(line, provider) {
    if (provider === 'ollama') {
        if (!line.trim()) return '';
        try {
            const obj = JSON.parse(line);
            return obj?.message?.content || '';
        } catch { return ''; }
    }
    if (!line.startsWith('data: ')) return '';
    const json = line.slice(6).trim();
    if (json === '[DONE]') return '';
    try {
        const obj = JSON.parse(json);
        if (provider === 'anthropic') return obj?.delta?.text || '';
        return obj?.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
}

/**
 * Extract token usage from a completed (non-streaming) response body.
 *
 * @param {Object} body     Parsed JSON response.
 * @param {string} provider
 * @returns {{ promptTokens: number, completionTokens: number }}
 */
export function extractUsage(body, provider) {
    if (provider === 'anthropic') {
        return {
            promptTokens:     body?.usage?.input_tokens  || 0,
            completionTokens: body?.usage?.output_tokens || 0,
        };
    }
    return {
        promptTokens:     body?.usage?.prompt_tokens     || 0,
        completionTokens: body?.usage?.completion_tokens || 0,
    };
}

/**
 * Extract image objects from a non-streaming response body.
 *
 * @param {Object} body
 * @param {string} provider
 * @returns {Array}
 */
export function extractImagesFromResponse(body, provider) {
    const images = [];
    if (provider === 'anthropic') {
        for (const b of body?.content || []) {
            if (b?.type === 'image') images.push(b);
        }
    } else {
        const content = body?.choices?.[0]?.message?.content;
        if (Array.isArray(content)) {
            for (const b of content) {
                if (b?.type === 'image_url') images.push(b);
            }
        }
    }
    return images;
}

/**
 * Extract tool calls from a non-streaming response body.
 * Returns an array in normalised OpenAI format:
 * [{ id, type:'function', function:{ name, arguments } }]
 *
 * @param {Object} body
 * @param {string} provider
 * @returns {Array}
 */
export function extractToolCalls(body, provider) {
    if (provider === 'anthropic') {
        return (body?.content || [])
            .filter(b => b?.type === 'tool_use')
            .map(b => ({
                id:       b.id,
                type:     'function',
                function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
            }));
    }
    return body?.choices?.[0]?.message?.tool_calls || [];
}

/**
 * Merge a streaming tool_call delta chunk into an accumulator array.
 * Each delta carries an `index` indicating which tool call it belongs to.
 * Mutates `accum` in place.
 *
 * @param {Array} accum   Accumulator indexed by tool call index.
 * @param {Array} deltas  Delta objects from choices[0].delta.tool_calls.
 */
export function mergeToolCallDeltas(accum, deltas) {
    for (const d of deltas) {
        const i = d.index ?? 0;
        if (!accum[i]) {
            accum[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        const t = accum[i];
        if (d.id)                  t.id                  += d.id;
        if (d.function?.name)      t.function.name       += d.function.name;
        if (d.function?.arguments) t.function.arguments  += d.function.arguments;
    }
}
