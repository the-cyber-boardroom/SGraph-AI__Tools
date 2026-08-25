/**
 * Vault Manager — entry point.
 *
 * Vault registry stored in Google Drive App Data (per-user, per-app, cross-device).
 * Uses existing sg-vault-connect + sg-vault-tree for vault connection and file browsing.
 *
 * @module vault-mgr
 * @version 0.1.51
 */

// ── Layout + header ───────────────────────────────────────────────────────────
import '/core/sg-layout/v0.1.0/sg-layout.js';
import 'https://dev.sgraph.ai/_common/js/components/sg-site-header/v1/v1.0/v1.0.6/sg-site-header.js';

// ── Auth ──────────────────────────────────────────────────────────────────────
import '/components/auth/sg-auth-tokens/v0/v0.1/v0.1.0/sg-auth-tokens.js';
import '/components/auth/sg-auth-google/v0/v0.1/v0.1.0/sg-auth-google.js';
import '/components/auth/sg-auth-user/v0/v0.1/v0.1.0/sg-auth-user.js';
import '/components/auth/sg-auth-required/v0/v0.1/v0.1.0/sg-auth-required.js';

// ── Drive ─────────────────────────────────────────────────────────────────────
import '/components/drive/sg-drive-appdata/v0/v0.1/v0.1.0/sg-drive-appdata.js';

// ── Vault ─────────────────────────────────────────────────────────────────────
import '/components/vault/sg-vault-connect/v0/v0.1/v0.1.3/sg-vault-connect.js';
import '/components/vault/sg-vault-tree/v0/v0.1/v0.1.3/sg-vault-tree.js';

// ── Init ──────────────────────────────────────────────────────────────────────
import { init } from './ui/ui-shell.js';

const config = await fetch('./config.json').then(r => r.json()).catch(() => ({}));
await init(config);
