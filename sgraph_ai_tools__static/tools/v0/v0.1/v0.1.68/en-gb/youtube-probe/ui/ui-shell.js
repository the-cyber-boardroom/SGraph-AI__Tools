/**
 * ui-shell.js
 * Layout: Setup on the left (token, video ids, corpus size), the test list and
 * the findings report on the right.
 * @module ui-shell
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { initSetup }   from './ui-setup.js';
import { initSuite }   from './ui-suite.js';
import { initReport }  from './ui-report.js';
import { initApiPane } from './ui-api-pane.js';

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

export async function init(state, ctx, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const bar = document.createElement('div');
    bar.className = 'yp-titlebar';
    bar.innerHTML = `
        <span class="yp-titlebar__icon" aria-hidden="true">🔬</span>
        <h1 class="yp-titlebar__name">YouTube Probe</h1>
        <span class="yp-titlebar__tag">answer the open questions before building the tool</span>
        <span class="yp-titlebar__ver" id="yp-title-ver"></span>`;
    wrap.appendChild(bar);
    fetch('./manifest.json').then(r => r.json()).then(m => {
        const v = bar.querySelector('#yp-title-ver');
        if (v) v.textContent = `v${m.version || ''} ${m.status || ''}`.trim();
    }).catch(() => {});

    const area = document.createElement('div');
    area.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(area);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    area.appendChild(layout);

    const ready = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    const narrow = matchMedia('(max-width: 900px)').matches;

    const setupTab  = { type: 'tab', id: 't-setup',  title: '⚙ Setup',    tag: 'div', locked: true,  closable: false };
    const suiteTab  = { type: 'tab', id: 't-suite',  title: '🧪 Tests',    tag: 'div', locked: false, closable: false };
    const reportTab = { type: 'tab', id: 't-report', title: '📝 Findings', tag: 'div', locked: false, closable: false };

    layout.setLayout(narrow
        ? { type: 'stack', id: 'root', activeTab: 0, tabs: [setupTab, suiteTab, reportTab] }
        : {
            type: 'row', id: 'root', sizes: [0.32, 0.68],
            children: [
                { type: 'stack', id: 's-setup', activeTab: 0, tabs: [setupTab] },
                { type: 'stack', id: 's-main',  activeTab: 0, tabs: [suiteTab, reportTab] },
            ],
        });
    await ready;

    const panel = id => {
        const el = layout.getPanelElement(id);
        if (el) el.style.cssText = 'height:100%;overflow:auto;padding:12px;box-sizing:border-box;';
        return el;
    };

    initSetup(panel('t-setup'), state, ctx, api);
    initSuite(panel('t-suite'), state, ctx, api);
    initReport(panel('t-report'), state, api);
    initApiPane(wrap, () => {});
}
