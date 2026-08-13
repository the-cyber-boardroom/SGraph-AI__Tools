/**
 * ui-chat-tab.js
 * One conversation: <sg-chat-thread> + window chip + draft controls +
 * <sg-chat-composer>. Sends go through the API (which enforces the 24h
 * window client-side); drafts only ever fill the composer.
 * @module ui-chat-tab
 */

import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { getConversation, windowOpen } from '../api/wa-state.js';

export function initChatTab(container, conversationId, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="wa-chat">
        <div class="wa-chat__head">
          <span id="wa-chat-window" class="wa-chip"></span>
          <button id="wa-chat-draft" class="wa-btn wa-btn--mini">✨ Draft reply</button>
          <input id="wa-chat-guidance" class="wa-input wa-input--slim" type="text"
                 placeholder="guidance, e.g. “short, propose Tuesday”">
          <span id="wa-chat-status" class="wa-muted"></span>
        </div>
        <sg-chat-thread id="wa-chat-thread"></sg-chat-thread>
        <sg-chat-composer id="wa-chat-composer"></sg-chat-composer>
      </div>`;

    const thread   = container.querySelector('#wa-chat-thread');
    const composer = container.querySelector('#wa-chat-composer');
    const windowEl = container.querySelector('#wa-chat-window');
    const statusEl = container.querySelector('#wa-chat-status');

    function conv() { return getConversation(conversationId); }

    function renderWindowState() {
        const c = conv();
        if (!c) return;
        const open = windowOpen(c);
        composer.setAttribute('mode', open ? 'free' : 'template-only');
        if (!open) {
            composer.whenReady?.().then(() => {
                composer.setReason('24h window closed — WhatsApp allows approved templates only.');
                composer.setTemplates(state.templates);
            }).catch(() => {});
            api.listTemplates().then(t => composer.setTemplates(t)).catch(() => {});
        }
        const hoursLeft = open ? Math.max(1, Math.round((c.windowExpiresAt - Date.now()) / 3_600_000)) : 0;
        windowEl.textContent = open ? `⏱ window open · ~${hoursLeft}h left` : '📋 template-only';
        windowEl.classList.toggle('wa-chip--on', open);
    }

    function renderThread() {
        const c = conv();
        if (!c) return;
        thread.whenReady?.().then(() => thread.setMessages(c.messages)).catch(() => {});
    }

    composer.addEventListener('sg-chat-composer:send', async e => {
        const d = e.detail || {};
        statusEl.textContent = 'sending…';
        try {
            if (d.kind === 'template') await api.sendTemplate({ conversationId, name: d.name, lang: d.lang });
            else                       await api.sendText({ conversationId, body: d.body });
            statusEl.textContent = state.demo ? 'recorded (demo — nothing sent)' : '';
            renderThread();
        } catch (err) {
            statusEl.textContent = err.message;
            if (d.kind === 'text') composer.whenReady?.().then(() => composer.setDraft(d.body)).catch(() => {});
        }
    });

    thread.addEventListener('sg-chat-thread:transcribe-click', async e => {
        statusEl.textContent = 'transcribing…';
        try {
            const r = await api.transcribeVoiceNote({ messageId: e.detail.messageId });
            statusEl.textContent = r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : '';
            renderThread();
        } catch (err) { statusEl.textContent = err.message; }
    });

    thread.addEventListener('sg-chat-thread:media-click', e => {
        api.downloadMedia({ messageId: e.detail.messageId }).catch(err => { statusEl.textContent = err.message; });
    });

    container.querySelector('#wa-chat-draft').addEventListener('click', async () => {
        statusEl.textContent = 'drafting…';
        try {
            const guidance = container.querySelector('#wa-chat-guidance').value.trim() || undefined;
            const { draft, costUsd } = await api.draftReply({ conversationId, guidance });
            composer.whenReady?.().then(() => composer.setDraft(draft)).catch(() => {});
            statusEl.textContent = costUsd != null ? `draft ready · $${costUsd.toFixed(4)} — review, then Send` : 'draft ready — review, then Send';
        } catch (err) { statusEl.textContent = err.message; }
    });

    for (const ev of [WA_EVENTS.MESSAGE_IN, WA_EVENTS.MESSAGE_OUT, WA_EVENTS.RECEIPT, WA_EVENTS.TRANSCRIPT_COMPLETE]) {
        window.addEventListener(ev, e => {
            if (!e.detail?.conversationId || e.detail.conversationId === conversationId) { renderThread(); renderWindowState(); }
        });
    }
    window.addEventListener(WA_EVENTS.WINDOW_CHANGED, e => {
        if (e.detail?.conversationId === conversationId) renderWindowState();
    });

    renderThread();
    renderWindowState();
}
