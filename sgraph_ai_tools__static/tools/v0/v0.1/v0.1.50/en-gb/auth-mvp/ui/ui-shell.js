/**
 * Auth MVP — sg-layout bootstrap and panel wiring.
 * @module ui-shell
 * @version 0.1.50
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { buildDevPanel } from '../dev-panel.js';
import { buildChecksPanel } from './ui-checks-panel.js';
import { buildOutputPanels } from './ui-output-panel.js';

export async function init() {
    const layoutWrap = document.getElementById('layout-wrap');
    layoutWrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // Tool area (flex:1 above the dev panel)
    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    layoutWrap.appendChild(toolArea);

    // Dev panel appended to layoutWrap (below toolArea)
    buildDevPanel(layoutWrap);

    // sg-layout — pattern from infographic-gen v0.1.37:
    //   1. append to DOM (connectedCallback fires, emits LAYOUT_READY with no tree — ignored)
    //   2. register listener immediately (synchronously)
    //   3. call setLayout() synchronously — fires LAYOUT_READY again, listener resolves
    //   4. await the promise
    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'display:block;width:100%;height:100%;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
    layout.setLayout({
        type: 'row', id: 'main', sizes: [0.38, 0.62],
        children: [
            {
                type: 'stack', id: 's-left', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-checks', title: '📋 Checks', tag: 'div', locked: true, closable: false },
                ],
            },
            {
                type: 'stack', id: 's-right', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-output', title: '📊 Output', tag: 'div', locked: true, closable: false },
                    { type: 'tab', id: 't-events', title: '📡 Events', tag: 'div', locked: true, closable: false },
                    { type: 'tab', id: 't-vaults', title: '🗄 Vaults',  tag: 'div', locked: true, closable: false },
                ],
            },
        ],
    });
    await layoutReady;

    const checksPanel = layout.getPanelElement('t-checks');
    const outputPanel = layout.getPanelElement('t-output');
    const eventsPanel = layout.getPanelElement('t-events');
    const vaultsPanel = layout.getPanelElement('t-vaults');

    buildChecksPanel(checksPanel);
    buildOutputPanels(outputPanel, eventsPanel, vaultsPanel);
}
