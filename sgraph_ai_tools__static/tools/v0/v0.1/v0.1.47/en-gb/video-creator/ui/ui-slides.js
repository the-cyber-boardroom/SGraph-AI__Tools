/**
 * ui-slides.js
 * Slide upload dropzone and thumbnail grid.
 * Accepts PNG/JPEG files via file picker or drag-and-drop.
 *
 * @module ui-slides
 */

/**
 * @param {PipelineState} state
 * @param {SgToolApi}     api
 */
export function initSlides(state, api) {
    const panel = document.getElementById('vc-slides-panel');
    panel.innerHTML = `
        <div class="vc-section-header">
            <span>Slides</span>
            <label class="btn-secondary vc-upload-btn" for="vc-file-input">
                + Add slides
                <input type="file" id="vc-file-input" accept="image/png,image/jpeg,image/webp"
                       multiple style="display:none">
            </label>
        </div>
        <div id="vc-drop-zone" class="vc-drop-zone">
            <div class="vc-drop-hint">Drop PNG / JPEG slides here or click <b>+ Add slides</b></div>
        </div>
        <div id="vc-thumbnail-grid" class="vc-thumbnail-grid"></div>
    `;

    const fileInput = document.getElementById('vc-file-input');
    const dropZone  = document.getElementById('vc-drop-zone');

    fileInput.addEventListener('change', () => _handleFiles(Array.from(fileInput.files), state, api));

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        _handleFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')), state, api);
    });

    // Re-render thumbnails when slides change
    window.addEventListener('tool:slides:loaded', () => _renderThumbnails(state, api));
}

async function _handleFiles(files, state, api) {
    if (!files.length) return;
    await api.loadSlides({ files });
}

function _renderThumbnails(state, api) {
    const grid = document.getElementById('vc-thumbnail-grid');
    if (!grid) return;

    if (state.slides.length === 0) {
        grid.innerHTML = '';
        return;
    }

    // Hide drop zone once slides are loaded
    const dropZone = document.getElementById('vc-drop-zone');
    if (dropZone) dropZone.style.display = 'none';

    grid.innerHTML = state.slides.map((slide, i) => `
        <div class="vc-thumb ${state.selectedSlide === i ? 'selected' : ''}"
             data-index="${i}" title="${slide.name}">
            <img src="${slide.dataUrl}" alt="${slide.name}">
            <div class="vc-thumb-label">${i + 1}</div>
            ${state.audioDurations[i] > 0
                ? `<div class="vc-thumb-badge">${state.audioDurations[i].toFixed(1)}s</div>`
                : ''}
        </div>
    `).join('');

    grid.querySelectorAll('.vc-thumb').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.index, 10);
            state.selectedSlide = idx;
            _renderThumbnails(state, api);
            window.dispatchEvent(new CustomEvent('vc:slide-selected', { detail: { index: idx } }));
        });
    });
}
