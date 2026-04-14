/**
 * Page Builder — _page.json editor with live preview + theme explorer.
 *
 * Uses PageLayoutRenderer from the SG/Send CDN to render _page.json directly
 * into a DOM element — no iframe. The same render path as the production
 * Browse component.
 *
 * Renderer API:  PageLayoutRenderer.render(container, json, folderPath, zipTree, browseStub)
 * JSON schema:   { title, theme, components: [...] }  (top-level uses "components")
 *                Section/columns nested items use "children", not "components".
 * CSS from:      https://dev.send.sgraph.ai/_common/js/components/send-download/send-browse-v031--page-layout.css
 * JS from:       https://dev.send.sgraph.ai/_common/js/page-layout-renderer.js
 *
 * @version 0.1.42
 */

import '/core/sg-layout/v0.1.0/sg-layout.js';
import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SgToolApi }  from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { THEME_SCHEMES, PALETTE_BLOCKS, DEMO_JSON } from './constants.js';

// ── Ensure PageLayoutRenderer is available (global var from CDN script) ──────
if (typeof PageLayoutRenderer === 'undefined') {
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://dev.send.sgraph.ai/_common/js/page-layout-renderer.js';
        s.onload  = resolve;
        s.onerror = () => reject(new Error('Failed to load PageLayoutRenderer from CDN'));
        document.head.appendChild(s);
    });
}

// ── Minimal stub for the browseInstance parameter ────────────────────────────
// The renderer uses browseInstance for vault asset resolution and navigation.
// In the page-builder, there's no zip context, so stubs are safe no-ops.
const _stub = {
    _objectUrls:     [],
    _buildSwitchUrl: () => '#',
    _openFileTab:    () => {},
    zipInstance:     null,
};

// ── State ─────────────────────────────────────────────────────────────────────
let _currentTheme = 'default';
let _currentVp    = 'desktop';
let _renderTimer  = null;

const VIEWPORTS = {
    phone:   { max: '375px',  label: 'Phone (375px)' },
    tablet:  { max: '768px',  label: 'Tablet (768px)' },
    desktop: { max: '100%',   label: 'Desktop (full width)' },
};

// ── Layout setup ──────────────────────────────────────────────────────────────
const layoutWrap = document.getElementById('layout-wrap');

const sgLayout = document.createElement('sg-layout');
sgLayout.style.cssText = 'display:block;width:100%;height:100%;';
layoutWrap.appendChild(sgLayout);

const layoutReady = new Promise(resolve => sgLayout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
sgLayout.setLayout({
    type: 'row', id: 'root', sizes: [0.40, 0.60],
    children: [
        { type: 'stack', id: 's-left',  activeTab: 0,
          tabs: [{ type: 'tab', id: 't-editor',  title: '✏ Editor',  tag: 'div', locked: true, closable: false }] },
        { type: 'stack', id: 's-right', activeTab: 0,
          tabs: [{ type: 'tab', id: 't-preview', title: '👁 Preview', tag: 'div', locked: true, closable: false }] },
    ],
});
await layoutReady;

const leftPanel  = sgLayout.getPanelElement('t-editor');
const rightPanel = sgLayout.getPanelElement('t-preview');

// ── Build editor panel ────────────────────────────────────────────────────────
leftPanel.style.cssText = 'overflow:hidden;height:100%;';

const editorDiv = document.createElement('div');
editorDiv.className = 'pb-editor';
leftPanel.appendChild(editorDiv);

// Theme row
const themeRow = document.createElement('div');
themeRow.className = 'pb-theme-row';
themeRow.innerHTML = '<span class="pb-label">Theme:</span>';

const themeSelect = document.createElement('select');
themeSelect.className = 'pb-theme-select';
for (const name of Object.keys(THEME_SCHEMES)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    themeSelect.appendChild(opt);
}
themeRow.appendChild(themeSelect);
editorDiv.appendChild(themeRow);

// Theme swatches — visual chips showing accent + background colour for each scheme
const swatchRow = document.createElement('div');
swatchRow.className = 'pb-swatch-row';
const _swatchBtns = {};
for (const [name, scheme] of Object.entries(THEME_SCHEMES)) {
    const chip = document.createElement('button');
    chip.className = 'pb-swatch' + (name === _currentTheme ? ' pb-swatch--active' : '');
    chip.dataset.theme = name;
    chip.title = `${name} — ${scheme.mode} mode, accent ${scheme.accent}`;

    const accentDot = document.createElement('span');
    accentDot.className = 'pb-swatch__dot';
    accentDot.style.background = scheme.accent;

    const bgDot = document.createElement('span');
    bgDot.className = 'pb-swatch__bg';
    bgDot.style.background = scheme.background;

    chip.appendChild(accentDot);
    chip.appendChild(bgDot);
    chip.appendChild(document.createTextNode(name));
    chip.addEventListener('click', () => _selectSwatch(name));
    swatchRow.appendChild(chip);
    _swatchBtns[name] = chip;
}
editorDiv.appendChild(swatchRow);

// Textarea
const textarea = document.createElement('textarea');
textarea.className = 'pb-textarea';
textarea.spellcheck = false;
textarea.autocomplete = 'off';
textarea.value = JSON.stringify(DEMO_JSON, null, 2);
editorDiv.appendChild(textarea);

// Error bar
const errorBar = document.createElement('div');
errorBar.className = 'pb-error-bar';
editorDiv.appendChild(errorBar);

// Action buttons
const actionsDiv = document.createElement('div');
actionsDiv.className = 'pb-actions';
actionsDiv.innerHTML = `
    <button class="pb-btn pb-btn--primary" id="pb-copy">📋 Copy JSON</button>
    <button class="pb-btn" id="pb-demo">Load Demo</button>
    <button class="pb-btn" id="pb-clear">Clear</button>
`;
editorDiv.appendChild(actionsDiv);

// Palette label
const paletteLabel = document.createElement('div');
paletteLabel.className = 'pb-palette-label';
paletteLabel.textContent = 'Insert component:';
editorDiv.appendChild(paletteLabel);

// Palette chips
const paletteDiv = document.createElement('div');
paletteDiv.className = 'pb-palette';
for (const item of PALETTE_BLOCKS) {
    const chip = document.createElement('button');
    chip.className = 'pb-chip';
    chip.textContent = item.id;
    chip.title = item.nav
        ? `Insert ${item.id} into page.navigation`
        : `Insert ${item.id} component`;
    chip.addEventListener('click', () => _insertBlock(item));
    paletteDiv.appendChild(chip);
}
editorDiv.appendChild(paletteDiv);

// ── Build preview panel ───────────────────────────────────────────────────────
rightPanel.style.cssText = 'overflow:hidden;height:100%;';

const previewPanel = document.createElement('div');
previewPanel.className = 'pb-preview-panel';
rightPanel.appendChild(previewPanel);

// Viewport toolbar
const vpBar = document.createElement('div');
vpBar.className = 'pb-viewport-bar';

const vpBtns = {};
for (const [vp, cfg] of Object.entries(VIEWPORTS)) {
    const btn = document.createElement('button');
    btn.className = 'pb-vp-btn' + (vp === _currentVp ? ' pb-vp-btn--active' : '');
    btn.textContent = vp === 'desktop' ? '🖥 Desktop' : vp === 'tablet' ? '⬜ Tablet' : '📱 Phone';
    btn.title = cfg.label;
    btn.addEventListener('click', () => _setViewport(vp));
    vpBar.appendChild(btn);
    vpBtns[vp] = btn;
}
const vpLabel = document.createElement('span');
vpLabel.className = 'pb-vp-label';
vpLabel.textContent = VIEWPORTS[_currentVp].label;
vpBar.appendChild(vpLabel);
previewPanel.appendChild(vpBar);

// Scroll area — dark "stage" that always fills the right panel height.
// The stage shows the available canvas space even when content is short.
const previewScroll = document.createElement('div');
previewScroll.className = 'pb-preview-scroll';
previewPanel.appendChild(previewScroll);

// Canvas wrapper — constrained to viewport max-width, centred by the flex stage.
// IMPORTANT: we do NOT pass this element to PageLayoutRenderer directly.
// The renderer sets container.className = 'plr-page plr-page--...' which would
// wipe our pb-preview-container sizing CSS. We use a child renderTarget instead.
const previewContainer = document.createElement('div');
previewContainer.className = 'pb-preview-container';
previewScroll.appendChild(previewContainer);

// ── Render pipeline ───────────────────────────────────────────────────────────

function _scheduleRender() {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(_render, 200);
}

async function _render() {
    let parsed;
    try {
        parsed = JSON.parse(textarea.value);
        errorBar.textContent = '';
        textarea.classList.remove('pb-textarea--error');
    } catch (e) {
        errorBar.textContent = `JSON error: ${e.message}`;
        textarea.classList.add('pb-textarea--error');
        return;
    }

    // Clear canvas — renderer will append to renderTarget.
    previewContainer.innerHTML = '';
    previewContainer.style.background = '';

    // Render into a child div so pb-preview-container keeps its sizing CSS
    // while the renderer applies plr-page / plr-page--light etc. to the target.
    const renderTarget = document.createElement('div');
    renderTarget.style.cssText = 'width:100%;min-height:100%;box-sizing:border-box;';
    previewContainer.appendChild(renderTarget);

    try {
        await PageLayoutRenderer.render(renderTarget, parsed, '', [], _stub);
        // Mirror the page background on the canvas wrapper so the dark stage
        // is still visible behind a constrained (phone/tablet) viewport.
        if (parsed.theme?.background) {
            previewContainer.style.background = parsed.theme.background;
        }
    } catch (err) {
        previewContainer.innerHTML =
            `<div class="pb-render-error">Render error:\n${_esc(err.message)}</div>`;
    }
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Theme picker ──────────────────────────────────────────────────────────────

themeSelect.addEventListener('change', () => _selectSwatch(themeSelect.value));

/** Central theme-selection handler — syncs dropdown, swatches, JSON, and preview. */
function _selectSwatch(name) {
    _currentTheme = name;
    themeSelect.value = name;
    for (const [n, btn] of Object.entries(_swatchBtns)) {
        btn.classList.toggle('pb-swatch--active', n === name);
    }
    _applyThemeToJson(name);
}

function _applyThemeToJson(name) {
    let parsed;
    try { parsed = JSON.parse(textarea.value); } catch { return; }
    parsed.theme = { ...THEME_SCHEMES[name] };
    textarea.value = JSON.stringify(parsed, null, 2);
    _render();
}

// ── Textarea input ────────────────────────────────────────────────────────────
textarea.addEventListener('input', _scheduleRender);

// ── Viewport switcher ─────────────────────────────────────────────────────────

function _setViewport(vp) {
    _currentVp = vp;
    previewContainer.style.maxWidth = VIEWPORTS[vp].max;
    for (const [v, btn] of Object.entries(vpBtns)) {
        btn.classList.toggle('pb-vp-btn--active', v === vp);
    }
    vpLabel.textContent = VIEWPORTS[vp].label;
}

// ── Action buttons ────────────────────────────────────────────────────────────

const copyBtn = document.getElementById('pb-copy');
copyBtn.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(textarea.value);
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy JSON'; }, 2000);
    } catch {
        copyBtn.textContent = '✗ Failed';
        setTimeout(() => { copyBtn.textContent = '📋 Copy JSON'; }, 2000);
    }
});

document.getElementById('pb-demo').addEventListener('click', () => {
    textarea.value = JSON.stringify(DEMO_JSON, null, 2);
    _selectSwatch('default');
    _render();
});

document.getElementById('pb-clear').addEventListener('click', () => {
    const empty = { title: 'New Page', theme: { ...THEME_SCHEMES.default }, components: [] };
    textarea.value = JSON.stringify(empty, null, 2);
    _selectSwatch('default');
    _render();
});

// ── Palette component insert ──────────────────────────────────────────────────

function _insertBlock(item) {
    let parsed;
    try {
        parsed = JSON.parse(textarea.value);
    } catch {
        parsed = { title: 'New Page', theme: { ...THEME_SCHEMES.default }, components: [] };
    }

    if (item.nav) {
        // Navigation lives in page.navigation (top-level array), not page.components
        if (!Array.isArray(parsed.navigation)) parsed.navigation = [];
        parsed.navigation.push(JSON.parse(JSON.stringify(item.item)));
    } else {
        if (!Array.isArray(parsed.components)) parsed.components = [];
        parsed.components.push(JSON.parse(JSON.stringify(item.block)));
    }

    textarea.value = JSON.stringify(parsed, null, 2);
    _render();
}

// ── SgToolApi ─────────────────────────────────────────────────────────────────
const api = new SgToolApi({
    name:     'page-builder',
    version:  { api: '0.1.0', ui: '0.1.42', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   { human: './SKILL-human.md', browser: './SKILL-browser.md', api: './SKILL-api.md' },
});

api.register('setJson', (json) => {
    textarea.value = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
    _render();
}, { async: false });

api.register('getJson', () => {
    try { return JSON.parse(textarea.value); } catch { return null; }
}, { async: false });

api.register('setTheme', (name) => {
    if (!THEME_SCHEMES[name]) throw new Error(`Unknown theme: "${name}". Available: ${Object.keys(THEME_SCHEMES).join(', ')}`);
    _selectSwatch(name);
}, { async: false });

api.register('getTheme', () => _currentTheme, { async: false });

api.register('render', () => _render(), { async: true });

api.register('getState', () => ({
    theme:    _currentTheme,
    viewport: _currentVp,
    valid:    errorBar.textContent === '',
    prompt:   null,   // page-builder has no text prompt
}), { async: false });

api.activate();

// ── Initial render ────────────────────────────────────────────────────────────
_render();
