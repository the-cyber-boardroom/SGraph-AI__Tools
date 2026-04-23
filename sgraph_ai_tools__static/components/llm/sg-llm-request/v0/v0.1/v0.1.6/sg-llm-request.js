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
 * @version 0.1.6
 *
 * Changelog:
 *   v0.1.6: Fixed OpenRouter PDF support. OpenRouter requires {type:'file',
 *     file:{filename, file_data}} content blocks — not Anthropic-native document
 *     blocks. The file type works for all OpenRouter models, not just anthropic/*.
 *
 *   v0.1.5: Split into three modules (builders, parsers, component). Two bug fixes:
 *     1. Anthropic direct: added anthropic-dangerous-direct-browser-access header,
 *        required by Anthropic for browser-to-API calls (buildHeaders in builders).
 *     2. OpenRouter + anthropic/* models: PDF binary_file parts now translated to
 *        Anthropic document blocks instead of being silently dropped (buildOpenAIBody
 *        in builders). NOTE: this approach was incorrect; v0.1.6 fixes the format.
 *
 *   v0.1.4: Tool calling support.
 *   v0.1.3: HTTP error body extraction.
 *   v0.1.2: binary_file translation for Anthropic (PDF) and OpenAI/OpenRouter (audio).
 *   v0.1.1: _readStream rawChunks/images accumulation; _bus() ancestor walk.
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';
import {
    buildHeaders,
    buildEndpoint,
    buildRequestBody,
} from './sg-llm-request-builders.js';
import {
    parseSseDelta,
    extractUsage,
    extractImagesFromResponse,
    extractToolCalls,
    mergeToolCallDeltas,
} from './sg-llm-request-parsers.js';

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

        this._emit(SGL_LLM.REQUEST_START, {
            provider: config.provider, model: config.model,
            streaming: this._streaming, tokenEstimate, mode,
        });

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
                const json       = await response.json();
                const content    = this._extractNonStreamContent(json, config.provider);
                const usage      = extractUsage(json, config.provider);
                const toolCalls  = extractToolCalls(json, config.provider);
                const respImages = extractImagesFromResponse(json, config.provider);
                const latencyMs  = Date.now() - startTime;

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
        let accumulated      = '';
        let buffer           = '';
        let promptTokens     = 0;
        let completionTokens = 0;
        let finishReason     = 'stop';
        const startTime      = Date.now();
        const rawChunks      = [];
        const accImages      = [];
        const accumToolCalls = [];

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
                        if (Array.isArray(imgs)) for (const img of imgs) accImages.push(img);

                        const tcDeltas = obj?.choices?.[0]?.delta?.tool_calls;
                        if (Array.isArray(tcDeltas) && tcDeltas.length > 0) {
                            mergeToolCallDeltas(accumToolCalls, tcDeltas);
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
window.SgLlmRequest = SgLlmRequest;
