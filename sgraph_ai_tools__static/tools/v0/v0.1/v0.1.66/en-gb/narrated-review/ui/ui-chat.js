/**
 * ui-chat.js
 * Two conversations in one panel:
 *   "This capture" — scoped to the selected pair (its screenshot, raw, analysis, notes).
 *   "Whole review" — has tools, so it can change the artefact and reports what it changed.
 * @module ui-chat
 */

import { renderMarkdown } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js';

export function initChat(el, state, api) {
    if (!el) return;
    el.innerHTML = `<div class="nr-chat">
        <div class="nr-chat__scope">
          <label><input type="radio" name="nr-scope" value="pair" checked> This capture</label>
          <label><input type="radio" name="nr-scope" value="session"> Whole review (can edit)</label>
          <span id="nr-chat-target" class="nr-muted"></span>
        </div>
        <div id="nr-chat-log" class="nr-chat__log"></div>
        <div class="nr-chat__row">
          <textarea id="nr-chat-input" rows="2" placeholder="Ask about this capture…"></textarea>
          <button id="nr-chat-send" class="nr-btn nr-btn--primary">Send</button>
        </div>
        <div id="nr-chat-status" class="nr-muted"></div>
      </div>`;

    const q = s => el.querySelector(s);
    const log = q('#nr-chat-log');
    let currentId = null;

    function scope() {
        const r = el.querySelector('input[name="nr-scope"]:checked');
        return r ? r.value : 'pair';
    }
    function refreshTarget() {
        const s = scope();
        q('#nr-chat-target').textContent = s === 'pair'
            ? (currentId ? `→ ${currentId}` : '→ select a capture in Pairs')
            : `→ ${state.pairs.length} captures, tools enabled`;
        q('#nr-chat-input').placeholder = s === 'pair'
            ? 'Ask about this capture…'
            : 'e.g. "add a note to capture 2 about the naming", "move capture 3 to the front"';
    }
    for (const r of el.querySelectorAll('input[name="nr-scope"]')) r.addEventListener('change', refreshTarget);
    window.addEventListener('nr:ui:select-pair', e => { currentId = e.detail.id; refreshTarget(); });
    window.addEventListener('nr:reset', () => { currentId = null; log.innerHTML = ''; refreshTarget(); });
    refreshTarget();

    function bubble(who, text, cls = '') {
        const d = document.createElement('div');
        d.className = `nr-chat__msg nr-chat__msg--${who} ${cls}`;
        d.innerHTML = who === 'you' ? `<b>You</b><div></div>` : `<b>Assistant</b><div></div>`;
        d.lastChild.innerHTML = who === 'you'
            ? String(text).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
            : renderMarkdown(String(text));
        log.appendChild(d);
        log.scrollTop = log.scrollHeight;
        return d;
    }

    async function send() {
        const text = q('#nr-chat-input').value.trim();
        if (!text) return;
        const s = scope();
        if (s === 'pair' && !currentId) { q('#nr-chat-status').textContent = 'Select a capture in the Pairs tab first.'; return; }
        q('#nr-chat-input').value = '';
        bubble('you', text);
        q('#nr-chat-send').disabled = true;
        q('#nr-chat-status').textContent = 'thinking…';
        try {
            const r = s === 'pair'
                ? await api.askPair({ id: currentId, text })
                : await api.askSession({ text });
            bubble('bot', r.text || '(no answer)');
            const cost = typeof r.costUsd === 'number' ? ` · $${r.costUsd.toFixed(4)}` : '';
            if (s === 'session' && r.changes && r.changes.length) {
                q('#nr-chat-status').textContent = `changed ${r.changes.length} thing(s): ${r.changes.map(c => c.tool).join(', ')}${cost}`;
            } else {
                q('#nr-chat-status').textContent = `done${cost}`;
            }
        } catch (err) {
            bubble('bot', `**${err.code || 'error'}** — ${err.message}`, 'is-error');
            q('#nr-chat-status').textContent = '';
        } finally {
            q('#nr-chat-send').disabled = false;
        }
    }

    q('#nr-chat-send').addEventListener('click', send);
    q('#nr-chat-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    });
}
