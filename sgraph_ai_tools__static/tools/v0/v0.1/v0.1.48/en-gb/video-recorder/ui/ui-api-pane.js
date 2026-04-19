/**
 * ui-api-pane.js
 * Collapsible bottom panel exposing the JS API:
 *   - Method quick-reference (click to copy into REPL)
 *   - Live event log
 *   - In-page REPL (evaluates window.__tool.xxx() calls)
 * @module ui-api-pane
 */

const TOOL_EVENTS = [
    'tool:ready', 'tool:mode:set',
    'tool:preview:start', 'tool:preview:stop',
    'tool:record:start',  'tool:record:stop',
    'tool:reset',
    'tool:save:progress', 'tool:save:complete',
    'tool:error',
];

const METHODS = [
    { label: 'getStatus()',                             sig: 'window.__tool.getStatus()' },
    { label: 'getConfig()',                             sig: 'window.__tool.getConfig()' },
    { label: "setMode({ mode: 'camera+audio' })",       sig: "window.__tool.setMode({ mode: 'camera+audio' })" },
    { label: 'startPreview()',                          sig: 'window.__tool.startPreview()' },
    { label: 'stopPreview()',                           sig: 'window.__tool.stopPreview()' },
    { label: 'startRecording()',                        sig: 'window.__tool.startRecording()' },
    { label: 'stopRecording()',                         sig: 'window.__tool.stopRecording()' },
    { label: 'newRecording()',                          sig: 'window.__tool.newRecording()' },
    { label: "saveSendFile({ accessToken: '…' })",      sig: "window.__tool.saveSendFile({ accessToken: '' })" },
    { label: 'meta.health()',                           sig: 'window.__tool.meta.health()' },
    { label: 'meta.getLog()',                           sig: 'window.__tool.meta.getLog()' },
    { label: 'meta.getMethods()',                       sig: 'window.__tool.meta.getMethods()' },
];

/**
 * @param {HTMLElement} container
 * @param {import('../api/recorder-state.js').RecordingState}  state
 * @param {import('../api/recorder-state.js').RecordingConfig} config
 * @param {object} api
 * @param {Function} emit
 */
export function initApiPane(container, state, config, api, emit) {
    container.innerHTML = `
        <details class="api-pane" id="api-pane-details">
            <summary class="api-pane__bar">
                <span class="api-pane__title">JS API</span>
                <code class="api-pane__ref">window.__tool</code>
                <span class="api-pane__hint">Click a method to load it into the REPL</span>
                <span class="api-pane__badge" id="api-event-count">0 events</span>
                <span class="api-pane__chevron">▾</span>
            </summary>
            <div class="api-pane__body">
                <div class="api-pane__col api-pane__col--methods">
                    <div class="api-pane__col-title">Methods</div>
                    ${METHODS.map(m => `<button class="api-pane__method" data-sig="${_escAttr(m.sig)}">${_esc(m.label)}</button>`).join('\n                    ')}
                </div>
                <div class="api-pane__col api-pane__col--log">
                    <div class="api-pane__col-title">Event log</div>
                    <div class="api-pane__log" id="api-log"></div>
                </div>
                <div class="api-pane__col api-pane__col--repl">
                    <div class="api-pane__col-title">REPL</div>
                    <div class="api-pane__repl-output" id="api-repl-output"></div>
                    <div class="api-pane__repl-row">
                        <span class="api-pane__repl-prompt">&gt;</span>
                        <input id="api-repl-input" class="api-pane__repl-input"
                               placeholder="window.__tool.getStatus()"
                               spellcheck="false" autocomplete="off" />
                        <button id="api-repl-run" class="api-pane__repl-btn">Run</button>
                    </div>
                </div>
            </div>
        </details>
    `;

    const logEl      = container.querySelector('#api-log');
    const countEl    = container.querySelector('#api-event-count');
    const replInput  = container.querySelector('#api-repl-input');
    const replOutput = container.querySelector('#api-repl-output');
    const replRun    = container.querySelector('#api-repl-run');

    let eventCount = 0;

    // ── Event log ─────────────────────────────────────────────────────────────

    TOOL_EVENTS.forEach(name => {
        window.addEventListener(name, () => {
            eventCount++;
            countEl.textContent = `${eventCount} event${eventCount === 1 ? '' : 's'}`;

            const time  = new Date().toLocaleTimeString('en-GB', { hour12: false });
            const entry = document.createElement('div');
            entry.className = 'api-pane__log-entry';
            entry.innerHTML =
                `<span class="api-pane__log-time">${time}</span>` +
                `<span class="api-pane__log-event">${name}</span>`;
            logEl.prepend(entry);
            while (logEl.children.length > 30) logEl.lastChild.remove();
        });
    });

    // ── Method buttons → populate REPL input ─────────────────────────────────

    container.querySelectorAll('.api-pane__method').forEach(btn => {
        btn.addEventListener('click', () => {
            replInput.value = btn.dataset.sig;
            replInput.focus();
            // Place cursor at end
            replInput.selectionStart = replInput.selectionEnd = replInput.value.length;
        });
    });

    // ── REPL ──────────────────────────────────────────────────────────────────

    function runRepl() {
        const code = replInput.value.trim();
        if (!code) return;

        const entry = document.createElement('div');
        entry.className = 'api-pane__repl-entry';

        try {
            // eslint-disable-next-line no-eval
            const result = eval(code);

            if (result && typeof result.then === 'function') {
                entry.innerHTML =
                    `<span class="api-pane__repl-in">&gt; ${_esc(code)}</span>` +
                    `<span class="api-pane__repl-pending">…</span>`;
                replOutput.prepend(entry);

                result.then(val => {
                    const span = entry.querySelector('.api-pane__repl-pending');
                    span.className   = 'api-pane__repl-out';
                    span.textContent = _formatResult(val);
                }).catch(err => {
                    const span = entry.querySelector('.api-pane__repl-pending');
                    span.className   = 'api-pane__repl-err';
                    span.textContent = `Error: ${err.message}`;
                });
            } else {
                entry.innerHTML =
                    `<span class="api-pane__repl-in">&gt; ${_esc(code)}</span>` +
                    `<span class="api-pane__repl-out">${_esc(_formatResult(result))}</span>`;
                replOutput.prepend(entry);
            }
        } catch (err) {
            entry.innerHTML =
                `<span class="api-pane__repl-in">&gt; ${_esc(code)}</span>` +
                `<span class="api-pane__repl-err">Error: ${_esc(err.message)}</span>`;
            replOutput.prepend(entry);
        }

        while (replOutput.children.length > 15) replOutput.lastChild.remove();
        replInput.select();
    }

    replRun.addEventListener('click', runRepl);
    replInput.addEventListener('keydown', e => { if (e.key === 'Enter') runRepl(); });
}

function _formatResult(val) {
    if (val === undefined) return 'undefined';
    try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

function _esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function _escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}
