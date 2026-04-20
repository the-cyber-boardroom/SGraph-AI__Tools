/**
 * ui-recording-tab.js
 * Mounts the post-recording UI into an sg-layout tab panel:
 *   video player · per-track downloads · SG/Send share
 *
 * Each recording tab owns its own blob references and upload state —
 * completely independent of global recording state.
 * @module ui-recording-tab
 */

import { saveSendFile } from '../api/save-sg-send.js';

const SEND_URL = 'https://send.sgraph.ai';

/**
 * @param {HTMLElement} container   sg-layout panel element (already in DOM)
 * @param {Blob|null}   primaryBlob primary blob (combined/best track) for player + upload
 * @param {{ combined?: Blob, screen?: Blob, camera?: Blob, audio?: Blob }} blobs
 * @param {number}      durationMs
 * @param {number}      sizeBytes
 * @param {string}      name        recording name (from config.recordingName or auto)
 */
export function initRecordingTab(container, primaryBlob, blobs, durationMs, sizeBytes, name) {
    const safeName = _sanitize(name);
    const savedToken = localStorage.getItem('sgraph-send-token') ?? '';

    container.innerHTML = `
        <div class="rec-tab">
            <div class="rec-tab__header">
                <span class="rec-tab__name">${_esc(name)}</span>
                <span class="rec-tab__meta">${_formatMs(durationMs)} · ${_formatBytes(sizeBytes)}</span>
            </div>

            <div class="rec-tab__player">
                <sg-video-player id="rec-player" label="${_escAttr(name)}"></sg-video-player>
            </div>

            <div class="rec-tab__actions">
                <div class="rec-tab__section">
                    <div class="rec-tab__section-title">Download</div>
                    <div class="rec-dl-btns" id="dl-btns"></div>
                </div>

                <div class="rec-tab__section">
                    <div class="rec-tab__section-title">Share — SG/Send (encrypted link)</div>
                    <div class="rec-share-row">
                        <input id="share-token" class="rec-input" type="password"
                               placeholder="SG/Send access token"
                               value="${_escAttr(savedToken)}" />
                        <button id="share-save-token" class="rec-btn rec-btn--ghost-sm">Save</button>
                    </div>
                    <button id="share-upload" class="rec-btn rec-btn--upload" ${!primaryBlob ? 'disabled' : ''}>
                        ↑ Upload &amp; Share
                    </button>
                    <div class="rec-share-progress" id="share-progress" style="display:none">
                        <div class="rec-progress-bar">
                            <div class="rec-progress-fill" id="share-fill"></div>
                        </div>
                        <span class="rec-progress-label" id="share-label">0%</span>
                    </div>
                    <div class="rec-share-result" id="share-result" style="display:none">
                        <span class="rec-result-label">Share token:</span>
                        <code class="rec-result-token" id="share-token-display"></code>
                        <a class="rec-result-link" id="share-link" target="_blank" rel="noopener">Open link</a>
                        <button class="rec-btn rec-btn--copy" id="share-copy">Copy</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // ── Video player ──────────────────────────────────────────────────────────

    const player = container.querySelector('#rec-player');
    if (player && primaryBlob) {
        // SgComponent.connectedCallback is async (fetches CSS + HTML).
        // Wait for the component to be fully ready before calling setBlob.
        player.whenReady().then(() => {
            player.setBlob(primaryBlob);
        }).catch(err => {
            console.warn('[rec-tab] sg-video-player ready timeout:', err);
        });
    }

    // ── Download buttons ──────────────────────────────────────────────────────

    const dlBtns = container.querySelector('#dl-btns');
    const TRACKS = [
        { key: 'combined', label: '⬇ Combined', primary: true },
        { key: 'screen',   label: '⬇ Screen',   primary: false },
        { key: 'camera',   label: '⬇ Camera',   primary: false },
        { key: 'audio',    label: '⬇ Audio',    primary: false },
    ];

    for (const track of TRACKS) {
        const blob = blobs[track.key];
        if (!blob) continue;
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        const btn = document.createElement('button');
        btn.className = `rec-btn rec-btn--dl${track.primary ? ' rec-btn--dl-primary' : ''}`;
        btn.textContent = `${track.label}  ${_formatBytes(blob.size)}`;
        btn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href     = URL.createObjectURL(blob);
            a.download = `${safeName}-${track.key}.${ext}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        });
        dlBtns.appendChild(btn);
    }

    if (!dlBtns.children.length) {
        dlBtns.textContent = 'No files available.';
        dlBtns.style.cssText = 'color:var(--rec-muted);font-size:12px;';
    }

    // ── SG/Send share ─────────────────────────────────────────────────────────

    const tokenInput   = container.querySelector('#share-token');
    const saveTokenBtn = container.querySelector('#share-save-token');
    const uploadBtn    = container.querySelector('#share-upload');
    const progressEl   = container.querySelector('#share-progress');
    const fillEl       = container.querySelector('#share-fill');
    const labelEl      = container.querySelector('#share-label');
    const resultEl     = container.querySelector('#share-result');

    saveTokenBtn.addEventListener('click', () => {
        const t = tokenInput.value.trim();
        if (t) {
            localStorage.setItem('sgraph-send-token', t);
            saveTokenBtn.textContent = '✓ Saved';
            setTimeout(() => { saveTokenBtn.textContent = 'Save'; }, 2000);
        }
    });

    uploadBtn.addEventListener('click', async () => {
        if (!primaryBlob) return;
        const accessToken = tokenInput.value.trim() || localStorage.getItem('sgraph-send-token');
        if (!accessToken) {
            tokenInput.focus();
            tokenInput.placeholder = '⚠ Token required';
            return;
        }

        uploadBtn.disabled       = true;
        progressEl.style.display = '';
        resultEl.style.display   = 'none';

        const ext      = primaryBlob.type.includes('mp4') ? 'mp4' : 'webm';
        const filename = `${safeName}.${ext}`;

        try {
            const result = await saveSendFile(primaryBlob, { filename, accessToken }, (percent, message) => {
                fillEl.style.width  = `${percent}%`;
                labelEl.textContent = message ?? `${percent}%`;
            });

            progressEl.style.display = 'none';
            resultEl.style.display   = '';

            container.querySelector('#share-token-display').textContent = result.token;
            const linkEl = container.querySelector('#share-link');
            linkEl.href  = result.shareUrl;
            container.querySelector('#share-copy').onclick =
                () => navigator.clipboard.writeText(result.shareUrl);
        } catch (err) {
            progressEl.style.display = 'none';
            uploadBtn.disabled       = false;
            uploadBtn.textContent    = `Error: ${err.message}`;
        }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _sanitize(name) {
    return (name || 'recording')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .slice(0, 80) || 'recording';
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

function _formatMs(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function _formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
