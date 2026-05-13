/**
 * aw-chat-pane — Thin custom element that hosts the chat UI inside an sg-layout tab.
 *
 * Renders sg-llm-chat-history, sg-llm-chat-input, and the loop status strip
 * inside light DOM so they remain within the [data-llm-bus] boundary.
 *
 * @module aw-chat-pane
 * @version 0.1.58
 */

export class AwChatPane extends HTMLElement {

    connectedCallback() {
        if (this._initialised) return;
        this._initialised = true;
        this._render();
    }

    _render() {
        this.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;';

        const history = document.createElement('sg-llm-chat-history');
        history.style.cssText = 'flex:1;min-height:0;display:block;overflow:hidden;';

        const input = document.createElement('sg-llm-chat-input');
        input.style.cssText = 'flex-shrink:0;display:block;';

        const strip = document.createElement('div');
        strip.id = 'loop-strip';
        strip.className = 'aw-loop-strip';
        strip.style.cssText = 'flex-shrink:0;';

        this.appendChild(history);
        this.appendChild(input);
        this.appendChild(strip);

        // Signal readiness so initShell can wire the loop strip
        this.dispatchEvent(new CustomEvent('aw-chat-pane:ready', {
            bubbles: true, composed: true,
        }));
    }
}

customElements.define('aw-chat-pane', AwChatPane);
