/**
 * ui-shell.js
 * Top-level UI orchestrator. Sets up sg-layout panels and mounts sub-panels.
 * Called by video-api.js after activate().
 *
 * Layout: two-column
 *   Left  — slides panel (upload + thumbnails + narration editor)
 *   Right — preview + export panel
 *
 * @module ui-shell
 */

import { initSlides }    from './ui-slides.js';
import { initNarration } from './ui-narration.js';
import { initPreview }   from './ui-preview.js';
import { initExport }    from './ui-export.js';

/**
 * Bootstrap the full UI.
 * @param {PipelineState} state
 * @param {SgToolApi}     api
 * @param {function}      emit
 */
export function init(state, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;

    wrap.innerHTML = `
        <div class="vc-shell">
            <div class="vc-left">
                <div id="vc-slides-panel"></div>
                <div id="vc-narration-panel"></div>
            </div>
            <div class="vc-right">
                <div id="vc-preview-panel"></div>
                <div id="vc-export-panel"></div>
            </div>
        </div>
    `;

    initSlides(state, api);
    initNarration(state, api);
    initPreview(state, api);
    initExport(state, api, emit);
}
