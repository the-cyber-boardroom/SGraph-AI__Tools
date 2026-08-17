/**
 * ui-shell.js
 * Layout. Narrow: one stack, Source first. Wide: a left column (Source,
 * Findings) beside a stack of the analysis views, with Timeline active — the
 * timeline IS the tool, so it is what you land on.
 * @module ui-shell
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { initSource }     from './ui-source.js';
import { initTimeline }   from './ui-timeline.js';
import { initHistograms } from './ui-histograms.js';
import { initStrip }      from './ui-strip.js';
import { initAlign }      from './ui-align.js';
import { initCompare }    from './ui-compare.js';
import { initFindings }   from './ui-findings.js';
import { initApiPane }    from './ui-api-pane.js';

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

export async function init(state, config, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const titleBar = document.createElement('div');
    titleBar.className = 'mp-titlebar';
    titleBar.innerHTML = `
        <span class="mp-titlebar__icon" aria-hidden="true">📊</span>
        <h1 class="mp-titlebar__name">Media Probe</h1>
        <span class="mp-titlebar__tag">see a recording's structure before you pay a model to guess at it</span>
        <span class="mp-titlebar__ver" id="mp-title-ver"></span>`;
    wrap.appendChild(titleBar);
    fetch('./manifest.json').then(r => r.json()).then(m => {
        const v = titleBar.querySelector('#mp-title-ver');
        if (v) v.textContent = `v${m.version || ''} ${m.status || ''}`.trim();
    }).catch(() => {});

    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(toolArea);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    const narrow = matchMedia('(max-width: 900px)').matches;

    const sourceTab   = { type: 'tab', id: 't-source',   title: '🎬 Source',     tag: 'div', locked: true, closable: false };
    const findingsTab = { type: 'tab', id: 't-findings', title: '📝 Findings',   tag: 'div', locked: true, closable: false };
    // Unlocked so drag-to-dock works: comparing the timeline against the
    // histograms side by side is the normal way to use this.
    const viewTabs = [
        { type: 'tab', id: 't-timeline',   title: '📈 Timeline',   tag: 'div', locked: false, closable: false },
        { type: 'tab', id: 't-histograms', title: '📊 Histograms', tag: 'div', locked: false, closable: false },
        { type: 'tab', id: 't-strip',      title: '🎞 Scenes',     tag: 'div', locked: false, closable: false },
        { type: 'tab', id: 't-align',      title: '↔ Alignment',   tag: 'div', locked: false, closable: false },
        { type: 'tab', id: 't-compare',    title: '⚖ Compare',     tag: 'div', locked: false, closable: false },
    ];

    layout.setLayout(narrow
        ? { type: 'stack', id: 'root', activeTab: 0, tabs: [sourceTab, ...viewTabs, findingsTab] }
        : {
            type: 'row', id: 'root', sizes: [0.28, 0.72],
            children: [
                {
                    type: 'column', id: 'c-left', sizes: [0.45, 0.55],
                    children: [
                        { type: 'stack', id: 's-source',   activeTab: 0, tabs: [sourceTab] },
                        { type: 'stack', id: 's-findings', activeTab: 0, tabs: [findingsTab] },
                    ],
                },
                { type: 'stack', id: 's-views', activeTab: 0, tabs: viewTabs },
            ],
        });
    await layoutReady;

    const panel = id => {
        const el = layout.getPanelElement(id);
        if (el) el.style.cssText = 'height:100%;overflow:auto;padding:12px;box-sizing:border-box;';
        return el;
    };

    initSource(panel('t-source'), state, config, api, emit);
    initTimeline(panel('t-timeline'), state, config, api);
    initHistograms(panel('t-histograms'), state, config, api);
    initStrip(panel('t-strip'), state, api);
    initAlign(panel('t-align'), state, api);
    initCompare(panel('t-compare'), state, api);
    initFindings(panel('t-findings'), state, api);
    initApiPane(wrap, () => {});
}
