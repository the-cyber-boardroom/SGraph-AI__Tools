/**
 * OpenRouter — application orchestrator.
 *
 * v0.1.23 — JS API Primitive
 *
 * Adds to the existing OpenRouter dashboard:
 *  - SgToolApi registration (window.__tool) with 11 methods
 *  - Bottom developer panel: Explorer / Console / Manifest tabs
 *  - Extracted JS (was inline in index.html) into api.js + connect.js
 *
 * Layout:
 *   outer column [0.74 / 0.26]
 *     top  (74%)  → tool-area → inner row [0.60 / 0.40]
 *                                 left column  → User: Connect | Key Stats | Usage
 *                                                             + Models | Model Detail
 *                                 right column → Admin: Connect | Keys | Generation
 *                                                             + Activity | Spending | Logs
 *     bottom (26%) → dev stack → ⚡ Explorer | > Console | 📋 Manifest
 *
 * @version 0.1.23
 */

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';
import '/components/llm/sg-llm-request/v0/v0.1/v0.1.2/sg-llm-request.js';
import '/components/openrouter/sg-openrouter-key-stats/v0/v0.1/v0.1.0/sg-openrouter-key-stats.js';
import '/components/openrouter/sg-openrouter-usage/v0/v0.1/v0.1.0/sg-openrouter-usage.js';
import '/components/openrouter/sg-openrouter-models/v0/v0.1/v0.1.0/sg-openrouter-models.js';
import '/components/openrouter/sg-openrouter-key-manager/v0/v0.1/v0.1.0/sg-openrouter-key-manager.js';
import '/components/openrouter/sg-openrouter-generation/v0/v0.1/v0.1.0/sg-openrouter-generation.js';
import '/components/openrouter/sg-openrouter-model-detail/v0/v0.1/v0.1.0/sg-openrouter-model-detail.js';
import '/components/openrouter/sg-openrouter-activity/v0/v0.1/v0.1.0/sg-openrouter-activity.js';
import '/components/openrouter/sg-openrouter-spending/v0/v0.1/v0.1.0/sg-openrouter-spending.js';
import '/components/openrouter/sg-openrouter-log-viewer/v0/v0.1/v0.1.1/sg-openrouter-log-viewer.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SGL_LLM }    from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';
import { SgToolApi }  from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGA_TOOL }   from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api-events.js';

import {
    state, registerConnectElements, wireVault,
} from './connect.js';
import {
    fetchKeyStats, fetchModels, fetchModelDetail,
    fetchUsage, fetchSpending, fetchActivity,
    fetchListKeys, fetchCreateKey, fetchDeleteKey,
} from './api.js';

// ── Register inline connect Web Components ────────────────────────────────────
registerConnectElements();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const busEl = document.getElementById('llm-bus');

// ── Vault bar wiring ──────────────────────────────────────────────────────────
wireVault({
    vaultKeyInput:  document.getElementById('vault-key-input'),
    vaultApiInput:  document.getElementById('vault-api-url'),
    vaultLoadBtn:   document.getElementById('vault-load-btn'),
    vaultUserPill:  document.getElementById('vault-user-pill'),
    vaultAdminPill: document.getElementById('vault-admin-pill'),
});

// ── Outer layout: column split (tool / dev panel) ─────────────────────────────
const outerLayout = document.createElement('sg-layout');
busEl.appendChild(outerLayout);

const outerReady = new Promise(resolve => outerLayout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
outerLayout.setLayout({
    type: 'column', id: 'outer', sizes: [0.74, 0.26],
    children: [
        { type: 'stack', id: 's-tool', activeTab: 0,
          tabs: [{ type: 'tab', id: 't-tool-area', title: 'Tool', tag: 'div', locked: true, closable: false }] },
        { type: 'stack', id: 's-dev', activeTab: 0,
          tabs: [
              { type: 'tab', id: 't-explorer', title: '\u26a1 Explorer', tag: 'div', locked: false, closable: false },
              { type: 'tab', id: 't-console',  title: '\u003e Console',  tag: 'div', locked: false, closable: false },
              { type: 'tab', id: 't-manifest', title: '\u{1F4CB} Manifest', tag: 'div', locked: false, closable: false },
          ] },
    ],
});
await outerReady;

const toolAreaPanel = outerLayout.getPanelElement('t-tool-area');
const explorerPanel = outerLayout.getPanelElement('t-explorer');
const consolePanel  = outerLayout.getPanelElement('t-console');
const manifestPanel = outerLayout.getPanelElement('t-manifest');

// ── Inner layout: tool content ────────────────────────────────────────────────
//  ┌──────────────────────────────────────┬──────────────────────────────────┐
//  │  USER (60%)                          │  ADMIN (40%)                     │
//  │  Connect | Key Stats | Usage  (top)  │  Connect | Keys | Generation     │
//  │  Models  | Model Detail    (bottom)  │  Activity | Spending | Logs      │
//  └──────────────────────────────────────┴──────────────────────────────────┘
toolAreaPanel.style.cssText = 'width:100%;height:100%;display:block;overflow:hidden;';
const innerLayout = document.createElement('sg-layout');
innerLayout.style.cssText = 'width:100%;height:100%;display:block;';
toolAreaPanel.appendChild(innerLayout);

const innerReady = new Promise(resolve => innerLayout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
innerLayout.setLayout({
    type: 'row', id: 'inner', sizes: [0.60, 0.40],
    children: [
        // User section — two-row column
        {
            type: 'column', id: 'col-user', sizes: [0.45, 0.55],
            children: [
                {
                    type: 'stack', id: 'st-user-top', activeTab: 0,
                    tabs: [
                        { type: 'tab', id: 't-user-connect',   title: 'Connect',   tag: 'sg-or-user-connect',     locked: false, closable: false },
                        { type: 'tab', id: 't-key-stats',      title: 'Key Stats', tag: 'sg-openrouter-key-stats', locked: false, closable: false },
                        { type: 'tab', id: 't-usage',          title: 'Usage',     tag: 'sg-openrouter-usage',     locked: false, closable: false },
                    ],
                },
                {
                    type: 'stack', id: 'st-user-bottom', activeTab: 0,
                    tabs: [
                        { type: 'tab', id: 't-models',       title: 'Models',       tag: 'sg-openrouter-models',       locked: false, closable: false },
                        { type: 'tab', id: 't-model-detail', title: 'Model Detail', tag: 'sg-openrouter-model-detail', locked: false, closable: false },
                    ],
                },
            ],
        },
        // Admin section — two-row column
        {
            type: 'column', id: 'col-admin', sizes: [0.40, 0.60],
            children: [
                {
                    type: 'stack', id: 'st-admin-top', activeTab: 0,
                    tabs: [
                        { type: 'tab', id: 't-admin-connect', title: 'Connect',    tag: 'sg-or-admin-connect',        locked: false, closable: false },
                        { type: 'tab', id: 't-key-manager',   title: 'Keys',       tag: 'sg-openrouter-key-manager',  locked: false, closable: false },
                        { type: 'tab', id: 't-generation',    title: 'Generation', tag: 'sg-openrouter-generation',   locked: false, closable: false },
                    ],
                },
                {
                    type: 'stack', id: 'st-admin-bottom', activeTab: 0,
                    tabs: [
                        { type: 'tab', id: 't-activity', title: 'Activity', tag: 'sg-openrouter-activity',   locked: false, closable: false },
                        { type: 'tab', id: 't-spending', title: 'Spending', tag: 'sg-openrouter-spending',   locked: false, closable: false },
                        { type: 'tab', id: 't-logs',     title: 'Logs',     tag: 'sg-openrouter-log-viewer', locked: false, closable: false },
                    ],
                },
            ],
        },
    ],
});
await innerReady;

// ── Dev panel components ──────────────────────────────────────────────────────
const mount = (panel, tag) => {
    panel.style.cssText = 'width:100%;height:100%;display:block;overflow:hidden;';
    const el = document.createElement(tag);
    el.style.cssText = 'display:block;width:100%;height:100%;';
    panel.appendChild(el);
    return el;
};

mount(explorerPanel, 'sg-tool-api-explorer');
mount(consolePanel,  'sg-tool-api-console');
mount(manifestPanel, 'sg-tool-api-manifest');

// ── SgToolApi registration ────────────────────────────────────────────────────
const api = new SgToolApi({
    name:     'openrouter',
    version:  { api: '0.1.0', ui: '0.1.23', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './SKILL-human.md',
        browser: './SKILL-browser.md',
        api:     './SKILL-api.md',
    },
});

// ── connect ───────────────────────────────────────────────────────────────────
// Skip-if-same-key: resolve immediately when apiKey matches current session.
let _connectedKey = null;

api.register('connect', async ({ apiKey } = {}) => {
    const key = apiKey || state.userApiKey || localStorage.getItem('or-user-api-key') || '';
    if (!key) throw new Error('apiKey required');

    // Skip-if-same-key
    if (key === _connectedKey && state.userConnected) {
        const stats = await fetchKeyStats(key);
        return {
            provider: 'openrouter',
            balance:  stats.usage    ?? null,
            limit:    stats.limit    ?? null,
        };
    }

    const stats = await fetchKeyStats(key);
    _connectedKey = key;

    // Update shared state
    state.userApiKey    = key;
    state.userConnected = true;
    state.balance       = stats.usage   ?? null;
    state.limit         = stats.limit   ?? null;
    localStorage.setItem('or-user-api-key', key);

    // Drive the UI component so panels light up
    const userConnect = document.querySelector('sg-or-user-connect');
    if (userConnect?.connect) userConnect.connect(key);
    else {
        // Fallback: dispatch event directly on bus
        busEl.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
            bubbles: true,
            detail:  { provider: 'openrouter', apiKey: key },
        }));
    }

    return {
        provider: 'openrouter',
        balance:  stats.usage  ?? null,
        limit:    stats.limit  ?? null,
    };
}, {
    async: true,
    sanitiseParams: p => ({ ...p, apiKey: p?.apiKey ? '\u2022\u2022\u2022\u2022' : undefined }),
    events: [SGA_TOOL.TOOL_CONNECTED],
});

// ── disconnect ────────────────────────────────────────────────────────────────
api.register('disconnect', () => {
    _connectedKey = null;
    const userConnect = document.querySelector('sg-or-user-connect');
    if (userConnect?.disconnect) userConnect.disconnect();
    else {
        state.userApiKey    = '';
        state.userConnected = false;
        busEl.dispatchEvent(new CustomEvent(SGL_LLM.DISCONNECTED, { bubbles: true }));
    }
}, { async: false });

// ── getState ──────────────────────────────────────────────────────────────────
api.register('getState', () => ({
    userConnected:  state.userConnected,
    adminConnected: state.adminConnected,
    apiKey:         state.userApiKey ? '\u2022\u2022\u2022\u2022' : '',
    balance:        state.balance,
    limit:          state.limit,
    currency:       state.currency,
}), { async: false });

// ── getKeyStats ───────────────────────────────────────────────────────────────
api.register('getKeyStats', async () => {
    if (!state.userApiKey) throw new Error('Not connected — call connect() first');
    const data = await fetchKeyStats(state.userApiKey);
    state.balance = data.usage   ?? null;
    state.limit   = data.limit   ?? null;
    return data;
}, { async: true, events: ['tool:key-stats'] });

// ── getModels ─────────────────────────────────────────────────────────────────
api.register('getModels', async (filter = {}) => {
    if (!state.userApiKey) throw new Error('Not connected — call connect() first');
    return fetchModels(state.userApiKey, filter);
}, { async: true, events: ['tool:models-loaded'] });

// ── getModelDetail ────────────────────────────────────────────────────────────
api.register('getModelDetail', async modelId => {
    if (!state.userApiKey) throw new Error('Not connected — call connect() first');
    if (!modelId) throw new Error('modelId required');
    const detail = await fetchModelDetail(state.userApiKey, modelId);
    if (!detail) throw new Error(`Model not found: ${modelId}`);
    return detail;
}, { async: true });

// ── getUsage ──────────────────────────────────────────────────────────────────
api.register('getUsage', async (params = {}) => {
    if (!state.userApiKey) throw new Error('Not connected — call connect() first');
    return fetchUsage(state.userApiKey, params);
}, { async: true });

// ── getSpending ───────────────────────────────────────────────────────────────
api.register('getSpending', async () => {
    if (!state.userApiKey) throw new Error('Not connected — call connect() first');
    return fetchSpending(state.userApiKey);
}, { async: true });

// ── getActivity ───────────────────────────────────────────────────────────────
api.register('getActivity', async (params = {}) => {
    if (!state.userApiKey) throw new Error('Not connected — call connect() first');
    return fetchActivity(state.userApiKey, params);
}, { async: true });

// ── listKeys ──────────────────────────────────────────────────────────────────
api.register('listKeys', async () => {
    if (!state.managementKey) throw new Error('Admin not connected — load vault with management key');
    return fetchListKeys(state.managementKey);
}, { async: true });

// ── createKey ─────────────────────────────────────────────────────────────────
api.register('createKey', async (params = {}) => {
    if (!state.managementKey) throw new Error('Admin not connected — load vault with management key');
    if (!params.name) throw new Error('params.name required');
    return fetchCreateKey(state.managementKey, params);
}, {
    async: true,
    sanitiseParams: p => p,  // no secrets in params
});

// ── deleteKey ─────────────────────────────────────────────────────────────────
api.register('deleteKey', async hash => {
    if (!state.managementKey) throw new Error('Admin not connected — load vault with management key');
    if (!hash) throw new Error('hash required');
    await fetchDeleteKey(state.managementKey, hash);
}, { async: true });

api.activate();
