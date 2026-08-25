/**
 * aw-tool-extractor — Extracts tool calls from LLM responses (all formats).
 *
 * Native tool_calls: emits llm:tool-calls-extracted {calls, format:'native'} for visibility only.
 * JSON-in-content: emits llm:tool-calls-extracted + llm:tool-calls (to trigger sg-tool-runner).
 * Code-block: lb_fn(args) syntax — same as JSON path but format:'codeblock'.
 *
 * @module aw-tool-extractor
 * @version 0.1.58
 */
import { normaliseToolCalls, isJsonInContent }
    from '/components/agentic/sg-local-bridge/v0/v0.1/v0.1.0/sg-local-bridge-shim.js';

export class AwToolExtractor extends HTMLElement {
    connectedCallback() {
        if (this._init) return;
        this._init = true;
        const bus = this._bus();

        // Visibility: log native tool_calls that sg-llm-request already handles
        bus.addEventListener('llm:tool-calls', (e) => {
            const { toolCalls } = e.detail ?? {};
            if (!toolCalls?.length || e._fromExtractor) return;
            bus.dispatchEvent(new CustomEvent('llm:tool-calls-extracted', {
                detail: { calls: toolCalls, format: 'native', raw: null, confidence: 1.0 },
                bubbles: true, composed: true,
            }));
        });

        // Text extraction fallback
        bus.addEventListener('llm:request-complete', (e) => {
            const { content, toolCalls } = e.detail ?? {};
            if (Array.isArray(toolCalls) && toolCalls.length > 0) return;
            if (!content) return;

            // Try JSON-in-content: {"tool":"name","parameters":{}}
            if (isJsonInContent({ content })) {
                const norm = normaliseToolCalls({ content });
                const calls = norm.tool_calls ?? [];
                if (calls.length) {
                    this._emit(bus, calls, 'json', content);
                    return;
                }
            }

            // Try code-block: lb_fn("arg") syntax
            const calls = _extractCodeBlock(content);
            if (calls.length) this._emit(bus, calls, 'codeblock', content);
        });
    }

    _emit(bus, calls, format, raw) {
        bus.dispatchEvent(new CustomEvent('llm:tool-calls-extracted', {
            detail: { calls, format, raw, confidence: format === 'json' ? 0.9 : 0.7 },
            bubbles: true, composed: true,
        }));
        const ev = new CustomEvent('llm:tool-calls', {
            detail: { toolCalls: calls, messages: [] },
            bubbles: true, composed: true,
        });
        ev._fromExtractor = true;
        bus.dispatchEvent(ev);
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

/** Parse lb_fn("arg") patterns from text. Returns OpenAI-format tool_calls[]. */
function _extractCodeBlock(content) {
    const calls = [];
    const re = /\blb_([a-z_]+)\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const name = `lb_${m[1]}`;
        const rawArgs = m[2].trim();
        let args = {};
        try { args = JSON.parse(rawArgs); } catch {
            // Single positional string arg → map to 'path' or 'command'
            const val = rawArgs.replace(/^["']|["']$/g, '');
            args = name === 'lb_run_bash' ? { command: val } : { path: val || '.' };
        }
        calls.push({ id:`call_${Date.now()}_${calls.length}`, type:'function',
                     function:{ name, arguments: JSON.stringify(args) } });
    }
    return calls;
}

customElements.define('aw-tool-extractor', AwToolExtractor);
