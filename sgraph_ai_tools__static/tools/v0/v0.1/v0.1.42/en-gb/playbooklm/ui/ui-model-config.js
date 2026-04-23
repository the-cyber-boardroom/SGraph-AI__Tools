/**
 * PlaybookLM — Per-phase model configuration.
 *
 * Maps pipeline steps 2–4 to LLM model IDs. Choices persist to localStorage.
 * Each step panel embeds a model selector via buildModelSelector(phase).
 * Other modules read the live choice via getPhaseModel(phase).
 *
 * @module ui-model-config
 * @version 0.1.0
 */

const LS_KEY = 'plm-model-config';

/**
 * Phase definitions: type, recommended model list, and default.
 * Only steps that invoke an LLM (2, 3, 4) have entries.
 *
 * @type {Object.<number, {label: string, type: string, typeBadge: string, default: string, recommended: Array<{id: string, label: string}>}>}
 */
export const PHASE_CONFIGS = {
  2: {
    label:     'Step 2 — Strategy',
    type:      'text',
    typeBadge: 'reasoning',
    default:   'anthropic/claude-sonnet-4-6',
    recommended: [
      { id: 'anthropic/claude-opus-4-6',           label: 'Claude Opus 4.6 — deepest reasoning' },
      { id: 'anthropic/claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 — recommended' },
      { id: 'anthropic/claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 — budget' },
      { id: 'google/gemini-2.5-flash',              label: 'Gemini 2.5 Flash — budget' },
      { id: 'openai/gpt-4o',                        label: 'GPT-4o — alternative' },
    ],
  },
  3: {
    label:     'Step 3 — Briefs',
    type:      'text',
    typeBadge: 'reasoning',
    default:   'anthropic/claude-sonnet-4-6',
    recommended: [
      { id: 'anthropic/claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 — recommended' },
      { id: 'anthropic/claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 — fast + cheap' },
      { id: 'google/gemini-2.5-flash',              label: 'Gemini 2.5 Flash — budget' },
    ],
  },
  4: {
    label:     'Step 4 — Images',
    type:      'image',
    typeBadge: 'image gen',
    default:   'google/gemini-3.1-flash-image-preview',
    recommended: [
      { id: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image — recommended' },
      { id: 'google/gemini-2.0-flash-exp:image',     label: 'Gemini 2.0 Flash Image — alternative' },
    ],
  },
};

/**
 * Get the currently configured model for a pipeline phase.
 * Falls back to the phase default if nothing has been saved.
 *
 * @param {number} phase - Step number (2, 3, or 4)
 * @returns {string} OpenRouter model ID
 */
export function getPhaseModel(phase) {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return saved[phase] || PHASE_CONFIGS[phase]?.default || '';
  } catch (_) {
    return PHASE_CONFIGS[phase]?.default || '';
  }
}

/**
 * Persist a model choice for a pipeline phase.
 *
 * @param {number} phase
 * @param {string} model
 * @returns {void}
 */
export function savePhaseModel(phase, model) {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    saved[phase] = model;
    localStorage.setItem(LS_KEY, JSON.stringify(saved));
  } catch (_) { /* storage full — silently ignore */ }
}

/**
 * Build an inline model selector row for embedding in a step panel.
 * Shows: label · datalist input · type badge.
 * Saves to localStorage on change / blur.
 *
 * @param {number} phase - Step number (2, 3, or 4)
 * @returns {HTMLElement}
 */
export function buildModelSelector(phase) {
  const config = PHASE_CONFIGS[phase];
  if (!config) return document.createElement('div');

  const current = getPhaseModel(phase);
  const listId  = `plm-models-list-${phase}`;

  const wrap = document.createElement('div');
  wrap.className = 'plm-model-selector';

  const label = document.createElement('span');
  label.className = 'plm-model-selector-label';
  label.textContent = 'Model:';

  const input = document.createElement('input');
  input.className   = 'plm-model-selector-input';
  input.setAttribute('list', listId);
  input.value       = current;
  input.autocomplete = 'off';
  input.spellcheck  = false;
  input.placeholder = config.default;

  const datalist = document.createElement('datalist');
  datalist.id = listId;
  config.recommended.forEach(r => {
    const opt = document.createElement('option');
    opt.value       = r.id;
    opt.textContent = r.label;
    datalist.appendChild(opt);
  });

  const badge = document.createElement('span');
  badge.className = `plm-model-selector-badge plm-model-badge-${config.type}`;
  badge.textContent = config.typeBadge;

  wrap.appendChild(label);
  wrap.appendChild(input);
  wrap.appendChild(datalist);
  wrap.appendChild(badge);

  function _save() {
    const val = input.value.trim();
    if (val) savePhaseModel(phase, val);
  }

  input.addEventListener('change', _save);
  input.addEventListener('blur', _save);

  return wrap;
}
