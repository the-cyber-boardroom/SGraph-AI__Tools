/**
 * ui-layout — initialise the sg-layout right panel and wire file-open events.
 *
 * @module ui-layout
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js'

/** Initial layout: one locked Trace tab. */
const RIGHT_LAYOUT = {
    type: 'stack',
    tabs: [{ tag: 'sg-vault-trace', title: 'Trace', locked: true }],
}

/**
 * Initialise the sg-layout element and attach the file-open listener.
 * Must be called after the DOM is ready.
 */
export function initLayout() {
    const layout = document.getElementById('ved-layout')
    if (!layout) return

    customElements.whenDefined('sg-layout').then(() => {
        if (typeof layout.setLayout === 'function') {
            layout.setLayout(RIGHT_LAYOUT)
        }
    })

    document.addEventListener('ved:file-open', ({ detail: { entry, vault } }) => {
        layout.dispatchEvent(new CustomEvent(SGL_EVENTS.CMD_ADD_PANEL, {
            detail: { tag: 'ved-file-viewer', title: entry.name, state: { entry, vault } },
        }))
    })
}
