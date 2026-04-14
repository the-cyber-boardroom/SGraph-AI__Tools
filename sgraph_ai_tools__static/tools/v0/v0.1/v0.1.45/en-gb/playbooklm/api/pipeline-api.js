/**
 * PlaybookLM — SgToolApi registration and application entry point.
 *
 * v0.1.45 changes:
 *  - Version bump to ui:0.1.45
 *  - Added 3 new API methods for slide version management:
 *    getSlideVersions(index), getSelectedVersion(index), setSelectedVersion(index, vIdx)
 *
 * @module pipeline-api
 * @version 0.1.1
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGL_LLM }   from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

import { PipelineState } from './pipeline-state.js';
import * as steps from './pipeline-steps.js';

// ── State (module-singleton) ──────────────────────────────────────────────────
const state = new PipelineState();

// ── SgToolApi setup ───────────────────────────────────────────────────────────
const api = new SgToolApi({
  name:     'playbooklm',
  version:  { api: '0.1.1', ui: '0.1.45', content: '0.1.0' },
  manifest: './manifest.json',
  skills:   { human: './skills/SKILL-human.md', browser: './skills/SKILL-browser.md', api: './skills/SKILL-api.md' },
});

// ── Connect ───────────────────────────────────────────────────────────────────

/**
 * @param {{apiKey?: string, textModel?: string, imageModel?: string}} params
 * @returns {Promise<{provider: string, textModel: string, imageModel: string}>}
 */
async function connectImpl(params = {}) {
  const apiKeyEl    = document.getElementById('api-key');
  const apiKey      = params.apiKey  || apiKeyEl?.value?.trim() || '';
  const textModel   = params.textModel  || steps.DEFAULT_TEXT_MODEL;
  const imageModel  = params.imageModel || steps.DEFAULT_IMAGE_MODEL;

  if (!apiKey) throw new Error('API key is required');

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter auth failed: HTTP ${res.status}`);

  state.setConnected(apiKey, textModel, imageModel);

  if (apiKeyEl && params.apiKey) apiKeyEl.value = apiKey;
  const statusEl = document.getElementById('conn-status');
  if (statusEl) statusEl.textContent = 'Connected ✓';

  const bus = document.getElementById('plm-bus');
  if (bus) {
    bus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
      detail: { provider: 'openrouter', model: textModel, apiKey, baseUrl: '' },
      bubbles: true,
    }));
  }

  return { provider: 'openrouter', textModel, imageModel };
}

// ── Register all 22 methods ───────────────────────────────────────────────────

api.register('connect',
  (p) => connectImpl(p),
  { async: true, sanitiseParams: p => ({ ...p, apiKey: p?.apiKey ? '••••' : undefined }) }
);

api.register('loadSources',
  (files) => state.loadSources(files),
  { async: true }
);

api.register('getSources',
  () => state.getSources(),
  { async: false }
);

api.register('removeSource',
  (i) => state.removeSource(i),
  { async: false }
);

api.register('generatePresentation',
  (p) => steps.generatePresentation(state, p),
  { async: true }
);

api.register('getPresentation',
  () => state.getPresentation(),
  { async: false }
);

api.register('setPresentation',
  (t) => state.setPresentation(t),
  { async: false }
);

api.register('generateSlideBriefs',
  (p) => steps.generateSlideBriefs(state, p),
  { async: true }
);

api.register('getSlideBriefs',
  () => state.getSlideBriefs(),
  { async: false }
);

api.register('setSlideBrief',
  (p) => state.setSlideBrief(p.index, p.brief),
  { async: false }
);

api.register('addSlideBrief',
  (b) => state.addSlideBrief(b),
  { async: false }
);

api.register('removeSlideBrief',
  (i) => state.removeSlideBrief(i),
  { async: false }
);

api.register('generateSlide',
  (p) => steps.generateSlide(state, p),
  { async: true }
);

api.register('generateAllSlides',
  (p) => steps.generateAllSlides(state, p),
  { async: true }
);

api.register('getSlideResults',
  () => state.getSlideResults(),
  { async: false }
);

// ── Slide version methods ─────────────────────────────────────────────────────

api.register('getSlideVersions',
  (index) => state.getSlideVersions(index),
  { async: false }
);

api.register('getSelectedVersion',
  (index) => state.getSelectedVersion(index),
  { async: false }
);

api.register('setSelectedVersion',
  (p) => state.setSelectedVersion(p.index, p.versionIdx),
  { async: false }
);

// ── Export ────────────────────────────────────────────────────────────────────

api.register('exportDeck',
  (p) => steps.exportDeck(state, p),
  { async: true }
);

api.register('getState',
  () => state.getFullState(),
  { async: false }
);

api.register('getPipelineStatus',
  () => state.getStatus(),
  { async: false }
);

api.register('stop',
  () => state.stop(),
  { async: false }
);

// ── Activate ──────────────────────────────────────────────────────────────────
api.activate();

// ── init() ────────────────────────────────────────────────────────────────────

/**
 * @param {object} manifest
 * @returns {Promise<void>}
 */
export async function init(manifest) {
  const { buildShell } = await import('../ui/ui-shell.js');
  await buildShell({ state, manifest });
}
