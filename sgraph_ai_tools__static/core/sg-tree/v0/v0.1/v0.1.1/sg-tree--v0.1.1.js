/**
 * sg-tree--v0.1.1.js
 * Surgical override: Editor Mode
 *
 * Adds inline rename, delete, create-folder, and add-files affordances
 * when the `editable="true"` attribute is set on <sg-tree>.
 *
 * Load order: import this module; it imports v0.1.0 itself.
 *
 * Usage:
 *   import '../v0.1.1/sg-tree--v0.1.1.js'; // pulls in v0.1.0 transitively
 *
 * @module sg-tree--v0.1.1
 * @requires ../v0.1.0/sg-tree.js
 */

import { SgTree } from '../v0.1.0/sg-tree.js';
import { SGT_EVENTS } from '../v0.1.0/sg-tree-events.js';

// ---------------------------------------------------------------------------
// Private module helpers
// ---------------------------------------------------------------------------

/**
 * Find a node by id in a live (mutable) tree. Returns { node } or null.
 * @param {object} root
 * @param {string} id
 * @returns {{ node: object }|null}
 */
function _findMutable(root, id) {
    if (!root) return null;
    if (root.id === id) return { node: root };
    if (root.children) {
        for (const c of root.children) {
            const r = _findMutable(c, id);
            if (r) return r;
        }
    }
    return null;
}

/**
 * Remove a node by id from a mutable tree. Returns true if found and removed.
 * @param {object} root
 * @param {string} id
 * @returns {boolean}
 */
function _removeNode(root, id) {
    if (!root.children) return false;
    const i = root.children.findIndex(c => c.id === id);
    if (i !== -1) {
        root.children.splice(i, 1);
        return true;
    }
    for (const c of root.children) {
        if (_removeNode(c, id)) return true;
    }
    return false;
}

/** @returns {string} Short random id */
function _uid() { return Math.random().toString(36).slice(2, 9); }

// ---------------------------------------------------------------------------
// Override: _renderRow — inject rename button when editable="true"
// ---------------------------------------------------------------------------

const _origRenderRow11 = SgTree.prototype._renderRow;

/**
 * Overrides v0.1.0's _renderRow. Appends a pencil-icon rename button to each
 * row when `editable="true"`. The button is hidden by default and shown on
 * row hover. MUST return the element.
 * @param {object} node
 * @param {number} depth
 * @param {string[]} path
 * @returns {HTMLElement}
 */
SgTree.prototype._renderRow = function(node, depth, path) {
    const row = _origRenderRow11.call(this, node, depth, path);
    if (this.getAttribute('editable') !== 'true') return row;

    const btn = document.createElement('span');
    btn.title = 'Rename (F2)';
    btn.setAttribute('aria-label', 'Rename');
    btn.textContent = '✎';
    btn.style.cssText = [
        'flex-shrink:0', 'width:20px', 'height:20px',
        'display:none', 'align-items:center', 'justify-content:center',
        'font-size:11px', 'cursor:pointer', 'color:#5a6478',
        'border-radius:3px', 'margin-right:4px',
        'transition:color 120ms ease',
    ].join(';');

    btn.addEventListener('mouseenter', () => { btn.style.color = '#4ECDC4'; });
    btn.addEventListener('mouseleave', () => { btn.style.color = '#5a6478'; });
    btn.addEventListener('click', e => { e.stopPropagation(); this._startRename(node.id); });

    row.appendChild(btn);
    row.addEventListener('mouseenter', () => { btn.style.display = 'flex'; });
    row.addEventListener('mouseleave', () => { btn.style.display = 'none'; });

    return row;
};

// ---------------------------------------------------------------------------
// Override: _onKeydown — F2 = rename, Delete = delete node
// ---------------------------------------------------------------------------

const _origKeydown11 = SgTree.prototype._onKeydown;

/**
 * Extends v0.1.0 keydown handler. When editable:
 * - F2 on focused node starts inline rename
 * - Delete on focused node removes it and its subtree
 * @param {KeyboardEvent} e
 */
SgTree.prototype._onKeydown = function(e) {
    if (this.getAttribute('editable') === 'true') {
        if (e.key === 'F2' && this._focusedId) {
            e.preventDefault();
            this._startRename(this._focusedId);
            return;
        }
        if (e.key === 'Delete' && this._focusedId) {
            e.preventDefault();
            this._deleteNode(this._focusedId);
            return;
        }
    }
    _origKeydown11.call(this, e);
};

// ---------------------------------------------------------------------------
// New method: _startRename — replace label span with inline input
// ---------------------------------------------------------------------------

/**
 * Start inline rename for the node with the given id.
 * Replaces the label span with a text input. Enter/blur commits; Escape cancels.
 * @param {string} id
 */
SgTree.prototype._startRename = function(id) {
    if (!this._data) return;
    const found = _findMutable(this._data, id);
    if (!found) return;

    const row = this._viewport.querySelector(`.sgt-row[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const labelEl = row.querySelector('.sgt-label');
    if (!labelEl) return;

    const orig = found.node.label;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = orig;
    input.style.cssText = [
        'flex:1', 'min-width:0',
        'background:#0d0d1a', 'border:1px solid #4ECDC4', 'border-radius:3px',
        'color:#e2e8f0', 'font-size:13px', 'padding:1px 6px',
        'outline:none', 'font-family:inherit',
    ].join(';');

    labelEl.replaceWith(input);
    input.select();
    input.focus();

    let committed = false;

    const commit = () => {
        if (committed) return;
        committed = true;
        const v = input.value.trim();
        if (v && v !== orig) this._commitRename(id, v);
        else this._render();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        else if (ev.key === 'Escape') {
            committed = true;
            input.removeEventListener('blur', commit);
            this._render();
        }
        ev.stopPropagation();
    });
};

// ---------------------------------------------------------------------------
// New method: _commitRename — update label, dispatch DATA_CHANGED
// ---------------------------------------------------------------------------

/**
 * Commit an in-progress rename to the data model.
 * Dispatches DATA_CHANGED with the updated tree.
 * @param {string} id
 * @param {string} newLabel
 */
SgTree.prototype._commitRename = function(id, newLabel) {
    if (!this._data) return;
    const found = _findMutable(this._data, id);
    if (!found) return;
    found.node.label = newLabel;
    this._render();
    this._dispatch(SGT_EVENTS.DATA_CHANGED, { root: JSON.parse(JSON.stringify(this._data)) });
};

// ---------------------------------------------------------------------------
// New method: _deleteNode — remove node and subtree, dispatch DATA_CHANGED
// ---------------------------------------------------------------------------

/**
 * Delete the node with the given id and all its descendants.
 * Root node cannot be deleted. Dispatches DATA_CHANGED.
 * @param {string} id
 */
SgTree.prototype._deleteNode = function(id) {
    if (!this._data) return;
    if (this._data.id === id) return; // cannot delete root
    if (!_removeNode(this._data, id)) return;

    if (this._selectedId === id) this._selectedId = null;
    if (this._focusedId  === id) this._focusedId  = null;
    this._expanded.delete(id);

    this._render();
    this._dispatch(SGT_EVENTS.DATA_CHANGED, { root: JSON.parse(JSON.stringify(this._data)) });
};

// ---------------------------------------------------------------------------
// New method: _createFolder — insert new folder node under parent
// ---------------------------------------------------------------------------

/**
 * Create a new folder node as a child of parentId (or root if null).
 * Expands the parent, re-renders, then starts inline rename on the new node.
 * Dispatches DATA_CHANGED.
 * @param {string|null} parentId
 * @param {string} [label='New Folder']
 * @returns {string|null} id of the new node, or null if parent not found
 */
SgTree.prototype._createFolder = function(parentId, label) {
    if (!this._data) return null;
    const pid = parentId || this._data.id;
    const found = _findMutable(this._data, pid);
    if (!found) return null;

    const parent = found.node;
    if (!Array.isArray(parent.children)) parent.children = [];

    const newId = 'folder_' + _uid();
    parent.children.push({ id: newId, label: label || 'New Folder', type: 'folder', children: [] });
    this._expanded.add(pid);
    this._render();
    this._dispatch(SGT_EVENTS.DATA_CHANGED, { root: JSON.parse(JSON.stringify(this._data)) });
    requestAnimationFrame(() => this._startRename(newId));
    return newId;
};

// ---------------------------------------------------------------------------
// New method: _addFiles — insert file nodes from FileList or descriptor array
// ---------------------------------------------------------------------------

/**
 * Add file nodes to the tree under parentId (or root if null).
 * Accepts a native FileList, a File[], or an array of { label, meta } objects.
 * Dispatches DATA_CHANGED.
 * @param {string|null} parentId
 * @param {FileList|Array} fileList
 */
SgTree.prototype._addFiles = function(parentId, fileList) {
    if (!this._data) return;
    const pid = parentId || this._data.id;
    const found = _findMutable(this._data, pid);
    if (!found) return;

    const parent = found.node;
    if (!Array.isArray(parent.children)) parent.children = [];

    for (const f of Array.from(fileList)) {
        const name = (f instanceof File) ? f.name : (f.label || f.name || 'file');
        parent.children.push({
            id:   'file_' + _uid(),
            label: name,
            type: 'file',
            meta: (f instanceof File)
                ? { size: f.size, lastModified: f.lastModified, mimeType: f.type }
                : (f.meta || {}),
        });
    }

    this._expanded.add(pid);
    this._render();
    this._dispatch(SGT_EVENTS.DATA_CHANGED, { root: JSON.parse(JSON.stringify(this._data)) });
};
