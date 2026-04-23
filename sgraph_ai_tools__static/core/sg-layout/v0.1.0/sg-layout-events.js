/**
 * sg-layout-events.js
 * Event name constants for the sg-layout framework.
 * Import this file. Never hardcode event name strings.
 * v0.1.0 — these names are frozen. Adding is ok. Changing is a breaking change.
 */

export const SGL_EVENTS = Object.freeze({

    // --- Registration (synchronous, composed: true) ---
    REGISTER:           'sg-layout:register',        // hosted → nearest sg-layout

    // --- Internal bus events (within one sg-layout instance) ---
    PANEL_RESIZED:      'panel:resized',             // { id, width, height }
    PANEL_FOCUSED:      'panel:focused',             // { id }
    PANEL_HIDDEN:       'panel:hidden',              // { id }
    PANEL_SHOWN:        'panel:shown',               // { id }
    PANEL_CLOSED:       'panel:closed',              // { id }
    TAB_CHANGED:        'tab:changed',               // { stackId, tabId }
    LAYOUT_READY:       'layout:ready',              // {} — all panels registered
    LAYOUT_CHANGED:     'layout:changed',            // { tree } — after any structural change

    // --- Upward bubble (composed: true, for cross-boundary drag) ---
    DRAG_START:         'sg-layout:drag-start',      // { panelId, sourceLayoutId }
    DRAG_END:           'sg-layout:drag-end',        // { panelId, accepted: bool }

    // --- Panel API events (dispatched on the sg-layout element itself) ---
    CMD_ADD_PANEL:      'sg-layout:add-panel',       // { tag, title, icon, state, target }
    CMD_REMOVE_PANEL:   'sg-layout:remove-panel',    // { id }
    CMD_FOCUS_PANEL:    'sg-layout:focus-panel',     // { id }
    CMD_SET_LAYOUT:     'sg-layout:set-layout',      // { tree }

    // --- Lifecycle signals (hosted component → parent layout, composed) ---
    SET_TITLE:          'sg-layout:set-title',       // { panelId, title }
    REQUEST_FOCUS:      'sg-layout:request-focus',   // { panelId }
    REQUEST_CLOSE:      'sg-layout:request-close',   // { panelId }
});
