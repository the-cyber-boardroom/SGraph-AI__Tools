# Auth MVP — Human Guide

**Version:** 0.1.50 · **Tool:** Auth MVP

---

## What This Tool Does

This tool is an interactive MVP for testing all auth building blocks used across the SGraph ecosystem. Run each check individually or use "Run All" to verify the complete auth stack.

---

## Getting Started

### 1. Google OAuth Setup

Before the Google check can run you need a **Google OAuth Client ID**:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (type: Web application)
3. Add your domain (or `http://localhost`) to **Authorised JavaScript origins**
4. Copy the Client ID (looks like `xxxx.apps.googleusercontent.com`)
5. Paste it into the **Google Client ID** field in the Setup panel and click Save

The Client ID is stored in `localStorage` so you only need to enter it once.

---

## The 7 Checks

| # | Check | What it tests |
|---|-------|---------------|
| 1 | **Auth Status** | Reads `sg-auth-token-*` keys, reports sign-in state across providers |
| 2 | **Google OAuth** | Loads GIS script, renders sign-in button, performs full OAuth round-trip |
| 3 | **Token Storage** | Saves/retrieves/expires a mock token in localStorage; verifies API |
| 4 | **User Profile** | Shows avatar, name, email from stored token claims |
| 5 | **Logout Workflow** | Calls `google.accounts.id.revoke()`, clears localStorage tokens |
| 6 | **Credential Store** | Detects browser support, stores a secret via password manager API |
| 7 | **Credential List** | Shows the metadata index of credentials stored by this app |

---

## Right Panel Tabs

- **Output** — Collapsible log per check. Each entry shows ✅/❌/⚠️ plus detail.
- **Events** — Live event log for all `sg-auth:*`, `vault:*`, and `sg-cred:*` window events.
- **Vaults** — The `sg-vault-picker` component (Stage 1: localStorage). Create vaults, import vault keys.

---

## Vault Picker (Stage 1)

The Vaults tab shows the `sg-vault-picker` component. At Stage 1, vault keys are stored in `localStorage` — this lets you test the full UX without a real vault backend.

**Create a vault:** Enter a name and click **+ Create**. A mock key in `{24hex}:{8hex}` format is generated — this mirrors the real SG/Send vault key format.

**Import a vault:** Paste an existing vault key + give it a name, click **Import**.

**Phase 2** (planned): vault keys will be stored in the browser's password manager and synced across devices. See `team/explorer/dev/plans/v0.1.50__auth-mvp__phase2-vault-pki-integration.md`.

---

## Event Bus

All components fire events on `window`. The Events tab captures:

- `sg-auth:signed-in` — Google sign-in complete, carries `{ provider, claims, idToken }`
- `sg-auth:signed-out` — Sign-out complete
- `sg-auth:error` — Auth error with `{ provider, error }`
- `sg-auth:token-saved` — Token written to localStorage
- `sg-auth:token-removed` — Token removed
- `sg-auth:tokens-cleared` — All tokens wiped
- `sg-cred:stored` — Secret stored via password manager
- `sg-cred:retrieved` — Secret retrieved from password manager
- `sg-cred:unsupported` — Browser does not support Credential Management API
- `sg-cred:error` — Credential store error
- `vault:created` — New vault created, carries `{ name, vaultKey, vaultId }`
- `vault:opened` — Vault opened/selected
- `vault:saved` — Vault key imported
- `vault:removed` — Vault removed from list
- `vault:cancelled` — Active vault closed

---

## JS API

Open the **⚡ Explorer** tab in the dev panel (footer bar) to call the tool API:

```javascript
window.__tool.getAuthStatus()    // → { signedIn, providers[], tokenCount }
window.__tool.getCredIndex()     // → [{ name, storedAt, method }]
window.__tool.detectCredStore()  // → { supported, method, nativeSupported }
window.__tool.clearAllTokens()   // clears all sg-auth-token-* from localStorage
window.__tool.runCheck('google') // run a specific check by ID
```

---

## Security Notes

- **Secrets are never in localStorage.** Only token metadata (name, timestamp, method) is indexed there. Actual secrets go through `navigator.credentials.store()` into your browser's password manager.
- **The Credential Management API is Chromium-only.** Safari and Firefox fall back to a hidden form submission which triggers the browser's built-in save-password heuristic.
- **OAuth tokens ARE stored in localStorage** (`sg-auth-token-google`) — this is Stage 1. Phase 2 will move them into the vault.
- **Vault keys in Stage 1** are stored in `localStorage` unencrypted as a stand-in. Stage 2 uses the password manager API.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Google button doesn't appear | Check Client ID is saved, ensure domain is in Google Console origins |
| "Not supported" on Credential Store | You're on Safari/Firefox — the form fallback will be used instead |
| Token check fails | Open DevTools → Application → Local Storage and check for `sg-auth-token-__test__` |
| Vault events not appearing | Open the Events tab; look for `vault:created` events |

---

## Phase 2 Roadmap

The next stage adds vault integration and PKI:

1. **sg-vault-picker Stage 2** — store vault key in browser password manager (sync across devices)
2. **Vault content** — store OAuth tokens, API keys, preferences inside encrypted vault blob
3. **Ed25519 PKI key** — generate user keypair at vault creation; private key stored encrypted in vault
4. **Google personalisation** — use Google identity as vault owner metadata

See the full plan: `team/explorer/dev/plans/v0.1.50__auth-mvp__phase2-vault-pki-integration.md`
