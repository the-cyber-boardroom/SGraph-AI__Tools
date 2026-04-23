/**
 * sg-llm-connection — Provider selection, API key entry, model listing.
 *
 * Manages LLM provider configuration: provider tabs, API key input (masked),
 * model dropdown with favourites, connection testing, and localStorage persistence.
 *
 * Security invariant: API keys are stored ONLY in localStorage under 'sg-llm-config'.
 * Keys are NEVER sent to any *.sgraph.ai domain.
 *
 * Emits: llm:connected, llm:disconnected, llm:model-changed, llm:models-loaded
 * Consumes: nothing (pure source — user input only)
 *
 * Usage:
 *   <sg-llm-connection></sg-llm-connection>
 *
 * @module sg-llm-connection
 * @version 0.1.4
 *
 * Changelog:
 *   v0.1.4: After auto-connect rebuilds the model dropdown, the previously-used
 *     model is now preserved even if it is no longer in the provider's list
 *     (e.g. deprecated/renamed models). If the exact model ID is not found among
 *     the fetched options it is re-added as a temporary option and selected,
 *     matching the same pattern used by bundle restore.
 *   v0.1.3: Auto-connect on page load. If a saved API key (or a no-key provider
 *     like Ollama) is found in localStorage during _restoreConfig(), _connect()
 *     is called automatically so the user lands in a ready state.
 *   v0.1.2: On llm:bundle-loaded, restores model selection.
 *   v0.1.1: _bus() updated to walk [data-llm-bus] ancestor for sg-layout panel compatibility (backwards compatible).
 *   v0.1.2: On llm:bundle-loaded, restores model selection in the dropdown
 *     (without re-connecting or changing the API key). If the bundled model is
 *     not in the current model list, it is added as a temporary option so the
 *     user can see what model was used. The provider tab is switched if the
 *     bundled provider differs from the current one (no key change).
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';

const STORAGE_KEY = 'sg-llm-config';

/** Provider definitions */
const PROVIDERS = [
    {
        id:          'openrouter',
        label:       'OpenRouter',
        placeholder: 'sk-or-v1-...',
        modelsUrl:   'https://openrouter.ai/api/v1/models',
        defaultModel:'anthropic/claude-haiku-4-5',
    },
    {
        id:          'ollama',
        label:       'Ollama (local)',
        placeholder: '(no key needed)',
        modelsUrl:   'http://localhost:11434/api/tags',
        defaultModel:'llama3.2',
        noKey:       true,
    },
    {
        id:          'anthropic',
        label:       'Anthropic',
        placeholder: 'sk-ant-...',
        modelsUrl:   null,
        defaultModel:'claude-haiku-4-5-20251001',
        builtinModels: [
            'claude-opus-4-6',
            'claude-sonnet-4-6',
            'claude-haiku-4-5-20251001',
            'claude-3-5-haiku-20241022',
        ],
    },
    {
        id:          'openai',
        label:       'OpenAI',
        placeholder: 'sk-...',
        modelsUrl:   'https://api.openai.com/v1/models',
        defaultModel:'gpt-4o-mini',
    },
];

const TEMPLATE = `
<div class="conn-root">
    <div class="conn-tabs" role="tablist" id="provider-tabs"></div>

    <div class="conn-body">
        <div class="conn-field" id="key-field">
            <label class="conn-label" for="api-key">API Key</label>
            <div class="conn-key-row">
                <input class="conn-input" type="password" id="api-key" autocomplete="off" spellcheck="false">
                <button class="conn-btn conn-btn--ghost" id="toggle-key" title="Show/hide key">👁</button>
            </div>
        </div>

        <div class="conn-field">
            <label class="conn-label" for="base-url">Base URL <span class="conn-hint">(optional)</span></label>
            <input class="conn-input" type="text" id="base-url" placeholder="Leave blank for default">
        </div>

        <div class="conn-field">
            <label class="conn-label" for="model-select">Model</label>
            <div class="conn-model-row">
                <select class="conn-input conn-select" id="model-select"></select>
                <button class="conn-btn conn-btn--ghost" id="refresh-models" title="Refresh models">↻</button>
            </div>
        </div>

        <div class="conn-actions">
            <button class="conn-btn conn-btn--primary" id="connect-btn">Connect</button>
            <span class="conn-status" id="conn-status"></span>
        </div>
    </div>
</div>
`;

const STYLES = `
:host { display: block; }

.conn-root {
    background: #111122;
    border: 1px solid #222d4d;
    border-radius: 8px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
}

.conn-tabs {
    display: flex;
    border-bottom: 1px solid #222d4d;
    background: #0d0d1a;
    overflow-x: auto;
}
.conn-tab {
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 500;
    color: #a0aec0;
    cursor: pointer;
    border: none;
    background: none;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
}
.conn-tab:hover { color: #e2e8f0; }
.conn-tab[aria-selected="true"] {
    color: #4ECDC4;
    border-bottom-color: #4ECDC4;
}

.conn-body { padding: 14px; }

.conn-field { margin-bottom: 12px; }
.conn-label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: #a0aec0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 5px;
}
.conn-hint { font-weight: 400; text-transform: none; letter-spacing: 0; }

.conn-input {
    width: 100%;
    background: #0d0d1a;
    border: 1px solid #333d5a;
    border-radius: 4px;
    color: #e2e8f0;
    padding: 6px 10px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
}
.conn-input:focus { border-color: #4ECDC4; }
.conn-select { cursor: pointer; }

.conn-key-row, .conn-model-row {
    display: flex;
    gap: 6px;
}
.conn-key-row .conn-input,
.conn-model-row .conn-input { flex: 1; min-width: 0; }

.conn-btn {
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
}
.conn-btn:hover { opacity: 0.85; }
.conn-btn--primary { background: #4ECDC4; color: #0d0d1a; }
.conn-btn--ghost {
    background: #1a1a3a;
    color: #a0aec0;
    border: 1px solid #333d5a;
    padding: 6px 10px;
}

.conn-actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }

.conn-status { font-size: 12px; }
.conn-status--ok      { color: #4ECDC4; }
.conn-status--error   { color: #ff6b6b; }
.conn-status--loading { color: #a0aec0; }
`;

/**
 * <sg-llm-connection> — LLM provider configuration panel.
 *
 * @fires llm:connected   - { provider, model, baseUrl, apiKey }
 * @fires llm:disconnected
 * @fires llm:model-changed - { model }
 * @fires llm:models-loaded - { models: string[] }
 */
export class SgLlmConnection extends HTMLElement {

    static jsUrl = import.meta.url;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._provider    = 'openrouter';
        this._connected   = false;
        this._models      = [];
        this._favourites  = [];
    }

    connectedCallback() {
        this._render();
        this._restoreConfig();
    }

    // --- Render -----------------------------------------------------------------

    _render() {
        this.shadowRoot.innerHTML = `<style>${STYLES}</style>${TEMPLATE}`;
        this._bindElements();
        this._renderTabs();
        this._renderModels();
        this._setupListeners();
    }

    _bindElements() {
        this._tabsEl    = this.shadowRoot.getElementById('provider-tabs');
        this._keyInput  = this.shadowRoot.getElementById('api-key');
        this._baseInput = this.shadowRoot.getElementById('base-url');
        this._modelSel  = this.shadowRoot.getElementById('model-select');
        this._connectBtn= this.shadowRoot.getElementById('connect-btn');
        this._statusEl  = this.shadowRoot.getElementById('conn-status');
        this._keyField  = this.shadowRoot.getElementById('key-field');
        this._toggleKey = this.shadowRoot.getElementById('toggle-key');
        this._refreshBtn= this.shadowRoot.getElementById('refresh-models');
    }

    _renderTabs() {
        this._tabsEl.innerHTML = '';
        for (const p of PROVIDERS) {
            const btn = document.createElement('button');
            btn.className = 'conn-tab';
            btn.textContent = p.label;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', p.id === this._provider ? 'true' : 'false');
            btn.dataset.provider = p.id;
            this._tabsEl.appendChild(btn);
        }
    }

    _renderModels() {
        const provDef = PROVIDERS.find(p => p.id === this._provider);
        const models = this._models.length
            ? this._models
            : (provDef?.builtinModels || [provDef?.defaultModel || '']);

        this._modelSel.innerHTML = '';
        for (const m of models) {
            if (!m) continue;
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m + (this._favourites.includes(m) ? ' ⭐' : '');
            this._modelSel.appendChild(opt);
        }

        // Restore saved model
        const saved = this._loadConfig()?.model;
        if (saved && [...this._modelSel.options].some(o => o.value === saved)) {
            this._modelSel.value = saved;
        }
    }

    _updateKeyField() {
        const provDef = PROVIDERS.find(p => p.id === this._provider);
        this._keyField.style.display = provDef?.noKey ? 'none' : '';
        this._keyInput.placeholder = provDef?.placeholder || '';
    }

    // --- Listeners --------------------------------------------------------------

    _setupListeners() {
        this._tabsEl.addEventListener('click', e => {
            const btn = e.target.closest('.conn-tab');
            if (!btn) return;
            this._switchProvider(btn.dataset.provider);
        });

        this._connectBtn.addEventListener('click', () => this._connect());

        this._toggleKey.addEventListener('click', () => {
            this._keyInput.type = this._keyInput.type === 'password' ? 'text' : 'password';
        });

        this._refreshBtn.addEventListener('click', () => this._loadModels());

        this._modelSel.addEventListener('change', () => {
            if (this._connected) {
                this._emit(SGL_LLM.MODEL_CHANGED, { model: this._modelSel.value });
                this._saveConfig();
            }
        });

        const bus = this._bus();
        bus.addEventListener(SGL_LLM.BUNDLE_LOADED, (e) => {
            this._restoreFromBundle(e.detail?.bundle);
        });
    }

    // --- Provider switching -----------------------------------------------------

    /**
     * @param {string} providerId
     */
    _switchProvider(providerId) {
        this._provider  = providerId;
        this._connected = false;
        this._models    = [];

        // Update tab selected states
        this._tabsEl.querySelectorAll('.conn-tab').forEach(btn => {
            btn.setAttribute('aria-selected', btn.dataset.provider === providerId ? 'true' : 'false');
        });

        this._updateKeyField();
        this._renderModels();
        this._setStatus('');

        // Restore saved key/url for this provider
        const cfg = this._loadConfig();
        if (cfg?.provider === providerId) {
            this._keyInput.value  = cfg.apiKey  || '';
            this._baseInput.value = cfg.baseUrl || '';
        } else {
            this._keyInput.value  = '';
            this._baseInput.value = '';
        }
    }

    // --- Connect ----------------------------------------------------------------

    async _connect() {
        const provDef    = PROVIDERS.find(p => p.id === this._provider);
        const apiKey     = provDef?.noKey ? '' : this._keyInput.value.trim();
        const baseUrl    = this._baseInput.value.trim();
        // Capture the desired model BEFORE the async fetch so it isn't lost when
        // _renderModels() rebuilds the dropdown.  Prefer the value that is already
        // visible in the UI (set by a bundle restore or _restoreConfig), falling
        // back to what is persisted in localStorage.
        const targetModel = this._modelSel.value || this._loadConfig()?.model || '';

        if (!provDef?.noKey && !apiKey) {
            this._setStatus('API key required', 'error');
            return;
        }

        this._setStatus('Connecting…', 'loading');

        try {
            // Test connection by loading models (if supported) or a ping
            const models = await this._fetchModels(provDef, apiKey, baseUrl);
            if (models.length) {
                this._models = models;
                this._renderModels();
                // _renderModels() tries to restore from localStorage but may fail if
                // the model has been renamed/removed. Explicitly re-apply the model
                // that was selected before the fetch, adding it as an option if needed.
                if (targetModel && this._modelSel.value !== targetModel) {
                    let opt = [...this._modelSel.options].find(o => o.value === targetModel);
                    if (!opt) {
                        opt = document.createElement('option');
                        opt.value       = targetModel;
                        opt.textContent = targetModel;
                        this._modelSel.prepend(opt);
                    }
                    this._modelSel.value = targetModel;
                }
                this._emit(SGL_LLM.MODELS_LOADED, { models });
            }

            this._connected = true;
            this._setStatus('Connected ✓', 'ok');

            const finalModel = this._modelSel.value || provDef?.defaultModel || '';
            this._saveConfig({ provider: this._provider, apiKey, baseUrl, model: finalModel, favourites: this._favourites });

            this._emit(SGL_LLM.CONNECTED, {
                provider: this._provider,
                model:    finalModel,
                baseUrl,
                apiKey,
            });

        } catch (err) {
            this._connected = false;
            this._setStatus(`Error: ${err.message}`, 'error');
        }
    }

    // --- Model loading ----------------------------------------------------------

    /**
     * @param {Object} provDef
     * @param {string} apiKey
     * @param {string} baseUrl
     * @returns {Promise<string[]>}
     */
    async _fetchModels(provDef, apiKey, baseUrl) {
        if (provDef.builtinModels) return provDef.builtinModels;
        if (!provDef.modelsUrl) return [];

        const url = baseUrl
            ? provDef.modelsUrl.replace(/^https?:\/\/[^/]+/, baseUrl.replace(/\/$/, ''))
            : provDef.modelsUrl;

        const headers = provDef.noKey ? {} : { Authorization: `Bearer ${apiKey}` };
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const json = await response.json();

        if (provDef.id === 'ollama') {
            return (json.models || []).map(m => m.name).sort();
        }
        // OpenAI-compat: array of { id } objects
        return (json.data || []).map(m => m.id).sort();
    }

    async _loadModels() {
        const provDef = PROVIDERS.find(p => p.id === this._provider);
        const apiKey  = this._keyInput.value.trim();
        const baseUrl = this._baseInput.value.trim();
        this._setStatus('Loading models…', 'loading');
        try {
            const models = await this._fetchModels(provDef, apiKey, baseUrl);
            this._models = models;
            this._renderModels();
            this._setStatus(`${models.length} models loaded`, 'ok');
            this._emit(SGL_LLM.MODELS_LOADED, { models });
        } catch (err) {
            this._setStatus(`Failed: ${err.message}`, 'error');
        }
    }

    // --- Status -----------------------------------------------------------------

    /**
     * @param {string} text
     * @param {'ok'|'error'|'loading'|''} type
     */
    _setStatus(text, type = '') {
        this._statusEl.textContent = text;
        this._statusEl.className = 'conn-status' + (type ? ` conn-status--${type}` : '');
    }

    // --- Persistence ------------------------------------------------------------

    _loadConfig() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        } catch { return null; }
    }

    _saveConfig(overrides = {}) {
        const current = this._loadConfig() || {};
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...overrides }));
    }

    _restoreConfig() {
        const cfg = this._loadConfig();
        if (!cfg) return;

        if (cfg.provider) {
            this._provider   = cfg.provider;
            this._favourites = cfg.favourites || [];
            this._renderTabs();
            this._updateKeyField();
        }
        if (cfg.apiKey)  this._keyInput.value  = cfg.apiKey;
        if (cfg.baseUrl) this._baseInput.value = cfg.baseUrl;

        this._renderModels();
        if (cfg.model) this._modelSel.value = cfg.model;

        // Auto-connect if credentials are available (key present, or provider
        // doesn't need a key like Ollama). Runs after current microtask so the
        // rest of the page finishes initialising first.
        const provDef  = PROVIDERS.find(p => p.id === this._provider);
        const hasKey   = !!this._keyInput.value.trim();
        const noKeyReq = !!provDef?.noKey;
        if (hasKey || noKeyReq) {
            setTimeout(() => this._connect(), 0);
        }
    }

    // --- Bundle restore ---------------------------------------------------------

    /**
     * Restore model (and optionally provider) from a loaded bundle.
     * Does NOT restore the API key. Does NOT re-connect.
     * @param {object} bundle
     */
    _restoreFromBundle(bundle) {
        if (!bundle?.config) return;
        const { provider, model } = bundle.config;

        // Switch provider tab if different (restores saved key for that provider)
        if (provider && provider !== this._provider) {
            this._switchProvider(provider);
        }

        // Set model in select — add as option if not already listed
        if (model && this._modelSel) {
            let opt = [...this._modelSel.options].find(o => o.value === model);
            if (!opt) {
                opt = document.createElement('option');
                opt.value = model;
                opt.textContent = model + ' (bundle)';
                this._modelSel.prepend(opt);
            }
            this._modelSel.value = model;
        }
    }

    // --- Events -----------------------------------------------------------------

    /**
     * @param {string} eventName
     * @param {Object} detail
     */
    _emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    // --- Public API -------------------------------------------------------------

    /** Currently selected model. */
    get model() { return this._modelSel?.value || ''; }

    /** Currently selected provider id. */
    get provider() { return this._provider; }

    /** Whether connected. */
    get connected() { return this._connected; }
}

customElements.define('sg-llm-connection', SgLlmConnection);
window.SgLlmConnection = SgLlmConnection;
