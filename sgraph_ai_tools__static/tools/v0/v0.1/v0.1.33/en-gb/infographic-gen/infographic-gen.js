/**
 * Infographic Generator — application orchestrator.
 *
 * v0.1.33 — Bottom Developer Panel
 *
 * Layout restructure: outer sg-layout becomes a column split (tool 74% / dev 26%).
 * The top tool area hosts an inner sg-layout (row: Create 36% | Results 64%).
 * The bottom dev panel is a stack with three tabs:
 *   - Explorer  (sg-tool-api-explorer)  health, methods, events, log
 *   - Console   (sg-tool-api-console)   interactive method caller
 *   - Manifest  (sg-tool-api-manifest)  manifest.json + API schema + SKILL files
 *
 * This pattern will be replicated across all tools that implement SgToolApi.
 *
 * @version 0.1.33
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SGL_LLM }    from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import { SgToolApi }  from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGA_TOOL }   from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api-events.js';

import '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import '/components/llm/sg-llm-request/v0/v0.1/v0.1.2/sg-llm-request.js';
import '/components/llm/sg-llm-stats/v0/v0.1/v0.1.1/sg-llm-stats.js';
import '/components/llm/sg-llm-infographic/v0/v0.1/v0.1.0/sg-llm-infographic.js';
import '/components/openrouter/sg-openrouter-generation/v0/v0.1/v0.1.1/sg-openrouter-generation.js';
import '/components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/sg-infographic-model-picker.js';
import '/components/infographic/sg-infographic-export/v0/v0.1/v0.1.0/sg-infographic-export.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

import { buildInputPanel } from './ui-input.js';
import { wireSend }        from './send.js';
import { wireConnect }     from './connect.js';
import { TEMPLATES }       from './constants.js';

// ── LocalStorage helpers ──────────────────────────────────────────────────────
const STORAGE_KEY = 'sg-infographic-gen-prefs';
function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function savePrefs(patch) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const apiKeyEl   = document.getElementById('api-key');
const connectBtn = document.getElementById('connect-btn');
const statusEl   = document.getElementById('conn-status');
const layoutWrap = document.getElementById('layout-wrap');

// ── Outer layout: column split (tool / dev panel) ─────────────────────────────
// Uses fractal pattern: outer column → two panels → inner row inside top panel.
const outerLayout = document.createElement('sg-layout');
layoutWrap.appendChild(outerLayout);

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

// ── Inner layout: row split (Create | Results) inside tool-area panel ──────────
toolAreaPanel.style.cssText = 'width:100%;height:100%;display:block;overflow:hidden;';
const innerLayout = document.createElement('sg-layout');
innerLayout.style.cssText = 'width:100%;height:100%;display:block;';
toolAreaPanel.appendChild(innerLayout);

const innerReady = new Promise(resolve => innerLayout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
innerLayout.setLayout({
    type: 'row', id: 'inner', sizes: [0.36, 0.64],
    children: [
        { type: 'stack', id: 's-left',  activeTab: 0,
          tabs: [{ type: 'tab', id: 't-input',       title: 'Create',  tag: 'div', locked: true, closable: false }] },
        { type: 'stack', id: 's-right', activeTab: 0,
          tabs: [{ type: 'tab', id: 't-placeholder', title: 'Results', tag: 'div', locked: true, closable: false }] },
    ],
});
await innerReady;

const leftPanel  = innerLayout.getPanelElement('t-input');
const rightPanel = innerLayout.getPanelElement('t-placeholder');

// ── Right panel placeholder ───────────────────────────────────────────────────
rightPanel.style.cssText = 'overflow:hidden;height:100%;display:block;background:#0d0d1a;';
const placeholder = document.createElement('div');
placeholder.style.cssText = [
    'height:100%', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:16px',
    'font-family:system-ui,sans-serif', 'padding:40px', 'box-sizing:border-box', 'text-align:center',
].join(';');
placeholder.innerHTML = `
  <div style="font-size:24px;font-weight:700;color:#e2e8f0;">\u{1F3A8} Infographic Generator</div>
  <div style="font-size:14px;color:#718096;max-width:420px;line-height:1.7;">
    Describe what you want \u2014 or pick a <strong style="color:#a0aec0;">template</strong> \u2014 then press
    <strong style="color:#4ECDC4;">\u25b6 Send</strong>.
  </div>
  <div style="font-size:13px;color:#4a5568;max-width:420px;line-height:1.8;text-align:left;">
    <strong style="color:#a0aec0;">Each result opens as a new tab.</strong><br>
    Drag tabs side by side to compare models.<br>
    Use the <strong style="color:#4ECDC4;">\u26a1 Explorer</strong> panel below to inspect the JS API.
  </div>
`;
rightPanel.appendChild(placeholder);

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

// ── Build input panel ─────────────────────────────────────────────────────────
const prefs = loadPrefs();
const {
    bus, modelPicker, textarea, advTextarea, directionTextarea,
    dropZone, sendBtn, activeRequests, updateStopBtn,
    getCurrentMode, getCurrentDoc,
} = buildInputPanel(leftPanel, prefs, savePrefs);

if (prefs.apiKey) apiKeyEl.value = prefs.apiKey;

// ── Wire send interceptor ─────────────────────────────────────────────────────
// Uses the inner layout for tab creation (s-right stack)
wireSend({
    bus, layout: innerLayout, apiKeyEl, modelPicker, textarea, advTextarea,
    directionTextarea, dropZone, activeRequests, updateStopBtn,
    getCurrentMode, getCurrentDoc,
    instanceId: 'infographic-generator:root',
});

// ── Send button ───────────────────────────────────────────────────────────────
sendBtn.addEventListener('click', () => {
    if (!textarea.value.trim()) { textarea.focus(); return; }
    bus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, { detail: {}, bubbles: false }));
});
textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendBtn.click();
});

// ── Wire connect handler ──────────────────────────────────────────────────────
wireConnect({ bus, apiKeyEl, connectBtn, statusEl, modelPicker, savePrefs });
if (prefs.apiKey) connectBtn.click();

// ── callId → Promise map for generate() ──────────────────────────────────────
const _pendingGenerates = new Map();

window.addEventListener(SGA_TOOL.GENERATION_COMPLETE, e => {
    const p = e.detail?.callId ? _pendingGenerates.get(e.detail.callId) : null;
    if (p) { _pendingGenerates.delete(e.detail.callId); p.resolve(e.detail); }
});
window.addEventListener(SGA_TOOL.GENERATION_ERROR, e => {
    const p = e.detail?.callId ? _pendingGenerates.get(e.detail.callId) : null;
    if (p) { _pendingGenerates.delete(e.detail.callId); p.reject(new Error(e.detail?.error || 'Generation failed')); }
});
window.addEventListener(SGA_TOOL.GENERATION_CANCELLED, e => {
    const p = e.detail?.callId ? _pendingGenerates.get(e.detail.callId) : null;
    if (p) { _pendingGenerates.delete(e.detail.callId); p.reject(new Error('Generation cancelled')); }
});

// ── SgToolApi registration ────────────────────────────────────────────────────
const api = new SgToolApi({
    name:     'infographic-generator',
    version:  { api: '0.1.0', ui: '0.1.33', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './SKILL-human.md',
        browser: './SKILL-browser.md',
        api:     './SKILL-api.md',
    },
});

// connect — skip-if-same-key
let _connectedKey   = null;
let _connectedModel = null;

api.register('connect', ({ apiKey, model } = {}) => {
    const newKey   = apiKey  || apiKeyEl.value.trim();
    const newModel = model   || modelPicker.getModel();
    if (newKey === _connectedKey && newModel === _connectedModel && _connectedKey !== '') {
        return Promise.resolve({ model: _connectedModel, provider: 'openrouter' });
    }
    if (apiKey) { apiKeyEl.value = apiKey; savePrefs({ apiKey }); }
    if (model)  modelPicker.setModel(model);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 15_000);
        bus.addEventListener(SGL_LLM.CONNECTED, e => {
            clearTimeout(timeout);
            _connectedKey   = newKey;
            _connectedModel = e.detail.model;
            resolve({ model: e.detail.model, provider: e.detail.provider });
        }, { once: true });
        connectBtn.click();
    });
}, {
    async: true,
    sanitiseParams: p => ({ ...p, apiKey: p?.apiKey ? '••••' : undefined }),
    events: [SGA_TOOL.TOOL_CONNECTED],
});

// generate — callId + renderUI
api.register('generate', ({ prompt, model, renderUI = true } = {}) => {
    if (prompt !== undefined) { textarea.value = prompt; savePrefs({ lastPrompt: prompt }); }
    if (model  !== undefined) { modelPicker.setModel(model); _connectedModel = model; }
    if (!textarea.value.trim()) return Promise.reject(new Error('No prompt — set a prompt first'));
    if (!apiKeyEl.value.trim()) return Promise.reject(new Error('Not connected — call connect() first'));
    const callId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        _pendingGenerates.set(callId, { resolve, reject });
        bus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail:  { renderUI, callId },
            bubbles: false,
        }));
    });
}, {
    async: true,
    events: [SGA_TOOL.GENERATION_STARTED, SGA_TOOL.GENERATION_COMPLETE, SGA_TOOL.GENERATION_ERROR, SGA_TOOL.GENERATION_CANCELLED],
});

// getState
api.register('getState', () => ({
    mode:              getCurrentMode(),
    prompt:            textarea.value,
    model:             modelPicker.getModel(),
    connected:         !!apiKeyEl.value.trim(),
    activeGenerations: activeRequests.size,
    systemPrompt:      advTextarea.value,
    document:          getCurrentDoc() ? { name: getCurrentDoc().name, type: getCurrentDoc().type } : null,
}), { async: false });

// setPrompt / getPrompt
api.register('setPrompt', text => { textarea.value = text; savePrefs({ lastPrompt: text }); }, { async: false });
api.register('getPrompt', ()   => textarea.value, { async: false });

// setModel / getModel
api.register('setModel', id  => { modelPicker.setModel(id); _connectedModel = id; }, { async: false });
api.register('getModel', ()  => modelPicker.getModel(),   { async: false });

// setTemplate
api.register('setTemplate', name => {
    const tmpl = TEMPLATES.find(
        t => t.id === name || t.label.toLowerCase() === String(name).toLowerCase(),
    );
    if (!tmpl) throw Object.assign(
        new Error(`Unknown template: "${name}". Available: ${TEMPLATES.map(t => t.id).join(', ')}`),
        { code: 'UNKNOWN_TEMPLATE' },
    );
    textarea.value = tmpl.prompt;
    savePrefs({ lastPrompt: tmpl.prompt });
    return tmpl.prompt;
}, { async: false });

// stop
api.register('stop', () => { for (const c of activeRequests.values()) c(); }, { async: false });

api.activate();
