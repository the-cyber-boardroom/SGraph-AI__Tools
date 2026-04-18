/**
 * ui-export.js
 * Save targets: SG/Send (encrypted link) and local folder.
 * @module ui-export
 */

import { SGA_RECORDER } from '../api/recorder-events.js';

/**
 * @param {HTMLElement} container
 * @param {import('../api/recorder-state.js').RecordingState}  state
 * @param {import('../api/recorder-state.js').RecordingConfig} config
 * @param {object} api
 * @param {Function} emit
 */
export function initExport(container, state, config, api, emit) {
    // Pre-fill token from localStorage if available
    const savedToken = localStorage.getItem('sgraph-send-token') ?? '';

    container.innerHTML = `
        <section class="export-panel">
            <h2 class="export-panel__title">Save</h2>

            <!-- SG/Send -->
            <div class="export-target" id="target-send">
                <div class="export-target__header">
                    <div class="export-target__info">
                        <span class="export-target__name">SG/Send</span>
                        <span class="export-target__desc">Encrypted shareable link</span>
                    </div>
                    <button id="btn-save-send" class="export-btn export-btn--primary" disabled>
                        Upload & Get Link
                    </button>
                </div>
                <div class="export-token-row">
                    <input id="send-token-input" class="export-input" type="password"
                           placeholder="SG/Send access token"
                           value="${_escAttr(savedToken)}" />
                    <button id="btn-save-token" class="export-btn export-btn--ghost-sm">Save</button>
                </div>
                <div class="export-progress" id="progress-send" style="display:none">
                    <div class="export-progress__bar"><div class="export-progress__fill" id="fill-send"></div></div>
                    <span class="export-progress__label" id="label-send">0%</span>
                </div>
                <div class="export-result" id="result-send" style="display:none">
                    <span class="export-result__label">Share token:</span>
                    <code class="export-result__token" id="token-send"></code>
                    <a class="export-result__link" id="link-send" target="_blank" rel="noopener">Open link</a>
                    <button class="export-btn export-btn--copy" id="btn-copy-send">Copy</button>
                </div>
            </div>

            <!-- Local Folder -->
            <div class="export-target" id="target-folder">
                <div class="export-target__header">
                    <div class="export-target__info">
                        <span class="export-target__name">Local Folder</span>
                        <span class="export-target__desc">Video + metadata saved to disk</span>
                    </div>
                    <button id="btn-save-folder" class="export-btn export-btn--secondary" disabled>
                        Save Folder
                    </button>
                </div>
                <div class="export-progress" id="progress-folder" style="display:none">
                    <div class="export-progress__bar"><div class="export-progress__fill" id="fill-folder"></div></div>
                    <span class="export-progress__label" id="label-folder">0%</span>
                </div>
                <div class="export-result" id="result-folder" style="display:none">
                    <span class="export-result__label" id="result-folder-label"></span>
                </div>
            </div>
        </section>
    `;

    const btnSaveSend    = container.querySelector('#btn-save-send');
    const btnSaveFolder  = container.querySelector('#btn-save-folder');
    const tokenInput     = container.querySelector('#send-token-input');
    const btnSaveToken   = container.querySelector('#btn-save-token');

    // ── Token persistence ─────────────────────────────────────────────────────

    btnSaveToken.addEventListener('click', () => {
        const token = tokenInput.value.trim();
        if (token) {
            localStorage.setItem('sgraph-send-token', token);
            btnSaveToken.textContent = '✓ Saved';
            setTimeout(() => { btnSaveToken.textContent = 'Save'; }, 2000);
        }
    });

    // ── Enable buttons once recording is stopped ──────────────────────────────

    window.addEventListener(SGA_RECORDER.RECORD_STOP, () => {
        btnSaveSend.disabled   = false;
        btnSaveFolder.disabled = false;
    });

    window.addEventListener(SGA_RECORDER.RESET, () => {
        btnSaveSend.disabled   = true;
        btnSaveFolder.disabled = true;
        container.querySelector('#result-send').style.display   = 'none';
        container.querySelector('#result-folder').style.display = 'none';
        _showProgress('send', false);
        _showProgress('folder', false);
    });

    // ── SG/Send ───────────────────────────────────────────────────────────────

    btnSaveSend.addEventListener('click', async () => {
        if (!state.blob) return;
        const accessToken = tokenInput.value.trim() || localStorage.getItem('sgraph-send-token');
        if (!accessToken) {
            tokenInput.focus();
            tokenInput.placeholder = '⚠ Token required';
            return;
        }
        btnSaveSend.disabled = true;
        _showProgress('send', true);

        try {
            const result = await api.saveSendFile({ accessToken });
            _showProgress('send', false);
            const resultEl = container.querySelector('#result-send');
            resultEl.style.display = '';
            container.querySelector('#token-send').textContent = result.token;
            const linkEl = container.querySelector('#link-send');
            linkEl.href  = result.shareUrl;
            container.querySelector('#btn-copy-send').onclick = () =>
                navigator.clipboard.writeText(result.shareUrl);
        } catch (err) {
            _showProgress('send', false);
            btnSaveSend.disabled    = false;
            btnSaveSend.textContent = `Error: ${err.message}`;
        }
    });

    // ── Local Folder ──────────────────────────────────────────────────────────

    btnSaveFolder.addEventListener('click', async () => {
        if (!state.blob) return;
        btnSaveFolder.disabled = true;
        _showProgress('folder', true);

        try {
            const result = await api.saveFolder({ screenshots: true });
            _showProgress('folder', false);
            const resultEl = container.querySelector('#result-folder');
            resultEl.style.display = '';
            container.querySelector('#result-folder-label').textContent = `Saved: ${result.folderId}`;
        } catch (err) {
            _showProgress('folder', false);
            btnSaveFolder.disabled    = false;
            btnSaveFolder.textContent = `Error: ${err.message}`;
        }
    });

    // ── Progress events ───────────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.SAVE_PROGRESS, (e) => {
        const { target, percent, message } = e.detail;
        const key   = target === 'sg-send' ? 'send' : target;
        const fill  = container.querySelector(`#fill-${key}`);
        const label = container.querySelector(`#label-${key}`);
        if (fill)  fill.style.width  = `${percent}%`;
        if (label) label.textContent = message ?? `${percent}%`;
    });
}

function _showProgress(key, show) {
    const el = document.querySelector(`#progress-${key}`);
    if (el) el.style.display = show ? '' : 'none';
}

function _escAttr(s) {
    return s.replace(/"/g, '&quot;');
}
