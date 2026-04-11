/**
 * Infographic Generator — application orchestrator.
 * Wires together the outer layout, form panels, model picker, and SEND handling.
 *
 * Constants  → ./constants.js
 * Panel builders → ./panels.js
 * Model picker → sg-infographic-model-picker component
 * Export actions → sg-infographic-export component
 *
 * Loaded via: <script type="module" src="infographic-gen.js">
 *
 * @version 0.1.25
 */

import { SgLayout }   from '/core/sg-layout/v0.1.0/sg-layout.js';
import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';

import '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import '/components/llm/sg-llm-request/v0/v0.1/v0.1.2/sg-llm-request.js';
import '/components/llm/sg-llm-stats/v0/v0.1/v0.1.1/sg-llm-stats.js';
import '/components/llm/sg-llm-infographic/v0/v0.1/v0.1.0/sg-llm-infographic.js';
import '/components/openrouter/sg-openrouter-generation/v0/v0.1/v0.1.1/sg-openrouter-generation.js';
import { ALL_MODELS, DEFAULT_MODEL, isImageModel } from '/components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/sg-infographic-model-picker.js';
import '/components/infographic/sg-infographic-export/v0/v0.1/v0.1.0/sg-infographic-export.js';

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

import { STORAGE_KEY, DEFAULT_SYSTEM_PROMPT, DOCUMENT_SYSTEM_PROMPT, TEMPLATES, DOC_TEMPLATES } from './constants.js';
import { setupResultFractal, setupLoadingState, setupDetailsPanel, extractImageSrc } from './panels.js';

// ── LocalStorage helpers ──────────────────────────────────────────────────────

function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function savePrefs(patch) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); }

// ── DOM refs ──────────────────────────────────────────────────────────────────

const apiKeyEl   = document.getElementById('api-key');
const connectBtn = document.getElementById('connect-btn');
const statusEl   = document.getElementById('conn-status');
const layoutWrap = document.getElementById('layout-wrap');

function setStatus(text, type) { statusEl.textContent = text; statusEl.className = type; }

// ── Restore saved key ─────────────────────────────────────────────────────────

const prefs = loadPrefs();
if (prefs.apiKey) apiKeyEl.value = prefs.apiKey;

// ── Outer sg-layout ───────────────────────────────────────────────────────────

const layout = document.createElement('sg-layout');
layoutWrap.appendChild(layout);
const outerReady = new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
layout.setLayout({
    type: 'row', id: 'root', sizes: [0.36, 0.64],
    children: [
        { type: 'stack', id: 's-left',  activeTab: 0,
          tabs: [{ type: 'tab', id: 't-input', title: 'Create', tag: 'div', locked: true, closable: false }] },
        { type: 'stack', id: 's-right', activeTab: 0,
          tabs: [{ type: 'tab', id: 't-placeholder', title: 'Results', tag: 'div', locked: true, closable: false }] },
    ],
});
await outerReady;

const leftPanel  = layout.getPanelElement('t-input');
const rightPanel = layout.getPanelElement('t-placeholder');

// ── Event bus div (data-llm-bus for v0.1.1 component scoping) ─────────────────

const bus = document.createElement('div');
bus.setAttribute('data-llm-bus', '');
bus.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#0a0a18;';
leftPanel.style.cssText = 'overflow:hidden;height:100%;display:block;';
leftPanel.appendChild(bus);

// ── Model picker (top of left panel, full width) ───────────────────────────────

const modelPicker = document.createElement('sg-infographic-model-picker');
modelPicker.style.cssText = 'display:block;flex-shrink:0;';
bus.appendChild(modelPicker);

const savedModel = prefs.model && ALL_MODELS.includes(prefs.model) ? prefs.model : DEFAULT_MODEL;
modelPicker.setModel(savedModel);

// ── Mode state ────────────────────────────────────────────────────────────────

let currentMode = 'text'; // 'text' | 'document'
let currentDoc  = null;   // { name, type, textContent?, dataUrl? }

// ── Mode toggle ───────────────────────────────────────────────────────────────

const modeToggle = document.createElement('div');
modeToggle.style.cssText = 'display:flex;flex-shrink:0;border-bottom:1px solid #1a1a3a;background:#0d0d1a;';

function makeModeBtn(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
        'flex:1', 'border:none', 'border-top:none', 'border-left:none', 'border-right:none',
        'padding:7px', 'font-size:12px', 'font-weight:600', 'cursor:pointer',
        'font-family:system-ui,sans-serif', 'background:transparent', 'color:#718096',
        'border-bottom:2px solid transparent',
    ].join(';');
    modeToggle.appendChild(btn);
    return btn;
}
const textModeBtn = makeModeBtn('\u270f  Text');
const docModeBtn  = makeModeBtn('\u{1F4C4}  Document');
bus.appendChild(modeToggle);

// ── Templates row ─────────────────────────────────────────────────────────────

const templatesOuter = document.createElement('div');
templatesOuter.style.cssText = [
    'flex-shrink:0', 'overflow-x:auto', 'overflow-y:hidden',
    'background:#0d0d1a', 'border-bottom:1px solid #1a1a3a', 'scrollbar-width:thin',
].join(';');
const templatesRow = document.createElement('div');
templatesRow.style.cssText = [
    'display:flex', 'align-items:center', 'gap:5px',
    'padding:6px 10px', 'width:max-content', 'min-width:100%', 'box-sizing:border-box',
].join(';');
const templLabel = document.createElement('span');
templLabel.textContent = 'Templates:';
templLabel.style.cssText = 'font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;font-family:system-ui,sans-serif;flex-shrink:0;';
templatesRow.appendChild(templLabel);
templatesOuter.appendChild(templatesRow);
bus.appendChild(templatesOuter);

// ── Main textarea ─────────────────────────────────────────────────────────────

const textarea = document.createElement('textarea');
textarea.placeholder = 'Describe your infographic\u2026\n\nExample: "Create an infographic showing the 5 key benefits of serverless architecture, with an icon for each benefit and a cost comparison chart."';
textarea.style.cssText = [
    'flex:1', 'min-height:0', 'resize:none', 'width:100%', 'box-sizing:border-box',
    'padding:12px 14px', 'background:#0d0d1a', 'color:#e2e8f0',
    'border:none', 'border-bottom:1px solid #1a1a3a', 'outline:none',
    'font-size:14px', 'line-height:1.6', 'font-family:system-ui,sans-serif',
].join(';');
bus.appendChild(textarea);

// Restore last prompt
if (prefs.lastPrompt) textarea.value = prefs.lastPrompt;
textarea.addEventListener('input', () => savePrefs({ lastPrompt: textarea.value }));

// ── Document mode panel ───────────────────────────────────────────────────────

const docModeDiv = document.createElement('div');
docModeDiv.style.cssText = 'display:none;flex-direction:column;flex:1;min-height:0;';
bus.appendChild(docModeDiv);

// Doc templates row
const docTemplOuter = document.createElement('div');
docTemplOuter.style.cssText = [
    'flex-shrink:0', 'overflow-x:auto', 'overflow-y:hidden',
    'background:#0d0d1a', 'border-bottom:1px solid #1a1a3a', 'scrollbar-width:thin',
].join(';');
const docTemplRow = document.createElement('div');
docTemplRow.style.cssText = [
    'display:flex', 'align-items:center', 'gap:5px',
    'padding:5px 8px', 'width:max-content', 'min-width:100%', 'box-sizing:border-box',
].join(';');
const docTemplLabel = document.createElement('span');
docTemplLabel.textContent = 'Focus:';
docTemplLabel.style.cssText = 'font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;font-family:system-ui,sans-serif;flex-shrink:0;';
docTemplRow.appendChild(docTemplLabel);
DOC_TEMPLATES.forEach(tmpl => {
    const btn = document.createElement('button');
    btn.innerHTML = `${tmpl.icon} ${tmpl.label}`;
    btn.style.cssText = [
        'background:#1a1a3a', 'border:1px solid #333d5a', 'border-radius:4px',
        'color:#e2e8f0', 'padding:3px 9px', 'font-size:12px', 'cursor:pointer',
        'white-space:nowrap', 'font-family:system-ui,sans-serif', 'flex-shrink:0',
    ].join(';');
    btn.addEventListener('click', () => { directionTextarea.value = tmpl.direction; });
    docTemplRow.appendChild(btn);
});
docTemplOuter.appendChild(docTemplRow);
docModeDiv.appendChild(docTemplOuter);

// Drop zone
const dropZone = document.createElement('div');
dropZone.style.cssText = [
    'flex:1', 'min-height:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:10px',
    'margin:8px', 'border:2px dashed #333d5a', 'border-radius:8px',
    'cursor:pointer', 'font-family:system-ui,sans-serif', 'transition:border-color 0.15s',
    'background:#0d0d1a',
].join(';');

const dropIcon    = document.createElement('div');
const dropMsg     = document.createElement('div');
const dropSubMsg  = document.createElement('div');
const docFileInfo = document.createElement('div');
const clearDocBtn = document.createElement('button');

dropIcon.textContent = '\u{1F4C4}';
dropIcon.style.cssText = 'font-size:32px;';
dropMsg.textContent = 'Drop a document here';
dropMsg.style.cssText = 'font-size:14px;font-weight:600;color:#a0aec0;text-align:center;';
dropSubMsg.textContent = 'or click to browse \u2014 PDF, Markdown, text, CSV, or image';
dropSubMsg.style.cssText = 'font-size:12px;color:#4a5568;text-align:center;';
docFileInfo.style.cssText = 'display:none;font-size:13px;color:#4ECDC4;font-weight:600;text-align:center;';
clearDocBtn.textContent = '\u2715 Clear';
clearDocBtn.style.cssText = 'display:none;background:none;border:1px solid #333d5a;border-radius:4px;color:#718096;padding:3px 10px;font-size:11px;cursor:pointer;font-family:system-ui,sans-serif;';

dropZone.appendChild(dropIcon);
dropZone.appendChild(dropMsg);
dropZone.appendChild(dropSubMsg);
dropZone.appendChild(docFileInfo);
dropZone.appendChild(clearDocBtn);
docModeDiv.appendChild(dropZone);

// Hidden file input
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.pdf,.md,.markdown,.txt,.csv,.json,.html,.js,.ts,.py,.png,.jpg,.jpeg,.webp,.gif';
fileInput.style.display = 'none';
docModeDiv.appendChild(fileInput);

// Direction textarea (optional)
const directionTextarea = document.createElement('textarea');
directionTextarea.placeholder = 'Direction (optional): e.g. "focus on the timeline" or "highlight key metrics"';
directionTextarea.rows = 2;
directionTextarea.style.cssText = [
    'flex-shrink:0', 'resize:none', 'width:100%', 'box-sizing:border-box',
    'padding:8px 10px', 'background:#111122', 'color:#e2e8f0',
    'border:none', 'border-top:1px solid #1a1a3a', 'outline:none',
    'font-size:13px', 'line-height:1.5', 'font-family:system-ui,sans-serif',
].join(';');
docModeDiv.appendChild(directionTextarea);

// Drop zone interaction
function setDocLoaded(doc) {
    currentDoc = doc;
    dropIcon.textContent = doc.type === 'image' ? '\u{1F5BC}\ufe0f' : doc.name.endsWith('.pdf') ? '\u{1F4D1}' : '\u{1F4DD}';
    dropMsg.textContent = doc.name;
    dropMsg.style.color = '#4ECDC4';
    dropSubMsg.style.display = 'none';
    docFileInfo.style.display = 'block';
    docFileInfo.textContent = doc.type === 'image'
        ? 'Image loaded \u2014 ready to generate'
        : `${Math.round((doc.textContent?.length || 0) / 4)} tokens est.`;
    clearDocBtn.style.display = 'inline-block';
    dropZone.style.borderColor = '#4ECDC4';
}
function clearDoc() {
    currentDoc = null;
    dropIcon.textContent = '\u{1F4C4}';
    dropMsg.textContent = 'Drop a document here';
    dropMsg.style.color = '#a0aec0';
    dropSubMsg.style.display = '';
    docFileInfo.style.display = 'none';
    clearDocBtn.style.display = 'none';
    dropZone.style.borderColor = '#333d5a';
    fileInput.value = '';
}
clearDocBtn.addEventListener('click', e => { e.stopPropagation(); clearDoc(); });

function readFile(file) {
    const isImage = file.type.startsWith('image/');
    const reader  = new FileReader();
    if (isImage) {
        reader.onload = ev => setDocLoaded({ name: file.name, type: 'image', dataUrl: ev.target.result });
        reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
        reader.onload = ev => setDocLoaded({ name: file.name, type: 'pdf',
            dataUrl: ev.target.result,
            textContent: null,   // PDF text extraction not available client-side
        });
        reader.readAsDataURL(file);
    } else {
        reader.onload = ev => setDocLoaded({ name: file.name, type: 'text', textContent: ev.target.result });
        reader.readAsText(file);
    }
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) readFile(fileInput.files[0]); });
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.style.borderColor = '#4ECDC4'; });
dropZone.addEventListener('dragleave', () => { if (!currentDoc) dropZone.style.borderColor = '#333d5a'; });
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
});

// ── Mode switcher ─────────────────────────────────────────────────────────────

function setMode(mode) {
    const isDoc = mode === 'document';
    // Swap system prompt default when mode changes (only if still on a known default)
    if (mode !== currentMode) {
        const oldDefault = currentMode === 'document' ? DOCUMENT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
        const newDefault = isDoc ? DOCUMENT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
        if (advTextarea.value === oldDefault) advTextarea.value = newDefault;
    }
    currentMode = mode;
    // Toggle visibility
    templatesRow.style.display = isDoc ? 'none' : '';
    textarea.style.display     = isDoc ? 'none' : '';
    docModeDiv.style.display   = isDoc ? 'flex' : 'none';
    // Active indicator on toggle buttons
    textModeBtn.style.cssText = textModeBtn.style.cssText.replace(/border-bottom:[^;]+/, `border-bottom:2px solid ${isDoc ? 'transparent' : '#4ECDC4'}`);
    textModeBtn.style.color = isDoc ? '#718096' : '#e2e8f0';
    docModeBtn.style.cssText = docModeBtn.style.cssText.replace(/border-bottom:[^;]+/, `border-bottom:2px solid ${isDoc ? '#4ECDC4' : 'transparent'}`);
    docModeBtn.style.color = isDoc ? '#e2e8f0' : '#718096';
}
textModeBtn.addEventListener('click', () => setMode('text'));
docModeBtn.addEventListener('click',  () => setMode('document'));
setMode('text'); // initialise

// Add template buttons (after textarea exists)
TEMPLATES.forEach(tmpl => {
    const btn = document.createElement('button');
    btn.innerHTML = `${tmpl.icon} ${tmpl.label}`;
    btn.title = tmpl.prompt.substring(0, 100) + '\u2026';
    btn.style.cssText = [
        'background:#1a1a3a', 'border:1px solid #333d5a', 'border-radius:4px',
        'color:#e2e8f0', 'padding:3px 9px', 'font-size:12px', 'cursor:pointer',
        'white-space:nowrap', 'font-family:system-ui,sans-serif', 'flex-shrink:0',
    ].join(';');
    btn.addEventListener('click', () => {
        textarea.value = tmpl.prompt;
        savePrefs({ lastPrompt: tmpl.prompt });
        textarea.focus();
    });
    templatesRow.appendChild(btn);
});

// ── Bottom action bar (Send + Stop + Advanced toggle) ─────────────────────────

const actionBar = document.createElement('div');
actionBar.style.cssText = [
    'display:flex', 'align-items:center', 'gap:8px', 'flex-shrink:0',
    'padding:8px 10px', 'background:#0a0a18', 'border-top:1px solid #1a1a3a',
].join(';');

const advancedToggle = document.createElement('button');
advancedToggle.textContent = '\u2699 Advanced';
advancedToggle.style.cssText = [
    'background:none', 'border:none', 'color:#718096', 'font-size:12px',
    'cursor:pointer', 'padding:4px 8px', 'font-family:system-ui,sans-serif',
    'white-space:nowrap',
].join(';');

const activeRequests = new Map(); // panelEl \u2192 cancelFn

const stopBtn = document.createElement('button');
stopBtn.textContent = '\u25a0 Stop';
stopBtn.style.cssText = [
    'background:#7f1d1d', 'border:none', 'border-radius:6px', 'color:#fca5a5',
    'padding:7px 14px', 'font-size:13px', 'font-weight:600', 'cursor:pointer',
    'flex-shrink:0', 'display:none',
].join(';');
stopBtn.addEventListener('click', () => { for (const c of activeRequests.values()) c(); });

const sendBtn = document.createElement('button');
sendBtn.innerHTML = '&#9658; Send';
sendBtn.style.cssText = [
    'background:#1d4ed8', 'border:none', 'border-radius:6px', 'color:#fff',
    'padding:8px 0', 'font-size:14px', 'font-weight:600', 'cursor:pointer',
    'flex:1',
].join(';');

actionBar.appendChild(advancedToggle);
actionBar.appendChild(stopBtn);
actionBar.appendChild(sendBtn);
bus.appendChild(actionBar);

function updateStopBtn() {
    stopBtn.style.display = activeRequests.size > 0 ? 'inline-block' : 'none';
    stopBtn.textContent = activeRequests.size > 1 ? `\u25a0 Stop all (${activeRequests.size})` : '\u25a0 Stop';
}

// ── Advanced section (system prompt override, hidden by default) ───────────────

const advancedSection = document.createElement('div');
advancedSection.style.cssText = [
    'display:none', 'flex-direction:column', 'flex-shrink:0',
    'border-top:1px solid #1a1a3a', 'background:#0a0a18',
].join(';');
const advLabel = document.createElement('div');
advLabel.textContent = 'System Prompt Override';
advLabel.style.cssText = 'font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.05em;padding:6px 10px 2px;font-family:system-ui,sans-serif;';
const advTextarea = document.createElement('textarea');
advTextarea.value = DEFAULT_SYSTEM_PROMPT;
advTextarea.style.cssText = [
    'resize:none', 'height:80px', 'width:100%', 'box-sizing:border-box',
    'padding:8px 10px', 'background:#111122', 'color:#a0aec0',
    'border:1px solid #1a1a3a', 'outline:none', 'font-size:12px', 'line-height:1.5',
    'font-family:system-ui,sans-serif',
].join(';');
advTextarea.addEventListener('focus', () => advTextarea.style.borderColor = '#4ECDC4');
advTextarea.addEventListener('blur',  () => advTextarea.style.borderColor = '#1a1a3a');
advancedSection.appendChild(advLabel);
advancedSection.appendChild(advTextarea);
bus.appendChild(advancedSection);

let advancedOpen = false;
advancedToggle.addEventListener('click', () => {
    advancedOpen = !advancedOpen;
    advancedSection.style.display = advancedOpen ? 'flex' : 'none';
    advancedToggle.style.color = advancedOpen ? '#4ECDC4' : '#718096';
});

// ── Right panel placeholder ───────────────────────────────────────────────────

rightPanel.style.cssText = 'overflow:hidden;height:100%;display:block;background:#0d0d1a;';
const placeholder = document.createElement('div');
placeholder.style.cssText = [
    'height:100%', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:16px',
    'font-family:system-ui,sans-serif', 'padding:40px', 'box-sizing:border-box',
    'text-align:center',
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

// ── SEND interceptor (capture phase) ─────────────────────────────────────────

bus.addEventListener(SGL_LLM.SEND, async e => {
    e.stopImmediatePropagation();

    const model  = modelPicker.getModel();
    const apiKey = apiKeyEl.value.trim();
    if (!apiKey) return;

    // Guard: require text in text mode, or a loaded doc in document mode
    if (currentMode === 'text' && !textarea.value.trim()) return;
    if (currentMode === 'document' && !currentDoc) {
        dropZone.style.borderColor = '#fc8181';
        setTimeout(() => { dropZone.style.borderColor = currentDoc ? '#4ECDC4' : '#333d5a'; }, 1200);
        return;
    }

    const isDocMode = currentMode === 'document';
    const tabTitle  = isDocMode
        ? `\u{1F4C4} ${model.split('/').pop().substring(0, 28)}`
        : model.split('/').pop().substring(0, 35);

    // Pre-compute context so it can be shown in the details panel immediately
    const sysPrompt   = advTextarea.value.trim() || (isDocMode ? DOCUMENT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT);
    const direction   = isDocMode
        ? (directionTextarea.value.trim() || 'Create an infographic that visualises the key information from this document.')
        : null;
    const docSnapshot = isDocMode ? { name: currentDoc.name, type: currentDoc.type, textContent: currentDoc.textContent } : null;

    // Create a new result tab in the right stack
    const tabId   = layout.addTabToStack('s-right', { tag: 'div', title: tabTitle });
    const panelEl = layout.getPanelElement(tabId);

    // Fractal inner layout (async — awaited before firing mini-bus SEND)
    const { imgPanel, detailsPanel } = await setupResultFractal(panelEl, model);
    setupLoadingState(imgPanel, model);
    const detailsCtl = await setupDetailsPanel(detailsPanel, model, { systemPrompt: sysPrompt, doc: docSnapshot, direction });

    // Filename for export
    const filename = `infographic-${model.split('/').pop()}.png`;

    // Isolated mini-bus + fresh sg-llm-request per request
    const miniBus = document.createElement('div');
    miniBus.setAttribute('data-llm-bus', '');
    document.body.appendChild(miniBus);
    miniBus.appendChild(document.createElement('sg-llm-request'));

    miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
        detail: { provider: 'openrouter', model, apiKey, baseUrl: '' },
    }));

    const finish = () => {
        imgPanel._clearTimer?.();
        imgPanel._cancel = null;
        activeRequests.delete(panelEl);
        updateStopBtn();
        setTimeout(() => miniBus.remove(), 0);
    };

    miniBus.addEventListener(SGL_LLM.REQUEST_COMPLETE, ev => {
        const src = extractImageSrc(ev.detail);
        if (src) {
            imgPanel.querySelector('[data-role="loading"]')?.remove();
            const img = imgPanel.querySelector('img');
            if (img) { img.src = src; img.style.display = 'block'; }
            detailsCtl.setExportSource(src, filename);
        } else if (isImageModel(model)) {
            const loadDiv = imgPanel.querySelector('[data-role="loading"]');
            if (loadDiv) loadDiv.innerHTML = '<div style="color:#a0aec0;font-size:14px;text-align:center;padding:20px;">No image returned.<br><span style="font-size:12px;color:#4a5568;">Try a different model or refine your prompt.</span></div>';
        }
        detailsCtl.update(ev.detail);
        const genId = ev.detail?.rawResponse?.id
                   ?? ev.detail?.rawChunks?.find(c => c?.id)?.id
                   ?? null;
        if (genId) setTimeout(() => detailsCtl.showGeneration(genId, apiKey), 500);
        finish();
    });

    miniBus.addEventListener(SGL_LLM.REQUEST_ERROR, ev => {
        const loadDiv = imgPanel.querySelector('[data-role="loading"]');
        if (loadDiv) loadDiv.innerHTML = `<div style="color:#fc8181;font-size:14px;font-family:system-ui;text-align:center;padding:20px;">Error: ${ev.detail?.error || 'Request failed'}</div>`;
        finish();
    });

    miniBus.addEventListener(SGL_LLM.REQUEST_CANCEL, () => {
        const loadDiv = imgPanel.querySelector('[data-role="loading"]');
        if (loadDiv) loadDiv.innerHTML = '<div style="color:#718096;font-size:14px;text-align:center;">Cancelled</div>';
        finish();
    });

    const cancelFn = () => miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CANCEL, { bubbles: false }));
    activeRequests.set(panelEl, cancelFn);
    imgPanel._cancel = cancelFn;
    updateStopBtn();

    // Assemble messages and fire on mini-bus
    let messages;
    if (isDocMode) {
        const userContent = [];
        if (currentDoc.type === 'image') {
            userContent.push({ type: 'image_url', image_url: { url: currentDoc.dataUrl } });
            userContent.push({ type: 'text', text: direction });
        } else if (currentDoc.type === 'pdf') {
            // sg-llm-request v0.1.2 translates binary_file \u2192 Anthropic document block
            const base64 = currentDoc.dataUrl.split(',')[1];
            userContent.push({ type: 'binary_file', name: currentDoc.name, mediaType: 'application/pdf', data: base64 });
            userContent.push({ type: 'text', text: direction });
        } else {
            userContent.push({ type: 'text', text: `Document (${currentDoc.name}):\n\n${currentDoc.textContent}\n\n${direction}` });
        }
        messages = [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userContent },
        ];
    } else {
        messages = [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: [{ type: 'text', text: textarea.value.trim() }] },
        ];
    }

    miniBus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
        detail: { messages, model },
        bubbles: false,
    }));
}, true); // capture phase

// ── Send button ───────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', () => {
    if (!textarea.value.trim()) { textarea.focus(); return; }
    bus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, { detail: {}, bubbles: false }));
});

textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendBtn.click();
});

// ── Connect handler ───────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
    const apiKey = apiKeyEl.value.trim();
    const model  = modelPicker.getModel();
    if (!apiKey) { setStatus('OpenRouter key required', 'error'); return; }

    setStatus('Connecting\u2026', '');
    connectBtn.disabled = true;

    try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        savePrefs({ apiKey, model });
        setStatus(`Connected \u2713  (${model.split('/').pop()})`, 'ok');

        bus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
            detail: { provider: 'openrouter', model, apiKey, baseUrl: '' },
            bubbles: true,
        }));
    } catch (err) {
        setStatus(`Error: ${err.message}`, 'error');
    }
    connectBtn.disabled = false;
});

// Auto-connect on load if key was saved
if (prefs.apiKey) connectBtn.click();

// Re-connect + save when model changes
modelPicker.addEventListener('infographic:model-changed', e => {
    savePrefs({ model: e.detail.model });
    if (apiKeyEl.value.trim()) connectBtn.click();
});
