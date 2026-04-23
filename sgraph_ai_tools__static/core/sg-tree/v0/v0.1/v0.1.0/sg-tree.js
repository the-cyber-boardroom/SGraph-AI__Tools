/**
 * sg-tree.js
 * Standalone vanilla JS + Web Components tree view.
 * Zero dependencies. ES module. Shadow DOM. Flat row rendering (not nested DOM).
 * Mirrors sg-layout's patterns.
 *
 * v0.1.0 — base class: setData, full public API (15 methods), single-select,
 *           expand/collapse, filter, keyboard navigation, ARIA, events.
 *           Override queue for surgical v0.1.x overrides.
 *
 * @module sg-tree
 */

import { SGT_EVENTS } from './sg-tree-events.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** @returns {string} Short random id */
function uid() {
    return Math.random().toString(36).slice(2, 10);
}

/**
 * Deep clone a plain object/array (JSON-safe data only).
 * @param {*} val
 * @returns {*}
 */
function deepClone(val) {
    return JSON.parse(JSON.stringify(val));
}

/**
 * Find a node by id in a tree, returning { node, parent, path } or null.
 * @param {object} root
 * @param {string} id
 * @param {object|null} parent
 * @param {string[]} path
 * @returns {{ node: object, parent: object|null, path: string[] }|null}
 */
function findNode(root, id, parent = null, path = []) {
    if (!root) return null;
    const currentPath = [...path, root.id];
    if (root.id === id) return { node: root, parent, path: currentPath };
    if (root.children && root.children.length) {
        for (const child of root.children) {
            const result = findNode(child, id, root, currentPath);
            if (result) return result;
        }
    }
    return null;
}

/**
 * Collect all ancestor ids for a given node id.
 * @param {object} root
 * @param {string} id
 * @returns {string[]} ancestor ids (not including the target id itself)
 */
function getAncestorIds(root, id) {
    const result = findNode(root, id);
    if (!result) return [];
    // path includes the node itself; return all but last
    return result.path.slice(0, -1);
}

// ---------------------------------------------------------------------------
// Shadow DOM styles
// ---------------------------------------------------------------------------

const SHADOW_STYLES = `
:host {
    --sgt-indent:          16px;
    --sgt-row-height:      28px;
    --sgt-icon-size:       16px;
    --sgt-badge-size:      18px;
    --sgt-bg:              transparent;
    --sgt-text:            #e2e8f0;
    --sgt-text-muted:      #5a6478;
    --sgt-text-disabled:   #3a3f4d;
    --sgt-hover-bg:        rgba(255, 255, 255, 0.05);
    --sgt-selected-bg:     rgba(78, 205, 196, 0.12);
    --sgt-selected-border: #4ECDC4;
    --sgt-focus-ring:      rgba(78, 205, 196, 0.4);
    --sgt-toggle-color:    #5a6478;
    --sgt-badge-bg:        rgba(255, 255, 255, 0.1);
    --sgt-badge-text:      #5a6478;
    --sgt-connector-color: rgba(255, 255, 255, 0.06);
    --sgt-transition:      120ms ease;

    display: block;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: var(--sgt-text);
    background: var(--sgt-bg);
}

*,
*::before,
*::after {
    box-sizing: border-box;
}

.sgt-root {
    width: 100%;
    height: 100%;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
}

.sgt-root:focus {
    box-shadow: inset 0 0 0 1px var(--sgt-focus-ring);
}

.sgt-viewport {
    overflow-y: auto;
    height: 100%;
    width: 100%;
}

.sgt-row {
    display: flex;
    align-items: center;
    height: var(--sgt-row-height);
    cursor: pointer;
    transition: background var(--sgt-transition);
    position: relative;
    white-space: nowrap;
    overflow: hidden;
}

.sgt-row:hover {
    background: var(--sgt-hover-bg);
}

.sgt-row[aria-selected="true"] {
    background: var(--sgt-selected-bg);
    border-left: 2px solid var(--sgt-selected-border);
}

.sgt-row[aria-selected="true"] .sgt-label {
    color: var(--sgt-text);
}

.sgt-row[aria-disabled="true"] {
    cursor: not-allowed;
    opacity: 0.4;
}

.sgt-row--focused:not([aria-selected="true"]) {
    background: var(--sgt-hover-bg);
    box-shadow: inset 0 0 0 1px var(--sgt-focus-ring);
}

.sgt-toggle {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--sgt-toggle-color);
    font-size: 10px;
    transition: color var(--sgt-transition);
}

.sgt-toggle--spacer {
    /* leaf placeholder — same size, no content */
}

.sgt-icon {
    flex-shrink: 0;
    width: var(--sgt-icon-size);
    height: var(--sgt-icon-size);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 4px;
    font-size: 12px;
}

.sgt-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--sgt-text);
}

.sgt-badge {
    flex-shrink: 0;
    min-width: var(--sgt-badge-size);
    height: var(--sgt-badge-size);
    padding: 0 5px;
    border-radius: 9px;
    background: var(--sgt-badge-bg);
    color: var(--sgt-badge-text);
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 6px;
}

.sgt-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 60px;
    color: var(--sgt-text-muted);
    font-size: 12px;
}
`;

// ---------------------------------------------------------------------------
// Default icon map
// ---------------------------------------------------------------------------

const DEFAULT_ICON_MAP = {
    'file':   '📄',
    '_custom': '◆',
};

// ---------------------------------------------------------------------------
// SgTree Web Component
// ---------------------------------------------------------------------------

/**
 * sg-tree — standalone tree view Web Component.
 *
 * Canonical data node format:
 * ```
 * {
 *   id:       string,       // required, unique
 *   label:    string,       // required
 *   type:     string,       // required: 'folder'|'file'|custom
 *   children: Node[],       // optional
 *   icon:     string|null,  // optional, overrides default
 *   meta:     object,       // optional, opaque pass-through
 *   badge:    string|null,  // optional, right-aligned count
 *   disabled: boolean,      // optional
 * }
 * ```
 *
 * Attributes:
 * - `selectable`: 'single'|'multi'|'none' (default 'single')
 * - `show-root`: boolean, default true
 * - `indent-px`: number, default 16
 *
 * @element sg-tree
 * @fires sg-tree:node-selected
 * @fires sg-tree:node-deselected
 * @fires sg-tree:selection-changed
 * @fires sg-tree:node-expanded
 * @fires sg-tree:node-collapsed
 * @fires sg-tree:node-activated
 * @fires sg-tree:node-context
 * @fires sg-tree:data-changed
 * @fires sg-tree:ready
 */
export class SgTree extends HTMLElement {

    // -----------------------------------------------------------------------
    // Custom Element boilerplate
    // -----------------------------------------------------------------------

    static get observedAttributes() {
        return ['selectable', 'show-root', 'indent-px'];
    }

    constructor() {
        super();

        // Internal state
        this._data        = null;         // root node (raw, not cloned)
        this._selectedId  = null;         // currently selected node id
        this._focusedId   = null;         // keyboard-focus node id (separate from selection)
        this._expanded    = new Set();    // set of expanded node ids
        this._filterFn    = null;         // active filter function or null
        this._visible     = [];           // flat [{node, depth, path}] — rebuilt on render
        this._ready       = false;

        // Public-readable internal property (required by v0.1.2 virtual scroll override)
        this._rowHeight   = 28;

        // Configuration
        this._selectable      = 'single';
        this._showRoot        = true;
        this._indentPx        = 16;
        this._expandableTypes = ['folder'];
        this._iconMap         = Object.assign({}, DEFAULT_ICON_MAP);
        this._sortFn          = null;

        // Shadow DOM
        this.attachShadow({ mode: 'open' });
        this._buildShadowDOM();
        this._bindEvents();
    }

    connectedCallback() {
        if (!this._ready) {
            this._ready = true;
            this._dispatch(SGT_EVENTS.READY, {});
        }
    }

    attributeChangedCallback(name, _old, val) {
        switch (name) {
            case 'selectable':
                this._selectable = val || 'single';
                break;
            case 'show-root':
                this._showRoot = val !== 'false' && val !== null;
                if (this._data) this._render();
                break;
            case 'indent-px': {
                const n = parseInt(val, 10);
                if (!isNaN(n) && n > 0) {
                    this._indentPx = n;
                    if (this._data) this._render();
                }
                break;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Shadow DOM construction
    // -----------------------------------------------------------------------

    /** @private */
    _buildShadowDOM() {
        const style = document.createElement('style');
        style.textContent = SHADOW_STYLES;

        this._rootEl     = document.createElement('div');
        this._rootEl.className  = 'sgt-root';
        this._rootEl.setAttribute('role', 'tree');
        this._rootEl.setAttribute('tabindex', '0');
        this._rootEl.setAttribute('aria-label', this.getAttribute('aria-label') || 'Tree');

        this._viewport = document.createElement('div');
        this._viewport.className = 'sgt-viewport';

        this._rootEl.appendChild(this._viewport);
        this.shadowRoot.appendChild(style);
        this.shadowRoot.appendChild(this._rootEl);
    }

    // -----------------------------------------------------------------------
    // Event binding
    // -----------------------------------------------------------------------

    /** @private */
    _bindEvents() {
        this._rootEl.addEventListener('keydown',    e => this._onKeydown(e));
        this._rootEl.addEventListener('focus',      () => this._onFocus());
        this._rootEl.addEventListener('click',      e => this._onRowClick(e));
        this._rootEl.addEventListener('dblclick',   e => this._onRowDblClick(e));
        this._rootEl.addEventListener('contextmenu',e => this._onRowContextMenu(e));
    }

    // -----------------------------------------------------------------------
    // Public API — Data
    // -----------------------------------------------------------------------

    /**
     * Set the tree data and re-render.
     * @param {object} root - Root node in canonical format.
     */
    setData(root) {
        this._data = root;
        // Expand root by default if it exists
        if (root && root.id) {
            this._expanded.add(root.id);
        }
        this._selectedId = null;
        this._focusedId  = null;
        this._render();
        this._dispatch(SGT_EVENTS.DATA_CHANGED, { root: this.getData() });
    }

    /**
     * Get a deep clone of the current tree data.
     * @returns {object|null}
     */
    getData() {
        return this._data ? deepClone(this._data) : null;
    }

    // -----------------------------------------------------------------------
    // Public API — Selection
    // -----------------------------------------------------------------------

    /**
     * Get the currently selected node id.
     * @returns {string|null}
     */
    getSelectedId() {
        return this._selectedId;
    }

    /**
     * Programmatically select a node by id and scroll it into view.
     * @param {string} id
     */
    select(id) {
        if (!this._data) return;
        const found = findNode(this._data, id);
        if (!found) return;
        if (found.node.disabled) return;
        this._setSelected(id, found.node, found.path);
        this.scrollTo(id);
    }

    // -----------------------------------------------------------------------
    // Public API — Expand / Collapse
    // -----------------------------------------------------------------------

    /**
     * Expand a node by id.
     * @param {string} id
     */
    expand(id) {
        if (!this._data) return;
        const found = findNode(this._data, id);
        if (!found) return;
        if (!this._isExpandable(found.node)) return;
        if (!this._expanded.has(id)) {
            this._expanded.add(id);
            this._render();
            this._dispatch(SGT_EVENTS.NODE_EXPANDED, { id, node: deepClone(found.node) });
        }
    }

    /**
     * Collapse a node by id.
     * @param {string} id
     */
    collapse(id) {
        if (!this._data) return;
        const found = findNode(this._data, id);
        if (!found) return;
        if (!this._isExpandable(found.node)) return;
        if (this._expanded.has(id)) {
            this._expanded.delete(id);
            this._render();
            this._dispatch(SGT_EVENTS.NODE_COLLAPSED, { id, node: deepClone(found.node) });
        }
    }

    /**
     * Expand all nodes in the tree.
     */
    expandAll() {
        if (!this._data) return;
        this._walkAll(this._data, node => {
            if (this._isExpandable(node)) this._expanded.add(node.id);
        });
        this._render();
    }

    /**
     * Collapse all nodes in the tree.
     */
    collapseAll() {
        this._expanded.clear();
        this._render();
    }

    /**
     * Expand all ancestor nodes of the given id and scroll the node into view.
     * @param {string} id
     */
    expandPath(id) {
        if (!this._data) return;
        const ancestors = getAncestorIds(this._data, id);
        let changed = false;
        for (const aid of ancestors) {
            const found = findNode(this._data, aid);
            if (found && this._isExpandable(found.node) && !this._expanded.has(aid)) {
                this._expanded.add(aid);
                changed = true;
            }
        }
        if (changed) this._render();
        this.scrollTo(id);
    }

    // -----------------------------------------------------------------------
    // Public API — Scroll
    // -----------------------------------------------------------------------

    /**
     * Scroll to make the node with the given id visible.
     * @param {string} id
     */
    scrollTo(id) {
        const row = this._viewport.querySelector(`.sgt-row[data-id="${CSS.escape(id)}"]`);
        if (row) {
            row.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * Get the current scroll position of the viewport.
     * @returns {number}
     */
    getScrollTop() {
        return this._viewport ? this._viewport.scrollTop : 0;
    }

    /**
     * Restore the scroll position of the viewport.
     * @param {number} px
     */
    setScrollTop(px) {
        if (this._viewport) this._viewport.scrollTop = px;
    }

    // -----------------------------------------------------------------------
    // Public API — Filter
    // -----------------------------------------------------------------------

    /**
     * Show only nodes where fn(node) === true. Pass null to clear filter.
     * When a filter is active, ancestor nodes of matching nodes are also shown
     * to maintain tree structure.
     * @param {Function|null} fn
     */
    filter(fn) {
        this._filterFn = fn || null;
        this._render();
    }

    // -----------------------------------------------------------------------
    // Public API — Expansion State
    // -----------------------------------------------------------------------

    /**
     * Get array of currently expanded node ids.
     * @returns {string[]}
     */
    getExpandedIds() {
        return Array.from(this._expanded);
    }

    /**
     * Restore expansion state from an array of ids.
     * @param {string[]} ids
     */
    setExpandedIds(ids) {
        this._expanded = new Set(ids);
        this._render();
    }

    // -----------------------------------------------------------------------
    // Public API — Layout State (sg-layout integration)
    // -----------------------------------------------------------------------

    /**
     * Get serialisable layout state for sg-layout integration.
     * @returns {{ expandedIds: string[], selectedId: string|null, scrollTop: number }}
     */
    getLayoutState() {
        return {
            expandedIds: this.getExpandedIds(),
            selectedId:  this._selectedId,
            scrollTop:   this.getScrollTop(),
        };
    }

    /**
     * Restore layout state from a previously serialised state object.
     * Called by sg-layout serialisation.
     * @param {{ expandedIds?: string[], selectedId?: string|null, scrollTop?: number }} state
     */
    setLayoutState(state) {
        if (!state) return;
        if (Array.isArray(state.expandedIds)) {
            this.setExpandedIds(state.expandedIds);
        }
        if (state.selectedId != null) {
            // restore selection without emitting event
            this._selectedId = state.selectedId;
            this._updateRowSelection();
        }
        if (typeof state.scrollTop === 'number') {
            // Defer scroll restoration slightly so DOM has settled
            requestAnimationFrame(() => this.setScrollTop(state.scrollTop));
        }
    }

    // -----------------------------------------------------------------------
    // Public Configuration Properties
    // -----------------------------------------------------------------------

    /**
     * Types that can be expanded/collapsed.
     * @type {string[]}
     */
    get expandableTypes()       { return this._expandableTypes; }
    set expandableTypes(val)    { this._expandableTypes = Array.isArray(val) ? val : ['folder']; if (this._data) this._render(); }

    /**
     * Map of type → icon string.
     * @type {object}
     */
    get iconMap()               { return this._iconMap; }
    set iconMap(val)            { this._iconMap = Object.assign({}, DEFAULT_ICON_MAP, val); if (this._data) this._render(); }

    /**
     * Custom sort function. Receives two nodes, returns -1/0/1.
     * Default null = folders first, then alphabetical.
     * @type {Function|null}
     */
    get sortFn()                { return this._sortFn; }
    set sortFn(fn)              { this._sortFn = fn || null; if (this._data) this._render(); }

    /**
     * Selection mode. 'single'|'multi'|'none'. v0.1.0 silently treats 'multi' as 'single'.
     * @type {string}
     */
    get selectable()            { return this._selectable; }
    set selectable(val)         { this._selectable = val || 'single'; }

    /**
     * Whether to show the root node.
     * @type {boolean}
     */
    get showRoot()              { return this._showRoot; }
    set showRoot(val)           { this._showRoot = Boolean(val); if (this._data) this._render(); }

    /**
     * Indentation per depth level in pixels.
     * @type {number}
     */
    get indentPx()              { return this._indentPx; }
    set indentPx(val)           { const n = parseInt(val, 10); if (!isNaN(n) && n > 0) { this._indentPx = n; if (this._data) this._render(); } }

    // -----------------------------------------------------------------------
    // Internal — Rendering
    // -----------------------------------------------------------------------

    /**
     * Build the flat visible list by walking the tree.
     * Skips collapsed subtrees. Applies active filter.
     * @private
     * @returns {Array<{node: object, depth: number, path: string[]}>}
     */
    _buildVisibleList() {
        if (!this._data) return [];
        const list = [];

        const walk = (node, depth, path) => {
            const currentPath = [...path, node.id];

            // Apply filter: if filter active, only include if node or descendant matches
            if (this._filterFn) {
                if (!this._nodePassesFilter(node)) return;
            }

            list.push({ node, depth, path: currentPath });

            // Expand children if expandable and expanded
            if (node.children && node.children.length && this._expanded.has(node.id)) {
                let children = [...node.children];

                // Sort children
                if (this._sortFn) {
                    children.sort(this._sortFn);
                } else {
                    children.sort((a, b) => {
                        const aExp = this._isExpandable(a);
                        const bExp = this._isExpandable(b);
                        if (aExp && !bExp) return -1;
                        if (!aExp && bExp) return 1;
                        return (a.label || '').localeCompare(b.label || '');
                    });
                }

                for (const child of children) {
                    walk(child, depth + 1, currentPath);
                }
            }
        };

        if (this._showRoot) {
            walk(this._data, 0, []);
        } else {
            // Skip root, show its children at depth 0
            if (this._data.children && this._data.children.length) {
                let rootChildren = [...this._data.children];
                if (this._sortFn) {
                    rootChildren.sort(this._sortFn);
                } else {
                    rootChildren.sort((a, b) => {
                        const aExp = this._isExpandable(a);
                        const bExp = this._isExpandable(b);
                        if (aExp && !bExp) return -1;
                        if (!aExp && bExp) return 1;
                        return (a.label || '').localeCompare(b.label || '');
                    });
                }
                for (const child of rootChildren) {
                    walk(child, 0, [this._data.id]);
                }
            }
        }

        return list;
    }

    /**
     * Check if a node or any of its descendants passes the active filter.
     * @private
     * @param {object} node
     * @returns {boolean}
     */
    _nodePassesFilter(node) {
        if (this._filterFn(node)) return true;
        if (node.children) {
            for (const child of node.children) {
                if (this._nodePassesFilter(child)) return true;
            }
        }
        return false;
    }

    /**
     * Clear viewport and re-render all visible rows.
     * @private
     */
    _render() {
        this._visible = this._buildVisibleList();
        this._renderVisibleRows();
    }

    /**
     * Render all rows from the _visible list.
     * Overridden by v0.1.2 (virtual scroll).
     * @private
     */
    _renderVisibleRows() {
        this._viewport.innerHTML = '';

        if (!this._visible.length) {
            const empty = document.createElement('div');
            empty.className = 'sgt-empty';
            empty.textContent = 'No items';
            this._viewport.appendChild(empty);
            return;
        }

        const frag = document.createDocumentFragment();
        for (const item of this._visible) {
            const row = this._renderRow(item.node, item.depth, item.path);
            frag.appendChild(row);
        }
        this._viewport.appendChild(frag);
    }

    /**
     * Create and return a single tree row element.
     * Overridden by v0.1.1 (editor mode).
     * IMPORTANT: must always return the created element.
     * @private
     * @param {object} node
     * @param {number} depth
     * @param {string[]} path
     * @returns {HTMLElement}
     */
    _renderRow(node, depth, path) {
        const indent = depth * this._indentPx;
        const isExpandable = this._isExpandable(node);
        const isExpanded   = this._expanded.has(node.id);
        const isSelected   = this._selectedId === node.id;
        const isFocused    = this._focusedId === node.id;
        const isDisabled   = Boolean(node.disabled);

        const row = document.createElement('div');
        row.className  = 'sgt-row';
        row.dataset.id = node.id;
        row.dataset.depth = String(depth);
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        if (isExpandable) {
            row.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        }
        if (isDisabled) {
            row.setAttribute('aria-disabled', 'true');
        }

        // Padding for indentation + toggle + icon
        row.style.paddingLeft = `${indent + 4}px`;

        if (isFocused && !isSelected) {
            row.classList.add('sgt-row--focused');
        }

        // Toggle (▸/▾) or spacer
        const toggle = document.createElement('span');
        toggle.className = isExpandable ? 'sgt-toggle' : 'sgt-toggle sgt-toggle--spacer';
        if (isExpandable) {
            toggle.textContent = isExpanded ? '▾' : '▸';
            toggle.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(toggle);

        // Icon
        const icon = document.createElement('span');
        icon.className = 'sgt-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = this._getIcon(node, isExpanded);
        row.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'sgt-label';
        label.textContent = node.label;
        row.appendChild(label);

        // Badge
        if (node.badge != null && node.badge !== '') {
            const badge = document.createElement('span');
            badge.className = 'sgt-badge';
            badge.textContent = node.badge;
            row.appendChild(badge);
        }

        return row;
    }

    /**
     * Update selection visual state without full re-render.
     * @private
     */
    _updateRowSelection() {
        const rows = this._viewport.querySelectorAll('.sgt-row');
        for (const row of rows) {
            const isSelected = row.dataset.id === this._selectedId;
            row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            if (isSelected) {
                row.classList.add('sgt-row--selected');
            } else {
                row.classList.remove('sgt-row--selected');
            }
        }
    }

    /**
     * Update focus ring visual without full re-render.
     * @private
     */
    _updateFocusRing() {
        const rows = this._viewport.querySelectorAll('.sgt-row');
        for (const row of rows) {
            if (row.dataset.id === this._focusedId) {
                row.classList.add('sgt-row--focused');
            } else {
                row.classList.remove('sgt-row--focused');
            }
        }
    }

    // -----------------------------------------------------------------------
    // Internal — Selection helpers
    // -----------------------------------------------------------------------

    /**
     * Set the selected node, update visuals, dispatch events.
     * @private
     * @param {string} id
     * @param {object} node
     * @param {string[]} path
     */
    _setSelected(id, node, path) {
        if (this._selectable === 'none') return;

        const prev = this._selectedId;
        this._selectedId = id;
        this._focusedId  = id;

        this._render();

        if (prev && prev !== id) {
            this._dispatch(SGT_EVENTS.NODE_DESELECTED, { id: prev });
        }
        this._dispatch(SGT_EVENTS.NODE_SELECTED, { id, node: deepClone(node), path });
        this._dispatch(SGT_EVENTS.SELECTION_CHANGED, { selectedIds: [id] });
    }

    // -----------------------------------------------------------------------
    // Internal — Node helpers
    // -----------------------------------------------------------------------

    /**
     * Check if a node is expandable based on its type.
     * @private
     * @param {object} node
     * @returns {boolean}
     */
    _isExpandable(node) {
        return this._expandableTypes.includes(node.type) && Array.isArray(node.children);
    }

    /**
     * Resolve the display icon for a node.
     * @private
     * @param {object} node
     * @param {boolean} isExpanded
     * @returns {string}
     */
    _getIcon(node, isExpanded) {
        if (node.icon != null) return node.icon;
        if (node.type === 'folder') return isExpanded ? '▾' : '▸';
        if (this._iconMap[node.type]) return this._iconMap[node.type];
        if (this._iconMap['file'] && node.type === 'file') return this._iconMap['file'];
        return this._iconMap['_custom'] || '◆';
    }

    /**
     * Walk all nodes in the tree calling fn for each.
     * @private
     * @param {object} node
     * @param {Function} fn
     */
    _walkAll(node, fn) {
        fn(node);
        if (node.children) {
            for (const child of node.children) this._walkAll(child, fn);
        }
    }

    /**
     * Get the index of a node id in the current visible list.
     * @private
     * @param {string} id
     * @returns {number} -1 if not found
     */
    _visibleIndexOf(id) {
        return this._visible.findIndex(item => item.node.id === id);
    }

    // -----------------------------------------------------------------------
    // Internal — Event dispatching
    // -----------------------------------------------------------------------

    /**
     * Dispatch a CustomEvent from this element.
     * @private
     * @param {string} name - Event name from SGT_EVENTS
     * @param {object} detail
     */
    _dispatch(name, detail) {
        this.dispatchEvent(new CustomEvent(name, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }

    // -----------------------------------------------------------------------
    // Internal — Event handlers
    // -----------------------------------------------------------------------

    /** @private */
    _onFocus() {
        // If nothing focused, focus first visible item
        if (!this._focusedId && this._visible.length) {
            this._focusedId = this._visible[0].node.id;
            this._updateFocusRing();
        }
    }

    /**
     * Handle click on any row element, bubbling up to find the row.
     * Overridden by v0.1.3 (multi-select).
     * @private
     * @param {MouseEvent} e
     */
    _onRowClick(e) {
        const row = e.target.closest('.sgt-row');
        if (!row) return;
        const id = row.dataset.id;
        if (!id || !this._data) return;

        const found = findNode(this._data, id);
        if (!found) return;
        if (found.node.disabled) return;

        // Focus it
        this._focusedId = id;

        // Toggle expand/collapse if expandable
        if (this._isExpandable(found.node)) {
            if (this._expanded.has(id)) {
                this._expanded.delete(id);
                this._render();
                this._dispatch(SGT_EVENTS.NODE_COLLAPSED, { id, node: deepClone(found.node) });
            } else {
                this._expanded.add(id);
                this._render();
                this._dispatch(SGT_EVENTS.NODE_EXPANDED, { id, node: deepClone(found.node) });
            }
        }

        // Select
        if (this._selectable !== 'none') {
            this._setSelected(id, found.node, found.path);
        }

        this._rootEl.focus({ preventScroll: true });
    }

    /**
     * Handle double-click — activates a node (emit NODE_ACTIVATED).
     * @private
     * @param {MouseEvent} e
     */
    _onRowDblClick(e) {
        const row = e.target.closest('.sgt-row');
        if (!row) return;
        const id = row.dataset.id;
        if (!id || !this._data) return;
        const found = findNode(this._data, id);
        if (!found || found.node.disabled) return;
        this._dispatch(SGT_EVENTS.NODE_ACTIVATED, { id, node: deepClone(found.node), path: found.path });
    }

    /**
     * Handle context menu — emit NODE_CONTEXT.
     * @private
     * @param {MouseEvent} e
     */
    _onRowContextMenu(e) {
        const row = e.target.closest('.sgt-row');
        if (!row) return;
        e.preventDefault();
        const id = row.dataset.id;
        if (!id || !this._data) return;
        const found = findNode(this._data, id);
        if (!found) return;
        this._dispatch(SGT_EVENTS.NODE_CONTEXT, { id, node: deepClone(found.node), x: e.clientX, y: e.clientY });
    }

    /**
     * Handle keyboard navigation on the root element.
     * Overridden by v0.1.1 (adds F2, Delete), v0.1.3 (adds Space for multi-select).
     * @private
     * @param {KeyboardEvent} e
     */
    _onKeydown(e) {
        if (!this._visible.length) return;

        const key = e.key;

        // Determine focused index
        let idx = this._focusedId ? this._visibleIndexOf(this._focusedId) : -1;
        if (idx === -1) idx = 0;

        switch (key) {
            case 'ArrowDown':
            case 'j': {
                e.preventDefault();
                const next = idx + 1;
                if (next < this._visible.length) {
                    this._focusedId = this._visible[next].node.id;
                    this._updateFocusRing();
                    this.scrollTo(this._focusedId);
                }
                break;
            }
            case 'ArrowUp':
            case 'k': {
                e.preventDefault();
                const prev = idx - 1;
                if (prev >= 0) {
                    this._focusedId = this._visible[prev].node.id;
                    this._updateFocusRing();
                    this.scrollTo(this._focusedId);
                }
                break;
            }
            case 'ArrowRight': {
                e.preventDefault();
                const item = this._visible[idx];
                if (!item) break;
                const node = item.node;
                if (this._isExpandable(node)) {
                    if (!this._expanded.has(node.id)) {
                        this._expanded.add(node.id);
                        this._render();
                        this._dispatch(SGT_EVENTS.NODE_EXPANDED, { id: node.id, node: deepClone(node) });
                    } else {
                        // Move to first child
                        const newIdx = idx + 1;
                        if (newIdx < this._visible.length) {
                            this._focusedId = this._visible[newIdx].node.id;
                            this._updateFocusRing();
                            this.scrollTo(this._focusedId);
                        }
                    }
                }
                break;
            }
            case 'ArrowLeft': {
                e.preventDefault();
                const item = this._visible[idx];
                if (!item) break;
                const node = item.node;
                if (this._isExpandable(node) && this._expanded.has(node.id)) {
                    this._expanded.delete(node.id);
                    this._render();
                    this._dispatch(SGT_EVENTS.NODE_COLLAPSED, { id: node.id, node: deepClone(node) });
                } else {
                    // Move to parent
                    const depth = item.depth;
                    if (depth > 0) {
                        // Find nearest ancestor in visible list
                        for (let i = idx - 1; i >= 0; i--) {
                            if (this._visible[i].depth < depth) {
                                this._focusedId = this._visible[i].node.id;
                                this._updateFocusRing();
                                this.scrollTo(this._focusedId);
                                break;
                            }
                        }
                    }
                }
                break;
            }
            case 'Enter': {
                e.preventDefault();
                const item = this._visible[idx];
                if (!item) break;
                const node = item.node;
                if (node.disabled) break;
                this._setSelected(node.id, node, item.path);
                // Emit NODE_ACTIVATED for leaf nodes
                if (!this._isExpandable(node)) {
                    this._dispatch(SGT_EVENTS.NODE_ACTIVATED, { id: node.id, node: deepClone(node), path: item.path });
                }
                break;
            }
            case ' ': {
                // Reserved for v0.1.3 multi-select; no-op in v0.1.0
                e.preventDefault();
                break;
            }
            case 'Home': {
                e.preventDefault();
                if (this._visible.length) {
                    this._focusedId = this._visible[0].node.id;
                    this._updateFocusRing();
                    this.scrollTo(this._focusedId);
                }
                break;
            }
            case 'End': {
                e.preventDefault();
                if (this._visible.length) {
                    this._focusedId = this._visible[this._visible.length - 1].node.id;
                    this._updateFocusRing();
                    this.scrollTo(this._focusedId);
                }
                break;
            }
            case '*': {
                // Expand all siblings of focused node
                e.preventDefault();
                const item = this._visible[idx];
                if (!item) break;
                const depth = item.depth;
                for (const v of this._visible) {
                    if (v.depth === depth && this._isExpandable(v.node)) {
                        this._expanded.add(v.node.id);
                    }
                }
                this._render();
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Register + override queue drain
// ---------------------------------------------------------------------------

customElements.define('sg-tree', SgTree);

// Drain pre-registered surgical overrides, then rewire for live application.
// Any code that ran before this script can queue overrides via:
//   window._SgTreeQ = window._SgTreeQ || [];
//   window._SgTreeQ.push(SgTree => { SgTree.prototype.foo = ...; });
const _q = window._SgTreeQ || [];
_q.forEach(fn => fn(SgTree));
window._SgTreeQ = { push: fn => fn(SgTree) };
