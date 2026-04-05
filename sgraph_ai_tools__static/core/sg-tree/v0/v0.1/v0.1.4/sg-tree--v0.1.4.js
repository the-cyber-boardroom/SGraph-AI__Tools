/**
 * sg-tree--v0.1.4.js
 * Surgical override: Drag-and-Drop (within tree)
 *
 * Adds intra-tree drag-and-drop reordering and reparenting.
 * Nodes can be dragged to reorder within a parent or reparented into a folder.
 * A drop indicator line shows the insertion point.
 *
 * Drop positions:
 * - Top 25% of row → insert BEFORE the row's node (as sibling)
 * - Middle 50%     → insert INTO the folder (as last child); disabled for files
 * - Bottom 25%     → insert AFTER the row's node (as sibling)
 *
 * Constraints:
 * - Root node cannot be dragged
 * - A node cannot be dropped into one of its own descendants
 * - Touch drag is NOT supported in v0.1.4 (mouse/pointer only)
 *
 * Load order: import this module; it imports v0.1.3 → v0.1.2 → v0.1.1 → v0.1.0.
 *
 * @module sg-tree--v0.1.4
 * @requires ../v0.1.3/sg-tree--v0.1.3.js
 */

import '../v0.1.3/sg-tree--v0.1.3.js';
import { SgTree } from '../v0.1.0/sg-tree.js';
import { SGT_EVENTS } from '../v0.1.0/sg-tree-events.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Find a node with its parent and index within parent.children.
 * @param {object} root
 * @param {string} id
 * @param {object|null} parent
 * @param {number} indexInParent
 * @returns {{ node: object, parent: object|null, index: number }|null}
 */
function _findWithParent(root, id, parent = null, indexInParent = -1) {
    if (!root) return null;
    if (root.id === id) return { node: root, parent, index: indexInParent };
    if (root.children) {
        for (let i = 0; i < root.children.length; i++) {
            const r = _findWithParent(root.children[i], id, root, i);
            if (r) return r;
        }
    }
    return null;
}

/**
 * Check if potentialAncestorId is an ancestor of (or equal to) nodeId.
 * Used to prevent dropping a node into its own subtree.
 * @param {object} root
 * @param {string} nodeId          — the node being dragged
 * @param {string} potentialDescId — potential drop target
 * @returns {boolean}
 */
function _isAncestorOrSelf(root, nodeId, potentialDescId) {
    if (nodeId === potentialDescId) return true;
    const found = _findWithParent(root, nodeId);
    if (!found) return false;

    // Walk descendants of nodeId and check if potentialDescId is among them
    function containsId(node, id) {
        if (node.id === id) return true;
        if (node.children) {
            for (const c of node.children) {
                if (containsId(c, id)) return true;
            }
        }
        return false;
    }
    return containsId(found.node, potentialDescId);
}

// ---------------------------------------------------------------------------
// Drag state (instance-level, set as this._dnd*)
// ---------------------------------------------------------------------------
// this._dndNodeId   — id of the node being dragged
// this._dndTarget   — { id, position: 'before'|'into'|'after' }
// this._dndIndicator — DOM element for the drop line

// ---------------------------------------------------------------------------
// Override: connectedCallback — create the drop indicator element
// ---------------------------------------------------------------------------

const _origConnected14 = SgTree.prototype.connectedCallback;

SgTree.prototype.connectedCallback = function() {
    _origConnected14.call(this);
    if (!this._dndIndicator) {
        const ind = document.createElement('div');
        ind.style.cssText = [
            'position:fixed', 'left:0', 'right:0', 'height:2px',
            'background:#4ECDC4', 'pointer-events:none',
            'z-index:9999', 'display:none',
            'border-radius:1px',
            'box-shadow:0 0 4px rgba(78,205,196,0.6)',
        ].join(';');
        // Append to shadow root so it clips correctly when host clips
        this.shadowRoot.appendChild(ind);
        this._dndIndicator = ind;
    }
};

// ---------------------------------------------------------------------------
// Override: _renderRow — add draggable attribute and drag event listeners
// ---------------------------------------------------------------------------

const _origRenderRow14 = SgTree.prototype._renderRow;

/**
 * Extends _renderRow to attach draggable and drag event listeners.
 * Root node gets draggable="false".
 * MUST return the element (v0.1.5 compat).
 * @param {object} node
 * @param {number} depth
 * @param {string[]} path
 * @returns {HTMLElement}
 */
SgTree.prototype._renderRow = function(node, depth, path) {
    const row = _origRenderRow14.call(this, node, depth, path);

    const isRoot = this._data && node.id === this._data.id;
    row.setAttribute('draggable', isRoot ? 'false' : 'true');

    if (!isRoot) {
        row.addEventListener('dragstart',  e => this._onDragStart(e, node));
        row.addEventListener('dragend',    e => this._onDragEnd(e));
    }
    row.addEventListener('dragover',   e => this._onDragOver(e, node, row));
    row.addEventListener('dragleave',  e => this._onDragLeave(e, row));
    row.addEventListener('drop',       e => this._onDrop(e, node));

    return row;
};

// ---------------------------------------------------------------------------
// _onDragStart
// ---------------------------------------------------------------------------

/**
 * Record the dragged node id and set drag data.
 * @param {DragEvent} e
 * @param {object} node
 */
SgTree.prototype._onDragStart = function(e, node) {
    this._dndNodeId = node.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
    // Dim the dragged row
    const row = e.currentTarget;
    requestAnimationFrame(() => { if (row) row.style.opacity = '0.4'; });
};

// ---------------------------------------------------------------------------
// _onDragOver
// ---------------------------------------------------------------------------

/**
 * Calculate drop position (before/into/after) and show the drop indicator.
 * @param {DragEvent} e
 * @param {object} node
 * @param {HTMLElement} row
 */
SgTree.prototype._onDragOver = function(e, node, row) {
    if (!this._dndNodeId) return;
    if (this._dndNodeId === node.id) return; // self

    // Prevent drop into own subtree
    if (_isAncestorOrSelf(this._data, this._dndNodeId, node.id)) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect    = row.getBoundingClientRect();
    const relY    = e.clientY - rect.top;
    const pct     = relY / rect.height;

    let position;
    const isFolder = this._isExpandable(node);

    if (pct < 0.25) {
        position = 'before';
    } else if (pct > 0.75) {
        position = 'after';
    } else {
        position = isFolder ? 'into' : (pct < 0.5 ? 'before' : 'after');
    }

    this._dndTarget = { id: node.id, position };
    this._showDropIndicator(row, position, rect);
};

// ---------------------------------------------------------------------------
// _onDragLeave
// ---------------------------------------------------------------------------

/**
 * Hide indicator when leaving a row (unless the new target is a child element).
 * @param {DragEvent} e
 * @param {HTMLElement} row
 */
SgTree.prototype._onDragLeave = function(e, row) {
    // relatedTarget is where the pointer went; if still inside the row, ignore
    if (row.contains(e.relatedTarget)) return;
    this._hideDropIndicator();
    this._dndTarget = null;
};

// ---------------------------------------------------------------------------
// _onDrop
// ---------------------------------------------------------------------------

/**
 * Mutate _data to move the dragged node to the drop position.
 * Dispatches DATA_CHANGED.
 * @param {DragEvent} e
 * @param {object} node — the drop target node
 */
SgTree.prototype._onDrop = function(e, node) {
    e.preventDefault();
    const dragId = e.dataTransfer.getData('text/plain') || this._dndNodeId;
    if (!dragId || !this._dndTarget) { this._onDragEnd(e); return; }

    const { id: targetId, position } = this._dndTarget;
    if (dragId === targetId) { this._onDragEnd(e); return; }
    if (_isAncestorOrSelf(this._data, dragId, targetId)) { this._onDragEnd(e); return; }
    if (this._data && this._data.id === dragId) { this._onDragEnd(e); return; }

    this._moveNode(dragId, targetId, position);
    this._onDragEnd(e);
};

// ---------------------------------------------------------------------------
// _onDragEnd
// ---------------------------------------------------------------------------

/**
 * Clean up drag state: restore row opacity, hide indicator, reset state.
 * @param {DragEvent} e
 */
SgTree.prototype._onDragEnd = function(e) {
    // Restore opacity on all rows (simpler than tracking the specific row)
    const rows = this._viewport.querySelectorAll('.sgt-row[style*="opacity"]');
    for (const r of rows) r.style.opacity = '';
    this._hideDropIndicator();
    this._dndNodeId = null;
    this._dndTarget = null;
};

// ---------------------------------------------------------------------------
// _moveNode — mutate _data, re-render, dispatch DATA_CHANGED
// ---------------------------------------------------------------------------

/**
 * Move dragId to position relative to targetId.
 * Positions: 'before' = preceding sibling, 'into' = last child, 'after' = following sibling.
 * @param {string} dragId
 * @param {string} targetId
 * @param {'before'|'into'|'after'} position
 */
SgTree.prototype._moveNode = function(dragId, targetId, position) {
    if (!this._data) return;

    // Extract dragged node from tree
    const dragInfo = _findWithParent(this._data, dragId);
    if (!dragInfo || !dragInfo.parent) return; // root or not found

    // Remove from current location
    dragInfo.parent.children.splice(dragInfo.index, 1);

    // Find target (after removal, in case tree changed)
    const targetInfo = _findWithParent(this._data, targetId);
    if (!targetInfo) {
        // Could not find target — bail out, changes already applied
        this._render();
        this._dispatch(SGT_EVENTS.DATA_CHANGED, { root: JSON.parse(JSON.stringify(this._data)) });
        return;
    }

    const dragNode = dragInfo.node;

    if (position === 'into') {
        // Make dragged node the last child of target
        if (!Array.isArray(targetInfo.node.children)) targetInfo.node.children = [];
        targetInfo.node.children.push(dragNode);
        this._expanded.add(targetId);
    } else if (position === 'before') {
        const parent = targetInfo.parent || this._data;
        const arr    = parent.children || [];
        const idx    = arr.indexOf(targetInfo.node);
        arr.splice(Math.max(0, idx), 0, dragNode);
    } else { // 'after'
        const parent = targetInfo.parent || this._data;
        const arr    = parent.children || [];
        const idx    = arr.indexOf(targetInfo.node);
        arr.splice(idx + 1, 0, dragNode);
    }

    this._render();
    this._dispatch(SGT_EVENTS.DATA_CHANGED, { root: JSON.parse(JSON.stringify(this._data)) });
};

// ---------------------------------------------------------------------------
// Drop indicator helpers
// ---------------------------------------------------------------------------

/**
 * Position and show the drop indicator line.
 * @param {HTMLElement} row
 * @param {'before'|'into'|'after'} position
 * @param {DOMRect} rect — pre-computed getBoundingClientRect
 */
SgTree.prototype._showDropIndicator = function(row, position, rect) {
    if (!this._dndIndicator) return;
    const r = rect || row.getBoundingClientRect();
    const ind = this._dndIndicator;

    if (position === 'into') {
        // Highlight entire row with a border instead of a line
        ind.style.display = 'none';
        row.style.outline = '1px solid #4ECDC4';
        row.style.outlineOffset = '-1px';
        this._dndHoveredRow = row;
    } else {
        // Restore any previously outlined row
        this._clearDndRowOutline();

        const y = position === 'before' ? r.top : r.bottom;
        ind.style.top     = `${y - 1}px`;
        ind.style.left    = `${r.left + 20}px`;
        ind.style.right   = `${window.innerWidth - r.right}px`;
        ind.style.display = 'block';
    }
};

/**
 * Hide the drop indicator and clear any row outline.
 */
SgTree.prototype._hideDropIndicator = function() {
    if (this._dndIndicator) this._dndIndicator.style.display = 'none';
    this._clearDndRowOutline();
};

/** @private */
SgTree.prototype._clearDndRowOutline = function() {
    if (this._dndHoveredRow) {
        this._dndHoveredRow.style.outline = '';
        this._dndHoveredRow.style.outlineOffset = '';
        this._dndHoveredRow = null;
    }
};
