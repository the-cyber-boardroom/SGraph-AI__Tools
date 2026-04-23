/**
 * sg-json-sender — Structured JSON request builder component.
 *
 * A panel that lets users build structured JSON requests to send to an LLM
 * with a specific response_format schema. Supports schema definition, template
 * selection, and JSON preview before dispatching `llm:send`.
 *
 * Features:
 *   - JSON schema editor (simplified: name/type/description rows)
 *   - Template picker (common schema patterns)
 *   - Live JSON preview of the request payload
 *   - Dispatches llm:send with response_format: { type:'json_schema', json_schema:{...} }
 *
 * Usage:
 *   <sg-json-sender></sg-json-sender>
 *
 * Attributes:
 *   placeholder — Prompt textarea placeholder text
 *
 * Events dispatched:
 *   llm:send — Standard LLM send event with messages + response_format
 *
 * @module sg-json-sender
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

// ---------------------------------------------------------------------------
// Schema templates
// ---------------------------------------------------------------------------

const SCHEMA_TEMPLATES = [
    {
        label: 'Summary',
        schema: {
            name: 'summary',
            description: 'A structured summary of the input',
            schema: {
                type: 'object',
                properties: {
                    title:     { type: 'string',  description: 'Brief title' },
                    summary:   { type: 'string',  description: 'Main summary (2-3 sentences)' },
                    key_points: { type: 'array', items: { type: 'string' }, description: 'Key points list' },
                    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'], description: 'Overall sentiment' },
                },
                required: ['title', 'summary', 'key_points'],
                additionalProperties: false,
            },
        },
    },
    {
        label: 'Classification',
        schema: {
            name: 'classification',
            description: 'Classify input into a category',
            schema: {
                type: 'object',
                properties: {
                    category:   { type: 'string',  description: 'The category label' },
                    confidence: { type: 'number',  description: 'Confidence score 0-1' },
                    reasoning:  { type: 'string',  description: 'Explanation of the classification' },
                },
                required: ['category', 'confidence'],
                additionalProperties: false,
            },
        },
    },
    {
        label: 'Data Extraction',
        schema: {
            name: 'extracted_data',
            description: 'Extract structured data from text',
            schema: {
                type: 'object',
                properties: {
                    entities:  { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'] }, description: 'Named entities found' },
                    dates:     { type: 'array', items: { type: 'string' }, description: 'Date references found' },
                    numbers:   { type: 'array', items: { type: 'string' }, description: 'Numeric values found' },
                    summary:   { type: 'string', description: 'One-line summary' },
                },
                required: ['entities', 'summary'],
                additionalProperties: false,
            },
        },
    },
    {
        label: 'Q&A',
        schema: {
            name: 'qa_response',
            description: 'Structured question and answer',
            schema: {
                type: 'object',
                properties: {
                    answer:      { type: 'string',  description: 'Direct answer to the question' },
                    explanation: { type: 'string',  description: 'Detailed explanation' },
                    sources:     { type: 'array', items: { type: 'string' }, description: 'Supporting facts or sources' },
                    confidence:  { type: 'string', enum: ['high', 'medium', 'low'], description: 'Answer confidence' },
                },
                required: ['answer', 'explanation'],
                additionalProperties: false,
            },
        },
    },
];

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    background: var(--sg-bg-secondary, #1a1a2e);
    border: 1px solid var(--sg-border, #333);
    border-radius: 6px;
    overflow: hidden;
    font-family: var(--sg-font-sans, system-ui, sans-serif);
    font-size: 13px;
    color: var(--sg-text, #e0e0e0);
    box-sizing: border-box;
  }

  /* Header */
  .js-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--sg-bg-tertiary, #16213e);
    border-bottom: 1px solid var(--sg-border, #333);
    flex-shrink: 0;
  }
  .js-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--sg-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex: 1;
  }

  /* Tabs */
  .js-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 12px 0;
    border-bottom: 1px solid var(--sg-border, #333);
    background: var(--sg-bg-tertiary, #16213e);
    flex-shrink: 0;
  }
  .js-tab {
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    color: var(--sg-text-dim, #888);
    border: none;
    background: none;
    border-bottom: 2px solid transparent;
    transition: color 0.15s;
    font-family: inherit;
  }
  .js-tab.active {
    color: var(--sg-accent, #4ecdc4);
    border-bottom-color: var(--sg-accent, #4ecdc4);
  }

  /* Panels */
  .js-panel { display: none; flex-direction: column; flex: 1; overflow: hidden; }
  .js-panel.active { display: flex; }

  /* Prompt panel */
  .js-prompt-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    gap: 8px;
    overflow-y: auto;
  }
  .js-label {
    font-size: 11px;
    color: var(--sg-text-dim, #888);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .js-textarea {
    background: var(--sg-bg-primary, #0d1117);
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text, #e0e0e0);
    font-family: inherit;
    font-size: 13px;
    padding: 8px;
    resize: vertical;
    min-height: 80px;
    outline: none;
    transition: border-color 0.15s;
    width: 100%;
    box-sizing: border-box;
  }
  .js-textarea:focus { border-color: var(--sg-accent, #4ecdc4); }
  .js-system-input {
    background: var(--sg-bg-primary, #0d1117);
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text, #e0e0e0);
    font-family: inherit;
    font-size: 12px;
    padding: 6px 8px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }

  /* Schema panel */
  .js-schema-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .js-schema-name-row {
    display: flex;
    gap: 8px;
  }
  .js-schema-name-row input {
    flex: 1;
    background: var(--sg-bg-primary, #0d1117);
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text, #e0e0e0);
    font-family: inherit;
    font-size: 12px;
    padding: 5px 8px;
    outline: none;
    box-sizing: border-box;
  }

  /* Template chips */
  .js-templates {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .js-tpl-chip {
    padding: 3px 10px;
    border: 1px solid var(--sg-border, #333);
    border-radius: 12px;
    font-size: 11px;
    cursor: pointer;
    color: var(--sg-text-dim, #888);
    background: none;
    font-family: inherit;
    transition: all 0.15s;
  }
  .js-tpl-chip:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }

  /* Field rows */
  .js-fields-header {
    display: grid;
    grid-template-columns: 1fr 80px 1fr auto;
    gap: 6px;
    font-size: 10px;
    color: var(--sg-text-dim, #888);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0 2px;
  }
  .js-fields-list { display: flex; flex-direction: column; gap: 4px; }
  .js-field-row {
    display: grid;
    grid-template-columns: 1fr 80px 1fr auto;
    gap: 6px;
    align-items: center;
  }
  .js-field-row input, .js-field-row select {
    background: var(--sg-bg-primary, #0d1117);
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text, #e0e0e0);
    font-family: inherit;
    font-size: 12px;
    padding: 4px 6px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .js-remove-btn {
    background: none;
    border: none;
    color: var(--sg-text-dim, #888);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
  }
  .js-remove-btn:hover { color: var(--sg-error, #ff6b6b); }
  .js-add-btn {
    margin-top: 4px;
    background: none;
    border: 1px dashed var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-text-dim, #888);
    cursor: pointer;
    font-size: 12px;
    padding: 5px;
    font-family: inherit;
    transition: all 0.15s;
    width: 100%;
  }
  .js-add-btn:hover { border-color: var(--sg-accent, #4ecdc4); color: var(--sg-accent, #4ecdc4); }

  /* Preview panel */
  .js-preview-wrap {
    flex: 1;
    overflow: auto;
    padding: 10px 12px;
  }
  .js-preview-code {
    background: var(--sg-bg-primary, #0d1117);
    border: 1px solid var(--sg-border, #333);
    border-radius: 4px;
    color: var(--sg-accent, #4ecdc4);
    font-family: var(--sg-font-mono, monospace);
    font-size: 12px;
    padding: 10px;
    white-space: pre;
    overflow: auto;
    margin: 0;
  }

  /* Footer */
  .js-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--sg-border, #333);
    flex-shrink: 0;
  }
  .js-send-btn {
    padding: 6px 16px;
    background: var(--sg-accent, #4ecdc4);
    color: #000;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  .js-send-btn:hover { opacity: 0.85; }
  .js-info {
    font-size: 11px;
    color: var(--sg-text-dim, #888);
    flex: 1;
  }
</style>

<div class="js-header">
  <span class="js-title">JSON Sender</span>
</div>

<div class="js-tabs">
  <button class="js-tab active" data-panel="prompt">Prompt</button>
  <button class="js-tab" data-panel="schema">Schema</button>
  <button class="js-tab" data-panel="preview">Preview</button>
</div>

<!-- Prompt panel -->
<div class="js-panel active" id="panel-prompt">
  <div class="js-prompt-wrap">
    <label class="js-label">System prompt (optional)</label>
    <input class="js-system-input" id="system-input" placeholder="You are a helpful assistant that always responds with valid JSON." />
    <label class="js-label">User message</label>
    <textarea class="js-textarea" id="prompt-input" rows="4" placeholder="Describe the task…"></textarea>
  </div>
</div>

<!-- Schema panel -->
<div class="js-panel" id="panel-schema">
  <div class="js-schema-wrap">
    <label class="js-label">Schema name</label>
    <div class="js-schema-name-row">
      <input id="schema-name" placeholder="response_schema" />
    </div>

    <label class="js-label">Templates</label>
    <div class="js-templates" id="tpl-chips"></div>

    <label class="js-label">Fields</label>
    <div class="js-fields-header">
      <span>Field name</span><span>Type</span><span>Description</span><span></span>
    </div>
    <div class="js-fields-list" id="fields-list"></div>
    <button class="js-add-btn" id="add-field-btn">+ Add field</button>
  </div>
</div>

<!-- Preview panel -->
<div class="js-panel" id="panel-preview">
  <div class="js-preview-wrap">
    <pre class="js-preview-code" id="preview-code"></pre>
  </div>
</div>

<div class="js-footer">
  <span class="js-info" id="footer-info">Build a prompt and schema, then send.</span>
  <button class="js-send-btn" id="send-btn">Send</button>
</div>
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class SgJsonSender extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));

        this._fields = [];  // [{ name, type, description, required }]
        this._schemaData = null;  // set when a template is loaded

        this._el = {
            tabs:        [...this.shadowRoot.querySelectorAll('.js-tab')],
            panels:      [...this.shadowRoot.querySelectorAll('.js-panel')],
            systemInput: this.shadowRoot.getElementById('system-input'),
            promptInput: this.shadowRoot.getElementById('prompt-input'),
            schemaName:  this.shadowRoot.getElementById('schema-name'),
            tplChips:    this.shadowRoot.getElementById('tpl-chips'),
            fieldsList:  this.shadowRoot.getElementById('fields-list'),
            addFieldBtn: this.shadowRoot.getElementById('add-field-btn'),
            previewCode: this.shadowRoot.getElementById('preview-code'),
            sendBtn:     this.shadowRoot.getElementById('send-btn'),
            footerInfo:  this.shadowRoot.getElementById('footer-info'),
        };
    }

    connectedCallback() {
        // Tabs
        this._el.tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const panelId = tab.dataset.panel;
                this._activateTab(panelId);
                if (panelId === 'preview') this._refreshPreview();
            });
        });

        // Templates
        SCHEMA_TEMPLATES.forEach((tpl) => {
            const btn = document.createElement('button');
            btn.className = 'js-tpl-chip';
            btn.textContent = tpl.label;
            btn.addEventListener('click', () => this._loadTemplate(tpl));
            this._el.tplChips.appendChild(btn);
        });

        // Add field
        this._el.addFieldBtn.addEventListener('click', () => {
            this._addField({ name: '', type: 'string', description: '', required: true });
        });

        // Send
        this._el.sendBtn.addEventListener('click', () => this._send());

        // Start with 2 default fields
        this._addField({ name: 'result',      type: 'string',  description: 'Main result', required: true });
        this._addField({ name: 'explanation', type: 'string',  description: 'Explanation', required: false });

        if (this.getAttribute('placeholder')) {
            this._el.promptInput.placeholder = this.getAttribute('placeholder');
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Get the current schema object built from the fields editor.
     * @returns {{ name:string, description:string, schema:Object }}
     */
    getSchema() {
        if (this._schemaData) return this._schemaData;
        return this._buildSchemaFromFields();
    }

    /**
     * Set schema directly (bypasses field editor).
     * @param {Object} schema
     */
    setSchema(schema) {
        this._schemaData = schema;
    }

    // ── Private ────────────────────────────────────────────────────────────

    _activateTab(panelId) {
        this._el.tabs.forEach((t) => t.classList.toggle('active', t.dataset.panel === panelId));
        this._el.panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${panelId}`));
    }

    _loadTemplate(tpl) {
        this._schemaData = tpl.schema;
        this._el.schemaName.value = tpl.schema.name;

        // Populate field rows from template schema
        this._fields = [];
        this._el.fieldsList.innerHTML = '';
        const props = tpl.schema.schema.properties ?? {};
        const required = tpl.schema.schema.required ?? [];
        for (const [name, def] of Object.entries(props)) {
            this._addField({
                name,
                type: def.type === 'array' ? 'array' : def.type,
                description: def.description ?? '',
                required: required.includes(name),
            });
        }
        this._el.footerInfo.textContent = `Template loaded: ${tpl.label}`;
    }

    _addField({ name = '', type = 'string', description = '', required = false } = {}) {
        const idx = this._fields.length;
        const field = { name, type, description, required };
        this._fields.push(field);

        const row = document.createElement('div');
        row.className = 'js-field-row';
        row.innerHTML = `
          <input type="text" placeholder="field_name" value="${this._esc(name)}" />
          <select>
            <option value="string" ${type === 'string' ? 'selected' : ''}>string</option>
            <option value="number" ${type === 'number' ? 'selected' : ''}>number</option>
            <option value="boolean" ${type === 'boolean' ? 'selected' : ''}>boolean</option>
            <option value="array" ${type === 'array' ? 'selected' : ''}>array</option>
            <option value="object" ${type === 'object' ? 'selected' : ''}>object</option>
          </select>
          <input type="text" placeholder="Description…" value="${this._esc(description)}" />
          <button class="js-remove-btn" title="Remove">×</button>
        `;

        const nameInput = row.querySelector('input:first-child');
        const typeSelect = row.querySelector('select');
        const descInput = row.querySelector('input:last-of-type');
        const removeBtn = row.querySelector('.js-remove-btn');

        nameInput.addEventListener('input', () => { field.name = nameInput.value; this._schemaData = null; });
        typeSelect.addEventListener('change', () => { field.type = typeSelect.value; this._schemaData = null; });
        descInput.addEventListener('input', () => { field.description = descInput.value; this._schemaData = null; });
        removeBtn.addEventListener('click', () => {
            this._fields.splice(idx, 1);
            row.remove();
            this._schemaData = null;
        });

        this._el.fieldsList.appendChild(row);
        this._schemaData = null;
    }

    _buildSchemaFromFields() {
        const name = this._el.schemaName.value.trim() || 'response_schema';
        const properties = {};
        const required = [];

        for (const f of this._fields) {
            if (!f.name.trim()) continue;
            const propName = f.name.trim();
            const def = { type: f.type };
            if (f.description) def.description = f.description;
            if (f.type === 'array') def.items = { type: 'string' };
            properties[propName] = def;
            if (f.required) required.push(propName);
        }

        return {
            name,
            description: `Structured ${name} response`,
            schema: {
                type: 'object',
                properties,
                required,
                additionalProperties: false,
            },
        };
    }

    _buildPayload() {
        const prompt = this._el.promptInput.value.trim();
        const system = this._el.systemInput.value.trim();
        const schema = this.getSchema();

        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: prompt || '(no prompt)' });

        return {
            messages,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name:   schema.name,
                    strict: true,
                    schema: schema.schema,
                },
            },
        };
    }

    _refreshPreview() {
        const payload = this._buildPayload();
        this._el.previewCode.textContent = JSON.stringify(payload, null, 2);
    }

    _send() {
        const payload = this._buildPayload();
        const bus = this._llmBus();

        bus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: payload,
            bubbles: true,
            composed: true,
        }));

        this._el.footerInfo.textContent = 'Sent. Waiting for response…';
    }

    _llmBus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return document;
    }

    _esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
}

customElements.define('sg-json-sender', SgJsonSender);
