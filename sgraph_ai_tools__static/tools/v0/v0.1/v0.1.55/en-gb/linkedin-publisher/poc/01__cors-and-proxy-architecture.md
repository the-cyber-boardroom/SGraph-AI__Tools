# LinkedIn Publisher — Architecture Notes

**Status:** Captured 26 Apr 2026 from Phase 0 probes + research.
**Audience:** Whoever picks up the Phase 1 build. Read this first.
**Out of scope:** Tech stack picks (Cloudflare Worker vs AWS Lambda vs anything else). Implementation patterns. Code samples. This doc is the *why*, not the *how*.

---

## 1. The constraint that shapes everything

**LinkedIn does not return CORS headers on any of its API or OAuth endpoints.** Probed and confirmed from the registered redirect origin (`https://dev.tools.sgraph.ai`):

- `api.linkedin.com/rest/posts` — blocked
- `api.linkedin.com/v2/userinfo` (OIDC) — blocked
- `api.linkedin.com/v2/me` — blocked
- `linkedin.com/oauth/v2/accessToken` (token exchange) — blocked
- `linkedin.com/oauth/.well-known/openid-configuration` (OIDC discovery) — blocked

The `linkedin.com/oauth/v2/authorization` URL is also blocked for `fetch()`, but that doesn't matter — the production flow uses `window.open()` for top-level navigation, which doesn't go through CORS.

**Consequence:** browser-direct calls to LinkedIn are impossible. A server-side relay is structurally required — not as an architecture preference, but because there's no other way for a browser to talk to LinkedIn at all.

---

## 2. The proxy is a transparent relay, not an application

The relay does exactly two things:

1. **Token exchange** — accepts a POST from the browser carrying `{code, code_verifier, redirect_uri}`, adds the LinkedIn `client_secret` it owns, forwards to LinkedIn's `accessToken` endpoint, returns the response unchanged.
2. **API passthrough** — accepts any `/rest/*` request from the browser carrying the user's `Authorization: Bearer <access_token>` header, forwards to `api.linkedin.com/rest/*` injecting the two required headers (`LinkedIn-Version`, `X-Restli-Protocol-Version`), returns the response unchanged.

In both cases it adds CORS headers on the response so the browser will accept it.

**It does NOT:**
- Store any user data (no token cache, no user DB, no logs containing user identifiers)
- Substitute its own credentials when calling the API on a user's behalf
- Transform the request or response bodies
- Make any decisions about what the user can or can't post

The only state the relay holds is the LinkedIn `client_secret`, which is per-app, not per-user.

---

## 3. Credential map

### Server-side (lives in the relay only — never in the browser, never in git)

| Credential | What it is | Why it can't be in the browser |
|---|---|---|
| `LINKEDIN_CLIENT_ID` | The app's public ID (`78tdt0b9upct3u`) | Not strictly secret, but kept alongside the secret for symmetry |
| `LINKEDIN_CLIENT_SECRET` | The hidden value behind the 👁 button on linkedin.com/developers | LinkedIn requires it on the token-exchange call **even when PKCE is used** — this is unusual (most modern providers treat PKCE as a replacement for the secret) and is the single load-bearing reason the relay must exist |

### Per-user (lives in the user's browser only — never on the relay)

| Item | Created by | Stored where | Lifetime |
|---|---|---|---|
| PKCE `code_verifier` | Browser at sign-in time | In-memory only | One sign-in attempt |
| `access_token` | LinkedIn returns it via the relay | `localStorage['sg-auth-token-linkedin-publisher']` | ~60 days (LinkedIn's TTL) |
| `id_token` (OIDC JWT) | LinkedIn returns it alongside the access token | Decoded once for profile display, then discarded | One session |
| `refresh_token` (if returned) | LinkedIn | localStorage alongside the access token | Per LinkedIn policy |

---

## 4. The two flows

### Flow A — Token exchange (once per sign-in)

```
1. Browser       generates PKCE verifier + challenge
2. Browser       window.open( linkedin.com/oauth/v2/authorization?... )
3. User          signs in on linkedin.com, grants scopes
4. LinkedIn      redirects popup to oauth-callback.html?code=...&state=...
5. callback.html postMessage({ code }) → opener; window.close()
6. Browser       POST relay /oauth/token { code, code_verifier, redirect_uri }
7. Relay         POST linkedin.com/oauth/v2/accessToken
                   { grant_type=authorization_code,
                     code, code_verifier, redirect_uri,
                     client_id, client_secret }      ← secret added here
8. LinkedIn      → Relay: { access_token, id_token, expires_in, refresh_token? }
9. Relay         → Browser (with CORS headers added)
10. Browser      caches access_token + decodes id_token JWT for profile fields
                 (sub, name, picture, email — no /v2/userinfo call needed)
```

### Flow B — API call (every post / list / read)

```
1. Browser    GET relay /rest/posts?...
              Authorization: Bearer <user's access_token>     ← user's, not relay's
2. Relay      GET api.linkedin.com/rest/posts?...
              Authorization: Bearer <unchanged>
              LinkedIn-Version: 202504                         ← injected by relay
              X-Restli-Protocol-Version: 2.0.0                 ← injected by relay
3. LinkedIn   → Relay: response body
4. Relay      → Browser (with CORS headers added)
```

The relay is **transparent** here — LinkedIn's per-user rate limits attach to the user's `Bearer` token, not to our app, because the relay never substitutes credentials.

---

## 5. Architectural shortcuts surfaced by the research

These let us skip work that the original brief assumed we'd need:

- **Skip `/v2/userinfo` entirely.** The OIDC `id_token` returned in step 9 of Flow A already contains `sub`, `name`, `given_name`, `family_name`, `picture`, `email`, `email_verified`, `locale`. A plain JWT decode in the browser is enough for displaying who's signed in. Signature verification against JWKS is the only thing that still needs network access — and even that can be skipped if we trust the id_token because it came over TLS from our own relay.
- **No JWKS endpoint on the relay (for v1).** Following from the above. If we ever want browser-side signature verification, the relay needs a cached `/jwks` route — but for v1 the trust-on-TLS shortcut is reasonable.
- **No discovery doc fetch.** Endpoint URLs are stable enough that they live in the core module as constants, not as runtime lookups against `.well-known/openid-configuration` (which is itself CORS-blocked).

---

## 6. Required CORS allowlist on the relay

The relay must respond to `OPTIONS` preflights and add these on every real response:

- `Access-Control-Allow-Origin: https://tools.sgraph.ai` (and `https://dev.tools.sgraph.ai`)
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Authorization, Content-Type, LinkedIn-Version, X-Restli-Protocol-Version`

Easy to forget the last two header names — they'll show up as opaque 426/400 errors if missing.

---

## 7. The migration path that keeps options open

Build the relay as a single deployment owned by `tools.sgraph.ai`. Expose **one** config field on the core module:

```
new LinkedInApi({ proxyUrl: 'https://linkedin-proxy.tools.sgraph.ai' })
```

A power user who'd rather self-host overrides `proxyUrl` to point at their own deployment of the same relay code. No architectural rework, no second code path. The default is friction-free for normal users; the override exists for users who need it.

---

## 8. What can the relay leak if compromised?

The blast radius is the `client_secret`. An attacker holding it can impersonate our app to mint access tokens for users who consent in their own browser to the OAuth scopes. They cannot decrypt past traffic (no per-session key material is held), and they cannot forge access tokens for users who never went through the consent flow. Recovery: rotate the secret in the linkedin.com/developers dashboard.

User access tokens never live on the relay (it forwards them once and forgets), so a compromise can't dump existing user tokens.

---

## References

- Phase 0 probe results (decision matrix + raw DevTools log): `team/explorer/architect/v0.1.0__phase-0__linkedin-cors-findings.md`
- Browser-from-LinkedIn research (comparison table, endpoint findings, recommended reference impl, risks/gotchas, sources): `team/explorer/architect/v0.1.0__phase-0__linkedin-browser-api-research.md`
- Member-first MVP brief amendment (revised phasing — proxy is Phase 1a, core+auth is Phase 1b): `team/humans/dinis_cruz/claude-code-web/v0.1.1__brief__tools-team__linkedin-publisher__amendment__member-first-mvp.md`
- Original brief 2/5 (the original "decide between A/B/C/D" framing this came out of): `team/humans/dinis_cruz/claude-code-web/v0.1.0__brief__tools-team__linkedin-publisher__2__critical-decisions.md`
