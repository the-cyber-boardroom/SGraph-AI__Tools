/**
 * PlaybookLM — Per-phase model configuration.
 *
 * v0.1.44: Fixed Haiku model ID to anthropic/claude-haiku-4.5 (OpenRouter
 * uses dot-notation, not the Anthropic API full date suffix).
 *
 * @module ui-model-config
 * @version 0.1.2
 */

const LS_KEY = 'plm-model-config';

/** Sentinel value for the "custom" select option. */
const CUSTOM_VAL = '__custom__';

/**
 * Phase definitions: type, default, and recommended model list.
 * Only steps that invoke an LLM (2, 3, 4) have entries.
 *
 * @type {Object.<number, {label: string, type: string, typeBadge: string, default: string, groups: Array<{label: string, models: Array<{id: string, label: string}>}>}>}
 */
export const PHASE_CONFIGS = {
  2: {
    label:     'Step 2 — Strategy',
    type:      'text',
    typeBadge: 'reasoning',
    default:   'anthropic/claude-sonnet-4-6',
    groups: [
      {
        label: 'Anthropic Claude 4',
        models: [
          { id: 'anthropic/claude-opus-4-6',   label: 'Claude Opus 4.6 \u2014 deepest reasoning' },
          { id: 'anthropic/claude-sonnet-4-6',  label: 'Claude Sonnet 4.6 \u2014 recommended' },
          { id: 'anthropic/claude-haiku-4.5',   label: 'Claude Haiku 4.5 \u2014 fast + cheap' },
        ],
      },
      {
        label: 'Google Gemini',
        models: [
          { id: 'google/gemini-2.5-pro',   label: 'Gemini 2.5 Pro \u2014 Google reasoning' },
          { id: 'google/gemini-2.5-flash',  label: 'Gemini 2.5 Flash \u2014 budget' },
        ],
      },
      {
        label: 'OpenAI',
        models: [
          { id: 'openai/gpt-4o',      label: 'GPT-4o' },
          { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini \u2014 cheap' },
        ],
      },
    ],
  },
  3: {
    label:     'Step 3 — Briefs',
    type:      'text',
    typeBadge: 'reasoning',
    default:   'anthropic/claude-sonnet-4-6',
    groups: [
      {
        label: 'Anthropic Claude 4',
        models: [
          { id: 'anthropic/claude-sonnet-4-6',  label: 'Claude Sonnet 4.6 \u2014 recommended' },
          { id: 'anthropic/claude-haiku-4.5',   label: 'Claude Haiku 4.5 \u2014 fast + cheap' },
          { id: 'anthropic/claude-opus-4-6',    label: 'Claude Opus 4.6 \u2014 overkill but great' },
        ],
      },
      {
        label: 'Google Gemini',
        models: [
          { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash \u2014 budget' },
          { id: 'google/gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
        ],
      },
      {
        label: 'OpenAI',
        models: [
          { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini \u2014 cheap' },
          { id: 'openai/gpt-4o',      label: 'GPT-4o' },
        ],
      },
    ],
  },
  4: {
    label:     'Step 4 — Images',
    type:      'image',
    typeBadge: 'image gen',
    default:   'google/gemini-3.1-flash-image-preview',
    groups: [
      {
        label: 'Google Gemini (image)',
        models: [
          { id: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image \u2014 recommended' },
          { id: 'google/gemini-2.0-flash-exp:image',     label: 'Gemini 2.0 Flash Image \u2014 alternative' },
        ],
      },
    ],
  },
};

/**
 * Get all model IDs for a phase (flattened from groups).
 *
 * @param {number} phase
 * @returns {string[]}
 */
function _allIds(phase) {
  return (PHASE_CONFIGS[phase]?.groups || []).flatMap(g => g.models.map(m => m.id));
}

/**
 * Get the currently configured model for a pipeline phase.
 *
 * @param {number} phase
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
  } catch (_) {}
}

/**
 * Build an inline model selector row for embedding in a step panel.
 * Shows a <select> with grouped friendly names + a "Custom…" fallback text input.
 * Saves to localStorage on change.
 *
 * @param {number} phase
 * @returns {HTMLElement}
 */
export function buildModelSelector(phase) {
  const config = PHASE_CONFIGS[phase];
  if (!config) return document.createElement('div');

  const current  = getPhaseModel(phase);
  const isCustom = !_allIds(phase).includes(current);

  const wrap = document.createElement('div');
  wrap.className = 'plm-model-selector';

  // Label
  const label = document.createElement('span');
  label.className = 'plm-model-selector-label';
  label.textContent = 'Model:';

  // <select> with optgroups
  const select = document.createElement('select');
  select.className = 'plm-model-select';

  config.groups.forEach(group => {
    const og = document.createElement('optgroup');
    og.label = group.label;
    group.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value       = m.id;
      opt.textContent = m.label;
      if (m.id === current) opt.selected = true;
      og.appendChild(opt);
    });
    select.appendChild(og);
  });

  // Custom separator + option
  const sep = document.createElement('option');
  sep.disabled = true;
  sep.textContent = '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';
  select.appendChild(sep);

  const customOpt = document.createElement('option');
  customOpt.value       = CUSTOM_VAL;
  customOpt.textContent = 'Custom model ID\u2026';
  if (isCustom) customOpt.selected = true;
  select.appendChild(customOpt);

  // Custom text input (shown only when "Custom…" selected)
  const customInput = document.createElement('input');
  customInput.className   = 'plm-model-custom-input';
  customInput.type        = 'text';
  customInput.placeholder = 'e.g. anthropic/claude-haiku-4.5';
  customInput.spellcheck  = false;
  customInput.style.display = isCustom ? '' : 'none';
  if (isCustom) customInput.value = current;

  // Badge
  const badge = document.createElement('span');
  badge.className = `plm-model-selector-badge plm-model-badge-${config.type}`;
  badge.textContent = config.typeBadge;

  wrap.appendChild(label);
  wrap.appendChild(select);
  wrap.appendChild(customInput);
  wrap.appendChild(badge);

  // ── Interaction ──────────────────────────────────────────────────────────

  select.addEventListener('change', () => {
    if (select.value === CUSTOM_VAL) {
      customInput.style.display = '';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
      savePhaseModel(phase, select.value);
    }
  });

  function _saveCustom() {
    const val = customInput.value.trim();
    if (val) savePhaseModel(phase, val);
  }

  customInput.addEventListener('change', _saveCustom);
  customInput.addEventListener('blur', _saveCustom);

  return wrap;
}
