/**
 * sg-infographic-model-picker — Curated model selector for infographic generation.
 *
 * Shows a styled dropdown with models grouped as:
 *   ⭐ Top 3 Recommended
 *   📷 Image Models
 *   ✏ SVG / Text Models
 *
 * Each option displays the model label, approximate cost, and speed indicator
 * so users can make informed choices without leaving the tool.
 *
 * Fires: infographic:model-changed { model: string } — bubbles, composed
 * API:   getModel() → string, setModel(id: string)
 *
 * @module sg-infographic-model-picker
 * @version 0.1.0
 */

// ── Curated model lists ────────────────────────────────────────────────────────

/** Models that produce raster images. */
export const ALL_IMAGE_MODELS = [
    'google/gemini-3.1-flash-image-preview',
    'google/gemini-2.5-flash-image',
    'google/gemini-3-pro-image-preview',
    'google/gemini-2.0-flash-001',
    'openai/gpt-5-image-mini',
    'openai/gpt-5-image',
    'sourceful/riverflow-v2-fast',
    'sourceful/riverflow-v2-fast-preview',
    'sourceful/riverflow-v2-standard-preview',
    'sourceful/riverflow-v2-pro',
    'sourceful/riverflow-v2-max-preview',
    'bytedance/seedream-4.5',
    'black-forest-labs/flux-2-pro',
    'black-forest-labs/flux-2-flex',
    'black-forest-labs/flux-2-klein',
];

/** Text/LLM models that generate SVG markup. */
export const ALL_SVG_MODELS = [
    'qwen/qwen-2.5-72b-instruct',
    'qwen/qwen-2.5-7b-instruct',
    'meta-llama/llama-3.3-70b-instruct',
    'meta-llama/llama-3.1-8b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct',
    'deepseek/deepseek-chat-v3-0324',
    'anthropic/claude-haiku-4-5-20251001',
];

/** All supported model IDs. */
export const ALL_MODELS = [...ALL_IMAGE_MODELS, ...ALL_SVG_MODELS];

/** Top 3 recommended models shown at the top of the picker. */
export const TOP_3_MODELS = [
    'google/gemini-2.5-flash-image',
    'openai/gpt-5-image-mini',
    'deepseek/deepseek-chat-v3-0324',
];

/** Default model pre-selected on first use. */
export const DEFAULT_MODEL = TOP_3_MODELS[0];

/**
 * Returns true if the model generates raster images (vs SVG text).
 * @param {string} id
 * @returns {boolean}
 */
export function isImageModel(id) { return ALL_IMAGE_MODELS.includes(id); }

// ── Model metadata (hard-coded; update as pricing changes) ─────────────────────

/**
 * @typedef {{ label: string, cost: string, speed: string }} ModelMeta
 * @type {Record<string, ModelMeta>}
 */
const MODEL_METADATA = {
    // Image models
    'google/gemini-3.1-flash-image-preview':    { label: 'Gemini 3.1 Flash Image',         cost: '~$0.10/img', speed: '⚡⚡⚡' },
    'google/gemini-2.5-flash-image':            { label: 'Gemini 2.5 Flash Image',          cost: '~$0.08/img', speed: '⚡⚡⚡' },
    'google/gemini-3-pro-image-preview':        { label: 'Gemini 3 Pro Image',              cost: '~$0.35/img', speed: '⚡⚡'   },
    'google/gemini-2.0-flash-001':              { label: 'Gemini 2.0 Flash',                cost: '~$0.04/img', speed: '⚡⚡⚡' },
    'openai/gpt-5-image-mini':                  { label: 'GPT-5 Image Mini',                cost: '~$0.03/img', speed: '⚡⚡⚡' },
    'openai/gpt-5-image':                       { label: 'GPT-5 Image',                     cost: '~$0.15/img', speed: '⚡⚡'   },
    'sourceful/riverflow-v2-fast':              { label: 'Riverflow v2 Fast',               cost: '~$0.02/img', speed: '⚡⚡⚡' },
    'sourceful/riverflow-v2-fast-preview':      { label: 'Riverflow v2 Fast Preview',       cost: 'free',       speed: '⚡⚡⚡' },
    'sourceful/riverflow-v2-standard-preview':  { label: 'Riverflow v2 Standard Preview',   cost: 'free',       speed: '⚡⚡'   },
    'sourceful/riverflow-v2-pro':               { label: 'Riverflow v2 Pro',                cost: '~$0.06/img', speed: '⚡⚡'   },
    'sourceful/riverflow-v2-max-preview':       { label: 'Riverflow v2 Max Preview',        cost: 'free',       speed: '⚡'     },
    'bytedance/seedream-4.5':                   { label: 'Seedream 4.5',                    cost: '~$0.05/img', speed: '⚡⚡'   },
    'black-forest-labs/flux-2-pro':             { label: 'FLUX 2 Pro',                      cost: '~$0.08/img', speed: '⚡⚡'   },
    'black-forest-labs/flux-2-flex':            { label: 'FLUX 2 Flex',                     cost: '~$0.04/img', speed: '⚡⚡'   },
    'black-forest-labs/flux-2-klein':           { label: 'FLUX 2 Klein',                    cost: '~$0.02/img', speed: '⚡⚡⚡' },
    // SVG / text models
    'qwen/qwen-2.5-72b-instruct':               { label: 'Qwen 2.5 72B',                    cost: '$0.40/Mtok', speed: '⚡⚡'   },
    'qwen/qwen-2.5-7b-instruct':                { label: 'Qwen 2.5 7B',                     cost: '$0.06/Mtok', speed: '⚡⚡⚡' },
    'meta-llama/llama-3.3-70b-instruct':        { label: 'Llama 3.3 70B',                   cost: '$0.30/Mtok', speed: '⚡⚡'   },
    'meta-llama/llama-3.1-8b-instruct:free':    { label: 'Llama 3.1 8B',                    cost: 'free',       speed: '⚡⚡⚡' },
    'mistralai/mistral-small-3.1-24b-instruct': { label: 'Mistral Small 3.1',               cost: '$0.10/Mtok', speed: '⚡⚡⚡' },
    'deepseek/deepseek-chat-v3-0324':           { label: 'DeepSeek Chat V3',                cost: '$0.27/Mtok', speed: '⚡⚡'   },
    'anthropic/claude-haiku-4-5-20251001':      { label: 'Claude Haiku 4.5',                cost: '$0.80/Mtok', speed: '⚡⚡⚡' },
};

/**
 * Build the display label for an option.
 * @param {string} id
 * @returns {string}
 */
function optionLabel(id) {
    const m = MODEL_METADATA[id];
    return m ? `${m.label}  ·  ${m.cost}  ${m.speed}` : id;
}

// ── Component ──────────────────────────────────────────────────────────────────

const STYLES = `
:host { display: block; }

.wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: #0d0d1a;
    border-bottom: 1px solid #1a1a3a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

label {
    font-size: 11px;
    font-weight: 600;
    color: #a0aec0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    flex-shrink: 0;
}

select {
    flex: 1;
    min-width: 0;
    background: #0d0d1a;
    border: 1px solid #333d5a;
    border-radius: 4px;
    color: #e2e8f0;
    padding: 6px 10px;
    font-size: 13px;
    outline: none;
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: border-color 0.15s;
}
select:focus { border-color: #4ECDC4; }
`;

/**
 * <sg-infographic-model-picker> — Curated model dropdown for infographic tools.
 */
export class SgInfographicModelPicker extends HTMLElement {

    static jsUrl = import.meta.url;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this._render();
    }

    _render() {
        this.shadowRoot.innerHTML = `<style>${STYLES}</style>
<div class="wrap">
  <label>Model</label>
  <select id="sel"></select>
</div>`;

        this._sel = this.shadowRoot.getElementById('sel');
        this._buildOptions();

        this._sel.addEventListener('change', () => {
            this.dispatchEvent(new CustomEvent('infographic:model-changed', {
                detail:   { model: this._sel.value },
                bubbles:  true,
                composed: true,
            }));
        });
    }

    _buildOptions() {
        const addGroup = (groupLabel, models) => {
            const grp = document.createElement('optgroup');
            grp.label = groupLabel;
            for (const id of models) {
                const opt = document.createElement('option');
                opt.value       = id;
                opt.textContent = optionLabel(id);
                grp.appendChild(opt);
            }
            this._sel.appendChild(grp);
        };

        addGroup('⭐ Top 3 Recommended', TOP_3_MODELS);
        addGroup('📷 Image Models',      ALL_IMAGE_MODELS.filter(m => !TOP_3_MODELS.includes(m)));
        addGroup('✏ SVG / Text Models',  ALL_SVG_MODELS.filter(m => !TOP_3_MODELS.includes(m)));
    }

    /**
     * Get the currently selected model id.
     * @returns {string}
     */
    getModel() { return this._sel?.value ?? ''; }

    /**
     * Pre-select a model. Adds an ad-hoc option if the id isn't in the list.
     * @param {string} model
     */
    setModel(model) {
        if (!model || !this._sel) return;
        const exists = [...this._sel.options].some(o => o.value === model);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value       = model;
            opt.textContent = optionLabel(model);
            this._sel.prepend(opt);
        }
        this._sel.value = model;
    }

    /** @returns {string} Alias for getModel(). */
    get value() { return this.getModel(); }
}

customElements.define('sg-infographic-model-picker', SgInfographicModelPicker);
