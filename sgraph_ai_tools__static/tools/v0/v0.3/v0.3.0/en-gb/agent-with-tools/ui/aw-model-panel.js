/**
 * aw-model-panel — Thin custom element wrapping the Model info panel
 * inside an sg-layout tab. Wires bus events the same way as ui-shell.
 *
 * @module aw-model-panel
 * @version 0.1.58
 */

export class AwModelPanel extends HTMLElement {

    connectedCallback() {
        if (this._initialised) return;
        this._initialised = true;
        this.style.cssText = 'display:block;height:100%;overflow:auto;';
        this._render();
        this._wireBus();
    }

    _render() {
        const bus      = this._getBus();
        const req      = bus?.querySelector('sg-llm-request');
        const provider = req?.getAttribute('provider') || 'ollama';
        const model    = req?.getAttribute('model')    || 'qwen2.5-coder:7b';

        this.innerHTML = `
            <div class="aw-panel">
                <div class="panel-label">Model</div>
                <div class="panel-row"><span class="panel-key">Provider</span><span class="panel-val" id="amp-prov">${_esc(provider)}</span></div>
                <div class="panel-row"><span class="panel-key">Model</span><span class="panel-val" id="amp-model">${_esc(model)}</span></div>
                <div class="panel-row"><span class="panel-key">Endpoint</span><span class="panel-val" id="amp-ep">localhost:11434</span></div>
                <div class="panel-row"><span class="panel-key">Streaming</span><span class="panel-val" id="amp-stream">✓</span></div>
                <div class="panel-row"><span class="panel-key">Speed</span><span class="panel-val" id="amp-speed">—</span></div>
            </div>`;

        if (req) {
            const obs = new MutationObserver(() => {
                this._setText('amp-prov',  req.getAttribute('provider') || 'ollama');
                this._setText('amp-model', req.getAttribute('model')    || '');
            });
            obs.observe(req, { attributes: true, attributeFilter: ['provider', 'model'] });
        }
    }

    _wireBus() {
        const bus = this._getBus();
        if (!bus) return;

        bus.addEventListener('llm:stats', (e) => {
            const tps = e.detail?.tokens_per_second;
            if (tps != null) this._setText('amp-speed', `${Math.round(tps)} tok/s`);
        });
    }

    _getBus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return null;
    }

    _setText(id, text) {
        const el = this.querySelector(`#${id}`);
        if (el) el.textContent = text;
    }
}

customElements.define('aw-model-panel', AwModelPanel);

function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
