/**
 * aw-system-prompt — Editable system prompt panel inside sg-layout.
 *
 * Listens for llm:system-prompt on [data-llm-bus] and displays the text
 * in a textarea. On save, re-dispatches llm:system-prompt so sg-agentic-loop
 * picks up the change immediately.
 *
 * @module aw-system-prompt
 * @version 0.1.58
 */

export class AwSystemPrompt extends HTMLElement {

    connectedCallback() {
        if (this._initialised) return;
        this._initialised = true;
        this._render();
        this._listenForPrompt();
    }

    _bus() {
        return this.closest('[data-llm-bus]');
    }

    _render() {
        this.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;';

        const toolbar = document.createElement('div');
        toolbar.style.cssText = [
            'display:flex;align-items:center;gap:8px;',
            'padding:6px 10px;',
            'background:var(--color-background-secondary,#0d0d1a);',
            'border-bottom:1px solid var(--color-border-subtle,#1a1a3a);',
            'flex-shrink:0;',
        ].join('');

        const label = document.createElement('span');
        label.textContent = 'SYSTEM PROMPT';
        label.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-muted,#4a5568);font-family:system-ui,sans-serif;flex:1;';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Apply';
        saveBtn.style.cssText = [
            'font-size:11px;padding:3px 10px;border-radius:4px;',
            'border:1px solid var(--color-border-subtle,#1a1a3a);',
            'background:var(--color-background-primary,#0a0a18);',
            'color:var(--color-text-secondary,#a0aec0);',
            'cursor:pointer;font-family:system-ui,sans-serif;',
        ].join('');

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.style.cssText = saveBtn.style.cssText;

        toolbar.appendChild(label);
        toolbar.appendChild(resetBtn);
        toolbar.appendChild(saveBtn);

        const textarea = document.createElement('textarea');
        textarea.placeholder = 'System prompt loading…';
        textarea.spellcheck = false;
        textarea.style.cssText = [
            'flex:1;min-height:0;width:100%;box-sizing:border-box;',
            'background:var(--color-background-primary,#0a0a18);',
            'color:var(--color-text-primary,#e2e8f0);',
            'font-family:"SF Mono",Monaco,monospace;font-size:12px;line-height:1.6;',
            'padding:10px 12px;',
            'border:none;outline:none;resize:none;',
        ].join('');

        this._textarea = textarea;
        this._original = '';

        saveBtn.addEventListener('click', () => this._apply());
        resetBtn.addEventListener('click', () => {
            textarea.value = this._original;
        });

        this.appendChild(toolbar);
        this.appendChild(textarea);
    }

    _listenForPrompt() {
        const bus = this._bus();
        if (!bus) return;
        bus.addEventListener('llm:system-prompt', (e) => {
            const text = e.detail?.content ?? '';
            this._original = text;
            this._textarea.value = text;
        });
    }

    _apply() {
        const bus = this._bus();
        if (!bus) return;
        const content = this._textarea.value;
        this._original = content;
        bus.dispatchEvent(new CustomEvent('llm:system-prompt', {
            detail: { content },
            bubbles: false, composed: false,
        }));
    }
}

customElements.define('aw-system-prompt', AwSystemPrompt);
