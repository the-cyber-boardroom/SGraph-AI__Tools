/**
 * sg-agentic-loop — Orchestrates the full LLM ↔ tool-calling feedback loop.
 *
 * Headless Web Component. Place on the page alongside <sg-llm-request> and
 * <sg-tool-runner> inside the same [data-llm-bus] element.
 *
 * Listens for `llm:agentic-start` to begin a loop.
 * Can also be started programmatically: `loop.start(task, tools, config)`.
 *
 * Loop sequence:
 *   1. Dispatch llm:send { messages, tools }
 *   2. sg-llm-request → llm:request-complete
 *   3a. If tool_calls present → sg-tool-runner auto-executes → llm:tool-results-complete
 *       → (optional: wait for human approval) → go to 1
 *   3b. If no tool_calls → llm:agentic-done
 *
 * Safety controls:
 *   max-iterations  — stop after N tool-calling cycles (default: 10)
 *   cost-budget     — stop when estimated cost exceeds $N (default: 0.50)
 *   human-approval  — pause after each tool batch; show overlay, require Click to continue
 *
 * Attributes:
 *   max-iterations="10"
 *   cost-budget="0.50"
 *   human-approval           — if present, enables human-in-the-loop
 *   system-prompt="..."      — default system prompt (overridable per start() call)
 *
 * Public API:
 *   loop.start(task, tools?, config?)  — begin loop
 *   loop.stop()                        — abort loop (fires llm:agentic-abort)
 *   loop.approve()                     — continue after approval pause
 *   loop.reject()                      — abort after approval pause
 *   loop.status                        — 'idle'|'running'|'awaiting-approval'|'done'|'aborted'
 *   loop.iterations                    — current iteration count
 *   loop.steps                         — array of all step records
 *   loop.tools = [...]                 — set active tools (also updated via llm:tool-defs-changed)
 *
 * @module sg-agentic-loop
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

/** Rough cost estimate: $5 per million tokens (mid-market average). */
const COST_PER_TOKEN = 5 / 1_000_000;

const DEFAULT_SYSTEM_PROMPT =
    'You are a helpful assistant with access to tools. Use the provided tools to ' +
    'complete the task step by step. When you have gathered enough information ' +
    'to answer fully, produce a final response without calling any more tools.';

// ── Approval overlay CSS ─────────────────────────────────────────────────────

const OVERLAY_CSS = `
:host { display: block; }
.al-overlay {
    display: none;
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    width: 360px;
    background: #0d0d1a;
    border: 1px solid #4ade80;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    font-family: system-ui, sans-serif;
    overflow: hidden;
}
.al-overlay.visible { display: block; }
.al-header {
    background: #0f2a1a;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 700;
    color: #4ade80;
    border-bottom: 1px solid #1a3a2a;
}
.al-badge {
    background: #1a4a2a;
    border-radius: 99px;
    padding: 2px 8px;
    font-size: 10px;
    color: #86efac;
    margin-left: auto;
}
.al-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.al-summary { font-size: 11px; color: #94a3b8; line-height: 1.5; }
.al-results {
    max-height: 120px;
    overflow-y: auto;
    background: #12122a;
    border-radius: 6px;
    padding: 6px 10px;
    font-family: monospace;
    font-size: 10px;
    color: #64748b;
    white-space: pre-wrap;
    word-break: break-word;
}
.al-footer {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid #1a1a2e;
}
.al-btn {
    flex: 1;
    padding: 8px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
}
.al-continue { background: #1a4a2a; color: #4ade80; }
.al-continue:hover { background: #245a32; }
.al-stop { background: #2a0d0d; color: #f87171; }
.al-stop:hover { background: #3d1515; }
.al-iter { font-size: 11px; color: #475569; text-align: center; margin-top: 2px; }
`;

// ─────────────────────────────────────────────────────────────────────────────

export class SgAgenticLoop extends HTMLElement {

    constructor() {
        super();
        this._shadow    = this.attachShadow({ mode: 'open' });
        this._state     = 'idle';   // idle | running | awaiting-approval | done | aborted
        this._messages  = [];
        this._tools     = [];       // active tool definitions
        this._steps     = [];
        this._stepCount = 0;
        this._iterations    = 0;
        this._totalTokens   = 0;
        this._maxIter       = 10;
        this._budget        = 0.5;
        this._pendingMsgs   = null; // messages held during approval pause
        this._handlers      = {};
    }

    connectedCallback() {
        this._renderOverlay();
        this._bindEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [ev, fn] of Object.entries(this._handlers)) {
            bus.removeEventListener(ev, fn);
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Start the agentic loop.
     *
     * @param {string} task
     * @param {Array} [tools] - tool definitions array (OpenAI format). If omitted, uses this.tools.
     * @param {Object} [config]
     * @param {number} [config.maxIterations]
     * @param {number} [config.costBudget]
     * @param {string} [config.systemPrompt]
     */
    start(task, tools, config = {}) {
        if (this._state === 'running' || this._state === 'awaiting-approval') return;

        this._maxIter = config.maxIterations
            ?? parseInt(this.getAttribute('max-iterations') || '10', 10);
        this._budget  = config.costBudget
            ?? parseFloat(this.getAttribute('cost-budget') || '0.5');
        const sysprompt = config.systemPrompt
            ?? this.getAttribute('system-prompt')
            ?? DEFAULT_SYSTEM_PROMPT;

        this._state       = 'running';
        this._tools       = tools ?? this._tools;
        this._steps       = [];
        this._stepCount   = 0;
        this._iterations  = 0;
        this._totalTokens = 0;
        this._pendingMsgs = null;
        this._messages    = [
            { role: 'system', content: sysprompt },
            { role: 'user',   content: task },
        ];

        this._emit(SGL_LLM.AGENTIC_START, { task, tools: this._tools, maxIterations: this._maxIter });
        this._addStep('user', task);
        this._sendToLLM();
    }

    /** Abort the running loop. */
    stop() {
        if (this._state !== 'running' && this._state !== 'awaiting-approval') return;
        this._hideOverlay();
        this._abort('cancelled');
    }

    /** Approve continuing (when awaiting human approval). */
    approve() {
        if (this._state !== 'awaiting-approval') return;
        this._hideOverlay();
        this._state   = 'running';
        this._messages = this._pendingMsgs;
        this._pendingMsgs = null;
        this._sendToLLM();
    }

    /** Reject (abort) after human approval pause. */
    reject() {
        if (this._state !== 'awaiting-approval') return;
        this._hideOverlay();
        this._abort('rejected');
    }

    /** @returns {'idle'|'running'|'awaiting-approval'|'done'|'aborted'} */
    get status() { return this._state; }

    /** @returns {number} */
    get iterations() { return this._iterations; }

    /** @returns {Array} */
    get steps() { return [...this._steps]; }

    /** Set active tool definitions. Also updated via llm:tool-defs-changed. */
    set tools(v) { this._tools = Array.isArray(v) ? v : this._tools; }
    get tools()  { return this._tools; }

    // ── Event binding ───────────────────────────────────────────────────────

    _bindEvents() {
        const bus = this._bus();
        const on  = (ev, fn) => {
            const bound = fn.bind(this);
            this._handlers[ev] = bound;
            bus.addEventListener(ev, bound);
        };

        on(SGL_LLM.AGENTIC_START,         this._onAgenticStart);
        on(SGL_LLM.TOOL_CALLS,            this._onToolCalls);
        on(SGL_LLM.TOOL_RESULTS_COMPLETE, this._onToolResultsComplete);
        on(SGL_LLM.REQUEST_COMPLETE,      this._onRequestComplete);
        on(SGL_LLM.REQUEST_ERROR,         this._onRequestError);
        on(SGL_LLM.REQUEST_CANCEL,        this._onRequestCancel);
        on(SGL_LLM.AGENTIC_APPROVED,      this._onApproved);
        on(SGL_LLM.AGENTIC_REJECTED,      this._onRejected);
        on(SGL_LLM.TOOL_DEFS_CHANGED,     this._onToolDefsChanged);
    }

    _onAgenticStart(e) {
        const { task, tools, maxIterations, costBudget, systemPrompt } = e.detail ?? {};
        // Only handle if fired externally (not by self to avoid double-start)
        if (this._state === 'running' || this._state === 'awaiting-approval') return;
        this.start(task, tools, { maxIterations, costBudget, systemPrompt });
    }

    _onToolCalls(e) {
        if (this._state !== 'running') return;
        // Log each tool call as a trace step
        for (const tc of e.detail?.toolCalls ?? []) {
            let args = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* ok */ }
            this._addStep('tool', { name: tc.function?.name, args });
        }
    }

    _onToolResultsComplete(e) {
        if (this._state !== 'running') return;
        const { results, messages } = e.detail ?? {};

        // Log results
        for (const r of results ?? []) {
            this._addStep('result', r.error ? { error: r.error } : r.result);
        }

        if (this._humanApproval) {
            this._state       = 'awaiting-approval';
            this._pendingMsgs = messages;
            this._showApproval(results ?? [], messages);
            this._emit(SGL_LLM.AGENTIC_APPROVAL_REQUIRED, {
                step:       this._stepCount,
                results:    results ?? [],
                messages,
                iterations: this._iterations,
            });
        } else {
            this._messages = messages;
            this._sendToLLM();
        }
    }

    _onRequestComplete(e) {
        if (this._state !== 'running') return;
        const { content, toolCalls, promptTokens, completionTokens } = e.detail ?? {};
        if ((toolCalls ?? []).length > 0) return; // handled via tool-results-complete

        this._totalTokens += (promptTokens || 0) + (completionTokens || 0);
        if (content) {
            this._messages = [...this._messages, { role: 'assistant', content }];
        }

        this._state = 'done';
        this._emit(SGL_LLM.AGENTIC_DONE, {
            steps:      this._steps,
            content:    content || '',
            iterations: this._iterations,
        });
    }

    _onRequestError(e) {
        if (this._state !== 'running') return;
        this._abort(`error: ${e.detail?.error || 'unknown'}`);
    }

    _onRequestCancel() {
        if (this._state !== 'running') return;
        this._abort('cancelled');
    }

    _onApproved() {
        this.approve();
    }

    _onRejected() {
        this.reject();
    }

    _onToolDefsChanged(e) {
        this._tools = e.detail?.tools ?? this._tools;
    }

    // ── Loop mechanics ──────────────────────────────────────────────────────

    _sendToLLM() {
        if (this._state !== 'running') return;

        // Safety: max iterations
        if (this._iterations >= this._maxIter) {
            this._abort('max_iterations');
            return;
        }

        // Safety: cost budget
        const estimatedCost = this._totalTokens * COST_PER_TOKEN;
        if (estimatedCost > this._budget) {
            this._abort('cost_budget');
            return;
        }

        this._iterations++;
        this._addStep('llm', `[iteration ${this._iterations}/${this._maxIter}]`);

        this._bus().dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: {
                messages:    this._messages,
                tools:       this._tools,
                tool_choice: this._tools.length > 0 ? 'auto' : undefined,
            },
            bubbles: true, composed: true,
        }));
    }

    _abort(reason) {
        this._state       = 'aborted';
        this._pendingMsgs = null;
        this._hideOverlay();
        this._emit(SGL_LLM.AGENTIC_ABORT, {
            reason,
            steps:      this._steps,
            iterations: this._iterations,
        });
    }

    /**
     * @param {'user'|'llm'|'tool'|'result'|'done'|'error'} type
     * @param {*} data
     */
    _addStep(type, data) {
        this._stepCount++;
        const step = { step: this._stepCount, type, data };
        this._steps.push(step);
        this._emit(SGL_LLM.AGENTIC_STEP, step);
    }

    // ── Human-approval overlay ──────────────────────────────────────────────

    get _humanApproval() {
        return this.hasAttribute('human-approval');
    }

    _renderOverlay() {
        this._shadow.innerHTML = `<style>${OVERLAY_CSS}</style>
        <div class="al-overlay" id="overlay">
            <div class="al-header">
                <span>🛑 Human Approval Required</span>
                <span class="al-badge" id="badge">iter 0/0</span>
            </div>
            <div class="al-body">
                <div class="al-summary" id="summary"></div>
                <div class="al-results" id="results"></div>
                <div class="al-iter" id="iter-info"></div>
            </div>
            <div class="al-footer">
                <button class="al-btn al-continue" id="btn-continue">▶ Continue Loop</button>
                <button class="al-btn al-stop"     id="btn-stop">■ Stop</button>
            </div>
        </div>`;
        this._shadow.getElementById('btn-continue').onclick = () => this.approve();
        this._shadow.getElementById('btn-stop').onclick     = () => this.reject();
    }

    /**
     * Show the approval overlay with a summary of what was executed.
     * @param {Array} results
     * @param {Array} messages
     */
    _showApproval(results, messages) {
        const overlay   = this._shadow.getElementById('overlay');
        const summary   = this._shadow.getElementById('summary');
        const resultsEl = this._shadow.getElementById('results');
        const badge     = this._shadow.getElementById('badge');
        const iterInfo  = this._shadow.getElementById('iter-info');

        if (!overlay) return;

        const toolNames = results.map(r => r.name).join(', ');
        summary.textContent  = `${results.length} tool(s) executed: ${toolNames}`;
        badge.textContent    = `iter ${this._iterations}/${this._maxIter}`;
        iterInfo.textContent = `Cost so far: ~$${(this._totalTokens * COST_PER_TOKEN).toFixed(4)} / budget $${this._budget.toFixed(2)}`;

        const preview = results.map(r => {
            const val = r.error
                ? `ERROR: ${r.error}`
                : JSON.stringify(r.result, null, 2);
            return `[${r.name}]\n${val?.slice?.(0, 200) ?? val}${(val?.length ?? 0) > 200 ? '…' : ''}`;
        }).join('\n\n');
        resultsEl.textContent = preview;

        overlay.classList.add('visible');
    }

    _hideOverlay() {
        this._shadow.getElementById('overlay')?.classList.remove('visible');
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-llm-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    _emit(eventName, detail) {
        this._bus().dispatchEvent(new CustomEvent(eventName, {
            detail, bubbles: true, composed: true,
        }));
    }
}

customElements.define('sg-agentic-loop', SgAgenticLoop);
window.SgAgenticLoop = SgAgenticLoop;
