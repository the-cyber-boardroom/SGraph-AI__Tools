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
 * This component is DUMB on purpose — it does NOT modify the messages array.
 * The reality constructor owns the model's universe. This is a dumb pipe.
 *
 * Security invariant: NEVER sends API keys to any *.sgraph.ai domain.
 *
 * Usage:
 *   <sg-llm-request></sg-llm-request>
 *   Place on the page (can be hidden). Wire via llm:send / llm:cancel events.
 *
 * v0.1.2 changes:
 *   - Translates `binary_file` content parts (from sg-llm-chat-history v0.1.8+):
 *       Anthropic: PDF → `document` block (base64). Audio/video skipped (unsupported).
 *       OpenAI/OpenRouter: audio → `input_audio` block (base64 + format). Others skipped.
 *       Ollama: all binary_file parts silently dropped (unsupported).
 *
 * v0.1.1 changes:
 *   - _readStream() now accumulates rawChunks[] (every parsed SSE object) and
 *     images[] (from delta.images in each chunk). Both are included in the
 *     REQUEST_COMPLETE event detail.
 *   - Non-streaming path now includes rawResponse (the full parsed JSON body)
 *     and images[] in REQUEST_COMPLETE.
 *   - _bus() updated to walk ancestors for [data-llm-bus] attribute, enabling
 *     use inside sg-layout panels (backwards compatible).
 *
 * @module sg-llm-request
 * @version 0.1.2
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

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
 * The canonical format uses content arrays for multimodal messages.
 *
 * @param {string} provider
 * @param {Array<{role: string, content: string|Array}>} messages
 * @param {string} model
 * @param {boolean} streaming
 * @returns {Object} Request body
 */
function buildRequestBody(provider, messages, model, streaming) {
    if (provider === 'anthropic') {
        return _buildAnthropicBody(messages, model, streaming);
    }
    if (provider === 'ollama') {
        return _buildOllamaBody(messages, model, streaming);
    }
    // openrouter, openai — both use OpenAI format
    return _buildOpenAIBody(messages, model, streaming);
}

/**
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @returns {Object}
 */
function _buildOpenAIBody(messages, model, streaming) {
    return {
        model,
        stream: streaming,
        messages: messages.map(msg => ({
            role: msg.role,
            content: Array.isArray(msg.content)
                ? msg.content.map(part => {
                    if (part.type === 'binary_file') {
                        // Audio → OpenAI input_audio format
                        if (part.mime_type?.startsWith('audio/')) {
                            const base64 = part.data_url?.split(',')[1] ?? '';
                            const fmt = _audioFmt(part.mime_type, part.name);
                            return { type: 'input_audio', input_audio: { data: base64, format: fmt } };
                        }
                        return null; // PDF, video not natively supported in OpenAI messages
                    }
                    return part;
                }).filter(Boolean)
                : msg.content
        }))
    };
}

/**
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @returns {Object}
 */
function _buildAnthropicBody(messages, model, streaming) {
    // Anthropic separates system prompt from messages array
    let systemPrompt = '';
    const chatMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemPrompt = typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || '';
            continue;
        }

        if (Array.isArray(msg.content)) {
            // Multimodal: convert to Anthropic content array format
            chatMessages.push({
                role: msg.role,
                content: msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text };
                    }
                    if (part.type === 'image_url') {
                        // part.image_url.url is a data URL: "data:image/png;base64,..."
                        const url = part.image_url.url;
                        const [header, data] = url.split(',');
                        const mediaType = header.replace('data:', '').replace(';base64', '');
                        return {
                            type: 'image',
                            source: { type: 'base64', media_type: mediaType, data }
                        };
                    }
                    if (part.type === 'binary_file') {
                        // Anthropic supports PDFs as document blocks
                        if (part.mime_type === 'application/pdf') {
                            const base64 = part.data_url?.split(',')[1] ?? '';
                            return {
                                type: 'document',
                                source: { type: 'base64', media_type: 'application/pdf', data: base64 }
                            };
                        }
                        return null; // audio/video not supported by Anthropic — skip
                    }
                    return part;
                }).filter(Boolean)
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
    return body;
}

/**
 * @param {Array} messages
 * @param {string} model
 * @param {boolean} streaming
 * @returns {Object}
 */
function _buildOllamaBody(messages, model, streaming) {
    // Ollama uses a flat messages format; images are separate base64 arrays
    const ollamaMessages = messages.map(msg => {
        if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
            const images = msg.content
                .filter(p => p.type === 'image_url')
                .map(p => p.image_url.url.split(',')[1]);  // strip data: prefix
            const out = { role: msg.role, content: textParts };
            if (images.length) out.images = images;
            return out;
        }
        return { role: msg.role, content: msg.content };
    });

    return { model, stream: streaming, messages: ollamaMessages };
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
    return `${base}/v1/chat/completions`;  // openrouter, openai
}

/**
 * Parse a single SSE data line and extract the text delta.
 *
 * @param {string} line
 * @param {string} provider
 * @returns {string} text delta, or '' if none
 */
function parseSseDelta(line, provider) {
    // Ollama uses NDJSON — each line is raw JSON, no 'data: ' prefix
    if (provider === 'ollama') {
        if (!line.trim()) return '';
        try {
            const obj = JSON.parse(line);
            return obj?.message?.content || '';
        } catch {
            return '';
        }
    }
    // SSE format for all other providers
    if (!line.startsWith('data: ')) return '';
    const json = line.slice(6).trim();
    if (json === '[DONE]') return '';
    try {
        const obj = JSON.parse(json);
        if (provider === 'anthropic') {
            // Anthropic: content_block_delta events
            return obj?.delta?.text || '';
        }
        // OpenAI-compat: choices[0].delta.content
        return obj?.choices?.[0]?.delta?.content || '';
    } catch {
        return '';
    }
}

/**
 * Extract token usage from a completed response body.
 *
 * @param {Object} body - Parsed response JSON
 * @param {string} provider
 * @returns {{ promptTokens: number, completionTokens: number }}
 */
function extractUsage(body, provider) {
    if (provider === 'anthropic') {
        return {
            promptTokens:     body?.usage?.input_tokens     || 0,
            completionTokens: body?.usage?.output_tokens    || 0,
        };
    }
    return {
        promptTokens:     body?.usage?.prompt_tokens     || 0,
        completionTokens: body?.usage?.completion_tokens || 0,
    };
}

/**
 * Extract image objects from a non-streaming response body.
 * Handles OpenAI-compat (choices[].message.content[]) and Anthropic (content[]) formats.
 *
 * @param {Object} body
 * @param {string} provider
 * @returns {Array<{type:string, image_url?:Object, source?:Object}>}
 */
function _extractImagesFromResponse(body, provider) {
    const images = [];
    if (provider === 'anthropic') {
        const blocks = body?.content || [];
        for (const b of blocks) {
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
 * <sg-llm-request> — Headless LLM fetch engine.
 *
 * Place on the page. It listens for llm:send on its container and emits
 * request lifecycle events (llm:request-start, llm:request-chunk,
 * llm:request-complete, llm:request-error, llm:request-cancel).
 *
 * @fires llm:request-start
 * @fires llm:request-chunk
 * @fires llm:request-complete
 * @fires llm:request-error
 * @fires llm:request-cancel
 */
export class SgLlmRequest extends HTMLElement {

    constructor() {
        super();
        this._config     = null;   // { provider, apiKey, model, baseUrl }
        this._streaming  = true;
        this._controller = null;   // AbortController for current request
        this._busy       = false;
    }

    connectedCallback() {
        this._container = this._bus();
        this._onSend    = this._handleSend.bind(this);
        this._onCancel  = this._handleCancel.bind(this);
        this._onConnect = this._handleConnected.bind(this);
        this._onStreamingChanged = this._handleStreamingChanged.bind(this);

        this._container.addEventListener(SGL_LLM.SEND,             this._onSend);
        this._container.addEventListener(SGL_LLM.CANCEL,           this._onCancel);
        this._container.addEventListener(SGL_LLM.CONNECTED,        this._onConnect);
        this._container.addEventListener(SGL_LLM.STREAMING_CHANGED, this._onStreamingChanged);
    }

    disconnectedCallback() {
        this._container.removeEventListener(SGL_LLM.SEND,             this._onSend);
        this._container.removeEventListener(SGL_LLM.CANCEL,           this._onCancel);
        this._container.removeEventListener(SGL_LLM.CONNECTED,        this._onConnect);
        this._container.removeEventListener(SGL_LLM.STREAMING_CHANGED, this._onStreamingChanged);
        this._cancel();
    }

    /**
     * Return the nearest ancestor with [data-llm-bus], or parentElement as fallback.
     * This allows the component to work inside sg-layout panel shadow DOMs.
     *
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

    // --- Event handlers ---------------------------------------------------------

    /**
     * @param {CustomEvent} e - detail: { provider, model, baseUrl, apiKey }
     */
    _handleConnected(e) {
        this._config = {
            provider: e.detail.provider,
            model:    e.detail.model,
            baseUrl:  e.detail.baseUrl || '',
            apiKey:   e.detail.apiKey  || '',
        };
    }

    /**
     * @param {CustomEvent} e - detail: { streaming: boolean }
     */
    _handleStreamingChanged(e) {
        this._streaming = e.detail.streaming;
    }

    /**
     * @param {CustomEvent} e - detail: { messages[], model?, provider?, mode }
     */
    async _handleSend(e) {
        if (this._busy) return;

        const { messages, model, provider, mode } = e.detail;

        // Allow overriding provider/model per send (for memory-update with cheaper model)
        const config = {
            provider: provider || this._config?.provider || 'openrouter',
            model:    model    || this._config?.model    || '',
            baseUrl:  this._config?.baseUrl || '',
            apiKey:   this._config?.apiKey  || '',
        };

        await this._executeRequest(messages, config, mode);
    }

    _handleCancel() {
        this._cancel();
    }

    // --- Request execution ------------------------------------------------------

    /**
     * Execute a request against the provider.
     *
     * @param {Array} messages
     * @param {{ provider: string, model: string, baseUrl: string, apiKey: string }} config
     * @param {string} mode - 'build' | 'memory-update'
     */
    async _executeRequest(messages, config, mode) {
        this._busy = true;
        this._controller = new AbortController();
        const startTime = Date.now();

        const tokenEstimate = messages.reduce((sum, m) => {
            const text = Array.isArray(m.content)
                ? m.content.filter(p => p.type === 'text').map(p => p.text).join('')
                : (m.content || '');
            return sum + Math.ceil(text.length / 4);
        }, 0);

        this._emit(SGL_LLM.REQUEST_START, {
            provider:      config.provider,
            model:         config.model,
            streaming:     this._streaming,
            tokenEstimate,
            mode,
        });

        try {
            const endpoint = buildEndpoint(config.provider, config.baseUrl);
            const headers  = buildHeaders(config.provider, config.apiKey);
            const body     = buildRequestBody(config.provider, messages, config.model, this._streaming);

            const response = await fetch(endpoint, {
                method:  'POST',
                headers,
                body:    JSON.stringify(body),
                signal:  this._controller.signal,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw Object.assign(new Error(`HTTP ${response.status}: ${response.statusText}`), {
                    status: response.status,
                    body:   errText,
                });
            }

            let content = '';

            if (this._streaming) {
                content = await this._readStream(response, config.provider);
            } else {
                const json = await response.json();
                content = this._extractNonStreamContent(json, config.provider);
                const usage = extractUsage(json, config.provider);
                const latencyMs = Date.now() - startTime;
                // Collect images from non-streaming response (Anthropic image blocks, etc.)
                const respImages = _extractImagesFromResponse(json, config.provider);
                this._emit(SGL_LLM.REQUEST_COMPLETE, {
                    content,
                    promptTokens:     usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    cost:             0,  // sg-llm-stats calculates cost from model pricing
                    latencyMs,
                    model:            config.model,
                    finishReason:     json?.choices?.[0]?.finish_reason || json?.stop_reason || 'stop',
                    mode,
                    images:           respImages,
                    rawChunks:        [],
                    rawResponse:      json,
                });
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                this._emit(SGL_LLM.REQUEST_CANCEL, {});
            } else {
                this._emit(SGL_LLM.REQUEST_ERROR, {
                    error:    err.message,
                    status:   err.status || 0,
                    provider: config.provider,
                });
            }
        } finally {
            this._busy = false;
            this._controller = null;
        }
    }

    /**
     * Read a streaming SSE response and emit REQUEST_CHUNK events.
     *
     * @param {Response} response
     * @param {string} provider
     * @returns {Promise<string>} accumulated full content
     */
    async _readStream(response, provider) {
        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer      = '';
        let promptTokens = 0;
        let completionTokens = 0;
        let finishReason = 'stop';
        const startTime  = Date.now();
        const rawChunks  = [];   // every parsed SSE JSON object
        const accImages  = [];   // {type, image_url} objects from delta.images

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();  // last incomplete line stays in buffer

            for (const line of lines) {
                const delta = parseSseDelta(line, provider);
                if (delta) {
                    accumulated += delta;
                    this._emit(SGL_LLM.REQUEST_CHUNK, { chunk: delta, accumulated });
                }

                // Extract usage, finish reason, images and accumulate raw chunks
                try {
                    // Ollama: raw JSON per line; others: 'data: ...' SSE lines
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
                        // Ollama: prompt_eval_count / eval_count on the done:true line
                        if (obj?.prompt_eval_count) promptTokens     = obj.prompt_eval_count;
                        if (obj?.eval_count)        completionTokens = obj.eval_count;
                        if (obj?.choices?.[0]?.finish_reason) finishReason = obj.choices[0].finish_reason;
                        if (obj?.stop_reason)  finishReason = obj.stop_reason;
                        if (obj?.done_reason)  finishReason = obj.done_reason;

                        // Collect images from delta (OpenRouter / some providers return
                        // delta.images[] containing {type:"image_url", image_url:{url:...}})
                        const imgs = obj?.choices?.[0]?.delta?.images;
                        if (Array.isArray(imgs)) {
                            for (const img of imgs) accImages.push(img);
                        }
                    }
                } catch { /* ignore parse errors on non-JSON lines */ }
            }
        }

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
            rawResponse:      null,  // only populated on non-streaming path
        });

        return accumulated;
    }

    /**
     * Extract content from a non-streaming response body.
     *
     * @param {Object} json
     * @param {string} provider
     * @returns {string}
     */
    _extractNonStreamContent(json, provider) {
        if (provider === 'anthropic') {
            return json?.content?.[0]?.text || '';
        }
        if (provider === 'ollama') {
            return json?.message?.content || '';
        }
        return json?.choices?.[0]?.message?.content || '';
    }

    // --- Helpers ----------------------------------------------------------------

    _cancel() {
        if (this._controller) {
            this._controller.abort();
            this._controller = null;
        }
        this._busy = false;
    }

    /**
     * Emit a custom event on this element (bubbles + composed).
     *
     * @param {string} eventName
     * @param {Object} detail
     */
    _emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    /** Whether a request is currently in flight. */
    get busy() { return this._busy; }
}

customElements.define('sg-llm-request', SgLlmRequest);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the audio format string expected by the OpenAI input_audio type
 * from a MIME type or filename extension.
 * @param {string} mimeType
 * @param {string} name  — filename (used as fallback)
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
    // Fall back to filename extension
    const ext = name?.split('.').pop()?.toLowerCase();
    if (['mp3','wav','ogg','webm','flac','aac','mp4','m4a'].includes(ext)) return ext;
    return 'mp3'; // safe fallback
}
window.SgLlmRequest = SgLlmRequest;
