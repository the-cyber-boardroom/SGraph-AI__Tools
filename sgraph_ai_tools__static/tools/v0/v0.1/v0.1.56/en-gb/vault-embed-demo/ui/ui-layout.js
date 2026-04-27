/**
 * ui-layout — initialise the sg-layout right panel and wire file-open events.
 *
 * sg-layout does NOT listen for CMD_ADD_PANEL as a DOM event; the public
 * imperative API is layout.addTabToStack(stackId, config).
 *
 * @module ui-layout
 */

const RIGHT_LAYOUT = {
    type: 'stack',
    tabs: [{ tag: 'sg-vault-trace', title: 'Trace', locked: true }],
}

let _layout   = null
let _stackId  = null

/**
 * Initialise the sg-layout element and attach the file-open listener.
 * Must be called after the DOM is ready.
 */
export function initLayout() {
    _layout = document.getElementById('ved-layout')
    if (!_layout) return

    customElements.whenDefined('sg-layout').then(() => {
        if (typeof _layout.setLayout === 'function') {
            _layout.setLayout(RIGHT_LAYOUT)
            // Capture the root stack ID so we can add tabs into it
            const tree = _layout.getLayout ? _layout.getLayout() : null
            _stackId = tree?.id ?? null
        }
    })

    document.addEventListener('ved:file-open', ({ detail: { entry, vault } }) => {
        if (!_layout) return
        const cfg = { tag: 'ved-file-viewer', title: entry.name || 'File', state: { entry, vault } }
        if (_stackId && typeof _layout.addTabToStack === 'function') {
            _layout.addTabToStack(_stackId, cfg)
        } else if (typeof _layout.addPanel === 'function') {
            // fallback: addPanel creates a split but at least opens something
            _layout.addPanel(cfg)
        }
    })
}
