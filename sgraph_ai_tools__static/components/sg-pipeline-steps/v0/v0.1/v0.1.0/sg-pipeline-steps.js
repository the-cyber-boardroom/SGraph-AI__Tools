/**
 * sg-pipeline-steps.js
 * Pipeline-spine Web Component: an ordered list of step rows with live
 * status icons, an info slot, and a re-run affordance. Generic — the host
 * tool decides what the steps are and what re-run means; the component only
 * renders state and emits intents. First consumer: video-publisher; the
 * linkedin-publisher pipeline is the anticipated second.
 *
 * Usage:
 *   <sg-pipeline-steps></sg-pipeline-steps>
 *   el.setSteps([{ key: 'audio', label: '① Audio', tab: null, rerunnable: true }, …]);
 *   el.setStatus('audio', { status: 'done', info: 'route: native' });
 *   el.setNote('Ready to publish.');
 *
 * Statuses: 'idle' | 'running' | 'done' | 'error'.
 *
 * Events (composed, bubbling):
 *   sg-pipeline-steps:step-selected  { key, tab }  — row clicked
 *   sg-pipeline-steps:step-rerun     { key }       — re-run button clicked
 *
 * @module sg-pipeline-steps
 * @version 0.1.0
 */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';

const ICONS = { idle: '○', running: '◐', done: '✓', error: '✗' };

export class SgPipelineSteps extends SgComponent {
    static jsUrl = import.meta.url;

    #steps = [];                 // [{ key, label, tab, rerunnable }]
    #statuses = new Map();       // key -> { status, info, error }
    #note = '';

    // ─── Public API ────────────────────────────────────────────────────────

    /**
     * Define (or replace) the ordered step list. Resets all statuses to idle.
     * @param {Array<{ key: string, label: string, tab?: string|null, rerunnable?: boolean }>} steps
     */
    setSteps(steps) {
        this.#steps = Array.isArray(steps) ? steps : [];
        this.#statuses = new Map(this.#steps.map(s => [s.key, { status: 'idle' }]));
        if (this._isReady) this._renderRows();
    }

    /**
     * Update one step's status.
     * @param {string} key
     * @param {{ status: 'idle'|'running'|'done'|'error', info?: string, error?: string }} update
     */
    setStatus(key, update = {}) {
        if (!this.#statuses.has(key)) return;
        this.#statuses.set(key, { status: 'idle', ...update });
        if (this._isReady) this._renderRow(key);
    }

    /** Reset every step to idle (keeps the step list). */
    resetStatuses() {
        for (const key of this.#statuses.keys()) this.#statuses.set(key, { status: 'idle' });
        if (this._isReady) this._renderRows();
    }

    /** Set the free-text note line under the steps ('' hides it). */
    setNote(text) {
        this.#note = String(text ?? '');
        if (this._isReady) this._renderNote();
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    bindElements() {
        this._listEl = this.$('.sgps-list');
        this._noteEl = this.$('.sgps-note');
    }

    setupEventListeners() {
        this.addTrackedListener(this._listEl, 'click', this._onClick);
    }

    onReady() {
        this._renderRows();
        this._renderNote();
    }

    // ─── Internals ─────────────────────────────────────────────────────────

    _onClick(e) {
        const row = e.target.closest('.sgps-step');
        if (!row) return;
        const key = row.dataset.step;
        if (e.target.closest('[data-rerun]')) {
            this.emit('sg-pipeline-steps:step-rerun', { key });
            return;
        }
        const step = this.#steps.find(s => s.key === key);
        this.emit('sg-pipeline-steps:step-selected', { key, tab: step?.tab ?? null });
    }

    _renderRows() {
        this._listEl.innerHTML = this.#steps.map(s => `
            <div class="sgps-step" data-step="${s.key}" data-status="idle">
                <span class="sgps-step__icon" data-icon>${ICONS.idle}</span>
                <span class="sgps-step__label">${this._escapeHtml(s.label)}</span>
                <span class="sgps-step__info" data-info></span>
                <button type="button" class="sgps-step__rerun" data-rerun hidden title="Re-run">↺</button>
            </div>`).join('');
        for (const s of this.#steps) this._renderRow(s.key);
    }

    _renderRow(key) {
        const row = this._listEl.querySelector(`.sgps-step[data-step="${CSS.escape(key)}"]`);
        if (!row) return;
        const step = this.#steps.find(s => s.key === key);
        const s = this.#statuses.get(key) || { status: 'idle' };
        row.dataset.status = s.status;
        row.querySelector('[data-icon]').textContent = ICONS[s.status] || ICONS.idle;
        row.querySelector('[data-info]').textContent =
            s.status === 'error' ? (s.error || 'failed') : (s.info || '');
        row.querySelector('[data-rerun]').hidden =
            !(step?.rerunnable && (s.status === 'done' || s.status === 'error'));
    }

    _renderNote() {
        this._noteEl.textContent = this.#note;
        this._noteEl.hidden = !this.#note;
    }
}

customElements.define('sg-pipeline-steps', SgPipelineSteps);
