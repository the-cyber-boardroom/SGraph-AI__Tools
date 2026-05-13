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
            const { messages } = e.detail ?? {};
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

        // Inject a compact tool-result bubble into the chat history so the user
        // can see what was executed without having to open the Queue panel.
        bus.addEventListener('sg-local-bridge:tool-call', (e) => {
            const { name, args, result, ms } = e.detail ?? {};
            const hist = bus.__sgLlmChatHistory;
            if (!hist || typeof hist._addBubble !== 'function') return;

            const argStr = (() => { try { return JSON.stringify(args ?? {}); } catch { return '{}'; } })();
            const resRaw = (() => { try { return typeof result === 'string' ? result : JSON.stringify(result ?? null); } catch { return String(result ?? ''); } })();
            const resStr = resRaw.length > 400 ? resRaw.slice(0, 400) + '…' : resRaw;
            const text   = `**🔧 ${name}** · ${ms ?? '?'}ms\n\`\`\`\n${argStr}\n\`\`\`\n**Result:** \`${resStr}\``;
            hist._addBubble('assistant', text, [], []);
        });
    }

    _bus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-llm-bus')) return el; el = el.parentElement; }
        return this.parentElement || document;
    }
}

customElements.define('aw-loop-coordinator', AwLoopCoordinator);
