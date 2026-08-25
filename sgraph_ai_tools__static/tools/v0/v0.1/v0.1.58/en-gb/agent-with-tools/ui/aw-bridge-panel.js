/**
 * aw-bridge-panel — Thin custom element wrapping the Bridge info panel
 * inside an sg-layout tab. Wires bus events the same way as ui-shell.
 *
 * @module aw-bridge-panel
 * @version 0.1.58
 */

export class AwBridgePanel extends HTMLElement {

    connectedCallback() {
        if (this._initialised) return;
        this._initialised = true;
        this.style.cssText = 'display:block;height:100%;overflow:auto;';
        this._render();
        this._wireBus();
    }

    _render() {
        const bus    = this._getBus();
        const bridge = bus?.querySelector('sg-local-bridge');
        const ep     = bridge?.getAttribute('endpoint')  || 'http://localhost:8000';
        const ws     = bridge?.getAttribute('workspace') || '/workspace';

        this.innerHTML = `
            <div class="aw-panel">
                <div class="panel-label">Bridge</div>
                <div class="panel-row"><span class="panel-key">Endpoint</span><span class="panel-val" id="abp-ep">${_esc(ep)}</span></div>
                <div class="panel-row"><span class="panel-key">Workspace</span><span class="panel-val" id="abp-ws">${_esc(ws)}</span></div>
                <div class="panel-row"><span class="panel-key">Version</span><span class="panel-val" id="abp-ver">—</span></div>
                <div class="panel-row"><span class="panel-key">Latency</span><span class="panel-val" id="abp-lat">—</span></div>
                <div class="panel-row"><span class="panel-key">Last call</span><span class="panel-val" id="abp-call">—</span></div>
            </div>`;
    }

    _wireBus() {
        const bus = this._getBus();
        if (!bus) return;

        bus.addEventListener('sg-local-bridge:status', (e) => {
            this._setText('abp-ver', `v${e.detail.version}`);
            this._setText('abp-lat', `${e.detail.latency_ms} ms`);
        });

        bus.addEventListener('sg-local-bridge:tool-call', (e) => {
            this._setText('abp-call', `${e.detail.name} (${e.detail.ms}ms)`);
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

customElements.define('aw-bridge-panel', AwBridgePanel);

function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
