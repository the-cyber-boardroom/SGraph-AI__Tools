/**
 * ui-conversations.js
 * Conversations panel — <sg-conversation-list> adapter + a manual sync
 * button with last-sync status.
 * @module ui-conversations
 */

import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { conversationRows } from '../api/wa-state.js';

export function initConversations(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="wa-convs">
        <div class="wa-row">
          <button id="wa-sync" class="wa-btn wa-btn--mini">↻ Sync</button>
          <span id="wa-sync-status" class="wa-muted"></span>
        </div>
        <sg-conversation-list id="wa-conv-list"></sg-conversation-list>
      </div>`;

    const list = container.querySelector('#wa-conv-list');
    const statusEl = container.querySelector('#wa-sync-status');

    function render() { list.whenReady?.().then(() => list.setConversations(conversationRows())).catch(() => {}); }

    container.querySelector('#wa-sync').addEventListener('click', async () => {
        statusEl.textContent = 'syncing…';
        try {
            const r = await api.syncInbound();
            statusEl.textContent = `${r.newMessages} new`;
        } catch (err) { statusEl.textContent = err.message; }
    });

    list.addEventListener('sg-conversation-list:select', e => {
        const id = e.detail?.id;
        if (!id) return;
        list.setActive(id);
        window.dispatchEvent(new CustomEvent('wa-desk:open-conversation', { detail: { conversationId: id } }));
    });

    for (const ev of [WA_EVENTS.SYNC, WA_EVENTS.MESSAGE_IN, WA_EVENTS.MESSAGE_OUT,
                      WA_EVENTS.WINDOW_CHANGED, WA_EVENTS.CONNECTED, WA_EVENTS.DISCONNECTED]) {
        window.addEventListener(ev, render);
    }
    render();
}
