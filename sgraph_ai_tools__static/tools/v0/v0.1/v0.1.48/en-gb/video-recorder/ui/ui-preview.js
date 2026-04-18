/**
 * ui-preview.js
 * Live video preview during recording and sg-video-player playback after stop.
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

            <!-- Live preview (shown during recording) -->
            <div class="preview-live" id="preview-live" hidden>
                <video id="live-video" class="preview-video" autoplay muted playsinline></video>
                <div class="preview-live__badge">LIVE</div>
            </div>

            <!-- Post-recording player (shown after stop) -->
            <div class="preview-playback" id="preview-playback" hidden>
                <sg-video-player id="player" label="Recording"></sg-video-player>
            </div>

            <div class="preview-placeholder" id="preview-placeholder">
                <span class="preview-placeholder__icon">🎬</span>
                <span>Preview appears here during recording</span>
            </div>
        </section>
    `;

    const liveEl      = container.querySelector('#preview-live');
    const liveVideo   = container.querySelector('#live-video');
    const playbackEl  = container.querySelector('#preview-playback');
    const placeholderEl = container.querySelector('#preview-placeholder');
    const player      = container.querySelector('#player');

    window.addEventListener(SGA_RECORDER.RECORD_START, () => {
        placeholderEl.hidden = true;
        playbackEl.hidden    = true;
        liveEl.hidden        = false;

        // Show the active media stream in the live preview video element
        if (state.stream) {
            liveVideo.srcObject = state.stream;
            liveVideo.play().catch(() => {});
        }
    });

    window.addEventListener(SGA_RECORDER.RECORD_STOP, () => {
        liveEl.hidden        = true;
        liveVideo.srcObject  = null;

        if (state.blob) {
            playbackEl.hidden = false;
            if (player?.setBlob) {
                player.setBlob(state.blob);
            }
        } else {
            placeholderEl.hidden = false;
        }
    });
}
