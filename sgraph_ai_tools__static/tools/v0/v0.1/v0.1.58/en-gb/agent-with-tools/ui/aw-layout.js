/**
 * aw-layout — Initialise the sg-layout panel tree for agent-with-tools.
 *
 * Layout:
 *   row [62% / 38%]
 *   ├─ column [25% / 75%]
 *   │  ├─ stack: aw-system-prompt (System Prompt tab)
 *   │  └─ stack: aw-chat-pane    (Chat tab, locked)
 *   └─ column [20% / 13% / 8% / 20% / 18% / 10% / 07% / 04%]
 *      ├─ stack: aw-demo-panel        (Demo tab)
 *      ├─ stack: sg-llm-connection    (Connection tab)
 *      ├─ stack: aw-pipeline-view     (Pipeline tab)
 *      ├─ stack: aw-execution-inspector (Queue tab)
 *      ├─ stack: aw-step-tracer       (Tracer tab)
 *      ├─ stack: sg-tool-definition   (Tools tab)
 *      ├─ stack: aw-bridge-panel      (Bridge tab)
 *      └─ stack: aw-model-panel       (Model tab)
 *
 * All custom elements remain within the [data-llm-bus] element so
 * bus event bubbling continues to work.
 *
 * @module aw-layout
 * @version 0.1.58
 */

import { SGL_EVENTS } from 'https://tools.sgraph.ai/core/sg-layout/v0.1.0/sg-layout-events.js';

const LAYOUT = {
    type: 'row',
    sizes: [0.62, 0.38],
    children: [
        {
            type: 'column',
            sizes: [0.25, 0.75],
            children: [
                { type: 'stack', tabs: [{ tag: 'aw-system-prompt', title: 'System Prompt' }] },
                { type: 'stack', tabs: [{ tag: 'aw-chat-pane',     title: 'Chat', locked: true }] },
            ],
        },
        {
            type: 'column',
            sizes: [0.20, 0.13, 0.08, 0.20, 0.18, 0.10, 0.07, 0.04],
            children: [
                { type: 'stack', tabs: [{ tag: 'aw-demo-panel',           title: 'Demo' }] },
                { type: 'stack', tabs: [{ tag: 'sg-llm-connection',       title: 'Connection' }] },
                { type: 'stack', tabs: [{ tag: 'aw-pipeline-view',        title: 'Pipeline' }] },
                { type: 'stack', tabs: [{ tag: 'aw-execution-inspector',  title: 'Queue' }] },
                { type: 'stack', tabs: [{ tag: 'aw-step-tracer',          title: 'Tracer' }] },
                { type: 'stack', tabs: [{ tag: 'sg-tool-definition',      title: 'Tools' }] },
                { type: 'stack', tabs: [{ tag: 'aw-bridge-panel',         title: 'Bridge' }] },
                { type: 'stack', tabs: [{ tag: 'aw-model-panel',          title: 'Model' }] },
            ],
        },
    ],
};

/**
 * Initialise the sg-layout element inside [data-llm-bus].
 * Must be called after the DOM is ready and sg-layout is imported.
 */
export function initLayout() {
    const layout = document.getElementById('aw-layout');
    if (!layout) return;

    customElements.whenDefined('sg-layout').then(() => {
        if (typeof layout.setLayout === 'function') {
            layout.setLayout(LAYOUT);
        }
        layout.events?.on(SGL_EVENTS.LAYOUT_READY, () => {
            // Layout is ready — wire loop strip now that aw-chat-pane is mounted
        });
    });
}
