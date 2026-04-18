/**
 * ui-preview.js
 * Camera preview before recording, live preview during recording,
 * and sg-video-player playback after stop.
 * @module ui-preview
 */

import { SGA_RECORDER } from '../api/recorder-events.js';

/**
 * @param {HTMLElement} container
 * @param {import('../api/recorder-state.js').RecordingState}  state
 * @param {import('../api/recorder-state.js').RecordingConfig} config
 * @param {object} api
 * @param {Function} emit
 */
export function initPreview(container, state, config, api, emit) {
    container.innerHTML = `
        <section class="preview-panel">
            <h2 class="preview-panel__title">Preview</h2>

            <!-- Camera preview before recording -->
            <div class="preview-live" id="preview-pregame" style="display:none">
                <video id="pregame-video" class="preview-video" autoplay muted playsinline></video>
                <div class="preview-live__badge preview-live__badge--preview">PREVIEW</div>
            </div>

            <!-- Live preview during recording -->
            <div class="preview-live" id="preview-live" style="display:none">
                <video id="live-video" class="preview-video" autoplay muted playsinline></video>
                <div class="preview-live__badge">LIVE</div>
            </div>

            <!-- Post-recording player -->
            <div class="preview-playback" id="preview-playback" style="display:none">
                <sg-video-player id="player" label="Recording"></sg-video-player>
            </div>

            <!-- Idle placeholder -->
            <div class="preview-placeholder" id="preview-placeholder">
                <span class="preview-placeholder__icon">🎬</span>
                <span>Select a mode and click Preview or Start Recording</span>
            </div>
        </section>
    `;

    const pregameEl     = container.querySelector('#preview-pregame');
    const pregameVideo  = container.querySelector('#pregame-video');
    const liveEl        = container.querySelector('#preview-live');
    const liveVideo     = container.querySelector('#live-video');
    const playbackEl    = container.querySelector('#preview-playback');
    const placeholderEl = container.querySelector('#preview-placeholder');
    const player        = container.querySelector('#player');

    function _showOnly(which) {
        pregameEl.style.display     = which === 'pregame'     ? '' : 'none';
        liveEl.style.display        = which === 'live'        ? '' : 'none';
        playbackEl.style.display    = which === 'playback'    ? '' : 'none';
        placeholderEl.style.display = which === 'placeholder' ? '' : 'none';
    }

    // Start with placeholder visible
    _showOnly('placeholder');

    // ── Camera preview (before recording) ────────────────────────────────────

    window.addEventListener(SGA_RECORDER.PREVIEW_START, (e) => {
        const { stream, hasVideo } = e.detail ?? {};
        if (stream && hasVideo) {
            pregameVideo.srcObject = stream;
            pregameVideo.play().catch(() => {});
            _showOnly('pregame');
        } else {
            // Audio-only or screen-only mode — no camera to show
            _showOnly('placeholder');
        }
    });

    window.addEventListener(SGA_RECORDER.PREVIEW_STOP, () => {
        pregameVideo.srcObject = null;
        _showOnly('placeholder');
    });

    // ── Live recording ────────────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.RECORD_START, () => {
        pregameVideo.srcObject = null;

        if (state.stream) {
            liveVideo.srcObject = state.stream;
            liveVideo.play().catch(() => {});
        }
        _showOnly('live');
    });

    window.addEventListener(SGA_RECORDER.RECORD_STOP, () => {
        liveVideo.srcObject = null;

        if (state.blob) {
            if (player?.setBlob) player.setBlob(state.blob);
            _showOnly('playback');
        } else {
            _showOnly('placeholder');
        }
    });

    // ── New recording reset ───────────────────────────────────────────────────

    window.addEventListener(SGA_RECORDER.RESET, () => {
        liveVideo.srcObject    = null;
        pregameVideo.srcObject = null;
        if (player?.destroy) player.destroy();
        _showOnly('placeholder');
    });
}
