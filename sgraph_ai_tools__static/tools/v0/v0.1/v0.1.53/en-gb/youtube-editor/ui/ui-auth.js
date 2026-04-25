/**
 * ui-auth.js
 * Left panel — client-id input, Connect/Sign-out, channel info card.
 * Handles SGA_YT.CONNECTED / DISCONNECTED / CHANNEL_LOADED.
 *
 * @module ui-auth
 */

import { SGA_YT }          from '../api/youtube-editor-events.js';
import { DEFAULT_CLIENT_ID, getClientId } from '../api/youtube-editor-pipeline.js';

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {object} api    SgToolApi instance
 * @param {Function} emit
 */
export function initAuth(root, state, api, emit) {
    root.innerHTML = `
        <div class="yte-auth">
            <header class="yte-auth__header">
                <span class="yte-auth__icon" aria-hidden="true">▶</span>
                <span class="yte-auth__title">YouTube Editor</span>
                <span id="conn-badge" class="yte-auth__badge yte-auth__badge--off">disconnected</span>
            </header>

            <p class="yte-auth__intro">
                Sign in with Google to upload, list, and edit your YouTube videos.
                All API calls go directly browser → YouTube.
            </p>

            <label class="yte-auth__label" for="cid-input">Google OAuth Client ID</label>
            <input type="text" id="cid-input" class="yte-auth__input mono" autocomplete="off" spellcheck="false">
            <div class="yte-auth__hint">Cached in localStorage as <code>sg-youtube-client-id</code>.</div>

            <div class="yte-auth__row">
                <button type="button" id="connect-btn"    class="yte-auth__btn yte-auth__btn--primary">Connect to YouTube</button>
                <button type="button" id="disconnect-btn" class="yte-auth__btn yte-auth__btn--ghost" hidden>Sign out</button>
            </div>

            <div id="channel-card" class="yte-auth__channel" hidden>
                <img id="ch-thumb" class="yte-auth__avatar" alt="" loading="lazy" referrerpolicy="no-referrer">
                <div class="yte-auth__ch-meta">
                    <div id="ch-title" class="yte-auth__ch-title"></div>
                    <div id="ch-stats" class="yte-auth__ch-stats"></div>
                </div>
            </div>

            <div id="auth-error" class="yte-auth__error" hidden></div>
        </div>
    `;

    const cidInput  = root.querySelector('#cid-input');
    const connBtn   = root.querySelector('#connect-btn');
    const discBtn   = root.querySelector('#disconnect-btn');
    const badge     = root.querySelector('#conn-badge');
    const card      = root.querySelector('#channel-card');
    const chThumb   = root.querySelector('#ch-thumb');
    const chTitle   = root.querySelector('#ch-title');
    const chStats   = root.querySelector('#ch-stats');
    const errEl     = root.querySelector('#auth-error');

    cidInput.value = getClientId() || DEFAULT_CLIENT_ID;

    cidInput.addEventListener('change', () => {
        api.setClientId({ clientId: cidInput.value.trim() });
    });

    connBtn.addEventListener('click', async () => {
        errEl.hidden = true;
        connBtn.disabled = true;
        connBtn.textContent = 'Connecting…';
        try {
            await api.connect({ clientId: cidInput.value.trim() });
            await api.getMyChannel();
        } catch (err) {
            errEl.hidden = false;
            errEl.textContent = err.message;
        } finally {
            connBtn.disabled = false;
            connBtn.textContent = 'Connect to YouTube';
        }
    });

    discBtn.addEventListener('click', () => {
        api.disconnect();
    });

    function _setConnected(on) {
        badge.textContent = on ? 'connected' : 'disconnected';
        badge.classList.toggle('yte-auth__badge--on',  on);
        badge.classList.toggle('yte-auth__badge--off', !on);
        connBtn.hidden = !!on;
        discBtn.hidden = !on;
    }

    function _renderChannel(channel) {
        if (!channel) { card.hidden = true; return; }
        card.hidden = false;
        chThumb.src = channel.thumbnailUrl || '';
        chTitle.textContent = channel.title || '(no title)';
        const s = channel.statistics || {};
        const subs = s.subscriberCount || '0';
        const vids = s.videoCount      || '0';
        const views = s.viewCount      || '0';
        chStats.textContent = `${vids} videos · ${subs} subscribers · ${views} views`;
    }

    // ── Reflect current state ────────────────────────────────────────────────
    _setConnected(state.connected);
    if (state.channel) {
        _renderChannel(state.channel);
    } else if (state.connected) {
        // Page loaded with a cached token but no channel info — fetch it so
        // the avatar/stats card populates without forcing a re-Connect click.
        api.getMyChannel().catch(err => {
            errEl.hidden = false;
            errEl.textContent = err.message;
        });
    }

    // ── React to events ──────────────────────────────────────────────────────
    window.addEventListener(SGA_YT.CONNECTED,    () => { _setConnected(true);  errEl.hidden = true; });
    window.addEventListener(SGA_YT.DISCONNECTED, () => { _setConnected(false); _renderChannel(null); });
    window.addEventListener(SGA_YT.CHANNEL_LOADED, (e) => _renderChannel(e.detail.channel));
    window.addEventListener(SGA_YT.ERROR, (e) => {
        if (e.detail?.step === 'connect' || e.detail?.step === 'auth') {
            errEl.hidden = false;
            errEl.textContent = e.detail.message;
        }
    });
}
