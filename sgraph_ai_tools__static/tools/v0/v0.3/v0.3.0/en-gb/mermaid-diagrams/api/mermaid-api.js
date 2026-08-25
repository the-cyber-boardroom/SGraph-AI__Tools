/**
 * Mermaid Diagrams — entry point + JS API Primitive.
 *
 * Imported as the manifest phase-3 entry module.
 * Initialises the UI then registers 8 methods on window.__tool.
 *
 * Methods:
 *   render(markup)     → Promise<{ svg, markup }>
 *   getMarkup()        → string
 *   setMarkup(markup)  → void
 *   loadDemo(id)       → { id, type, label, markup }
 *   getDemos()         → Array<{ id, type, label, description }>
 *   exportSvg()        → string | null
 *   exportPng()        → Promise<string | null>
 *   getState()         → { markup, hasRendered, theme }
 *
 * @module mermaid-api
 * @version 0.1.57
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { init }      from '../ui/ui-shell.js';

const layoutWrap = document.getElementById('layout-wrap');
const { renderer, editor, demos } = await init(layoutWrap);

// ── SgToolApi ─────────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:    'mermaid-diagrams',
    version: '0.1.57',
    manifest: './manifest.json',
    skills: {
        human:   './SKILL-human.md',
        browser: './SKILL-browser.md',
        api:     './SKILL-api.md',
    },
});

api.register('render', async (markup) => {
    if (typeof markup !== 'string' || !markup.trim()) {
        throw new Error('render() requires a non-empty markup string');
    }
    editor.setValue(markup, true);
    await renderer.render(markup);
    return { svg: renderer.getSvg(), markup };
}, { async: true });

api.register('getMarkup', () => editor.getValue());

api.register('setMarkup', (markup) => {
    if (typeof markup !== 'string') throw new Error('markup must be a string');
    editor.setValue(markup);
});

api.register('loadDemo', (id) => {
    const list = demos.getDemos();
    const found = list.find(d => d.id === id);
    if (!found) throw new Error(`Demo not found: "${id}". Call getDemos() for valid ids.`);
    demos.selectDemo(id);
    return found;
});

api.register('getDemos', () => demos.getDemos());

api.register('exportSvg', () => renderer.getSvg() ?? null);

api.register('exportPng', async () => {
    const svg = renderer.getSvg();
    if (!svg) return null;
    return _svgToPng(svg);
}, { async: true });

api.register('getState', () => ({
    markup:      editor.getValue(),
    hasRendered: renderer.getSvg() !== null,
    theme:       renderer.getAttribute('theme') || 'dark',
}));

api.activate();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @param {string} svg @returns {Promise<string>} */
function _svgToPng(svg) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url  = URL.createObjectURL(blob);
        const img  = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth  || 800;
            canvas.height = img.naturalHeight || 600;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0a0a18';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG rasterisation failed')); };
        img.src = url;
    });
}
