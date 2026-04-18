/**
 * ui-shell.js
 * Layout scaffold — creates the three-panel layout and mounts all sub-panels.
 * @module ui-shell
 */

import { initControls } from './ui-controls.js';
import { initPreview }  from './ui-preview.js';
import { initExport }   from './ui-export.js';

/**
 * @param {import('../api/recorder-state.js').RecordingState}  state
 * @param {import('../api/recorder-state.js').RecordingConfig} config
 * @param {object} api   SgToolApi instance
 * @param {Function} emit  (eventName, detail) => void
 */
export function init(state, config, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;

    wrap.innerHTML = `
        <div class="rec-layout">
            <div class="rec-panel rec-panel--controls" id="panel-controls"></div>
            <div class="rec-panel rec-panel--preview"  id="panel-preview"></div>
            <div class="rec-panel rec-panel--export"   id="panel-export"></div>
        </div>
    `;

    initControls(document.getElementById('panel-controls'), state, config, api, emit);
    initPreview( document.getElementById('panel-preview'),  state, config, api, emit);
    initExport(  document.getElementById('panel-export'),   state, config, api, emit);
}
