/**
 * ui-shell — assembles the audio-transcribe page with sg-layout.
 *
 * Structure (host = #audio-transcribe-root, a flex column):
 *   slim header (title + version)
 *   toolArea → <sg-layout> row:
 *       left stack  (40%): 🎙 Source · 🎚 Model & Cost · 📦 Bundle & Send
 *       right stack (60%): 📋 Queue
 *   bottom JS-API dev panel (footer bar + collapsible Skills/Explorer/Console/Manifest)
 *
 * The <sg-llm-request> engine the api entry appended to the host is preserved
 * (the host carries [data-llm-bus]); the cost view (<sg-openrouter-key-stats>)
 * lives inside the Model panel — a light-DOM (slotted) descendant of the host,
 * so it resolves the same bus and reacts to the `llm:connected` event.
 *
 * @module audio-transcribe/ui-shell
 */

import { mountSource } from './ui-source.js';
import { mountQueue } from './ui-queue.js';
import { mountModel } from './ui-model.js';
import { mountBundle } from './ui-bundle.js';
import { buildDevPanel } from '../dev-panel.js';

const PANEL_BASE = 'height:100%;overflow:hidden;display:flex;flex-direction:column;min-height:0;background:#0a0a18;box-sizing:border-box;';

/** Create a padded, scrollable mount wrapper inside a layout panel. */
function panelScroll(panelEl) {
    panelEl.style.cssText = PANEL_BASE;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:14px 16px;box-sizing:border-box;';
    panelEl.appendChild(wrap);
    return wrap;
}

/**
 * Mount the tool shell into a host element.
 * @param {{ host: HTMLElement, state: object, api: object, devPanel?: boolean }} opts
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function mountShell({ host, state, api, devPanel = true }) {
    if (!host) return { destroy() {} };

    // Preserve the <sg-llm-request> engine the api entry appended to the host.
    const engine = host.querySelector('sg-llm-request');
    host.innerHTML = '';
    // Fill the space below the site header (the body is a flex column).
    host.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
    if (engine) { engine.style.display = 'none'; host.appendChild(engine); }

    const v = (api && api._version) || {};
    const header = document.createElement('header');
    header.className = 'at-topbar';
    header.style.cssText = 'flex-shrink:0;padding:10px 16px 8px;';
    header.innerHTML = `
        <h1 style="margin:0;font-size:1.15rem;color:#f1f5f9;">Audio Transcribe ${v.api ? `<span class="at-version" title="tool version">v${v.api}</span>` : ''}</h1>
        <p class="at-subtitle" style="margin:2px 0 0;">Record or drop many audio files (incl. WhatsApp <code>.opus</code>) and transcribe each via curated OpenRouter models — in your browser.</p>
    `;
    host.appendChild(header);

    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;';
    host.appendChild(toolArea);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    // setLayout() is synchronous: it renders the tree, mounts every tab, then
    // emits LAYOUT_READY. Do NOT await LAYOUT_READY before calling it — the
    // element already fired that event from connectedCallback during appendChild,
    // so awaiting here hangs forever (the layout never builds). Call setLayout,
    // then read the panel elements synchronously.
    layout.setLayout({
        type: 'row', id: 'main', sizes: [0.4, 0.6],
        children: [
            {
                type: 'stack', id: 's-left', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-source', title: '🎙 Source',       tag: 'div', locked: true, closable: false },
                    { type: 'tab', id: 't-model',  title: '🎚 Model & Cost',  tag: 'div', locked: true, closable: false },
                    { type: 'tab', id: 't-bundle', title: '📦 Bundle & Send', tag: 'div', locked: true, closable: false },
                ],
            },
            {
                type: 'stack', id: 's-right', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-queue', title: '📋 Queue', tag: 'div', locked: true, closable: false },
                ],
            },
        ],
    });

    const sourceWrap = panelScroll(layout.getPanelElement('t-source'));
    const modelWrap  = panelScroll(layout.getPanelElement('t-model'));
    const bundleWrap = panelScroll(layout.getPanelElement('t-bundle'));
    const queueWrap  = panelScroll(layout.getPanelElement('t-queue'));

    // Model panel: the model/key controls, then the cost view below them.
    const modelMount = document.createElement('div');
    modelWrap.appendChild(modelMount);

    const costSection = document.createElement('section');
    costSection.className = 'at-panel at-cost';
    costSection.style.cssText = 'margin-top:18px;';
    costSection.innerHTML = `<h2 class="at-panel__title">OpenRouter usage &amp; cost</h2>
        <p class="at-cost__hint" style="color:#94a3b8;font-size:0.8rem;margin:0 0 8px;">Live from your key once connected — usage, limit and remaining credit.</p>`;
    const keyStats = document.createElement('sg-openrouter-key-stats');
    keyStats.style.cssText = 'display:block;';
    costSection.appendChild(keyStats);
    modelWrap.appendChild(costSection);

    const m = [
        mountSource({ root: sourceWrap, state, api }),
        mountModel({ root: modelMount, state, api }),
        mountBundle({ root: bundleWrap, state, api }),
        mountQueue({ root: queueWrap, state, api }),
    ];

    if (devPanel) buildDevPanel(host);

    return {
        destroy() { m.forEach((x) => x && x.destroy && x.destroy()); host.innerHTML = ''; },
    };
}
