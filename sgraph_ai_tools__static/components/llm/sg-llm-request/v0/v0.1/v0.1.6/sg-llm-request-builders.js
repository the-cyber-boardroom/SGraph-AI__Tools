/**
 * sg-llm-request-builders — Request construction for all supported LLM providers.
 *
 * Builds headers, endpoint URLs, and request bodies. Translates the canonical
 * internal message format (OpenAI-style content arrays with `image_url` and
 * `binary_file` parts) into each provider's wire format.
 *
 * Providers:
 *   - Anthropic  — /v1/messages, x-api-key, Anthropic content blocks
 *   - OpenRouter  — /v1/chat/completions, Bearer, OpenAI-compat
 *                   + {type:'file'} blocks for PDF attachments (all models)
 *   - OpenAI     — /v1/chat/completions, Bearer, OpenAI-compat
 *   - Ollama     — /api/chat, no auth, Ollama format
 *
 * @module sg-llm-request-builders
 * @version 0.1.6
 *
 * Changelog:
 *   v0.1.6: Fixed OpenRouter PDF format. OpenRouter uses {type:'file', file:{filename, file_data}}
 *     content blocks for all models (not Anthropic-native document blocks). Removed the
 *     isAnthropicModel restriction — the file block works for every OpenRouter model.
 */

/** Default base URLs for each provider. */
export const PROVIDER_DEFAULTS = {
    openrouter: 'https://openrouter.ai/api',
    ollama:     'http://localhost:11434',
    anthropic:  'https://api.anthropic.com',
    openai:     'https://api.openai.com',
};

const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Build request headers for a given provider.
 *
 * @param {string} provider
 * @param {string} apiKey
 * @returns {Object}
 */
export function buildHeaders(provider, apiKey) {
    const base = { 'Content-Type': 'application/json' };
    if (provider === 'anthropic') {
        return {
            ...base,
            'x-api-key':  apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
            // Required by Anthropic for direct browser-to-API calls.
            'anthropic-dangerous-direct-browser-access': 'true',
        };
    }
    if (provider === 'ollama') {
        return base;
    }
    // openrouter, openai
    return { ...base, 'Authorization': `Bearer ${apiKey}` };
}

/**
 * Build the provider endpoint URL.
 *
 * @param {string} provider
 * @param {string} baseUrl
 * @returns {string}
 */
export function buildEndpoint(provider, baseUrl) {
    const base = (baseUrl || PROVIDER_DEFAULTS[provider] || '').replace(/\/$/, '');
    if (provider === 'ollama')     return `${base}/api/chat`;
    if (provider === 'anthropic')  return `${base}/v1/messages`;
    return `${base}/v1/chat/completions`;
}

/**
 * Convert a canonical OpenAI-style messages array to the provider's wire format.
 *
 * @param {string} provider
 * @param {Array<{role:string, content:string|Array}>} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {{ tools?: Array, tool_choice?: string, response_format?: Object }} [opts]
 * @returns {Object} Request body
 */
export function buildRequestBody(provider, messages, model, streaming, opts = {}) {
    if (provider === 'anthropic') return buildAnthropicBody(messages, model, streaming, opts);
    if (provider === 'ollama')    return buildOllamaBody(messages, model, streaming, opts);
    return buildOpenAIBody(messages, model, streaming, opts);
}

/**
 * Build an OpenAI-compatible request body (used for openrouter and openai).
 *
 * binary_file translation:
 *   - audio/*          → input_audio block (OpenAI native format)
 *   - application/pdf  → {type:'file'} block (OpenRouter format, works for all models)
 *   - everything else  → dropped (null → filtered)
 *
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {Object} opts
 * @returns {Object}
 */
export function buildOpenAIBody(messages, model, streaming, opts = {}) {
    const body = {
        model,
        stream: streaming,
        messages: messages.map(msg => ({
            role: msg.role,
            ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
            ...(msg.tool_calls   ? { tool_calls:   msg.tool_calls   } : {}),
            content: Array.isArray(msg.content)
                ? msg.content.map(part => {
                    if (part.type === 'binary_file') {
                        if (part.mime_type?.startsWith('audio/')) {
                            const base64 = part.data_url?.split(',')[1] ?? '';
                            const fmt = audioFmt(part.mime_type, part.name);
                            return { type: 'input_audio', input_audio: { data: base64, format: fmt } };
                        }
                        if (part.mime_type === 'application/pdf') {
                            // OpenRouter supports PDFs via the `file` content type for all models.
                            // file_data accepts a base64 data URL (data:application/pdf;base64,...).
                            return {
                                type: 'file',
                                file: {
                                    filename:  part.name || 'document.pdf',
                                    file_data: part.data_url,
                                },
                            };
                        }
                        return null;
                    }
                    return part;
                }).filter(Boolean)
                : msg.content,
        })),
    };
    if (opts.tools?.length)   { body.tools = opts.tools; body.tool_choice = opts.tool_choice ?? 'auto'; }
    if (opts.response_format) { body.response_format = opts.response_format; }
    return body;
}

/**
 * Build an Anthropic-format request body.
 *
 * binary_file translation:
 *   - application/pdf → document block (base64)
 *   - audio/video     → dropped (unsupported by Anthropic messages API)
 *
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {Object} opts
 * @returns {Object}
 */
export function buildAnthropicBody(messages, model, streaming, opts = {}) {
    let systemPrompt = '';
    const chatMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemPrompt = typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || '';
            continue;
        }

        if (Array.isArray(msg.content)) {
            chatMessages.push({
                role: msg.role,
                content: msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text };
                    }
                    if (part.type === 'image_url') {
                        const url = part.image_url.url;
                        const [header, data] = url.split(',');
                        const mediaType = header.replace('data:', '').replace(';base64', '');
                        return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
                    }
                    if (part.type === 'binary_file') {
                        if (part.mime_type === 'application/pdf') {
                            const base64 = part.data_url?.split(',')[1] ?? '';
                            return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
                        }
                        return null;
                    }
                    return part;
                }).filter(Boolean),
            });
        } else if (msg.role === 'tool') {
            chatMessages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }],
            });
        } else {
            chatMessages.push({ role: msg.role, content: msg.content });
        }
    }

    const body = { model, max_tokens: 4096, stream: streaming, messages: chatMessages };
    if (systemPrompt) body.system = systemPrompt;

    if (opts.tools?.length) {
        body.tools = opts.tools.map(t => ({
            name:         t.function?.name        ?? t.name,
            description:  t.function?.description ?? t.description ?? '',
            input_schema: t.function?.parameters  ?? t.input_schema ?? { type: 'object', properties: {} },
        }));
        const tc = opts.tool_choice;
        if (tc && tc !== 'auto') body.tool_choice = tc === 'required' ? { type: 'any' } : { type: 'tool', name: tc };
    }
    return body;
}

/**
 * Build an Ollama-format request body.
 * Ollama does not support binary_file parts — they are silently dropped.
 *
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {Object} opts
 * @returns {Object}
 */
export function buildOllamaBody(messages, model, streaming, opts = {}) {
    const ollamaMessages = messages.map(msg => {
        if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
            const images    = msg.content
                .filter(p => p.type === 'image_url')
                .map(p => p.image_url.url.split(',')[1]);
            const out = { role: msg.role, content: textParts };
            if (images.length) out.images = images;
            return out;
        }
        return { role: msg.role, content: msg.content ?? '' };
    });

    const body = { model, stream: streaming, messages: ollamaMessages };
    if (opts.tools?.length) { body.tools = opts.tools; }
    return body;
}

/**
 * Map an audio MIME type or filename to an OpenAI audio format string.
 *
 * @param {string} mimeType
 * @param {string} name
 * @returns {string}
 */
export function audioFmt(mimeType, name) {
    const mime = mimeType?.toLowerCase() ?? '';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('wav'))  return 'wav';
    if (mime.includes('ogg'))  return 'ogg';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('flac')) return 'flac';
    if (mime.includes('aac'))  return 'aac';
    if (mime.includes('mp4') || mime.includes('m4a')) return 'mp4';
    const ext = name?.split('.').pop()?.toLowerCase();
    if (['mp3','wav','ogg','webm','flac','aac','mp4','m4a'].includes(ext)) return ext;
    return 'mp3';
}
