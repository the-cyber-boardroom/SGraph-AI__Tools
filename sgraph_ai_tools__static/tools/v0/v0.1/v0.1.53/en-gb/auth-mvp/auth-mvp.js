/**
 * Auth MVP — entry point.
 *
 * Layout (sg-layout row, 2 columns):
 *   Left  38%: [📋 Checks] tab — Setup + 7 auth check sections with inline components
 *   Right 62%: [📊 Output] [📡 Events] [🗄 Vaults] tabs
 *
 * JS API (window.__tool):
 *   getAuthStatus()     → { tokens, valid[], signedIn }
 *   getCredIndex()      → [{ name, storedAt, method }]
 *   detectCredStore()   → { supported, method, nativeSupported }
 *   clearAllTokens()    → void
 *   runCheck(id)        → Promise<{ status, output[] }>
 *
 * @module auth-mvp
 * @version 0.1.50
 */

// ── Core + Layout ──────────────────────────────────────────────────────────────
import '/core/sg-layout/v0.1.0/sg-layout.js';
import 'https://dev.sgraph.ai/_common/js/components/sg-site-header/v1/v1.0/v1.0.6/sg-site-header.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

// ── Auth components ────────────────────────────────────────────────────────────
import '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import '/components/auth/sg-auth-google/v0/v0.1/v0.1.0/sg-auth-google.js';
import '/components/auth/sg-auth-status/v0/v0.1/v0.1.0/sg-auth-status.js';
import '/components/auth/sg-auth-user/v0/v0.1/v0.1.0/sg-auth-user.js';
import '/components/auth/sg-credential-store/v0/v0.1/v0.1.0/sg-credential-store.js';
import '/components/auth/sg-credential-list/v0/v0.1/v0.1.0/sg-credential-list.js';
import '/components/vault/sg-vault-picker/v0/v0.1/v0.1.0/sg-vault-picker.js';
import '/components/drive/sg-drive-appdata/v0/v0.1/v0.1.0/sg-drive-appdata.js';

// ── Tool modules ───────────────────────────────────────────────────────────────
import { api } from './api/auth-api.js';
import { init } from './ui/ui-shell.js';

const config = await fetch('./config.json').then(r => r.json()).catch(() => ({}));
await init(config);
api.activate();
