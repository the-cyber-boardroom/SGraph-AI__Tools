/**
 * ui-shell.js
 * Layout: left column (Conversations | Accounts) — right stack of per-chat
 * tabs (the youtube-editor per-video pattern). Chat tabs open on selection
 * or via the openConversation action.
 * @module ui-shell
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { initConversations } from './ui-conversations.js';
import { initChatTab } from './ui-chat-tab.js';
import { initAccounts } from './ui-accounts.js';
import { initApiPane } from './ui-api-pane.js';

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/sg-conversation-list/v0/v0.1/v0.1.0/sg-conversation-list.js';
import '/components/sg-chat-thread/v0/v0.1/v0.1.0/sg-chat-thread.js';
import '/components/sg-chat-composer/v0/v0.1/v0.1.0/sg-chat-composer.js';
import '/components/upload-dropzone/v1/v1.0/v1.0.0/sg-upload-dropzone.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

export async function init(state, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(toolArea);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    layout.setLayout({
        type: 'row', id: 'root', sizes: [0.32, 0.68],
        children: [
            {
                type: 'column', id: 'c-left', sizes: [0.62, 0.38],
                children: [
                    { type: 'stack', id: 's-convs', activeTab: 0,
                      tabs: [{ type: 'tab', id: 't-convs', title: '💬 Conversations', tag: 'div', locked: true, closable: false }] },
                    { type: 'stack', id: 's-accounts', activeTab: 0,
                      tabs: [{ type: 'tab', id: 't-accounts', title: '🔑 Accounts', tag: 'div', locked: true, closable: false }] },
                ],
            },
            {
                type: 'stack', id: 's-chats', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-welcome', title: '👋 Start', tag: 'div', locked: true, closable: false }],
            },
        ],
    });
    await layoutReady;

    const panel = id => {
        const el = layout.getPanelElement(id);
        if (el) el.style.cssText = 'height:100%;overflow-y:auto;padding:12px;box-sizing:border-box;';
        return el;
    };

    initConversations(panel('t-convs'), state, api, emit);
    initAccounts(panel('t-accounts'), state, api, emit);
    initApiPane(wrap, api);

    const welcome = panel('t-welcome');
    welcome.innerHTML = `
      <div class="wa-welcome">
        <h3>WhatsApp Desk</h3>
        <p class="wa-muted">Connect the Voice Debrief number in <b>Accounts</b>, or explore with demo data.</p>
        <button id="wa-demo-btn" class="wa-btn">🧪 Load demo conversations</button>
        <p class="wa-muted">Sends are blocked in demo mode; everything else works — including voice-note transcription (bring your OpenRouter key).</p>
      </div>`;
    welcome.querySelector('#wa-demo-btn').addEventListener('click', () => api.loadDemo());

    // ── Per-conversation tabs ────────────────────────────────────────────────
    const openTabs = new Map();   // conversationId → tabId

    function openConversation(conversationId) {
        const conv = state.conversations.get(conversationId);
        if (!conv) return;
        if (openTabs.has(conversationId)) { layout.focusPanel(openTabs.get(conversationId)); return; }
        // addTabToStack generates and returns the tab id (a passed id is ignored).
        const tabId = layout.addTabToStack('s-chats', {
            title: `💬 ${(conv.name || conversationId).slice(0, 18)}`,
            tag: 'div',
        });
        if (!tabId) return;
        openTabs.set(conversationId, tabId);
        const el = layout.getPanelElement(tabId);
        if (el) {
            el.style.cssText = 'height:100%;overflow:hidden;padding:0;box-sizing:border-box;';
            initChatTab(el, conversationId, state, api, emit);
        }
        api.markRead?.({ conversationId, messageId: conv.messages.at(-1)?.id }).catch(() => {});
    }

    window.addEventListener('wa-desk:open-conversation', e => openConversation(e.detail?.conversationId));
    layout.events.on(SGL_EVENTS.PANEL_CLOSED, e => {
        for (const [cid, tid] of openTabs) if (tid === (e?.id ?? e?.detail?.id)) openTabs.delete(cid);
    });
    window.addEventListener(WA_EVENTS.DISCONNECTED, () => {
        for (const [, tid] of openTabs) { try { layout.closePanel?.(tid); } catch (_e) { /* left open */ } }
        openTabs.clear();
    });
}
