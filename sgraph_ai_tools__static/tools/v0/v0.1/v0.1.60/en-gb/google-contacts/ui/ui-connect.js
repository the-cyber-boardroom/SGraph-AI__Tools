/**
 * ui-connect — client ID entry + sign-in / sign-out panel.
 *
 * Shows a setup form when the user is not signed in; collapses into a
 * compact "signed in as …" strip when they are.
 *
 * @module google-contacts/ui-connect
 */

const SETUP_DOC_URL = 'https://console.cloud.google.com/apis/credentials';

export function mountConnect({ root, state, api }) {
    function render(s) {
        if (s.signedIn) {
            const mins = s.tokenExpiresAt ? Math.round((s.tokenExpiresAt - Date.now()) / 60000) : null;
            root.innerHTML = `
                <div class="gc-connect gc-connect--signed-in">
                    <div class="gc-pill gc-pill--ok">Signed in</div>
                    <div class="gc-connect__meta">
                        ${mins != null
                            ? `Access token expires in <strong>${mins} min</strong>`
                            : `Access token active`}
                    </div>
                    <button class="gc-btn gc-btn--ghost" data-act="signout">Sign out</button>
                </div>
            `;
            root.querySelector('[data-act="signout"]').onclick = async () => {
                try { await api.signOut(); } catch (e) { _flash(root, e.message); }
            };
            return;
        }

        root.innerHTML = `
            <div class="gc-connect">
                <h2>1 · Connect</h2>
                <p class="gc-note">
                    Create (or reuse) a Google Cloud project, enable the
                    <strong>People API</strong>, then create an OAuth
                    <strong>Web application</strong> credential with this page's
                    origin as an authorised JavaScript origin. Paste the resulting
                    Client ID below.
                    <a href="${SETUP_DOC_URL}" target="_blank" rel="noopener">Open Google Cloud Console →</a>
                </p>
                <form class="gc-form" data-form="connect">
                    <label class="gc-label">
                        OAuth Client ID
                        <input
                            type="text" name="clientId" class="gc-input"
                            placeholder="…apps.googleusercontent.com"
                            value="${_attr(s.clientId)}"
                            autocomplete="off" spellcheck="false">
                    </label>
                    <div class="gc-row">
                        <button type="submit" class="gc-btn gc-btn--primary">
                            ${s.clientId ? 'Sign in with Google' : 'Save & sign in'}
                        </button>
                        ${s.error ? `<span class="gc-err">${_html(s.error)}</span>` : ''}
                    </div>
                </form>
                <p class="gc-note gc-note--small">
                    The Client ID is stored in this browser's localStorage (it is public by design).
                    The short-lived access token stays in memory only — it is never written to disk.
                </p>
            </div>
        `;
        root.querySelector('[data-form="connect"]').onsubmit = async (e) => {
            e.preventDefault();
            const id = new FormData(e.target).get('clientId').toString().trim();
            try {
                await api.connect({ clientId: id });
                await api.signIn({});
            } catch (err) {
                _flash(root, err.message);
            }
        };
    }

    const off = state.subscribe(render);
    return { destroy() { off(); root.innerHTML = ''; } };
}

function _attr(s) { return (s || '').replace(/"/g, '&quot;'); }
function _html(s) { return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function _flash(root, msg) {
    let el = root.querySelector('.gc-err');
    if (!el) {
        el = document.createElement('div');
        el.className = 'gc-err';
        root.appendChild(el);
    }
    el.textContent = msg;
}
