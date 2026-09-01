/**
 * ui-setup.js
 * Credentials and the inputs the manual tests need.
 *
 * TWO WAYS TO GET A TOKEN, and the fast one is listed first on purpose. The GIS
 * flow needs a Google Cloud project with an authorised origin — worth doing, but
 * it is 20 minutes of console work standing between you and the answer to M4.
 * Pasting a token from the OAuth Playground takes two minutes and answers the
 * same question today.
 *
 * @module ui-setup
 */

export function initSetup(el, state, ctx, api) {
    if (!el) return;
    el.innerHTML = `<div class="yp-setup">
        <h4>1 · A Google access token</h4>
        <div class="yp-note">
          Needed only by the <b>M</b> tests. The <b>A</b> tests run with nothing at all — start there.
        </div>

        <div class="yp-card">
          <b>Fastest — paste a token</b>
          <div class="yp-muted">
            <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noopener">OAuth&nbsp;Playground</a>
            → tick <code>youtube.force-ssl</code> → authorise → exchange for an access token → paste it here.
            Valid about an hour. Nothing is sent anywhere except to Google.
          </div>
          <div class="yp-row">
            <input id="yp-token" type="password" placeholder="ya29.…" autocomplete="off">
            <button id="yp-token-save" class="yp-btn yp-btn--sm">Use</button>
            <span id="yp-token-state" class="yp-muted"></span>
          </div>
        </div>

        <div class="yp-card">
          <b>Or sign in with your own OAuth client</b>
          <div class="yp-muted">
            A Google Cloud project with the YouTube Data API enabled, an OAuth <i>Web application</i>
            client, and this page's origin in <b>Authorised JavaScript origins</b>.
            Scopes requested: <code>youtube.readonly</code> + <code>youtube.force-ssl</code>.
          </div>
          <div class="yp-row">
            <input id="yp-client" placeholder="xxxxx.apps.googleusercontent.com" autocomplete="off">
            <button id="yp-signin" class="yp-btn yp-btn--sm">Sign in</button>
          </div>
          <div id="yp-signin-state" class="yp-muted"></div>
        </div>

        <h4>2 · Videos to test against</h4>
        <div class="yp-row">
          <label class="yp-lab">One of <b>yours</b>
            <input id="yp-mine" placeholder="URL or 11-char id" autocomplete="off">
          </label>
        </div>
        <div class="yp-muted">Used by M3 and M4 — the question the whole pack hinges on.</div>
        <div class="yp-row">
          <label class="yp-lab">One you <b>don't own</b>
            <input id="yp-other" placeholder="URL or 11-char id" autocomplete="off">
          </label>
        </div>
        <div class="yp-muted">Used by M5–M7, to establish what the third-party path can and cannot do.</div>

        <h4>3 · Corpus size (for the cost projection)</h4>
        <div class="yp-row">
          <label class="yp-lab">talks <input id="yp-talks" type="number" min="1" max="500"></label>
          <label class="yp-lab">captures each <input id="yp-caps" type="number" min="1" max="500"></label>
          <label class="yp-lab">tab-capture s <input id="yp-secs" type="number" min="2" max="30"></label>
        </div>

        <h4>Before running M8</h4>
        <div class="yp-note">
          Open a YouTube video in <b>another tab</b> and press play. Then run M8 and pick
          <b>that tab</b> — <i>not</i> a window or a whole screen — and tick <b>“share tab audio”</b>.
          Only a tab can carry audio, and a missing tick is the usual reason route C looks broken.
        </div>
      </div>`;

    const q = s => el.querySelector(s);

    function refreshToken() {
        Promise.resolve(api.hasToken()).then(r => {
            q('#yp-token-state').textContent = r.present ? '✓ token set' : 'no token — M tests will be blocked';
            q('#yp-token-state').className = r.present ? 'yp-ok' : 'yp-muted';
        }).catch(() => {});
    }

    /**
     * Acknowledge the sign-in IN THE PANEL THAT PERFORMED IT.
     *
     * The first live run signed in through this card and got no response here at
     * all — the only acknowledgement appeared as "✓ token set" in the *other*
     * card, next to the paste box, which reads as "your pasted token was
     * accepted" and says nothing about whether the Google account came through.
     * So: name the channel and its video count, which is the question actually
     * being asked ("did I log into an account that has videos?"), and the scope
     * and expiry, which is what makes any later 403 interpretable.
     */
    function showSignIn(text, cls = 'yp-muted') {
        const n = q('#yp-signin-state');
        n.textContent = text;
        n.className = cls;
    }

    async function describeSignIn() {
        showSignIn('checking the account…');
        try {
            const info = await api.getStatus({});
            const bits = [];
            if (info.channel?.title) {
                bits.push(`✓ signed in as “${info.channel.title}”`);
                bits.push(`${info.channel.videoCount} video${info.channel.videoCount === 1 ? '' : 's'}`);
            } else {
                bits.push('✓ signed in');
            }
            if (info.token?.hasForceSsl) bits.push('force-ssl granted');
            else bits.push('⚠ force-ssl NOT granted — M4 will 403 for the wrong reason');
            if (info.token?.expiresInS) bits.push(`~${Math.round(info.token.expiresInS / 60)} min left`);
            showSignIn(bits.join(' · '), info.token?.hasForceSsl ? 'yp-ok' : 'yp-warn');
        } catch (err) {
            showSignIn(`signed in, but the account could not be read: ${err.code || 'error'} — ${err.message}`, 'yp-warn');
        }
    }

    q('#yp-token-save').addEventListener('click', () => {
        api.setToken({ token: q('#yp-token').value });
        q('#yp-token').value = '';
        refreshToken();
        describeSignIn();
    });
    q('#yp-signin').addEventListener('click', async () => {
        showSignIn('opening Google…');
        try { await api.signIn({ clientId: q('#yp-client').value.trim() }); }
        catch (err) { showSignIn(`${err.code || 'error'}: ${err.message}`, 'yp-warn'); return; }
        refreshToken();
        describeSignIn();
    });
    window.addEventListener('yp:auth:changed', refreshToken);

    const bind = (sel, key, num) => {
        const input = q(sel);
        input.value = ctx[key] ?? '';
        input.addEventListener('change', () => {
            api.setContext({ [key]: num ? Number(input.value) : input.value.trim() });
        });
    };
    bind('#yp-mine', 'videoId');
    bind('#yp-other', 'otherVideoId');
    bind('#yp-talks', 'talks', true);
    bind('#yp-caps', 'capturesPerTalk', true);
    bind('#yp-secs', 'captureSeconds', true);
    refreshToken();
}
