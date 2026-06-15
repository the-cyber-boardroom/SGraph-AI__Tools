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

import { SGL_EVENTS } from '../../../../../../../core/sg-layout/v0.1.0/sg-layout-events.js';
import { mountSource } from './ui-source.js';
import { mountQueue } from './ui-queue.js';
import { mountModel } from './ui-model.js';
import { mountBundle } from './ui-bundle.js';
import { mountItemPanel } from './ui-item-panel.js';
import { mountTts } from './ui-tts.js';
import { mountChat } from './ui-chat.js';
import { mountDebug } from './ui-debug.js';
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
export async function mountShell({ host, state, api, devPanel = true, getRecordingStream }) {
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
                    { type: 'tab', id: 't-source', title: '🎙 Source',       tag: 'div', locked: false, closable: false },
                    { type: 'tab', id: 't-tts',    title: '🗣 Voice',        tag: 'div', locked: false, closable: false },
                    { type: 'tab', id: 't-model',  title: '🎚 Model & Cost',  tag: 'div', locked: false, closable: false },
                    { type: 'tab', id: 't-bundle', title: '📦 Bundle & Send', tag: 'div', locked: false, closable: false },
                ],
            },
            {
                type: 'stack', id: 's-right', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-queue', title: '📋 Queue', tag: 'div', locked: false, closable: false },
                    { type: 'tab', id: 't-chat',  title: '💬 Chat',  tag: 'div', locked: false, closable: false },
                    { type: 'tab', id: 't-debug', title: '🔎 Debug', tag: 'div', locked: false, closable: false },
                ],
            },
        ],
    });

    const sourceWrap = panelScroll(layout.getPanelElement('t-source'));
    const ttsWrap    = panelScroll(layout.getPanelElement('t-tts'));
    const modelWrap  = panelScroll(layout.getPanelElement('t-model'));
    const bundleWrap = panelScroll(layout.getPanelElement('t-bundle'));
    const queueWrap  = panelScroll(layout.getPanelElement('t-queue'));
    const chatWrap   = panelScroll(layout.getPanelElement('t-chat'));
    const debugWrap  = panelScroll(layout.getPanelElement('t-debug'));

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
    const sessionCost = document.createElement('div');
    sessionCost.className = 'at-session-cost';
    costSection.appendChild(sessionCost);
    modelWrap.appendChild(costSection);

    // This-session spend = sum of every transcription cost across all audio files.
    function renderSessionCost() {
        let usd = 0; let pending = false; let n = 0;
        for (const it of state.getItems()) for (const v of (it.versions || [])) {
            n += 1;
            if (typeof v.costUsd === 'number') usd += v.costUsd;
            if (v.costPending) pending = true;
        }
        sessionCost.textContent = n ? `This session: 💰 $${usd.toFixed(4)}${pending ? '…' : ''} over ${n} transcription${n === 1 ? '' : 's'}` : '';
    }
    const onStateForCost = () => renderSessionCost();
    state.addEventListener('change', onStateForCost);
    renderSessionCost();

    // Per-recording detail tabs: clicking a Queue row's "Open" spawns (or focuses)
    // a closable tab in the right stack with the audio player + re-transcribe.
    const openTabs = new Map();   // itemId -> tabId
    const openMounts = new Map(); // itemId -> { destroy }

    function openItem(itemId) {
        if (!state.getItem(itemId)) return;
        if (openTabs.has(itemId)) { layout.focusPanel(openTabs.get(itemId)); return; }
        const name = state.getItem(itemId).name || 'audio';
        const title = `🎧 ${name.length > 16 ? name.slice(0, 15) + '…' : name}`;
        const tabId = layout.addTabToStack('s-right', { tag: 'div', title, closable: true });
        openTabs.set(itemId, tabId);
        const wrap = panelScroll(layout.getPanelElement(tabId));
        openMounts.set(itemId, mountItemPanel({ root: wrap, id: itemId, state, api }));
        layout.focusPanel(tabId);
    }

    // Clean up a per-item panel when its tab is closed.
    layout.events.on(SGL_EVENTS.PANEL_CLOSED, (d) => {
        const tabId = d && d.id; if (!tabId) return;
        for (const [itemId, tid] of openTabs) {
            if (tid === tabId) {
                const mnt = openMounts.get(itemId);
                if (mnt && mnt.destroy) mnt.destroy();
                openMounts.delete(itemId); openTabs.delete(itemId);
                break;
            }
        }
    });

    const m = [
        mountSource({ root: sourceWrap, state, api, getRecordingStream }),
        mountTts({ root: ttsWrap, api }),
        mountModel({ root: modelMount, state, api }),
        mountBundle({ root: bundleWrap, state, api }),
        mountQueue({ root: queueWrap, state, api, openItem }),
        mountChat({ root: chatWrap, getContext: () => state.getItems()
            .filter((i) => i.status === 'done' && i.transcript)
            .map((it, i) => `### Transcript ${i + 1} — ${it.name}\n${it.transcript}`).join('\n\n') }),
        mountDebug({ root: debugWrap, api }),
    ];

    if (devPanel) buildDevPanel(host);

    return {
        destroy() {
            state.removeEventListener('change', onStateForCost);
            for (const mnt of openMounts.values()) if (mnt && mnt.destroy) mnt.destroy();
            m.forEach((x) => x && x.destroy && x.destroy());
            host.innerHTML = '';
        },
    };
}
