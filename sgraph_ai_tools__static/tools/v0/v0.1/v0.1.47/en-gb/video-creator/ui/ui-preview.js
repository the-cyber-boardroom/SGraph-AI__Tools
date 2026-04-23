/**
 * ui-preview.js
 * Canvas preview showing the currently selected slide.
 * Shows TTS progress bar and status messages.
 *
 * @module ui-preview
 */

/**
 * @param {PipelineState} state
 * @param {SgToolApi}     api
 */
export function initPreview(state, api) {
    const panel = document.getElementById('vc-preview-panel');
    panel.innerHTML = `
        <div class="vc-section-header">
            <span>Preview</span>
            <span id="vc-preview-status" class="vc-status-text">Ready</span>
        </div>
        <div class="vc-canvas-wrap">
            <canvas id="vc-preview-canvas" width="1280" height="720"></canvas>
            <div id="vc-progress-overlay" class="vc-progress-overlay hidden">
                <div class="vc-progress-label" id="vc-progress-label">Loading…</div>
                <div class="vc-progress-bar-track">
                    <div class="vc-progress-bar-fill" id="vc-progress-fill" style="width:0%"></div>
                </div>
            </div>
        </div>
    `;

    const canvas   = document.getElementById('vc-preview-canvas');
    const ctx      = canvas.getContext('2d');
    const statusEl = document.getElementById('vc-preview-status');

    _drawPlaceholder(ctx, canvas.width, canvas.height);

    // Show selected slide
    window.addEventListener('vc:slide-selected', (e) => {
        const slide = state.slides[e.detail.index];
        if (slide) _drawSlideImage(ctx, canvas, slide);
    });

    window.addEventListener('tool:slides:loaded', () => {
        if (state.slides.length > 0) _drawSlideImage(ctx, canvas, state.slides[0]);
    });

    // TTS progress
    window.addEventListener('tool:audio:progress', (e) => {
        const { slideIndex, total } = e.detail;
        if (slideIndex !== undefined) {
            _setProgress(
                `Generating audio: slide ${slideIndex + 1} / ${total ?? state.slides.length}`,
                (slideIndex / (total ?? state.slides.length)) * 100
            );
            statusEl.textContent = `TTS: ${slideIndex + 1}/${total ?? state.slides.length}`;
        }
    });

    window.addEventListener('tool:audio:complete', () => {
        _hideProgress();
        statusEl.textContent = 'Audio ready';
    });

    window.addEventListener('tool:record:start', () => {
        statusEl.textContent = 'Recording…';
        _setProgress('Recording slideshow…', 0);
    });

    window.addEventListener('tool:record:stop', () => {
        _hideProgress();
        statusEl.textContent = 'Recording done';
    });
}

function _drawPlaceholder(ctx, w, h) {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#30363d';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Upload slides to begin', w / 2, h / 2);
}

function _drawSlideImage(ctx, canvas, slide) {
    const img  = new Image();
    img.onload = () => {
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const w     = img.width  * scale;
        const h     = img.height * scale;
        const x     = (canvas.width  - w) / 2;
        const y     = (canvas.height - h) / 2;
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, x, y, w, h);
    };
    img.src = slide.dataUrl;
}

function _setProgress(label, pct) {
    const overlay = document.getElementById('vc-progress-overlay');
    const fill    = document.getElementById('vc-progress-fill');
    const lbl     = document.getElementById('vc-progress-label');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    if (lbl) lbl.textContent = label;
    if (fill) fill.style.width = `${Math.min(100, pct)}%`;
}

function _hideProgress() {
    const overlay = document.getElementById('vc-progress-overlay');
    if (overlay) overlay.classList.add('hidden');
}
