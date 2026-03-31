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
 * @module sg-llm-request
 * @version 0.1.0
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
            content: msg.content  // pass through as-is (string or content array)
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
                    return part;
                })
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
    if (!line.startsWith('data: ')) return '';
    const json = line.slice(6).trim();
    if (json === '[DONE]') return '';
    try {
        const obj = JSON.parse(json);
        if (provider === 'anthropic') {
            // Anthropic: content_block_delta events
            return obj?.delta?.text || '';
        }
        if (provider === 'ollama') {
            return obj?.message?.content || '';
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
        this._container = this.parentElement || document;
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
                this._emit(SGL_LLM.REQUEST_COMPLETE, {
                    content,
                    promptTokens:     usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    cost:             0,  // sg-llm-stats calculates cost from model pricing
                    latencyMs,
                    model:            config.model,
                    finishReason:     json?.choices?.[0]?.finish_reason || json?.stop_reason || 'stop',
                    mode,
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
        const startTime = Date.now();

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

                // Extract usage from final chunk (Anthropic, some OpenAI-compat)
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const obj = JSON.parse(line.slice(6));
                        if (obj?.usage) {
                            const u = extractUsage(obj, provider);
                            if (u.promptTokens)     promptTokens     = u.promptTokens;
                            if (u.completionTokens) completionTokens = u.completionTokens;
                        }
                        if (obj?.choices?.[0]?.finish_reason) finishReason = obj.choices[0].finish_reason;
                        if (obj?.stop_reason) finishReason = obj.stop_reason;
                    } catch { /* ignore */ }
                }
            }
        }

        this._emit(SGL_LLM.REQUEST_COMPLETE, {
            content:          accumulated,
            promptTokens,
            completionTokens,
            cost:             0,
            latencyMs:        Date.now() - (this._startTime || Date.now()),
            model:            this._config?.model || '',
            finishReason,
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
window.SgLlmRequest = SgLlmRequest;
