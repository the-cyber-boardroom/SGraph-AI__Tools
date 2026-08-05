/**
 * ui-shell.js
 * Layout: left column (Record|Import stack, Steps, Accounts) — right stack
 * (Transcript | Metadata | Publish). One page, visible pipeline, one primary
 * action per state.
 * @module ui-shell
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { pickupHandoff } from '../handoff/sg-publish-handoff.js';
import { acceptHandoff } from '../api/publisher-pipeline.js';
import { initRecordTab }  from './ui-record.js';
import { initSourceTab }  from './ui-source.js';
import { initStepsPanel } from './ui-steps.js';
import { initAccounts }   from './ui-accounts.js';
import { initTranscriptTab } from './ui-transcript.js';
import { initMetadataTab }   from './ui-metadata.js';
import { initPublishTab }    from './ui-publish.js';
import { initApiPane }       from './ui-api-pane.js';

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/upload-dropzone/v1/v1.0/v1.0.0/sg-upload-dropzone.js';
import '/components/sg-video-player/v0/v0.1/v0.1.0/sg-video-player.js';
import '/components/sg-pipeline-steps/v0/v0.1/v0.1.0/sg-pipeline-steps.js';
import '/components/openrouter/sg-openrouter-key-stats/v0/v0.1/v0.1.0/sg-openrouter-key-stats.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

/**
 * @param {object} state    publisher state
 * @param {object} api      SgToolApi instance
 * @param {Function} emit
 */
export async function init(state, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(toolArea);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    const mobile = matchMedia('(max-width: 900px)').matches;

    const inputTabs = [
        { type: 'tab', id: 't-record', title: '⏺ Record',  tag: 'div', locked: true, closable: false },
        { type: 'tab', id: 't-import', title: '📥 Import', tag: 'div', locked: true, closable: false },
    ];
    const workTabs = [
        { type: 'tab', id: 't-transcript', title: '📝 Transcript', tag: 'div', locked: true, closable: false },
        { type: 'tab', id: 't-metadata',   title: '🏷 Metadata',   tag: 'div', locked: true, closable: false },
        { type: 'tab', id: 't-publish',    title: '🚀 Publish',    tag: 'div', locked: true, closable: false },
    ];
    const stepsTab    = { type: 'tab', id: 't-steps',    title: '📋 Steps',    tag: 'div', locked: true, closable: false };
    const accountsTab = { type: 'tab', id: 't-accounts', title: '🔑 Accounts', tag: 'div', locked: true, closable: false };

    layout.setLayout(mobile
        ? { type: 'stack', id: 'root', activeTab: 0, tabs: [...inputTabs, stepsTab, ...workTabs, accountsTab] }
        : {
            type: 'row', id: 'root', sizes: [0.38, 0.62],
            children: [
                {
                    type: 'column', id: 'c-left', sizes: [0.48, 0.32, 0.20],
                    children: [
                        { type: 'stack', id: 's-input',    activeTab: 0, tabs: inputTabs },
                        { type: 'stack', id: 's-steps',    activeTab: 0, tabs: [stepsTab] },
                        { type: 'stack', id: 's-accounts', activeTab: 0, tabs: [accountsTab] },
                    ],
                },
                { type: 'stack', id: 's-work', activeTab: 0, tabs: workTabs },
            ],
        });
    await layoutReady;

    const panel = id => {
        const el = layout.getPanelElement(id);
        if (el) el.style.cssText = 'height:100%;overflow-y:auto;padding:12px;box-sizing:border-box;';
        return el;
    };

    initRecordTab(panel('t-record'), state, api, emit);
    initSourceTab(panel('t-import'), state, api, emit);
    initStepsPanel(panel('t-steps'), state, api, emit, layout);
    initAccounts(panel('t-accounts'), state, api, emit);
    initTranscriptTab(panel('t-transcript'), state, api, emit);
    initMetadataTab(panel('t-metadata'), state, api, emit);
    initPublishTab(panel('t-publish'), state, api, emit);
    initApiPane(wrap, api);

    // ── Handoff receiver (secondary entry — video-recorder "Publish") ────────
    const handoff = pickupHandoff();
    if (handoff?.blob) {
        // Defer a tick so all panels have their DOM mounted before events fire.
        Promise.resolve().then(() => {
            acceptHandoff(handoff);
            layout.focusPanel('t-import');
        });
    }
}
