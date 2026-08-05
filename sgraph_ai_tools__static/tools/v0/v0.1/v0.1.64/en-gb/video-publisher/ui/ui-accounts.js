/**
 * ui-accounts.js
 * One Accounts panel for the pipeline's credentials (Decision 5) — the exact
 * storage keys the existing tools use, so nothing needs re-entering:
 *   OpenRouter key  → localStorage 'sg-openrouter-mgmt-key' (audio-transcribe)
 *   YouTube client  → localStorage 'sg-youtube-client-id'   (youtube-editor)
 * @module ui-accounts
 */

import { VP_EVENTS } from '../api/publisher-events.js';
import { getApiKey } from '../api/publisher-pipeline.js';
import { getClientId, DEFAULT_CLIENT_ID } from '../api/publisher-youtube.js';

export function initAccounts(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="vp-accounts">
        <div class="vp-account">
          <span id="vp-acc-or-chip" class="vp-chip">○ OpenRouter</span>
          <div class="vp-row">
            <input id="vp-acc-or-key" class="vp-input" type="password" placeholder="sk-or-…" autocomplete="off">
            <button id="vp-acc-or-save" class="vp-btn vp-btn--mini">Save</button>
          </div>
          <div id="vp-acc-or-bus" data-llm-bus>
            <sg-openrouter-key-stats id="vp-acc-or-stats"></sg-openrouter-key-stats>
          </div>
        </div>
        <div class="vp-account">
          <span id="vp-acc-yt-chip" class="vp-chip">○ YouTube</span>
          <div class="vp-row">
            <input id="vp-acc-yt-cid" class="vp-input" type="text" placeholder="Google OAuth client ID" autocomplete="off">
            <button id="vp-acc-yt-save" class="vp-btn vp-btn--mini">Save</button>
          </div>
          <div class="vp-muted">Shared with YouTube Editor. Sign in from the Publish tab.</div>
        </div>
      </div>`;

    const $ = s => container.querySelector(s);
    const orChip = $('#vp-acc-or-chip'), ytChip = $('#vp-acc-yt-chip');
    const keyEl = $('#vp-acc-or-key'), cidEl = $('#vp-acc-yt-cid');

    const orBus = $('#vp-acc-or-bus');
    function feedKeyStats() {
        const apiKey = getApiKey();
        if (apiKey) orBus.dispatchEvent(new CustomEvent('llm:connected', {
            detail: { provider: 'openrouter', apiKey }, bubbles: false,
        }));
    }

    function refresh() {
        const hasKey = !!getApiKey();
        orChip.textContent = hasKey ? '● OpenRouter' : '○ OpenRouter';
        orChip.classList.toggle('vp-chip--on', hasKey);
        ytChip.textContent = state.youtube.connected ? '● YouTube' : '○ YouTube';
        ytChip.classList.toggle('vp-chip--on', state.youtube.connected);
        if (!keyEl.value && hasKey) keyEl.placeholder = '•••••••• (saved)';
        if (!cidEl.value) {
            const cid = getClientId();
            cidEl.placeholder = cid === DEFAULT_CLIENT_ID ? 'default (tools.sgraph.ai)' : cid;
        }
    }

    $('#vp-acc-or-save').addEventListener('click', async () => {
        await api.setApiKey({ apiKey: keyEl.value.trim() });
        keyEl.value = '';
        refresh();
        feedKeyStats();
    });
    $('#vp-acc-yt-save').addEventListener('click', async () => {
        await api.setClientId({ clientId: cidEl.value.trim() });
        cidEl.value = '';
        refresh();
    });

    for (const ev of [VP_EVENTS.YT_CONNECTED, VP_EVENTS.YT_DISCONNECTED]) window.addEventListener(ev, refresh);
    refresh();
    feedKeyStats();
}
