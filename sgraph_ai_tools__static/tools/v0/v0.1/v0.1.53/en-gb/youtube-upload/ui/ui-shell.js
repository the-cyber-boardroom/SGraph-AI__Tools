/**
 * ui-shell.js
 * Layout orchestrator — sg-layout row split (Controls | Result/Activity)
 * + collapsible JS API dev panel + footer bar (matches video-recorder pattern).
 *
 * @module ui-shell
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SGA_YT }     from '../api/youtube-upload-events.js';
import { initControls } from './ui-controls.js';
import { initResult }   from './ui-result.js';
import { initApiPane }  from './ui-api-pane.js';

// Side-effect imports — register custom elements before use
import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/upload-dropzone/v1/v1.0/v1.0.0/sg-upload-dropzone.js';
import '/components/video/upload/sg-youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

/**
 * @param {import('../api/youtube-upload-state.js').YouTubeUploadState} state
 * @param {object}   api    SgToolApi instance
 * @param {Function} emit
 */
export async function init(state, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // ── Tool area ─────────────────────────────────────────────────────────────
    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(toolArea);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    layout.setLayout({
        type: 'row', id: 'root', sizes: [0.4, 0.6],
        children: [
            {
                type: 'stack', id: 's-controls', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-controls', title: '▶ Upload', tag: 'div', locked: true, closable: false }],
            },
            {
                type: 'stack', id: 's-result', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-result', title: 'Activity', tag: 'div', locked: true, closable: false }],
            },
        ],
    });
    await layoutReady;

    const controlsEl = layout.getPanelElement('t-controls');
    const resultEl   = layout.getPanelElement('t-result');

    if (controlsEl) {
        controlsEl.style.cssText = 'height:100%;overflow-y:auto;padding:14px;box-sizing:border-box;';
        initControls(controlsEl, state, api, emit);
    }
    if (resultEl) {
        resultEl.style.cssText = 'height:100%;overflow-y:auto;padding:14px;box-sizing:border-box;';
        initResult(resultEl, state, emit);
    }

    // ── Dev panel (JS API explorer / console / manifest / skills) ─────────────
    initApiPane(wrap);
}
