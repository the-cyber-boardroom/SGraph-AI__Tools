/**
 * agent-with-tools — UI shell.
 *
 * Renders:
 *   - Bridge status dot in #bridge-status (grey/amber/green/red)
 *   - Bridge info panel into #bridge-panel
 *   - Model info panel into #model-panel
 *   - Loop status strip in #loop-strip
 *
 * Exports:
 *   initShell(bus, toolApi) → void
 *
 * @module ui-shell
 * @version 0.1.58
 */

// ── Bridge status dot ─────────────────────────────────────────────────────────

/**
 * Wire the bridge status dot (#bridge-status) to sg-local-bridge events.
 * @param {Element} bus
 */
function _wireBridgeDot(bus) {
    const dot = document.getElementById('bridge-status');
    if (!dot) return;

    // Start in connecting state (bridge has auto-connect so ping is in flight)
    _setDot(dot, 'connecting', 'Bridge connecting…');

    bus.addEventListener('sg-local-bridge:status', (e) => {
        const { workspace, latency_ms, version } = e.detail;
        _setDot(dot, 'ok', `Bridge · ${workspace} · ${latency_ms}ms · v${version}`);
    });

    bus.addEventListener('sg-local-bridge:error', (e) => {
        _setDot(dot, 'error', `Bridge offline: ${e.detail.message}`);
    });

    // Clicking re-triggers connect()
    dot.addEventListener('click', () => {
        _setDot(dot, 'connecting', 'Bridge reconnecting…');
        window.__tool?.connect().catch(() => {});
    });
}

/**
 * Update dot data-state and title.
 * @param {Element} dot
 * @param {'connecting'|'ok'|'error'|'idle'} state
 * @param {string} label
 */
function _setDot(dot, state, label) {
    dot.dataset.state = state;
    dot.title = label;
}

// ── Bridge info panel ─────────────────────────────────────────────────────────

/**
 * Render initial bridge panel and update it on status/error events.
 * @param {Element} bus
 */
function _wireBridgePanel(bus) {
    const panel = document.getElementById('bridge-panel');
    if (!panel) return;

    const bridge = bus.querySelector('sg-local-bridge');
    const ep     = bridge?.getAttribute('endpoint')  || 'http://localhost:8000';
    const ws     = bridge?.getAttribute('workspace') || '/workspace';

    panel.innerHTML = `
        <div class="panel-label">Bridge</div>
        <div class="panel-row"><span class="panel-key">Endpoint</span><span class="panel-val" id="bp-ep">${_esc(ep)}</span></div>
        <div class="panel-row"><span class="panel-key">Workspace</span><span class="panel-val" id="bp-ws">${_esc(ws)}</span></div>
        <div class="panel-row"><span class="panel-key">Version</span><span class="panel-val" id="bp-ver">—</span></div>
        <div class="panel-row"><span class="panel-key">Latency</span><span class="panel-val" id="bp-lat">—</span></div>
        <div class="panel-row"><span class="panel-key">Last call</span><span class="panel-val" id="bp-call">—</span></div>`;

    bus.addEventListener('sg-local-bridge:status', (e) => {
        _setText('bp-ver', `v${e.detail.version}`);
        _setText('bp-lat', `${e.detail.latency_ms} ms`);
    });

    bus.addEventListener('sg-local-bridge:tool-call', (e) => {
        _setText('bp-call', `${e.detail.name} (${e.detail.ms}ms)`);
    });
}

// ── Model info panel ──────────────────────────────────────────────────────────

/**
 * Render and update the model panel from llm events.
 * @param {Element} bus
 */
function _wireModelPanel(bus) {
    const panel = document.getElementById('model-panel');
    if (!panel) return;

    const req      = bus.querySelector('sg-llm-request');
    const provider = req?.getAttribute('provider') || 'ollama';
    const model    = req?.getAttribute('model')    || 'qwen2.5-coder:7b';

    panel.innerHTML = `
        <div class="panel-label">Model</div>
        <div class="panel-row"><span class="panel-key">Provider</span><span class="panel-val" id="mp-prov">${_esc(provider)}</span></div>
        <div class="panel-row"><span class="panel-key">Model</span><span class="panel-val" id="mp-model">${_esc(model)}</span></div>
        <div class="panel-row"><span class="panel-key">Endpoint</span><span class="panel-val" id="mp-ep">localhost:11434</span></div>
        <div class="panel-row"><span class="panel-key">Streaming</span><span class="panel-val" id="mp-stream">✓</span></div>
        <div class="panel-row"><span class="panel-key">Speed</span><span class="panel-val" id="mp-speed">—</span></div>`;

    // Update when provider/model attributes change via MutationObserver
    if (req) {
        const obs = new MutationObserver(() => {
            _setText('mp-prov',  req.getAttribute('provider') || 'ollama');
            _setText('mp-model', req.getAttribute('model')    || '');
        });
        obs.observe(req, { attributes: true, attributeFilter: ['provider', 'model'] });
    }

    // Listen for stats events (tok/s)
    bus.addEventListener('llm:stats', (e) => {
        const tps = e.detail?.tokens_per_second;
        if (tps != null) _setText('mp-speed', `${Math.round(tps)} tok/s`);
    });
}

// ── Loop status strip ─────────────────────────────────────────────────────────

/**
 * Wire the #loop-strip to sg-agentic-loop events on the bus.
 * @param {Element} bus
 */
function _wireLoopStrip(bus) {
    const strip = document.getElementById('loop-strip');
    if (!strip) return;

    // Initial idle state
    _renderStrip(strip, 'idle', '● idle · 0 tool calls · $0.00', false, false);

    bus.addEventListener('agentic-loop:start', () => {
        _renderStrip(strip, 'running', '● running · iter 0/15 · $0.00', true, false);
    });

    bus.addEventListener('agentic-loop:iteration', (e) => {
        const { iteration, max_iterations, cost } = e.detail || {};
        const costStr = cost != null ? `$${Number(cost).toFixed(2)}` : '$0.00';
        _renderStrip(strip, 'running', `● running · iter ${iteration}/${max_iterations} · ${costStr}`, true, false);
    });

    bus.addEventListener('agentic-loop:paused', (e) => {
        _renderStrip(strip, 'paused', '● waiting · approve or stop', true, true);
    });

    bus.addEventListener('agentic-loop:done', (e) => {
        const { tool_calls = 0, cost = 0 } = e.detail || {};
        _renderStrip(strip, 'idle', `● idle · ${tool_calls} tool calls · $${Number(cost).toFixed(2)}`, false, false);
    });

    bus.addEventListener('agentic-loop:error', (e) => {
        const msg = e.detail?.message || 'Unknown error';
        _renderStrip(strip, 'error', `● error: ${_esc(msg)}`, false, false);
    });
}

/**
 * Render loop strip content.
 * @param {Element} strip
 * @param {string} state
 * @param {string} statusText
 * @param {boolean} showStop
 * @param {boolean} showApprove
 */
function _renderStrip(strip, state, statusText, showStop, showApprove) {
    strip.dataset.state = state;
    let html = `<span class="ls-dot ls-dot--${state}"></span><span class="ls-status">${statusText}</span>`;
    if (showApprove) {
        html += `<button class="ls-approve" onclick="document.querySelector('[data-llm-bus]').dispatchEvent(new CustomEvent('agentic-loop:approve',{bubbles:false}))">Approve</button>`;
    }
    if (showStop) {
        html += `<button class="ls-stop" onclick="document.querySelector('[data-llm-bus]').dispatchEvent(new CustomEvent('agentic-loop:stop',{bubbles:false}))">Stop</button>`;
    }
    strip.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @param {string} id @param {string} text */
function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

/** @param {string} s @returns {string} */
function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the UI shell. Called from agent-with-tools-api.js after api.activate().
 * @param {Element} bus - The [data-llm-bus] element
 * @param {object} toolApi - SgToolApi instance (unused here, passed for future use)
 * @returns {void}
 */
export function initShell(bus, toolApi) {
    if (!bus) return;
    _wireBridgeDot(bus);
    _wireBridgePanel(bus);
    _wireModelPanel(bus);
    _wireLoopStrip(bus);
}
