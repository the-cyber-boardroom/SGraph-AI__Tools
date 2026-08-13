/**
 * ui-accounts.js
 * Accounts panel — WhatsApp Cloud API creds, relay, OpenRouter key.
 * Same chip pattern as the publisher; secrets never echoed back.
 * @module ui-accounts
 */

import { WA_EVENTS } from '/core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-events.js';
import { maskedCreds } from '../api/wa-pipeline.js';
import { getOpenRouterKey } from '../api/wa-voice.js';

export function initAccounts(container, state, api, emit) {
    if (!container) return;
    container.innerHTML = `
      <div class="wa-accounts">
        <div class="wa-account">
          <span id="wa-acc-meta-chip" class="wa-chip">○ WhatsApp Cloud API</span>
          <input id="wa-acc-token"   class="wa-input" type="password" placeholder="System-user token" autocomplete="off">
          <div class="wa-row">
            <input id="wa-acc-phone" class="wa-input" type="text" placeholder="Phone-number ID" autocomplete="off">
            <input id="wa-acc-waba"  class="wa-input" type="text" placeholder="WABA ID" autocomplete="off">
          </div>
          <div class="wa-row">
            <button id="wa-acc-save"    class="wa-btn wa-btn--mini">Save</button>
            <button id="wa-acc-connect" class="wa-btn wa-btn--mini">Connect</button>
            <span id="wa-acc-status" class="wa-muted"></span>
          </div>
        </div>
        <div class="wa-account">
          <span id="wa-acc-relay-chip" class="wa-chip">○ Relay</span>
          <div class="wa-row">
            <input id="wa-acc-relay-url"   class="wa-input" type="text" placeholder="https://…workers.dev" autocomplete="off">
            <input id="wa-acc-relay-token" class="wa-input" type="password" placeholder="Relay token" autocomplete="off">
            <button id="wa-acc-relay-save" class="wa-btn wa-btn--mini">Save</button>
          </div>
          <div class="wa-muted">Deploy: see <code>whatsapp_relay/README.md</code>. Inbound needs it; outbound doesn't.</div>
        </div>
        <div class="wa-account">
          <span id="wa-acc-or-chip" class="wa-chip">○ OpenRouter</span>
          <div class="wa-row">
            <input id="wa-acc-or-key" class="wa-input" type="password" placeholder="sk-or-…" autocomplete="off">
            <button id="wa-acc-or-save" class="wa-btn wa-btn--mini">Save</button>
          </div>
          <div class="wa-muted">Voice-note transcription + drafted replies. Shared with Audio Transcribe / Video Publisher.</div>
        </div>
      </div>`;

    const $ = s => container.querySelector(s);
    const statusEl = $('#wa-acc-status');

    function refresh() {
        const c = maskedCreds();
        const metaChip = $('#wa-acc-meta-chip');
        metaChip.textContent = state.connected
            ? `● ${state.verifiedName || 'Connected'}${state.demo ? ' (demo)' : ''}`
            : c.tokenSet ? '◐ WhatsApp (saved — Connect)' : '○ WhatsApp Cloud API';
        metaChip.classList.toggle('wa-chip--on', state.connected);
        if (c.phoneNumberId) $('#wa-acc-phone').placeholder = c.phoneNumberId;
        if (c.wabaId)        $('#wa-acc-waba').placeholder = c.wabaId;
        const relayChip = $('#wa-acc-relay-chip');
        relayChip.textContent = state.relayOk ? '● Relay' : (c.relayUrl ? '◐ Relay (saved)' : '○ Relay');
        relayChip.classList.toggle('wa-chip--on', state.relayOk);
        if (c.relayUrl) $('#wa-acc-relay-url').placeholder = c.relayUrl;
        const orChip = $('#wa-acc-or-chip');
        const hasKey = !!getOpenRouterKey();
        orChip.textContent = hasKey ? '● OpenRouter' : '○ OpenRouter';
        orChip.classList.toggle('wa-chip--on', hasKey);
    }

    $('#wa-acc-save').addEventListener('click', async () => {
        await api.setCreds({
            token: $('#wa-acc-token').value.trim() || undefined,
            phoneNumberId: $('#wa-acc-phone').value.trim() || undefined,
            wabaId: $('#wa-acc-waba').value.trim() || undefined,
        });
        $('#wa-acc-token').value = '';
        refresh();
    });

    $('#wa-acc-connect').addEventListener('click', async () => {
        statusEl.textContent = 'connecting…';
        try {
            const r = await api.connect();
            statusEl.textContent = `${r.displayNumber ?? 'connected'}${r.relay ? ' · relay live' : ' · no relay'}`;
        } catch (err) { statusEl.textContent = err.message; }
        refresh();
    });

    $('#wa-acc-relay-save').addEventListener('click', async () => {
        await api.setCreds({
            relayUrl: $('#wa-acc-relay-url').value.trim() || undefined,
            relayToken: $('#wa-acc-relay-token').value.trim() || undefined,
        });
        $('#wa-acc-relay-token').value = '';
        refresh();
    });

    $('#wa-acc-or-save').addEventListener('click', async () => {
        await api.setOpenRouterKey({ apiKey: $('#wa-acc-or-key').value.trim() });
        $('#wa-acc-or-key').value = '';
        refresh();
    });

    for (const ev of [WA_EVENTS.CONNECTED, WA_EVENTS.DISCONNECTED, WA_EVENTS.SYNC]) window.addEventListener(ev, refresh);
    refresh();
}
