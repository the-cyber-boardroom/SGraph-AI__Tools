/**
 * sg-llm-request — Headless LLM fetch engine Web Component.
 *
 * The ONLY component that makes fetch calls to external LLM APIs.
 * Receives a messages array via llm:send event, calls the provider,
 * and emits response events. Supports streaming (SSE) and non-streaming.
 *
 * Providers supported:
 *   - OpenRouter  (/v1/chat/completions, Bearer auth, OpenAI-compat messages)
 *   - Ollama      (/api/chat, no auth, Ollama format)
 *   - Anthropic   (/v1/messages, x-api-key auth, Anthropic format)
 *   - OpenAI      (/v1/chat/completions, Bearer auth, OpenAI messages)
 *
 * Tool calling:
 *   Pass tools[] and optional tool_choice in llm:send detail.
 *   When the LLM responds with tool calls, llm:tool-calls is emitted in
 *   addition to llm:request-complete. toolCalls[] is normalised to OpenAI
 *   format across all providers.
 *
 * @module sg-llm-request
 * @version 0.1.4
 *
 * Changelog:
 *   v0.1.4: Tool calling support.
 *     - llm:send detail now accepts: tools, tool_choice, response_format
 *     - Request bodies for all providers include tools when supplied
 *     - Anthropic tool format auto-converted from OpenAI JSON schema format
 *     - Streaming: tool_call deltas accumulated by index into full tool_calls[]
 *     - Non-streaming: tool_calls extracted from choices[0].message.tool_calls
 *       (or Anthropic tool_use blocks)
 *     - llm:tool-calls emitted alongside llm:request-complete when tool calls present
 *     - llm:request-complete detail gains toolCalls[] field (always present, may be [])
 *     - sg-llm-events bumped to v0.1.1 (import updated)
 *
 *   v0.1.3: HTTP error responses now extract the JSON error body to surface the full
 *     provider message.
 *
 *   v0.1.2: Translates binary_file content parts for Anthropic (PDF) and
 *     OpenAI/OpenRouter (audio). Ollama drops binary_file parts silently.
 *
 *   v0.1.1: _readStream accumulates rawChunks[] and images[].
 *     Non-streaming path includes rawResponse and images[].
 *     _bus() walks ancestors for [data-llm-bus].
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

/** Default base URLs for each provider */
const PROVIDER_DEFAULTS = {
    openrouter: 'https://openrouter.ai/api',
    ollama:     'http://localhost:11434',
    anthropic:  'https://api.anthropic.com',
    openai:     'https://api.openai.com',
};

/** Anthropic API version header value */
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Build request headers for a given provider.
 *
 * @param {string} provider
 * @param {string} apiKey
 * @returns {Object}
 */
function buildHeaders(provider, apiKey) {
    const base = { 'Content-Type': 'application/json' };
    if (provider === 'anthropic') {
        return { ...base, 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION };
    }
    if (provider === 'ollama') {
        return base;
    }
    // openrouter, openai
    return { ...base, 'Authorization': `Bearer ${apiKey}` };
}

/**
 * Convert a canonical OpenAI-style messages array to the provider's format.
 *
 * @param {string} provider
 * @param {Array<{role: string, content: string|Array}>} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {{ tools?: Array, tool_choice?: string, response_format?: Object }} [opts]
 * @returns {Object} Request body
 */
function buildRequestBody(provider, messages, model, streaming, opts = {}) {
    if (provider === 'anthropic') {
        return _buildAnthropicBody(messages, model, streaming, opts);
    }
    if (provider === 'ollama') {
        return _buildOllamaBody(messages, model, streaming, opts);
    }
    // openrouter, openai — both use OpenAI format
    return _buildOpenAIBody(messages, model, streaming, opts);
}

/**
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {Object} opts
 * @returns {Object}
 */
function _buildOpenAIBody(messages, model, streaming, opts = {}) {
    const body = {
        model,
        stream: streaming,
        messages: messages.map(msg => ({
            role: msg.role,
            // Preserve tool_call_id for tool result messages
            ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
            // Preserve tool_calls for assistant messages
            ...(msg.tool_calls   ? { tool_calls: msg.tool_calls }   : {}),
            content: Array.isArray(msg.content)
                ? msg.content.map(part => {
                    if (part.type === 'binary_file') {
                        if (part.mime_type?.startsWith('audio/')) {
                            const base64 = part.data_url?.split(',')[1] ?? '';
                            const fmt = _audioFmt(part.mime_type, part.name);
                            return { type: 'input_audio', input_audio: { data: base64, format: fmt } };
                        }
                        return null;
                    }
                    return part;
                }).filter(Boolean)
                : msg.content
        }))
    };
    if (opts.tools?.length)      { body.tools = opts.tools; body.tool_choice = opts.tool_choice ?? 'auto'; }
    if (opts.response_format)    { body.response_format = opts.response_format; }
    return body;
}

/**
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {Object} opts
 * @returns {Object}
 */
function _buildAnthropicBody(messages, model, streaming, opts = {}) {
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
                }).filter(Boolean)
            });
        } else if (msg.role === 'tool') {
            // Convert tool result message (OpenAI format) to Anthropic tool_result block
            chatMessages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }]
            });
        } else {
            chatMessages.push({ role: msg.role, content: msg.content });
        }
    }

    const body = {
        model,
        max_tokens: 4096,
        stream: streaming,
        messages: chatMessages,
    };
    if (systemPrompt) body.system = systemPrompt;

    // Convert OpenAI tool format → Anthropic tool format
    if (opts.tools?.length) {
        body.tools = opts.tools.map(t => ({
            name:         t.function?.name        ?? t.name,
            description:  t.function?.description ?? t.description ?? '',
            input_schema: t.function?.parameters  ?? t.input_schema ?? { type: 'object', properties: {} },
        }));
        // Anthropic tool_choice: 'auto' | 'any' | { type: 'tool', name: '...' }
        const tc = opts.tool_choice;
        if (tc && tc !== 'auto') body.tool_choice = tc === 'required' ? { type: 'any' } : { type: 'tool', name: tc };
    }
    return body;
}

/**
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @param {Object} opts
 * @returns {Object}
 */
function _buildOllamaBody(messages, model, streaming, opts = {}) {
    const ollamaMessages = messages.map(msg => {
        if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
            const images = msg.content
                .filter(p => p.type === 'image_url')
                .map(p => p.image_url.url.split(',')[1]);
            const out = { role: msg.role, content: textParts };
            if (images.length) out.images = images;
            return out;
        }
        return { role: msg.role, content: msg.content ?? '' };
    });

    const body = { model, stream: streaming, messages: ollamaMessages };
    // Ollama uses the same tools format as OpenAI
    if (opts.tools?.length) { body.tools = opts.tools; }
    return body;
}

/**
 * Build the provider endpoint URL.
 *
 * @param {string} provider
 * @param {string} baseUrl
 * @returns {string}
 */
function buildEndpoint(provider, baseUrl) {
    const base = (baseUrl || PROVIDER_DEFAULTS[provider] || '').replace(/\/$/, '');
    if (provider === 'ollama') return `${base}/api/chat`;
    if (provider === 'anthropic') return `${base}/v1/messages`;
    return `${base}/v1/chat/completions`;
}

/**
 * Parse a single SSE data line and extract the text delta.
 *
 * @param {string} line
 * @param {string} provider
 * @returns {string}
 */
function parseSseDelta(line, provider) {
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
        if (provider === 'anthropic') {
            return obj?.delta?.text || '';
        }
        return obj?.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
}

/**
 * Extract token usage from a completed response body.
 *
 * @param {Object} body
 * @param {string} provider
 * @returns {{ promptTokens: number, completionTokens: number }}
 */
function extractUsage(body, provider) {
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
function _extractImagesFromResponse(body, provider) {
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
 * Returns normalised OpenAI format: [{ id, type:'function', function:{ name, arguments } }]
 *
 * @param {Object} body
 * @param {string} provider
 * @returns {Array}
 */
function _extractToolCalls(body, provider) {
    if (provider === 'anthropic') {
        // Anthropic: content[] may contain tool_use blocks
        const blocks = body?.content || [];
        return blocks
            .filter(b => b?.type === 'tool_use')
            .map(b => ({
                id:       b.id,
                type:     'function',
                function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
            }));
    }
    // OpenAI-compat (openrouter, openai, ollama)
    return body?.choices?.[0]?.message?.tool_calls || [];
}

/**
 * Merge a streaming tool_call delta chunk into an accumulator array.
 * Each delta has an `index` indicating which tool call it belongs to.
 *
 * @param {Array} accum - accumulator array indexed by tool call index
 * @param {Array} deltas - delta objects from choices[0].delta.tool_calls
 */
function _mergeToolCallDeltas(accum, deltas) {
    for (const d of deltas) {
        const i = d.index ?? 0;
        if (!accum[i]) {
            accum[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        const t = accum[i];
        if (d.id)                   t.id                  += d.id;
        if (d.function?.name)       t.function.name       += d.function.name;
        if (d.function?.arguments)  t.function.arguments  += d.function.arguments;
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * <sg-llm-request> — Headless LLM fetch engine.
 *
 * @fires llm:request-start
 * @fires llm:request-chunk
 * @fires llm:request-complete
 * @fires llm:request-error
 * @fires llm:request-cancel
 * @fires llm:tool-calls  (when LLM response contains tool calls)
 */
export class SgLlmRequest extends HTMLElement {

    constructor() {
        super();
        this._config     = null;
        this._streaming  = true;
        this._controller = null;
        this._busy       = false;
    }

    connectedCallback() {
        this._container = this._bus();
        this._onSend             = this._handleSend.bind(this);
        this._onCancel           = this._handleCancel.bind(this);
        this._onConnect          = this._handleConnected.bind(this);
        this._onStreamingChanged = this._handleStreamingChanged.bind(this);

        this._container.addEventListener(SGL_LLM.SEND,              this._onSend);
        this._container.addEventListener(SGL_LLM.CANCEL,            this._onCancel);
        this._container.addEventListener(SGL_LLM.CONNECTED,         this._onConnect);
        this._container.addEventListener(SGL_LLM.STREAMING_CHANGED, this._onStreamingChanged);
    }

    disconnectedCallback() {
        this._container.removeEventListener(SGL_LLM.SEND,              this._onSend);
        this._container.removeEventListener(SGL_LLM.CANCEL,            this._onCancel);
        this._container.removeEventListener(SGL_LLM.CONNECTED,         this._onConnect);
        this._container.removeEventListener(SGL_LLM.STREAMING_CHANGED, this._onStreamingChanged);
        this._cancel();
    }

    /**
     * Return the nearest ancestor with [data-llm-bus], or parentElement as fallback.
     * @returns {Element}
     */
    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    // ── Event handlers ──────────────────────────────────────────────────────

    /** @param {CustomEvent} e - detail: { provider, model, baseUrl, apiKey } */
    _handleConnected(e) {
        this._config = {
            provider: e.detail.provider,
            model:    e.detail.model,
            baseUrl:  e.detail.baseUrl || '',
            apiKey:   e.detail.apiKey  || '',
        };
    }

    /** @param {CustomEvent} e - detail: { streaming: boolean } */
    _handleStreamingChanged(e) {
        this._streaming = e.detail.streaming;
    }

    /**
     * @param {CustomEvent} e
     * detail: { messages[], model?, provider?, mode?, tools?, tool_choice?, response_format? }
     */
    async _handleSend(e) {
        if (this._busy) return;
        const { messages, model, provider, mode, tools, tool_choice, response_format } = e.detail;

        const config = {
            provider: provider || this._config?.provider || 'openrouter',
            model:    model    || this._config?.model    || '',
            baseUrl:  this._config?.baseUrl || '',
            apiKey:   this._config?.apiKey  || '',
        };
        const opts = { tools, tool_choice, response_format };

        await this._executeRequest(messages, config, mode, opts);
    }

    _handleCancel() { this._cancel(); }

    // ── Request execution ────────────────────────────────────────────────────

    /**
     * @param {Array} messages
     * @param {{ provider, model, baseUrl, apiKey }} config
     * @param {string} mode
     * @param {{ tools?, tool_choice?, response_format? }} opts
     */
    async _executeRequest(messages, config, mode, opts = {}) {
        this._busy = true;
        this._controller = new AbortController();
        const startTime = Date.now();

        const tokenEstimate = messages.reduce((sum, m) => {
            const text = Array.isArray(m.content)
                ? m.content.filter(p => p.type === 'text').map(p => p.text).join('')
                : (m.content || '');
            return sum + Math.ceil(text.length / 4);
        }, 0);

        this._emit(SGL_LLM.REQUEST_START, { provider: config.provider, model: config.model, streaming: this._streaming, tokenEstimate, mode });

        try {
            const endpoint = buildEndpoint(config.provider, config.baseUrl);
            const headers  = buildHeaders(config.provider, config.apiKey);
            const body     = buildRequestBody(config.provider, messages, config.model, this._streaming, opts);

            const response = await fetch(endpoint, {
                method: 'POST', headers,
                body:   JSON.stringify(body),
                signal: this._controller.signal,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                let bodyMsg = '';
                try {
                    const errJson = JSON.parse(errText);
                    bodyMsg = errJson?.error?.message || errJson?.message || '';
                } catch { /* not JSON */ }
                const statusLabel = bodyMsg || response.statusText || String(response.status);
                throw Object.assign(new Error(`HTTP ${response.status}: ${statusLabel}`), {
                    status: response.status, body: errText, bodyError: bodyMsg,
                });
            }

            if (this._streaming) {
                await this._readStream(response, config.provider, messages);
            } else {
                const json    = await response.json();
                const content = this._extractNonStreamContent(json, config.provider);
                const usage   = extractUsage(json, config.provider);
                const toolCalls = _extractToolCalls(json, config.provider);
                const respImages = _extractImagesFromResponse(json, config.provider);
                const latencyMs = Date.now() - startTime;

                this._emit(SGL_LLM.REQUEST_COMPLETE, {
                    content,
                    promptTokens:     usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    cost:             0,
                    latencyMs,
                    model:            config.model,
                    finishReason:     json?.choices?.[0]?.finish_reason || json?.stop_reason || 'stop',
                    mode,
                    images:           respImages,
                    rawChunks:        [],
                    rawResponse:      json,
                    toolCalls,
                });

                if (toolCalls.length > 0) {
                    this._emit(SGL_LLM.TOOL_CALLS, { toolCalls, messages });
                }
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                this._emit(SGL_LLM.REQUEST_CANCEL, {});
            } else {
                this._emit(SGL_LLM.REQUEST_ERROR, {
                    error:     err.message,
                    bodyError: err.bodyError || '',
                    status:    err.status || 0,
                    provider:  config.provider,
                });
            }
        } finally {
            this._busy = false;
            this._controller = null;
        }
    }

    /**
     * Read a streaming SSE response. Accumulates tool_call deltas and emits
     * llm:tool-calls in addition to llm:request-complete when tool calls are present.
     *
     * @param {Response} response
     * @param {string} provider
     * @param {Array} messages - original messages sent (forwarded in llm:tool-calls)
     * @returns {Promise<string>}
     */
    async _readStream(response, provider, messages) {
        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer      = '';
        let promptTokens     = 0;
        let completionTokens = 0;
        let finishReason = 'stop';
        const startTime = Date.now();
        const rawChunks = [];
        const accImages = [];
        const accumToolCalls = [];  // indexed by tool_call index

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const delta = parseSseDelta(line, provider);
                if (delta) {
                    accumulated += delta;
                    this._emit(SGL_LLM.REQUEST_CHUNK, { chunk: delta, accumulated });
                }

                try {
                    const raw = provider === 'ollama'
                        ? line.trim()
                        : (line.startsWith('data: ') && line !== 'data: [DONE]' ? line.slice(6) : '');
                    if (raw) {
                        const obj = JSON.parse(raw);
                        rawChunks.push(obj);

                        if (obj?.usage) {
                            const u = extractUsage(obj, provider);
                            if (u.promptTokens)     promptTokens     = u.promptTokens;
                            if (u.completionTokens) completionTokens = u.completionTokens;
                        }
                        if (obj?.prompt_eval_count) promptTokens     = obj.prompt_eval_count;
                        if (obj?.eval_count)        completionTokens = obj.eval_count;
                        if (obj?.choices?.[0]?.finish_reason) finishReason = obj.choices[0].finish_reason;
                        if (obj?.stop_reason)  finishReason = obj.stop_reason;
                        if (obj?.done_reason)  finishReason = obj.done_reason;

                        const imgs = obj?.choices?.[0]?.delta?.images;
                        if (Array.isArray(imgs)) {
                            for (const img of imgs) accImages.push(img);
                        }

                        // Accumulate tool_call deltas
                        const tcDeltas = obj?.choices?.[0]?.delta?.tool_calls;
                        if (Array.isArray(tcDeltas) && tcDeltas.length > 0) {
                            _mergeToolCallDeltas(accumToolCalls, tcDeltas);
                        }
                    }
                } catch { /* ignore parse errors */ }
            }
        }

        const toolCalls = accumToolCalls.filter(Boolean);

        this._emit(SGL_LLM.REQUEST_COMPLETE, {
            content:          accumulated,
            promptTokens,
            completionTokens,
            cost:             0,
            latencyMs:        Date.now() - startTime,
            model:            this._config?.model || '',
            finishReason,
            images:           accImages,
            rawChunks,
            rawResponse:      null,
            toolCalls,
        });

        if (toolCalls.length > 0) {
            this._emit(SGL_LLM.TOOL_CALLS, { toolCalls, messages });
        }

        return accumulated;
    }

    /**
     * @param {Object} json
     * @param {string} provider
     * @returns {string}
     */
    _extractNonStreamContent(json, provider) {
        if (provider === 'anthropic') {
            // When tool use is present, content may be empty string
            const textBlock = (json?.content || []).find(b => b?.type === 'text');
            return textBlock?.text || '';
        }
        if (provider === 'ollama') return json?.message?.content || '';
        return json?.choices?.[0]?.message?.content || '';
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _cancel() {
        if (this._controller) { this._controller.abort(); this._controller = null; }
        this._busy = false;
    }

    /**
     * @param {string} eventName
     * @param {Object} detail
     */
    _emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true, composed: true }));
    }

    /** Whether a request is currently in flight. */
    get busy() { return this._busy; }
}

customElements.define('sg-llm-request', SgLlmRequest);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @param {string} mimeType
 * @param {string} name
 * @returns {string}
 */
function _audioFmt(mimeType, name) {
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

window.SgLlmRequest = SgLlmRequest;
