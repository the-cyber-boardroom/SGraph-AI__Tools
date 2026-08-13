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
        <div class="wa-account wa-account--bridge">
          <span id="wa-acc-bridge-chip" class="wa-chip">○ Bridge (companion)</span>
          <div class="wa-muted">⚠️ Unofficial companion link (like an iPad). <b>Expendable number only</b> — ban risk is on that number, never your phone apps. See <code>whatsapp_bridge/README.md</code>.</div>
          <div class="wa-row">
            <input id="wa-acc-bridge-url"   class="wa-input" type="text" placeholder="http://127.0.0.1:8787" autocomplete="off">
            <input id="wa-acc-bridge-token" class="wa-input" type="password" placeholder="Bridge token" autocomplete="off">
          </div>
          <div class="wa-row">
            <button id="wa-acc-bridge-save"    class="wa-btn wa-btn--mini">Save</button>
            <button id="wa-acc-bridge-connect" class="wa-btn wa-btn--mini">Connect (Bridge)</button>
            <span id="wa-acc-bridge-status" class="wa-muted"></span>
          </div>
          <div id="wa-acc-bridge-qr" class="wa-muted" hidden></div>
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
        const bridgeChip = $('#wa-acc-bridge-chip');
        const bridgeOn = state.connected && state.mode === 'bridge';
        bridgeChip.textContent = bridgeOn ? `● Bridge${state.verifiedName ? ` · ${state.verifiedName}` : ''}` : (c.bridgeUrl ? '◐ Bridge (saved)' : '○ Bridge (companion)');
        bridgeChip.classList.toggle('wa-chip--on', bridgeOn);
        if (c.bridgeUrl) $('#wa-acc-bridge-url').placeholder = c.bridgeUrl;
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

    $('#wa-acc-bridge-save').addEventListener('click', async () => {
        await api.setCreds({
            bridgeUrl: $('#wa-acc-bridge-url').value.trim() || undefined,
            bridgeToken: $('#wa-acc-bridge-token').value.trim() || undefined,
        });
        $('#wa-acc-bridge-token').value = '';
        refresh();
    });

    const bridgeQr = $('#wa-acc-bridge-qr');
    const bridgeStatusEl = $('#wa-acc-bridge-status');
    $('#wa-acc-bridge-connect').addEventListener('click', async () => {
        bridgeStatusEl.textContent = 'connecting…';
        try {
            const r = await api.connectBridge();
            if (r.linked) { bridgeStatusEl.textContent = `linked${r.me?.id ? ` · ${r.me.id}` : ''}`; bridgeQr.hidden = true; }
            else {
                bridgeStatusEl.textContent = 'scan the QR in the terminal running the bridge';
                bridgeQr.hidden = false;
                bridgeQr.textContent = 'The bridge process prints the QR — scan it with WhatsApp → Linked Devices. Re-click Connect once linked.';
            }
        } catch (err) { bridgeStatusEl.textContent = err.message; }
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
