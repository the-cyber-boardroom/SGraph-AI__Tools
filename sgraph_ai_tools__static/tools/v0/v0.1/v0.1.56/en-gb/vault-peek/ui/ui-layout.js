/**
 * ui-layout — initialise both sg-layout elements and wire file-open events.
 *
 * Left layout  : column split — credentials panel (top) + vault tree (bottom).
 * Right layout : stack — Trace tab + dynamically added file-viewer tabs.
 *
 * sg-layout does NOT listen for CMD_ADD_PANEL as a DOM event; the public
 * imperative API is layout.addTabToStack(stackId, config).
 *
 * @module ui-layout
 */

const LEFT_LAYOUT = {
    type: 'column',
    sizes: [0.38, 0.62],
    children: [
        { type: 'stack', tabs: [{ tag: 'ved-cred-panel', title: 'Credentials', locked: true }] },
        { type: 'stack', tabs: [{ tag: 'ved-vault-tree', title: 'Vault Files',  locked: true }] },
    ],
}

const RIGHT_LAYOUT = {
    type: 'stack',
    tabs: [{ tag: 'sg-vault-trace', title: 'Trace', locked: true }],
}

let _rightLayout = null
let _stackId     = null

/**
 * Initialise both sg-layout elements and attach the file-open listener.
 * Must be called after the DOM is ready.
 */
export function initLayout() {
    const leftLayout  = document.getElementById('ved-left-layout')
    _rightLayout      = document.getElementById('ved-layout')

    customElements.whenDefined('sg-layout').then(() => {
        if (leftLayout && typeof leftLayout.setLayout === 'function') {
            leftLayout.setLayout(LEFT_LAYOUT)
        }
        if (_rightLayout && typeof _rightLayout.setLayout === 'function') {
            _rightLayout.setLayout(RIGHT_LAYOUT)
            const tree = _rightLayout.getLayout ? _rightLayout.getLayout() : null
            _stackId = tree?.id ?? null
        }
    })

    document.addEventListener('ved:file-open', ({ detail: { entry, vault } }) => {
        if (!_rightLayout) return
        const cfg = { tag: 'ved-file-viewer', title: entry.name || 'File', state: { entry, vault } }
        if (_stackId && typeof _rightLayout.addTabToStack === 'function') {
            _rightLayout.addTabToStack(_stackId, cfg)
        } else if (typeof _rightLayout.addPanel === 'function') {
            _rightLayout.addPanel(cfg)
        }
    })
}
