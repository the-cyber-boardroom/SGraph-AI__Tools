/**
 * sg-llm-model-picker — Compact model selector for any LLM provider.
 *
 * Standalone dropdown that shows available models for the active provider
 * with a refresh button to fetch live model lists.
 *
 * Emits: llm:model-changed { model }
 * Consumes: llm:connected { provider, model, baseUrl, apiKey }
 *
 * Usage:
 *   <sg-llm-model-picker provider="anthropic"></sg-llm-model-picker>
 *
 * @module sg-llm-model-picker
 * @version 0.1.0
 */

/** Provider definitions — mirrors sg-llm-connection */
const PROVIDERS = {
    openrouter: {
        modelsUrl:     'https://openrouter.ai/api/v1/models',
        defaultModel:  'anthropic/claude-haiku-4-5',
        parseModels:   json => (json.data || []).map(m => m.id).sort(),
        needsAuth:     true,
    },
    ollama: {
        modelsUrl:     'http://localhost:11434/api/tags',
        defaultModel:  'llama3.2',
        parseModels:   json => (json.models || []).map(m => m.name).sort(),
        needsAuth:     false,
    },
    anthropic: {
        modelsUrl:     null,
        defaultModel:  'claude-haiku-4-5-20251001',
        builtinModels: [
            'claude-opus-4-6',
            'claude-sonnet-4-6',
            'claude-haiku-4-5-20251001',
            'claude-3-5-haiku-20241022',
        ],
        needsAuth:     false,
    },
    openai: {
        modelsUrl:     'https://api.openai.com/v1/models',
        defaultModel:  'gpt-4o-mini',
        parseModels:   json => (json.data || [])
            .map(m => m.id)
            .filter(id => id.startsWith('gpt-') || id.startsWith('o'))
            .sort(),
        needsAuth:     true,
    },
};

const STYLES = `
:host { display: block; }
:host([compact]) { display: inline-block; }

.picker-root {
    display: flex;
    gap: 6px;
    align-items: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
}

.picker-select {
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
    transition: border-color 0.15s;
    box-sizing: border-box;
}
.picker-select:focus { border-color: #4ECDC4; }

.picker-refresh {
    background: #1a1a3a;
    color: #a0aec0;
    border: 1px solid #333d5a;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
}
.picker-refresh:hover { opacity: 0.85; }
.picker-refresh:disabled { opacity: 0.5; cursor: default; }
`;

const TEMPLATE = `
<div class="picker-root">
    <select class="picker-select" id="model-select"></select>
    <button class="picker-refresh" id="refresh-btn" title="Refresh models">↻</button>
</div>
`;

/**
 * <sg-llm-model-picker> — Compact model dropdown with live refresh.
 *
 * @fires llm:model-changed - { model: string }
 */
export class SgLlmModelPicker extends HTMLElement {

    static jsUrl = import.meta.url;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._provider    = this.getAttribute('provider') || 'openrouter';
        this._baseUrl     = this.getAttribute('base-url') || '';
        this._apiKey      = '';
        this._models      = [];   // last known good model list
        this._loading     = false;
    }

    connectedCallback() {
        this._render();
        this._setupListeners();
        this._listenConnected();

        // If provider attribute already set, load builtin models immediately
        const provDef = PROVIDERS[this._provider];
        if (provDef?.builtinModels) {
            this._setModels(provDef.builtinModels);
        } else if (provDef) {
            this._setModels([provDef.defaultModel]);
        }
    }

    disconnectedCallback() {
        if (this._connectedHandler) {
            const scope = this.parentElement || document;
            scope.removeEventListener('llm:connected', this._connectedHandler);
        }
    }

    static get observedAttributes() { return ['provider', 'base-url']; }

    attributeChangedCallback(name, _old, value) {
        if (name === 'provider') this._provider = value || 'openrouter';
        if (name === 'base-url') this._baseUrl  = value || '';
    }

    // --- Render -----------------------------------------------------------------

    _render() {
        this.shadowRoot.innerHTML = `<style>${STYLES}</style>${TEMPLATE}`;
        this._selectEl  = this.shadowRoot.getElementById('model-select');
        this._refreshBtn = this.shadowRoot.getElementById('refresh-btn');
        this._updateRefreshVisibility();
    }

    _updateRefreshVisibility() {
        const provDef = PROVIDERS[this._provider];
        const hasLiveModels = !provDef?.builtinModels;
        this._refreshBtn.style.display = hasLiveModels ? '' : 'none';
    }

    /** @param {string[]} models */
    _setModels(models) {
        if (models.length) this._models = models;
        const list = this._models.length ? this._models : ['(no models)'];
        this._selectEl.innerHTML = list
            .map(m => `<option value="${m}">${m}</option>`)
            .join('');
    }

    _setLoading(loading) {
        this._loading = loading;
        this._refreshBtn.disabled = loading;
        this._refreshBtn.textContent = loading ? '…' : '↻';
        if (loading) {
            this._selectEl.innerHTML = '<option value="">Loading…</option>';
        }
    }

    // --- Model loading ----------------------------------------------------------

    /**
     * @param {string} provider
     * @param {string} apiKey
     * @param {string} baseUrl
     * @returns {Promise<string[]>}
     */
    async _fetchModels(provider, apiKey, baseUrl) {
        const provDef = PROVIDERS[provider];
        if (!provDef) throw new Error(`Unknown provider: ${provider}`);
        if (provDef.builtinModels) return provDef.builtinModels;
        if (!provDef.modelsUrl) return [];

        let url = provDef.modelsUrl;
        if (baseUrl) {
            url = url.replace(/^https?:\/\/[^/]+/, baseUrl.replace(/\/$/, ''));
        } else if (provider === 'ollama' && this._baseUrl) {
            url = url.replace(/^https?:\/\/[^/]+/, this._baseUrl.replace(/\/$/, ''));
        }

        const headers = provDef.needsAuth && apiKey
            ? { Authorization: `Bearer ${apiKey}` }
            : {};

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return provDef.parseModels(json);
    }

    async _loadModels() {
        this._setLoading(true);
        try {
            const models = await this._fetchModels(this._provider, this._apiKey, this._baseUrl);
            this._setLoading(false);
            this._setModels(models);
        } catch (_err) {
            this._setLoading(false);
            // Restore last known models; show error option only if we have none
            if (this._models.length) {
                this._setModels(this._models);
            } else {
                this._selectEl.innerHTML = '<option value="">Failed to load</option>';
            }
        }
    }

    // --- Event listening --------------------------------------------------------

    _listenConnected() {
        const scope = this.parentElement || document;
        this._connectedHandler = e => {
            const { provider, model, baseUrl, apiKey } = e.detail || {};
            if (provider) {
                this._provider = provider;
                this._apiKey   = apiKey || '';
                this._baseUrl  = baseUrl || '';
                this._models   = [];
                this._updateRefreshVisibility();
            }
            this.setProvider(
                provider || this._provider,
                apiKey   || this._apiKey,
                baseUrl  || this._baseUrl
            ).then(() => {
                if (model) this.setModel(model);
            });
        };
        scope.addEventListener('llm:connected', this._connectedHandler);
    }

    // --- Listeners --------------------------------------------------------------

    _setupListeners() {
        this._refreshBtn.addEventListener('click', () => this._loadModels());

        this._selectEl.addEventListener('change', () => {
            const model = this._selectEl.value;
            if (!model || model === 'Loading…' || model === 'Failed to load') return;
            this._emit('llm:model-changed', { model });
        });
    }

    // --- Events -----------------------------------------------------------------

    /**
     * @param {string} eventName
     * @param {Object} detail
     */
    _emit(eventName, detail) {
        const scope = this.parentElement || this;
        scope.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    // --- Public API -------------------------------------------------------------

    /**
     * Load models for a provider and optionally authenticate.
     * @param {string} provider - Provider id
     * @param {string} apiKey   - API key (empty string for no-auth providers)
     * @param {string} baseUrl  - Optional base URL override
     * @returns {Promise<void>}
     */
    async setProvider(provider, apiKey, baseUrl) {
        this._provider = provider || this._provider;
        this._apiKey   = apiKey  || '';
        this._baseUrl  = baseUrl || '';
        this._models   = [];
        this._updateRefreshVisibility();

        const provDef = PROVIDERS[this._provider];
        if (provDef?.builtinModels) {
            this._setModels(provDef.builtinModels);
        } else {
            await this._loadModels();
        }
    }

    /**
     * Pre-select a model in the dropdown.
     * @param {string} model
     */
    setModel(model) {
        if (!model) return;
        // Add option if not present (e.g. newly connected before model list loaded)
        const exists = [...this._selectEl.options].some(o => o.value === model);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = model;
            opt.textContent = model;
            this._selectEl.prepend(opt);
        }
        this._selectEl.value = model;
    }

    /**
     * Get the currently selected model string.
     * @returns {string}
     */
    getModel() {
        return this._selectEl?.value || '';
    }
}

customElements.define('sg-llm-model-picker', SgLlmModelPicker);
window.SgLlmModelPicker = SgLlmModelPicker;
