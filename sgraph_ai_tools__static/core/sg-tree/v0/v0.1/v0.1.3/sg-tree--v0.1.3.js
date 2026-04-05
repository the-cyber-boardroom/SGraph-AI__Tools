/**
 * sg-tree--v0.1.3.js
 * Surgical override: Multi-Select
 *
 * Adds full multi-selection when `selectable="multi"`:
 * - Plain click → single select (anchor reset)
 * - Shift+click → contiguous range select from anchor to target
 * - Ctrl/Cmd+click → toggle individual node
 * - Space → toggle focused node
 * - selectAll() / deselectAll() public methods
 * - getSelectedIds() returns all selected ids
 * - getSelectedId() returns first selected (backwards compatible with v0.1.0)
 *
 * `selectable="single"` behaviour is unchanged.
 *
 * Load order: import this module; it imports v0.1.2 → v0.1.1 → v0.1.0.
 *
 * @module sg-tree--v0.1.3
 * @requires ../v0.1.2/sg-tree--v0.1.2.js
 */

import '../v0.1.2/sg-tree--v0.1.2.js';
import { SgTree } from '../v0.1.0/sg-tree.js';
import { SGT_EVENTS } from '../v0.1.0/sg-tree-events.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Find a node by id, returning { node, parent, path } or null.
 * @param {object} root
 * @param {string} id
 * @param {object|null} parent
 * @param {string[]} path
 * @returns {{ node: object, parent: object|null, path: string[] }|null}
 */
function _find13(root, id, parent = null, path = []) {
    if (!root) return null;
    const p = [...path, root.id];
    if (root.id === id) return { node: root, parent, path: p };
    if (root.children) {
        for (const c of root.children) {
            const r = _find13(c, id, root, p);
            if (r) return r;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Initialise _selectedIds on setData
// ---------------------------------------------------------------------------

const _origSetData13 = SgTree.prototype.setData;

/**
 * Extends setData: initialises the _selectedIds Set and clears the anchor.
 * @param {object} root
 */
SgTree.prototype.setData = function(root) {
    this._selectedIds = new Set();
    this._anchorId    = null;
    _origSetData13.call(this, root);
};

// ---------------------------------------------------------------------------
// Ensure _selectedIds exists on instances created before setData is called
// ---------------------------------------------------------------------------

const _origConnected13 = SgTree.prototype.connectedCallback;

SgTree.prototype.connectedCallback = function() {
    if (!this._selectedIds) {
        this._selectedIds = new Set();
        this._anchorId    = null;
    }
    _origConnected13.call(this);
};

// ---------------------------------------------------------------------------
// Override: _renderRow — fix aria-selected for multi-select
// ---------------------------------------------------------------------------

const _origRenderRow13 = SgTree.prototype._renderRow;

/**
 * After calling the prior _renderRow, updates aria-selected to reflect
 * _selectedIds (which may have multiple entries in multi-select mode).
 * @param {object} node
 * @param {number} depth
 * @param {string[]} path
 * @returns {HTMLElement}
 */
SgTree.prototype._renderRow = function(node, depth, path) {
    const row = _origRenderRow13.call(this, node, depth, path);

    if (this._selectedIds && this._selectable === 'multi') {
        const isSelected = this._selectedIds.has(node.id);
        row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }

    return row;
};

// ---------------------------------------------------------------------------
// Override: _onRowClick — Shift/Ctrl multi-select handling
// ---------------------------------------------------------------------------

/**
 * Replaces v0.1.0's _onRowClick.
 * In single mode: identical behaviour.
 * In multi mode: Shift+click = range, Ctrl/Cmd+click = toggle, plain = single.
 * @param {MouseEvent} e
 */
SgTree.prototype._onRowClick = function(e) {
    const row = e.target.closest('.sgt-row');
    if (!row) return;
    const id = row.dataset.id;
    if (!id || !this._data) return;

    const found = _find13(this._data, id);
    if (!found || found.node.disabled) return;

    this._focusedId = id;

    // Expand / collapse toggle (same logic as v0.1.0)
    if (this._isExpandable(found.node)) {
        if (this._expanded.has(id)) {
            this.collapse(id);
        } else {
            this.expand(id);
        }
    }

    if (this._selectable === 'none') {
        this._rootEl.focus({ preventScroll: true });
        return;
    }

    if (this._selectable === 'multi' && this._selectedIds) {
        if (e.shiftKey && this._anchorId) {
            this._rangeSelect(this._anchorId, id);
        } else if (e.ctrlKey || e.metaKey) {
            // Toggle
            if (this._selectedIds.has(id)) {
                this._selectedIds.delete(id);
                if (this._selectedId === id) {
                    this._selectedId = this._selectedIds.size
                        ? this._selectedIds.values().next().value
                        : null;
                }
            } else {
                this._selectedIds.add(id);
                this._selectedId = id;
                this._anchorId   = id;
            }
            this._render();
            this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: Array.from(this._selectedIds) });
        } else {
            // Plain click — single select, reset anchor
            this._selectedIds = new Set([id]);
            this._selectedId  = id;
            this._anchorId    = id;
            this._render();
            this._dispatch(SGT_EVENTS.NODE_SELECTED, { id, node: found.node, path: found.path });
            this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: [id] });
        }
    } else {
        // Single-select mode (unchanged from v0.1.0 behaviour)
        const prev = this._selectedId;
        this._selectedId = id;
        if (this._selectedIds) this._selectedIds = new Set([id]);
        this._anchorId   = id;
        this._render();
        if (prev && prev !== id) {
            this._dispatch(SGT_EVENTS.NODE_DESELECTED, { id: prev });
        }
        this._dispatch(SGT_EVENTS.NODE_SELECTED, { id, node: found.node, path: found.path });
        this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: [id] });
    }

    this._rootEl.focus({ preventScroll: true });
};

// ---------------------------------------------------------------------------
// Override: _onKeydown — Space = toggle focused node in multi mode
// ---------------------------------------------------------------------------

const _origKeydown13 = SgTree.prototype._onKeydown;

/**
 * Extends keydown handler. In multi-select mode, Space toggles the focused node.
 * @param {KeyboardEvent} e
 */
SgTree.prototype._onKeydown = function(e) {
    if (e.key === ' ' && this._selectable === 'multi' && this._focusedId && this._selectedIds) {
        e.preventDefault();
        const id = this._focusedId;
        if (this._selectedIds.has(id)) {
            this._selectedIds.delete(id);
            if (this._selectedId === id) {
                this._selectedId = this._selectedIds.size
                    ? this._selectedIds.values().next().value
                    : null;
            }
        } else {
            this._selectedIds.add(id);
            this._selectedId = id;
        }
        this._render();
        this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: Array.from(this._selectedIds) });
        return;
    }
    _origKeydown13.call(this, e);
};

// ---------------------------------------------------------------------------
// Private: _rangeSelect — select contiguous range between anchor and target
// ---------------------------------------------------------------------------

/**
 * Select all visible (non-disabled) nodes from anchorId to targetId inclusive.
 * @param {string} anchorId
 * @param {string} targetId
 */
SgTree.prototype._rangeSelect = function(anchorId, targetId) {
    const aIdx = this._visible.findIndex(v => v.node.id === anchorId);
    const tIdx = this._visible.findIndex(v => v.node.id === targetId);
    if (aIdx === -1 || tIdx === -1) return;

    const start = Math.min(aIdx, tIdx);
    const end   = Math.max(aIdx, tIdx);

    this._selectedIds = new Set();
    for (let i = start; i <= end; i++) {
        const { node } = this._visible[i];
        if (!node.disabled) this._selectedIds.add(node.id);
    }
    this._selectedId = targetId;
    this._render();
    this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: Array.from(this._selectedIds) });
};

// ---------------------------------------------------------------------------
// Public API additions
// ---------------------------------------------------------------------------

/**
 * Get all currently selected node ids.
 * Returns a single-element array in single-select mode (backwards compat).
 * @returns {string[]}
 */
SgTree.prototype.getSelectedIds = function() {
    if (this._selectedIds) return Array.from(this._selectedIds);
    return this._selectedId ? [this._selectedId] : [];
};

/**
 * Get the primary (first) selected node id. Backwards compatible with v0.1.0.
 * @returns {string|null}
 */
SgTree.prototype.getSelectedId = function() {
    if (this._selectedIds && this._selectedIds.size) {
        return this._selectedIds.values().next().value;
    }
    return this._selectedId;
};

/**
 * Select all non-disabled visible nodes. Only meaningful in multi-select mode.
 */
SgTree.prototype.selectAll = function() {
    if (!this._data) return;
    if (!this._selectedIds) this._selectedIds = new Set();
    for (const { node } of this._visible) {
        if (!node.disabled) this._selectedIds.add(node.id);
    }
    this._selectedId = this._selectedIds.size
        ? this._selectedIds.values().next().value
        : null;
    this._render();
    this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: Array.from(this._selectedIds) });
};

/**
 * Clear all selections.
 */
SgTree.prototype.deselectAll = function() {
    if (this._selectedIds) this._selectedIds.clear();
    this._selectedId = null;
    this._render();
    this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: [] });
};

// ---------------------------------------------------------------------------
// Override: getLayoutState / setLayoutState — persist multi-selection
// ---------------------------------------------------------------------------

const _origGetLayout13 = SgTree.prototype.getLayoutState;

/**
 * Extends getLayoutState to include all selectedIds for multi-select mode.
 * @returns {{ expandedIds: string[], selectedId: string|null, selectedIds: string[], scrollTop: number }}
 */
SgTree.prototype.getLayoutState = function() {
    const state = _origGetLayout13.call(this);
    state.selectedIds = this.getSelectedIds();
    return state;
};

const _origSetLayout13 = SgTree.prototype.setLayoutState;

/**
 * Extends setLayoutState to restore multi-selection.
 * @param {object} state
 */
SgTree.prototype.setLayoutState = function(state) {
    _origSetLayout13.call(this, state);
    if (state && Array.isArray(state.selectedIds) && this._selectedIds) {
        this._selectedIds = new Set(state.selectedIds);
        this._selectedId  = state.selectedIds[0] || null;
        this._render();
    }
};
