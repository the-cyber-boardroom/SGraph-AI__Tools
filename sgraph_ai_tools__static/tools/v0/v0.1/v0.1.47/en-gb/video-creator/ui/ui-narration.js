/**
 * ui-narration.js
 * Per-slide narration text editor.
 * Shows the currently selected slide's narration; saves on input.
 *
 * @module ui-narration
 */

/**
 * @param {PipelineState} state
 * @param {SgToolApi}     api
 */
export function initNarration(state, api) {
    const panel = document.getElementById('vc-narration-panel');
    panel.innerHTML = `
        <div class="vc-section-header">
            <span id="vc-narration-label">Narration — no slide selected</span>
            <span id="vc-char-count" class="vc-char-count">0 chars</span>
        </div>
        <textarea id="vc-narration-text" class="vc-narration-textarea"
                  placeholder="Type narration for the selected slide…"
                  rows="6" disabled></textarea>
        <div class="vc-narration-hint">
            Tip: each sentence is generated in parallel — shorter sentences = faster audio.
        </div>
    `;

    const textarea  = document.getElementById('vc-narration-text');
    const label     = document.getElementById('vc-narration-label');
    const charCount = document.getElementById('vc-char-count');

    textarea.addEventListener('input', () => {
        const idx = state.selectedSlide;
        if (idx === null) return;
        state.setNarration(idx, textarea.value);
        charCount.textContent = `${textarea.value.length} chars`;
        api.setNarration({ slideIndex: idx, text: textarea.value });
    });

    window.addEventListener('vc:slide-selected', (e) => {
        const idx = e.detail.index;
        state.selectedSlide = idx;
        _updateEditor(state, textarea, label, charCount);
    });

    window.addEventListener('tool:slides:loaded', () => {
        if (state.slides.length > 0) {
            state.selectedSlide = 0;
            _updateEditor(state, textarea, label, charCount);
        }
    });
}

function _updateEditor(state, textarea, label, charCount) {
    const idx = state.selectedSlide;
    if (idx === null || idx >= state.slides.length) {
        textarea.disabled = true;
        textarea.value    = '';
        label.textContent = 'Narration — no slide selected';
        charCount.textContent = '0 chars';
        return;
    }
    textarea.disabled     = false;
    textarea.value        = state.narrations[idx] ?? '';
    label.textContent     = `Narration — Slide ${idx + 1}: ${state.slides[idx].name}`;
    charCount.textContent = `${textarea.value.length} chars`;
    textarea.focus();
}
