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
import { sendToPublisher }     from '../../video-publisher/handoff/sg-publish-handoff.js';
import { sendToYouTubeEditor } from '../../youtube-editor/handoff/sg-youtube-handoff.js';

const SEND_URL = 'https://send.sgraph.ai';

const VIZ_MODES = [
    ['smooth-eq',     'Smooth EQ'],
    ['mirror-eq',     'Mirror EQ'],
    ['mirror-wave',   'Mirror Wave'],
    ['bars',          'Bars'],
    ['mirror-bars',   'Mirror Bars'],
    ['waveform',      'Waveform'],
    ['circular-wave', 'Circular Wave'],
    ['circular-bars', 'Circular Bars'],
    ['blob',          'Blob'],
];

const REGEN_SPEEDS = [
    ['1',  '1× (real-time)'],
    ['2',  '2× faster'],
    ['4',  '4× faster'],
    ['8',  '8× faster'],
];

/**
 * @param {HTMLElement} container   sg-layout panel element (already in DOM)
 * @param {Blob|null}   primaryBlob primary blob (combined/best track) for player + upload
 * @param {{ combined?: Blob, screen?: Blob, camera?: Blob, audio?: Blob }} blobs
 * @param {number}      durationMs
 * @param {number}      sizeBytes
 * @param {string}      name        recording name (from config.recordingName or auto)
 * @param {{ vizWasHidden?: boolean, vizMode?: string, onRegenerate?: (mode: string) => Promise<Blob> }} [opts]
 */
export function initRecordingTab(container, primaryBlob, blobs, durationMs, sizeBytes, name, opts = {}) {
    const { vizWasHidden = false, vizMode = 'smooth-eq', onRegenerate = null, audioSource = 'mic' } = opts;
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

                ${vizWasHidden ? `
                <div class="rec-tab__section" id="regen-section">
                    <div class="rec-tab__section-title" style="color:#fbbf24;">⚠ Visualisation</div>
                    <p style="font-size:11px;color:var(--rec-muted);margin-bottom:8px;line-height:1.5;">
                        You switched tabs during recording — the visualisation may be frozen in places.
                        Regenerate it from the audio (plays back in real-time, no upload needed).
                    </p>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <select id="regen-mode" style="flex:1;min-width:120px;background:rgba(0,0,0,0.4);border:1px solid var(--rec-border);border-radius:6px;color:var(--rec-text);font-size:12px;padding:6px 8px;outline:none;cursor:pointer;">
                            ${VIZ_MODES.map(([v, l]) => `<option value="${v}"${v === vizMode ? ' selected' : ''}>${l}</option>`).join('')}
                        </select>
                        <select id="regen-speed" style="background:rgba(0,0,0,0.4);border:1px solid var(--rec-border);border-radius:6px;color:var(--rec-text);font-size:12px;padding:6px 8px;outline:none;cursor:pointer;">
                            ${REGEN_SPEEDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                        </select>
                        <button id="regen-btn" class="rec-btn rec-btn--dl">↺ Regenerate Viz</button>
                    </div>
                    <div id="regen-status" style="display:none;margin-top:8px;font-size:11px;color:var(--rec-muted);"></div>
                </div>` : ''}

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

                <div class="rec-tab__section">
                    <div class="rec-tab__section-title">Publish</div>
                    <p style="font-size:11px;color:var(--rec-muted);margin:0 0 8px;line-height:1.5;">
                        Open Video Publisher (new tab) with this recording pre-loaded — it
                        transcribes the audio, writes the title/description, and uploads to
                        YouTube from one page.
                    </p>
                    <button id="send-publisher" class="rec-btn rec-btn--upload" ${!primaryBlob ? 'disabled' : ''}>
                        🚀 Publish
                    </button>
                </div>

                <div class="rec-tab__section">
                    <div class="rec-tab__section-title">Send to YouTube</div>
                    <p style="font-size:11px;color:var(--rec-muted);margin:0 0 8px;line-height:1.5;">
                        Open the recording in YouTube Editor (new tab) with this blob pre-loaded —
                        set title, privacy, and upload to your channel.
                    </p>
                    <button id="send-youtube" class="rec-btn rec-btn--upload" ${!primaryBlob ? 'disabled' : ''}>
                        ▶ Send to YouTube Editor
                    </button>
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
    const audioLabel = audioSource === 'screen' ? '⬇ Audio (tab)' : '⬇ Audio (mic)';
    const TRACKS = [
        { key: 'combined', label: '⬇ Combined',  primary: true },
        { key: 'screen',   label: '⬇ Screen',    primary: false },
        { key: 'camera',   label: '⬇ Camera',    primary: false },
        { key: 'audio',    label: audioLabel,     primary: false },
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

    // ── Regenerate visualisation ──────────────────────────────────────────────

    function _rebuildDlBtns(newBlob) {
        // Insert the regenerated blob as a new primary download at the top,
        // keeping all original track downloads intact below it.
        const ext = newBlob.type.includes('mp4') ? 'mp4' : 'webm';
        const btn = document.createElement('button');
        btn.className   = 'rec-btn rec-btn--dl rec-btn--dl-primary';
        btn.textContent = `⬇ Regenerated Viz  ${_formatBytes(newBlob.size)}`;
        btn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href     = URL.createObjectURL(newBlob);
            a.download = `${safeName}-viz-regen.${ext}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        });
        dlBtns.insertBefore(btn, dlBtns.firstChild);
    }

    if (vizWasHidden && onRegenerate) {
        const regenBtn    = container.querySelector('#regen-btn');
        const modeSelect  = container.querySelector('#regen-mode');
        const speedSelect = container.querySelector('#regen-speed');
        const regenStatus = container.querySelector('#regen-status');

        regenBtn?.addEventListener('click', async () => {
            const mode  = modeSelect.value;
            const speed = parseFloat(speedSelect.value) || 1;
            regenBtn.disabled       = true;
            regenStatus.textContent = speed > 1
                ? `Generating at ${speed}× speed (viz only — use Audio download for clean audio)…`
                : 'Generating… (plays back the audio in real-time)';
            regenStatus.style.color = 'var(--rec-muted)';
            regenStatus.style.display = '';

            try {
                const newBlob = await onRegenerate(mode, speed);

                // Update player
                player?.whenReady().then(() => player.setBlob(newBlob)).catch(() => {});
                // Update download buttons
                _rebuildDlBtns(newBlob);

                regenStatus.textContent = '✓ Done — player and download updated.';
                regenStatus.style.color = '#34d399';
            } catch (err) {
                regenStatus.textContent = `Error: ${err.message}`;
                regenStatus.style.color = '#ef4444';
            } finally {
                regenBtn.disabled    = false;
                regenBtn.textContent = '↺ Regenerate Again';
            }
        });
    }

    // ── Hand-offs (shared helpers — same protocol, consume-once) ─────────────

    const handoffPayload = () => ({
        blob:           primaryBlob,
        audioBlob:      blobs.audio || null,   // route-1 audio: publisher skips extraction
        suggestedTitle: name || `Recording ${new Date().toLocaleDateString('en-GB')}`,
        filename:       `${(name || 'recording').replace(/[^\w-]+/g, '_')}.webm`,
        sourceUrl:      location.href,
        sourceTool:     'video-recorder',
    });

    container.querySelector('#send-publisher')?.addEventListener('click', () => {
        if (primaryBlob) sendToPublisher(handoffPayload());
    });

    container.querySelector('#send-youtube')?.addEventListener('click', () => {
        if (primaryBlob) sendToYouTubeEditor(handoffPayload());
    });

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
