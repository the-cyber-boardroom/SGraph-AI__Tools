/**
 * ui-export.js
 * Three save targets: SG/Send, folder, vault.
 * Also includes sg-video-compressor for optional compression before save.
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
    container.innerHTML = `
        <section class="export-panel">
            <h2 class="export-panel__title">Save</h2>

            <!-- Optional compression step -->
            <div class="export-compress" id="export-compress">
                <div class="export-compress__header">
                    <span class="export-compress__label">Optional: Compress before saving</span>
                    <button id="btn-compress" class="export-btn export-btn--secondary" disabled>
                        Compress
                    </button>
                </div>
                <sg-video-compressor id="compressor" resolution="720p" format="mp4" video-kbps="1500"></sg-video-compressor>
            </div>

            <!-- Save targets -->
            <div class="export-targets">

                <!-- SG/Send -->
                <div class="export-target" id="target-send">
                    <div class="export-target__header">
                        <div class="export-target__info">
                            <span class="export-target__name">SG/Send</span>
                            <span class="export-target__desc">Encrypted link — share anywhere</span>
                        </div>
                        <button id="btn-save-send" class="export-btn export-btn--primary" disabled>
                            Save & Get Link
                        </button>
                    </div>
                    <div class="export-progress" id="progress-send" hidden>
                        <div class="export-progress__bar"><div class="export-progress__fill" id="fill-send"></div></div>
                        <span class="export-progress__label" id="label-send">0%</span>
                    </div>
                    <div class="export-result" id="result-send" hidden>
                        <span class="export-result__label">Share token:</span>
                        <code class="export-result__token" id="token-send"></code>
                        <a class="export-result__link" id="link-send" target="_blank" rel="noopener">Open link</a>
                        <button class="export-btn export-btn--copy" id="btn-copy-send">Copy</button>
                    </div>
                </div>

                <!-- Folder -->
                <div class="export-target" id="target-folder">
                    <div class="export-target__header">
                        <div class="export-target__info">
                            <span class="export-target__name">Local Folder</span>
                            <span class="export-target__desc">Video + thumbnail + metadata</span>
                        </div>
                        <button id="btn-save-folder" class="export-btn export-btn--secondary" disabled>
                            Save Folder
                        </button>
                    </div>
                    <div class="export-progress" id="progress-folder" hidden>
                        <div class="export-progress__bar"><div class="export-progress__fill" id="fill-folder"></div></div>
                        <span class="export-progress__label" id="label-folder">0%</span>
                    </div>
                    <div class="export-result" id="result-folder" hidden>
                        <span class="export-result__label" id="result-folder-label"></span>
                    </div>
                </div>

                <!-- Vault -->
                <div class="export-target" id="target-vault">
                    <div class="export-target__header">
                        <div class="export-target__info">
                            <span class="export-target__name">SGraph Vault</span>
                            <span class="export-target__desc">Versioned encrypted commit</span>
                        </div>
                        <button id="btn-save-vault" class="export-btn export-btn--secondary" disabled>
                            Save to Vault
                        </button>
                    </div>
                    <div class="export-vault-inputs" id="vault-inputs">
                        <input id="vault-id"  class="export-input" type="text" placeholder="Vault ID" />
                        <input id="vault-key" class="export-input" type="password" placeholder="Vault Key" />
                        <input id="vault-msg" class="export-input" type="text" placeholder="Commit message (optional)" />
                    </div>
                    <div class="export-progress" id="progress-vault" hidden>
                        <div class="export-progress__bar"><div class="export-progress__fill" id="fill-vault"></div></div>
                        <span class="export-progress__label" id="label-vault">0%</span>
                    </div>
                    <div class="export-result" id="result-vault" hidden>
                        <span class="export-result__label" id="result-vault-label"></span>
                        <a class="export-result__link" id="link-vault" target="_blank" rel="noopener" hidden>Open Vault</a>
                    </div>
                </div>
            </div>

            <!-- Direct download fallback -->
            <div class="export-download">
                <button id="btn-download" class="export-btn export-btn--ghost" disabled>
                    ↓ Download WebM
                </button>
            </div>
        </section>
    `;

    const btnSaveSend   = container.querySelector('#btn-save-send');
    const btnSaveFolder = container.querySelector('#btn-save-folder');
    const btnSaveVault  = container.querySelector('#btn-save-vault');
    const btnCompress   = container.querySelector('#btn-compress');
    const btnDownload   = container.querySelector('#btn-download');
    const compressor    = container.querySelector('#compressor');

    // Enable save buttons once recording is stopped
    window.addEventListener(SGA_RECORDER.RECORD_STOP, () => {
        btnSaveSend.disabled   = false;
        btnSaveFolder.disabled = false;
        btnSaveVault.disabled  = false;
        btnCompress.disabled   = false;
        btnDownload.disabled   = false;
    });

    // ── Compress ───────────────────────────────────────────────────────────

    btnCompress.addEventListener('click', async () => {
        if (!state.blob) return;
        btnCompress.disabled = true;
        try {
            const result = await compressor.compress(state.blob);
            state.blob      = result;
            state.sizeBytes = result.size;
            btnCompress.textContent = `Compressed (${_formatBytes(result.size)})`;
        } catch (err) {
            btnCompress.disabled = false;
            btnCompress.textContent = `Compress failed: ${err.message}`;
        }
    });

    compressor.addEventListener('sg-video-compressor:complete', (e) => {
        btnCompress.disabled = false;
    });

    // ── SG/Send ────────────────────────────────────────────────────────────

    btnSaveSend.addEventListener('click', async () => {
        if (!state.blob) return;
        btnSaveSend.disabled = true;
        _showProgress('send', true);

        try {
            const result = await api.saveSendFile({});
            _showProgress('send', false);
            container.querySelector('#result-send').hidden  = false;
            container.querySelector('#token-send').textContent = result.token;
            const linkEl = container.querySelector('#link-send');
            linkEl.href = result.shareUrl;
            container.querySelector('#btn-copy-send').onclick = () => navigator.clipboard.writeText(result.shareUrl);
        } catch (err) {
            _showProgress('send', false);
            btnSaveSend.disabled   = false;
            btnSaveSend.textContent = `Error: ${err.message}`;
        }
    });

    // ── Folder ────────────────────────────────────────────────────────────

    btnSaveFolder.addEventListener('click', async () => {
        if (!state.blob) return;
        btnSaveFolder.disabled = true;
        _showProgress('folder', true);

        try {
            const result = await api.saveFolder({ screenshots: true });
            _showProgress('folder', false);
            container.querySelector('#result-folder').hidden = false;
            container.querySelector('#result-folder-label').textContent = `Saved as: ${result.folderId}`;
        } catch (err) {
            _showProgress('folder', false);
            btnSaveFolder.disabled   = false;
            btnSaveFolder.textContent = `Error: ${err.message}`;
        }
    });

    // ── Vault ─────────────────────────────────────────────────────────────

    btnSaveVault.addEventListener('click', async () => {
        if (!state.blob) return;
        const vaultId  = container.querySelector('#vault-id').value.trim();
        const vaultKey = container.querySelector('#vault-key').value.trim();
        const message  = container.querySelector('#vault-msg').value.trim();

        if (!vaultId || !vaultKey) {
            alert('Please enter vault ID and key.');
            return;
        }

        btnSaveVault.disabled = true;
        _showProgress('vault', true);

        try {
            const result = await api.saveVault({ vaultId, vaultKey, message });
            _showProgress('vault', false);
            container.querySelector('#result-vault').hidden = false;
            container.querySelector('#result-vault-label').textContent = `Committed: ${result.commitHash?.slice(0, 8) ?? '—'}`;
            if (result.vaultUrl) {
                const linkEl = container.querySelector('#link-vault');
                linkEl.href = result.vaultUrl;
                linkEl.hidden = false;
            }
        } catch (err) {
            _showProgress('vault', false);
            btnSaveVault.disabled   = false;
            btnSaveVault.textContent = `Error: ${err.message}`;
        }
    });

    // ── Download ──────────────────────────────────────────────────────────

    btnDownload.addEventListener('click', () => {
        if (!state.blob) return;
        const ext = state.blob.type.includes('mp4') ? 'mp4' : 'webm';
        const a   = document.createElement('a');
        a.href    = URL.createObjectURL(state.blob);
        a.download = `recording-${Date.now()}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    });

    // ── Progress events ───────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.SAVE_PROGRESS, (e) => {
        const { target, percent, message } = e.detail;
        const key = target === 'sg-send' ? 'send' : target;
        const fill  = container.querySelector(`#fill-${key}`);
        const label = container.querySelector(`#label-${key}`);
        if (fill)  fill.style.width       = `${percent}%`;
        if (label) label.textContent      = message ?? `${percent}%`;
    });
}

function _showProgress(key, show) {
    const el = document.querySelector(`#progress-${key}`);
    if (el) el.hidden = !show;
}

function _formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
