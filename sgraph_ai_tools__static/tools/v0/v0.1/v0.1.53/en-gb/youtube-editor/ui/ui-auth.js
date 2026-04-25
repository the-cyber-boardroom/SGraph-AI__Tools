/**
 * ui-auth.js
 * Left panel — client-id input, Connect/Sign-out, channel info card with
 * banner backdrop + handle + joined date + description + topic chips, plus
 * a 28-day analytics summary if the yt-analytics.readonly scope was granted.
 *
 * @module ui-auth
 */

import { SGA_YT }           from '../api/youtube-editor-events.js';
import { DEFAULT_CLIENT_ID, getClientId }
    from '../api/youtube-editor-pipeline.js';

export function initAuth(root, state, api, emit) {
    root.innerHTML = `
        <div class="yte-auth">
            <header class="yte-auth__header">
                <span class="yte-auth__icon" aria-hidden="true">▶</span>
                <span class="yte-auth__title">YouTube Editor</span>
                <span id="conn-badge" class="yte-auth__badge yte-auth__badge--off">disconnected</span>
            </header>

            <p class="yte-auth__intro">
                Sign in with Google to upload, list, edit, and analyse your YouTube videos.
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
                <div id="ch-banner" class="yte-auth__banner"></div>
                <div class="yte-auth__channel-body">
                    <img id="ch-thumb" class="yte-auth__avatar" alt="" loading="lazy" referrerpolicy="no-referrer">
                    <div class="yte-auth__ch-meta">
                        <div id="ch-title"  class="yte-auth__ch-title"></div>
                        <div id="ch-handle" class="yte-auth__ch-handle"></div>
                        <div id="ch-stats"  class="yte-auth__ch-stats"></div>
                        <div id="ch-joined" class="yte-auth__ch-joined"></div>
                    </div>
                </div>

                <div id="ch-desc-wrap" class="yte-auth__ch-desc-wrap" hidden>
                    <div id="ch-desc" class="yte-auth__ch-desc"></div>
                    <button type="button" id="ch-desc-toggle" class="yte-auth__more">more</button>
                </div>

                <div id="ch-topics" class="yte-auth__topics"></div>

                <div class="yte-auth__links">
                    <a id="ch-link"     class="yte-auth__link" target="_blank" rel="noopener" hidden>View on YouTube ↗</a>
                    <a id="ch-studio"   class="yte-auth__link" target="_blank" rel="noopener" hidden>Open Studio ↗</a>
                </div>
            </div>

            <!-- Analytics summary (only visible when yt-analytics scope granted) -->
            <div id="analytics-card" class="yte-auth__analytics" hidden>
                <div class="yte-auth__analytics-head">
                    <span class="yte-auth__analytics-title">📈 Last 28 days</span>
                    <span id="an-range" class="yte-auth__analytics-range"></span>
                </div>
                <div class="yte-auth__metrics">
                    <div class="yte-auth__metric"><div id="an-views"   class="yte-auth__metric-val">—</div><div class="yte-auth__metric-label">Views</div></div>
                    <div class="yte-auth__metric"><div id="an-watch"   class="yte-auth__metric-val">—</div><div class="yte-auth__metric-label">Watch hrs</div></div>
                    <div class="yte-auth__metric"><div id="an-subs"    class="yte-auth__metric-val">—</div><div class="yte-auth__metric-label">Subs gained</div></div>
                    <div class="yte-auth__metric"><div id="an-likes"   class="yte-auth__metric-val">—</div><div class="yte-auth__metric-label">Likes</div></div>
                </div>
                <div id="an-status" class="yte-auth__analytics-status"></div>
            </div>

            <div id="analytics-not-granted" class="yte-auth__notice" hidden>
                Analytics not available — sign out and re-connect to grant the
                <code>yt-analytics.readonly</code> scope (must also be added to your
                OAuth consent screen in Google Cloud).
            </div>

            <div id="auth-error" class="yte-auth__error" hidden></div>
        </div>
    `;

    const cidInput  = root.querySelector('#cid-input');
    const connBtn   = root.querySelector('#connect-btn');
    const discBtn   = root.querySelector('#disconnect-btn');
    const badge     = root.querySelector('#conn-badge');
    const card      = root.querySelector('#channel-card');
    const banner    = root.querySelector('#ch-banner');
    const chThumb   = root.querySelector('#ch-thumb');
    const chTitle   = root.querySelector('#ch-title');
    const chHandle  = root.querySelector('#ch-handle');
    const chStats   = root.querySelector('#ch-stats');
    const chJoined  = root.querySelector('#ch-joined');
    const chDescWrap   = root.querySelector('#ch-desc-wrap');
    const chDesc       = root.querySelector('#ch-desc');
    const chDescToggle = root.querySelector('#ch-desc-toggle');
    const chTopics  = root.querySelector('#ch-topics');
    const chLink    = root.querySelector('#ch-link');
    const chStudio  = root.querySelector('#ch-studio');
    const anCard    = root.querySelector('#analytics-card');
    const anNotGranted = root.querySelector('#analytics-not-granted');
    const anRange   = root.querySelector('#an-range');
    const anViews   = root.querySelector('#an-views');
    const anWatch   = root.querySelector('#an-watch');
    const anSubs    = root.querySelector('#an-subs');
    const anLikes   = root.querySelector('#an-likes');
    const anStatus  = root.querySelector('#an-status');
    const errEl     = root.querySelector('#auth-error');

    cidInput.value = getClientId() || DEFAULT_CLIENT_ID;

    cidInput.addEventListener('change', () => api.setClientId({ clientId: cidInput.value.trim() }));

    connBtn.addEventListener('click', async () => {
        errEl.hidden = true;
        connBtn.disabled = true;
        connBtn.textContent = 'Connecting…';
        try {
            await api.connect({ clientId: cidInput.value.trim() });
            await api.getMyChannel();
            _maybeLoadAnalytics();
        } catch (err) {
            errEl.hidden = false;
            errEl.textContent = err.message;
        } finally {
            connBtn.disabled = false;
            connBtn.textContent = 'Connect to YouTube';
        }
    });

    discBtn.addEventListener('click', () => api.disconnect());

    chDescToggle.addEventListener('click', () => {
        const expanded = chDesc.classList.toggle('is-expanded');
        chDescToggle.textContent = expanded ? 'less' : 'more';
    });

    function _setConnected(on) {
        badge.textContent = on ? 'connected' : 'disconnected';
        badge.classList.toggle('yte-auth__badge--on',  on);
        badge.classList.toggle('yte-auth__badge--off', !on);
        connBtn.hidden = !!on;
        discBtn.hidden = !on;
        if (!on) {
            card.hidden = true;
            anCard.hidden = true;
            anNotGranted.hidden = true;
        }
    }

    function _renderChannel(channel) {
        if (!channel) { card.hidden = true; return; }
        card.hidden = false;

        // Banner backdrop with subtle gradient overlay (gradient is in CSS)
        if (channel.bannerUrl) {
            banner.style.backgroundImage = `url('${_cssUrl(channel.bannerUrl)}=w960-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj')`;
            banner.classList.add('is-visible');
        } else {
            banner.style.backgroundImage = '';
            banner.classList.remove('is-visible');
        }

        chThumb.src = channel.thumbnailUrl || '';
        chTitle.textContent  = channel.title || '(no title)';
        chHandle.textContent = channel.customUrl || '';
        chHandle.style.display = channel.customUrl ? '' : 'none';

        const s = channel.statistics || {};
        const subs  = channel.hiddenSubscribers ? '—' : _short(s.subscriberCount);
        const vids  = _short(s.videoCount);
        const views = _short(s.viewCount);
        chStats.textContent = `${vids} videos · ${subs} subscribers · ${views} views`;

        const joined = channel.publishedAt
            ? `Joined ${new Date(channel.publishedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
            : '';
        const country = channel.country ? `  ·  ${channel.country}` : '';
        chJoined.textContent = joined ? joined + country : '';

        // Description (collapsed initially)
        if (channel.description?.trim()) {
            chDescWrap.hidden = false;
            chDesc.textContent = channel.description;
            chDesc.classList.remove('is-expanded');
            chDescToggle.textContent = 'more';
            // Hide toggle if description fits in the collapsed clamp
            requestAnimationFrame(() => {
                const overflowing = chDesc.scrollHeight > chDesc.clientHeight + 2;
                chDescToggle.style.display = overflowing ? '' : 'none';
            });
        } else {
            chDescWrap.hidden = true;
        }

        // Topic chips
        chTopics.innerHTML = '';
        for (const label of (channel.topicLabels || []).slice(0, 6)) {
            const chip = document.createElement('span');
            chip.className = 'yte-auth__chip';
            chip.textContent = label;
            chTopics.appendChild(chip);
        }

        // Links
        chLink.hidden = !channel.channelUrl;
        chLink.href   = channel.channelUrl || '#';
        chStudio.hidden = !channel.studioUrl;
        chStudio.href   = channel.studioUrl || '#';
    }

    async function _maybeLoadAnalytics() {
        if (!state.connected) return;
        if (!state.hasAnalytics) {
            anCard.hidden = true;
            anNotGranted.hidden = false;
            return;
        }
        anNotGranted.hidden = true;
        anCard.hidden = false;
        anStatus.textContent = 'Loading…';
        try {
            const s = await api.getChannelAnalyticsSummary({ days: 28 });
            anRange.textContent = s.startDate && s.endDate ? `${s.startDate} → ${s.endDate}` : '';
            anViews.textContent = _short(s.views);
            const hours = (Number(s.estimatedMinutesWatched) || 0) / 60;
            anWatch.textContent = hours >= 100 ? Math.round(hours).toLocaleString() : hours.toFixed(1);
            const net = (Number(s.subscribersGained) || 0) - (Number(s.subscribersLost) || 0);
            anSubs.textContent = (net >= 0 ? '+' : '') + _short(Math.abs(net)).replace('-', '');
            anLikes.textContent = _short(s.likes);
            anStatus.textContent = '';
        } catch (err) {
            anStatus.textContent = err.message;
        }
    }

    // ── Reflect current state ────────────────────────────────────────────────
    _setConnected(state.connected);
    if (state.channel) {
        _renderChannel(state.channel);
        _maybeLoadAnalytics();
    } else if (state.connected) {
        api.getMyChannel().catch(err => { errEl.hidden = false; errEl.textContent = err.message; });
        _maybeLoadAnalytics();
    }

    // ── React to events ──────────────────────────────────────────────────────
    window.addEventListener(SGA_YT.CONNECTED,    () => { _setConnected(true);  errEl.hidden = true; });
    window.addEventListener(SGA_YT.DISCONNECTED, () => { _setConnected(false); _renderChannel(null); });
    window.addEventListener(SGA_YT.CHANNEL_LOADED, (e) => _renderChannel(e.detail.channel));
    window.addEventListener(SGA_YT.ERROR, (e) => {
        if (e.detail?.step === 'connect' || e.detail?.step === 'auth') {
            errEl.hidden = false; errEl.textContent = e.detail.message;
        }
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** YouTube banner URLs end with =sNNNN-... — strip the =suffix so we can re-size. */
function _cssUrl(url) {
    return String(url).split('=')[0].replace(/'/g, "\\'");
}

/** 12345 → "12.3K", 1234567 → "1.2M". */
function _short(n) {
    if (n === null || n === undefined || n === '') return '0';
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    if (Math.abs(num) < 1000)        return String(num);
    if (Math.abs(num) < 1_000_000)   return (num / 1000).toFixed(num < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
    if (Math.abs(num) < 1e9)         return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    return (num / 1e9).toFixed(1) + 'B';
}
