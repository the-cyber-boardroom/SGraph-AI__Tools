/**
 * Infographic Generator — application orchestrator.
 *
 * v0.1.31 changes:
 *   - generate({ renderUI: false }) — headless mode; LLM request runs but no
 *     result tab is created. Useful for Playwright automation.
 *   - Version bump to 0.1.31
 *   (send.js also updated: cost API polling + renderUI:false wiring)
 *
 * @version 0.1.31
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

// ── Outer sg-layout ───────────────────────────────────────────────────────────
const layout = document.createElement('sg-layout');
layoutWrap.appendChild(layout);
const outerReady = new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
layout.setLayout({
    type: 'row', id: 'root', sizes: [0.36, 0.64],
    children: [
        { type: 'stack', id: 's-left', activeTab: 0,
          tabs: [
              { type: 'tab', id: 't-input',    title: 'Create',      tag: 'div', locked: true,  closable: false },
              { type: 'tab', id: 't-explorer', title: 'API Explorer', tag: 'div', locked: false, closable: false },
          ] },
        { type: 'stack', id: 's-right', activeTab: 0,
          tabs: [{ type: 'tab', id: 't-placeholder', title: 'Results', tag: 'div', locked: true, closable: false }] },
    ],
});
await outerReady;

const leftPanel     = layout.getPanelElement('t-input');
const explorerPanel = layout.getPanelElement('t-explorer');
const rightPanel    = layout.getPanelElement('t-placeholder');

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
    Change the model between sends to run multiple in parallel.
  </div>
`;
rightPanel.appendChild(placeholder);

// ── API Explorer panel ────────────────────────────────────────────────────────
explorerPanel.style.cssText = 'width:100%;height:100%;display:block;overflow:hidden;';
const explorerEl = document.createElement('sg-tool-api-explorer');
explorerEl.style.cssText = 'display:block;width:100%;height:100%;';
explorerPanel.appendChild(explorerEl);

// ── Build input panel ─────────────────────────────────────────────────────────
const prefs = loadPrefs();
const {
    bus, modelPicker, textarea, advTextarea, directionTextarea,
    dropZone, sendBtn, activeRequests, updateStopBtn,
    getCurrentMode, getCurrentDoc,
} = buildInputPanel(leftPanel, prefs, savePrefs);

if (prefs.apiKey) apiKeyEl.value = prefs.apiKey;

// ── Wire send interceptor ─────────────────────────────────────────────────────
wireSend({
    bus, layout, apiKeyEl, modelPicker, textarea, advTextarea,
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

// Auto-connect on load if key was saved
if (prefs.apiKey) connectBtn.click();

// ── FIFO queue for generate() ─────────────────────────────────────────────────
const _pendingGenerates = [];
window.addEventListener(SGA_TOOL.GENERATION_COMPLETE, e => {
    const p = _pendingGenerates.shift();
    if (p) p.resolve(e.detail);
});
window.addEventListener(SGA_TOOL.GENERATION_ERROR, e => {
    const p = _pendingGenerates.shift();
    if (p) p.reject(new Error(e.detail?.error || 'Generation failed'));
});
window.addEventListener(SGA_TOOL.GENERATION_CANCELLED, () => {
    const p = _pendingGenerates.shift();
    if (p) p.reject(new Error('Generation cancelled'));
});

// ── SgToolApi registration ────────────────────────────────────────────────────
const api = new SgToolApi({
    name:     'infographic-generator',
    version:  { api: '0.1.0', ui: '0.1.31', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './SKILL-human.md',
        browser: './SKILL-browser.md',
        api:     './SKILL-api.md',
    },
});

// connect({ apiKey?, model? }) → Promise<{ model, provider }>
api.register('connect', ({ apiKey, model } = {}) => {
    if (apiKey) { apiKeyEl.value = apiKey; savePrefs({ apiKey }); }
    if (model)  modelPicker.setModel(model);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 15_000);
        bus.addEventListener(SGL_LLM.CONNECTED, e => {
            clearTimeout(timeout);
            resolve({ model: e.detail.model, provider: e.detail.provider });
        }, { once: true });
        connectBtn.click();
    });
}, {
    async: true,
    sanitiseParams: p => ({ ...p, apiKey: p?.apiKey ? '••••' : undefined }),
    events: [SGA_TOOL.TOOL_CONNECTED],
});

// generate({ prompt?, model?, renderUI? }) → Promise<detail>
// renderUI: false — skips tab creation (headless mode for Playwright)
api.register('generate', ({ prompt, model, renderUI = true } = {}) => {
    if (prompt !== undefined) { textarea.value = prompt; savePrefs({ lastPrompt: prompt }); }
    if (model  !== undefined) modelPicker.setModel(model);
    if (!textarea.value.trim()) return Promise.reject(new Error('No prompt — set a prompt first'));
    if (!apiKeyEl.value.trim()) return Promise.reject(new Error('Not connected — call connect() first'));
    return new Promise((resolve, reject) => {
        _pendingGenerates.push({ resolve, reject });
        bus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail:  { renderUI },
            bubbles: false,
        }));
    });
}, {
    async: true,
    events: [SGA_TOOL.GENERATION_STARTED, SGA_TOOL.GENERATION_COMPLETE, SGA_TOOL.GENERATION_ERROR, SGA_TOOL.GENERATION_CANCELLED],
});

// getState()
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
api.register('setModel', id  => modelPicker.setModel(id), { async: false });
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

// stop()
api.register('stop', () => { for (const c of activeRequests.values()) c(); }, { async: false });

api.activate();
