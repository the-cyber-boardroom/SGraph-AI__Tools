/**
 * mv-api — SgToolApi registration and tool boot. The entry point.
 *
 * Every action the UI performs is registered here first; the UI is one consumer
 * of this surface, not a privileged one. Anything a person can do with the
 * buttons, a script can do with `window.__tool`.
 *
 * NOTE: SgToolApi wraps every registered action in a Promise, sync or not — so
 * callers must always `await`, and internal code calls the pipeline functions
 * directly rather than going back through `api.*`.
 *
 * @module markdown-viewer/mv-api
 */

import { SgToolApi }     from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { state, snapshot, loadPrefs } from './mv-state.js';
import { MV_EVENTS }     from './mv-events.js';
import * as pipeline     from './mv-pipeline.js';

import { mountToolbar }  from '../ui/ui-toolbar.js';
import { mountDocument } from '../ui/ui-document.js';
import { mountOpen }     from '../ui/ui-open.js';

const api = new SgToolApi({
    name:    'markdown-viewer',
    version: '0.1.0',
    manifest: './manifest.json',
    skills: {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

// ── Loading ──────────────────────────────────────────────────────────────────

api.register('loadText', (params = {}) => pipeline.loadText(params.text, params.name, 'text'), {
    async: false,
    events: [MV_EVENTS.LOADED, MV_EVENTS.RENDERED],
});

api.register('loadFile', (params = {}) => pipeline.loadFile(params.file), {
    async: true,
    events: [MV_EVENTS.LOADED, MV_EVENTS.RENDERED],
});

api.register('loadUrl', (params = {}) => pipeline.loadUrl(params.url), {
    async: true,
    events: [MV_EVENTS.LOADED, MV_EVENTS.RENDERED],
});

// ── Reading ──────────────────────────────────────────────────────────────────

api.register('getStatus',   () => snapshot(),          { async: false });
api.register('getSource',   () => state.source,        { async: false });
api.register('getHtml',     () => state.html,          { async: false });
api.register('getHeadings', () => state.headings,      { async: false });
api.register('getFrontMatter', () => state.config,     { async: false });

/** Render arbitrary markdown without disturbing the loaded document. */
api.register('renderToHtml', (params = {}) =>
    pipeline.renderStandalone(params.text, params.options), { async: false });

// ── View ─────────────────────────────────────────────────────────────────────

api.register('setSourceView', (params = {}) => pipeline.setSourceView(params.source), {
    async: false, events: [MV_EVENTS.VIEW],
});

api.register('setOptions', (params = {}) => pipeline.setOptions(params), {
    async: false, events: [MV_EVENTS.OPTIONS],
});

api.register('print', () => pipeline.print(), { async: false, events: [MV_EVENTS.PRINTED] });
api.register('clear', () => pipeline.clear(), { async: false, events: [MV_EVENTS.CLEARED] });

// ── Boot ─────────────────────────────────────────────────────────────────────

function boot() {
    loadPrefs();
    mountToolbar();
    mountDocument();
    mountOpen();
    api.activate();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export { api };
