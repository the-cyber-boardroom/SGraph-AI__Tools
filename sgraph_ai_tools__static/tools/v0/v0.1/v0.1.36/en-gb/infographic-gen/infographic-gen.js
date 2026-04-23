/**
 * Infographic Generator — application orchestrator.
 *
 * v0.1.36 — Image attachment support in Text mode
 *
 * Destructures getCurrentImage from buildInputPanel and passes it through to
 * wireSend, enabling multimodal requests (logo, screenshot, reference
 * infographic) alongside the text prompt. getState() now includes an `image`
 * field: { name } when an image is attached, null otherwise.
 *
 * @version 0.1.36
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

// ── Main layout: flex column ──────────────────────────────────────────────────
layoutWrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

// ── Tool area ─────────────────────────────────────────────────────────────────
const toolArea = document.createElement('div');
toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
layoutWrap.appendChild(toolArea);

// ── Resize handle (between tool area and dev panel) ───────────────────────────
const resizeHandle = document.createElement('div');
resizeHandle.style.cssText = [
    'flex-shrink:0', 'height:6px', 'display:none',
    'background:#1a1a3a', 'cursor:ns-resize',
    'position:relative', 'transition:background 120ms',
].join(';');
// Centred grip indicator
const grip = document.createElement('div');
grip.style.cssText = [
    'position:absolute', 'left:50%', 'top:50%',
    'transform:translate(-50%,-50%)',
    'width:36px', 'height:2px',
    'background:#2d3748', 'border-radius:2px',
    'pointer-events:none',
].join(';');
resizeHandle.appendChild(grip);
resizeHandle.addEventListener('mouseenter', () => {
    resizeHandle.style.background = '#4ECDC4';
    grip.style.background = '#4ECDC4';
});
resizeHandle.addEventListener('mouseleave', () => {
    resizeHandle.style.background = '#1a1a3a';
    grip.style.background = '#2d3748';
});
layoutWrap.appendChild(resizeHandle);

// ── Collapsible dev panel ─────────────────────────────────────────────────────
const DEV_HEIGHT_DEFAULT = 340;
let devOpen    = false;
let devCurrentH = DEV_HEIGHT_DEFAULT;

const devPanel = document.createElement('div');
devPanel.style.cssText = [
    'height:0', 'overflow:hidden', 'flex-shrink:0',
    'transition:height 0.22s ease',
    'display:flex', 'flex-direction:column',
    'background:#0a0a18',
].join(';');
layoutWrap.appendChild(devPanel);

// ── Drag-to-resize logic ──────────────────────────────────────────────────────
resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = devPanel.offsetHeight;
    devPanel.style.transition = 'none'; // disable during drag for smooth feel

    const onMove = e => {
        const delta = startY - e.clientY;   // drag up → positive → taller
        devCurrentH = Math.max(140, Math.min(startH + delta, window.innerHeight * 0.75));
        devPanel.style.height = `${devCurrentH}px`;
    };
    const onUp = () => {
        devPanel.style.transition = 'height 0.22s ease';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
});

// Tab bar inside dev panel
const devTabBar = document.createElement('div');
devTabBar.style.cssText = 'display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;';
devPanel.appendChild(devTabBar);

// Content area
const devContent = document.createElement('div');
devContent.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0;';
devPanel.appendChild(devContent);

// ── Dev panel tabs ────────────────────────────────────────────────────────────
const DEV_TABS = [
    { id: 'explorer', label: '⚡ Explorer', tag: 'sg-tool-api-explorer' },
    { id: 'console',  label: '> Console',  tag: 'sg-tool-api-console' },
    { id: 'manifest', label: '📋 Manifest', tag: 'sg-tool-api-manifest' },
    { id: 'skills',   label: '📄 Skills' },
];
let activeDevTab = 'explorer';
const devBtns = {};

function switchDevTab(id) {
    activeDevTab = id;
    for (const [tid, btn] of Object.entries(devBtns)) {
        const on = tid === id;
        btn.style.color            = on ? '#4ECDC4' : '#4a5568';
        btn.style.borderBottomColor = on ? '#4ECDC4' : 'transparent';
    }
    for (const pane of devContent.querySelectorAll('[data-dev-pane]')) {
        pane.style.display = pane.dataset.devPane === id ? 'block' : 'none';
    }
}

for (const t of DEV_TABS) {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    btn.dataset.devTab = t.id;
    btn.style.cssText = [
        'padding:7px 14px', 'font-size:11px', 'font-weight:600',
        'background:none', 'border:none', 'border-bottom:2px solid transparent',
        'cursor:pointer', 'white-space:nowrap',
        'font-family:system-ui,sans-serif',
        `color:${t.id === activeDevTab ? '#4ECDC4' : '#4a5568'}`,
        `border-bottom-color:${t.id === activeDevTab ? '#4ECDC4' : 'transparent'}`,
    ].join(';');
    btn.addEventListener('click', () => switchDevTab(t.id));
    devTabBar.appendChild(btn);
    devBtns[t.id] = btn;

    const pane = document.createElement('div');
    pane.dataset.devPane = t.id;
    pane.style.cssText = [
        'position:absolute', 'inset:0',
        `display:${t.id === activeDevTab ? 'block' : 'none'}`,
        'overflow:hidden',
    ].join(';');

    if (t.tag) {
        const el = document.createElement(t.tag);
        el.style.cssText = 'display:block;width:100%;height:100%;';
        pane.appendChild(el);
    } else {
        pane.appendChild(_buildSkillsPanel());
    }

    devContent.appendChild(pane);
}

// ── Skills panel builder ──────────────────────────────────────────────────────
function _buildSkillsPanel() {
    const SKILLS = [
        { label: '👤 Human Guide',         url: './SKILL-human.md' },
        { label: '🎭 Browser / Playwright', url: './SKILL-browser.md' },
        { label: '⚙️ API Spec',             url: './SKILL-api.md' },
    ];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:100%;overflow-y:auto;padding:10px 12px;background:#0a0a18;box-sizing:border-box;';

    for (const s of SKILLS) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#0d0d1a;border:1px solid #1a1a3a;border-radius:4px;margin-bottom:8px;overflow:hidden;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;cursor:pointer;font-family:system-ui,sans-serif;';
        hdr.innerHTML = `
            <span style="font-size:12px;font-weight:600;color:#a0aec0;">${s.label}</span>
            <span style="color:#4ECDC4;font-size:10px;">▼ expand</span>
        `;
        hdr.addEventListener('mouseenter', () => { hdr.style.background = '#111120'; });
        hdr.addEventListener('mouseleave', () => { hdr.style.background = ''; });

        const body = document.createElement('pre');
        body.style.cssText = 'display:none;margin:0;padding:10px;font-size:11px;line-height:1.65;color:#718096;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;font-family:system-ui,sans-serif;border-top:1px solid #1a1a3a;';
        body.textContent = 'Loading…';

        hdr.addEventListener('click', () => {
            const open = body.style.display === 'block';
            body.style.display = open ? 'none' : 'block';
            hdr.querySelector('span:last-child').textContent = open ? '▼ expand' : '▲ collapse';
            if (!open && body.textContent === 'Loading…') {
                fetch(s.url).then(r => r.text()).then(t => { body.textContent = t; })
                            .catch(() => { body.textContent = 'Failed to load.'; });
            }
        });

        card.appendChild(hdr);
        card.appendChild(body);
        wrap.appendChild(card);
    }
    return wrap;
}

// ── Footer bar (always visible, click toggles dev panel) ─────────────────────
const footerBar = document.createElement('div');
footerBar.style.cssText = 'flex-shrink:0;padding:0 0.75rem 0.5rem;background:#0a0a18;';

const footerInner = document.createElement('div');
footerInner.style.cssText = [
    'background:#0d0d1a', 'border:1px solid #1e293b', 'border-radius:6px',
    'display:flex', 'align-items:center', 'gap:8px', 'padding:8px 12px',
    'cursor:pointer', 'user-select:none',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'font-size:13px', 'color:#cbd5e0',
    'transition:background 150ms',
].join(';');
footerInner.innerHTML = `
    <span class="ft-icon"   style="font-size:16px;line-height:1;">🔧</span>
    <span class="ft-name"   style="font-weight:600;font-size:13px;"></span>
    <span class="ft-ver"    style="color:#64748b;font-size:11px;font-family:'SF Mono',Monaco,monospace;"></span>
    <span class="ft-status" style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;background:rgba(78,205,196,0.15);color:#4ecdc4;"></span>
    <span class="ft-deps"   style="color:#64748b;font-size:11px;"></span>
    <span class="ft-arrow"  style="margin-left:auto;color:#64748b;font-size:11px;transition:transform 150ms;">▸</span>
`;
footerBar.appendChild(footerInner);
layoutWrap.appendChild(footerBar);

footerInner.addEventListener('mouseenter', () => { footerInner.style.background = 'rgba(78,205,196,0.04)'; });
footerInner.addEventListener('mouseleave', () => { footerInner.style.background = devOpen ? 'rgba(78,205,196,0.04)' : ''; });

footerInner.addEventListener('click', () => {
    devOpen = !devOpen;
    devPanel.style.height      = devOpen ? `${devCurrentH}px` : '0';
    resizeHandle.style.display = devOpen ? 'block' : 'none';
    // When open: square top corners so panel + handle form one continuous block
    footerInner.style.borderRadius = devOpen ? '0 0 6px 6px' : '6px';
    footerInner.style.borderTop    = devOpen ? '1px solid #4ECDC4' : '1px solid #1e293b';
    footerInner.style.background   = devOpen ? 'rgba(78,205,196,0.04)' : '';
    const arrow = footerInner.querySelector('.ft-arrow');
    if (arrow) arrow.style.transform = devOpen ? 'rotate(90deg)' : '';
});

// Populate footer from manifest
fetch('./manifest.json')
    .then(r => r.json())
    .then(m => {
        const deps = Object.values(m.dependencies || {}).reduce((s, a) => s + a.length, 0);
        const q = cls => footerInner.querySelector(`.${cls}`);
        if (q('ft-icon'))   q('ft-icon').textContent   = m.icon    || '🔧';
        if (q('ft-name'))   q('ft-name').textContent   = m.name    || '';
        if (q('ft-ver'))    q('ft-ver').textContent    = `v${m.version || ''}`;
        if (q('ft-status')) q('ft-status').textContent = m.status  || '';
        if (q('ft-deps'))   q('ft-deps').textContent   = `${deps} deps`;
    })
    .catch(() => {});

// ── Inner layout: row split (Create | Results) inside tool area ───────────────
const innerLayout = document.createElement('sg-layout');
innerLayout.style.cssText = 'width:100%;height:100%;display:block;';
toolArea.appendChild(innerLayout);

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
    Use \u{1F4CE} to attach a reference image (logo, screenshot) in Text mode.<br>
    Click the footer bar below to open the <strong style="color:#4ECDC4;">JS API panel</strong>
    (Explorer \u00b7 Console \u00b7 Manifest \u00b7 Skills).
  </div>
`;
rightPanel.appendChild(placeholder);

// ── Build input panel ─────────────────────────────────────────────────────────
const prefs = loadPrefs();
const {
    bus, modelPicker, textarea, advTextarea, directionTextarea,
    dropZone, sendBtn, activeRequests, updateStopBtn,
    getCurrentMode, getCurrentDoc, getCurrentImage,
} = buildInputPanel(leftPanel, prefs, savePrefs);

if (prefs.apiKey) apiKeyEl.value = prefs.apiKey;

// ── Wire send interceptor ─────────────────────────────────────────────────────
wireSend({
    bus, layout: innerLayout, apiKeyEl, modelPicker, textarea, advTextarea,
    directionTextarea, dropZone, activeRequests, updateStopBtn,
    getCurrentMode, getCurrentDoc, getCurrentImage,
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
    version:  { api: '0.1.0', ui: '0.1.36', content: '0.1.0' },
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
    document:          getCurrentDoc()   ? { name: getCurrentDoc().name,   type: getCurrentDoc().type   } : null,
    image:             getCurrentImage() ? { name: getCurrentImage().name }                               : null,
}), { async: false });

api.register('setPrompt', text => { textarea.value = text; savePrefs({ lastPrompt: text }); }, { async: false });
api.register('getPrompt', ()   => textarea.value, { async: false });
api.register('setModel',  id   => { modelPicker.setModel(id); _connectedModel = id; }, { async: false });
api.register('getModel',  ()   => modelPicker.getModel(), { async: false });

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

api.register('stop', () => { for (const c of activeRequests.values()) c(); }, { async: false });

api.activate();
