/**
 * aw-loop-coordinator — Headless agentic loop controller.
 *
 * Listens for llm:tool-results-complete and re-fires llm:send with the
 * accumulated messages until max-iterations is reached.
 * Emits llm:loop-limit-reached when the ceiling is hit.
 *
 * Attribute:
 *   max-iterations  — integer, default 10
 *
 * @module aw-loop-coordinator
 * @version 0.1.58
 */
export class AwLoopCoordinator extends HTMLElement {
    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this._iter = 0;
        this._maxIter = parseInt(this.getAttribute('max-iterations') ?? '10', 10) || 10;

        const bus = this._bus();

        bus.addEventListener('llm:chat-message', () => {
            this._iter = 0;
        });

        bus.addEventListener('llm:tool-results-complete', (e) => {
            const { results, messages } = e.detail ?? {};

            // Inject a tool-results bubble into chat (fires for both success AND error)
            _injectResultsBubble(bus, results, messages);

            this._iter += 1;

            if (this._iter >= this._maxIter) {
                bus.dispatchEvent(new CustomEvent('llm:loop-limit-reached', {
                    detail: { iterations: this._iter },
                    bubbles: true, composed: true,
                }));
                return;
            }

            // Continue loop — P1 capture listener in api.js will inject tools
            bus.dispatchEvent(new CustomEvent('llm:send', {
                detail: { messages: messages ?? [] },
                bubbles: true, composed: true,
            }));
        });
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-loop-coordinator', AwLoopCoordinator);

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Inject a compact tool-results summary bubble into sg-llm-chat-history.
 * Uses the semi-private _addBubble API on bus.__sgLlmChatHistory.
 * Works for both success and error results (no dependency on sg-local-bridge:tool-call).
 */
function _injectResultsBubble(bus, results, messages) {
    const hist = bus.__sgLlmChatHistory;
    if (!hist?._addBubble || !results?.length) return;

    // Recover args from the assistant's tool_calls message in the updated array
    const toolCallMsg = [...(messages ?? [])].reverse().find(m => m.role === 'assistant' && m.tool_calls);

    const lines = results.map(r => {
        const tc     = toolCallMsg?.tool_calls?.find(t => t.id === r.toolCallId);
        const args   = tc?.function?.arguments ?? '{}';
        const ok     = !r.error;
        const resRaw = ok
            ? (() => { try { const s = JSON.stringify(r.result ?? null); return s.length > 400 ? s.slice(0, 400) + '…' : s; } catch { return String(r.result); } })()
            : r.error;
        return `**${ok ? '✓' : '✗'} ${r.name}**\n\`\`\`json\n${args}\n\`\`\`\n→ \`${resRaw}\``;
    });

    hist._addBubble('assistant', lines.join('\n\n---\n\n'), [], []);
}
