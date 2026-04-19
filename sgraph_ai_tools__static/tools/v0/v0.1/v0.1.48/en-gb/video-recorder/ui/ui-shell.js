/**
 * ui-shell.js
 * Layout scaffold — 2-column (sidebar | preview) + JS API bottom pane.
 * @module ui-shell
 */

import { initControls } from './ui-controls.js';
import { initPreview }  from './ui-preview.js';
import { initExport }   from './ui-export.js';
import { initApiPane }  from './ui-api-pane.js';

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
        </div>
        <div id="panel-api"></div>
    `;

    const panelControls = document.getElementById('panel-controls');

    // Controls fill the top of the sidebar
    const controlsMount = document.createElement('div');
    panelControls.appendChild(controlsMount);
    initControls(controlsMount, state, config, api, emit);

    // Save (SG/Send) appended below controls in the same sidebar
    const divider = document.createElement('hr');
    divider.className = 'rec-divider';
    panelControls.appendChild(divider);

    const saveMount = document.createElement('div');
    panelControls.appendChild(saveMount);
    initExport(saveMount, state, config, api, emit);

    initPreview(document.getElementById('panel-preview'), state, config, api, emit);
    initApiPane(document.getElementById('panel-api'),     state, config, api, emit);
}
