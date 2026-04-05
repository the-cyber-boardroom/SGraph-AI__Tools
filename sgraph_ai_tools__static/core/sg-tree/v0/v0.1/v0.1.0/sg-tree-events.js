/**
 * sg-tree-events.js
 * Event name constants for the sg-tree component.
 * Import this file. Never hardcode event name strings.
 * v0.1.0 — these names are frozen. Adding is ok. Changing is a breaking change.
 */
export const SGT_EVENTS = Object.freeze({
    NODE_SELECTED:     'sg-tree:node-selected',    // { id, node, path }
    NODE_DESELECTED:   'sg-tree:node-deselected',  // { id }
    SELECTION_CHANGED: 'sg-tree:selection-changed', // { selectedIds } — ids only, call getData() for node objects
    NODE_EXPANDED:     'sg-tree:node-expanded',    // { id, node }
    NODE_COLLAPSED:    'sg-tree:node-collapsed',   // { id, node }
    NODE_ACTIVATED:    'sg-tree:node-activated',   // { id, node, path } — double-click or Enter on leaf
    NODE_CONTEXT:      'sg-tree:node-context',     // { id, node, x, y }
    DATA_CHANGED:      'sg-tree:data-changed',     // { root }
    READY:             'sg-tree:ready',            // {}
});
