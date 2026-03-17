/**
 * sg-layout.js
 * Fractal window management Web Component.
 * v0.1.0 — row/column layout, resize handles, registration protocol, serialisation.
 *
 * @module sg-layout
 */

import { SGL_EVENTS } from './sg-layout-events.js';

// ---------------------------------------------------------------------------
// Internal helpers — not exported
// ---------------------------------------------------------------------------

/** @returns {string} Short random id */
function uid() {
    return Math.random().toString(36).slice(2, 10);
}

/**
 * Normalise an array of sizes so they sum to 1.0.
 * @param {number[]|undefined} sizes
 * @param {number} count
 * @returns {number[]}
 */
function normaliseSizes(sizes, count) {
    if (sizes && sizes.length === count) {
        const sum = sizes.reduce((a, b) => a + b, 0);
        if (sum > 0) return sizes.map(s => s / sum);
    }
    return Array(count).fill(1 / count);
}

function makeRow(children, sizes)          { return { type: 'row',    id: uid(), children, sizes: normaliseSizes(sizes, children.length) }; }
function makeColumn(children, sizes)       { return { type: 'column', id: uid(), children, sizes: normaliseSizes(sizes, children.length) }; }
function makeStack(tabs, activeTab = 0)    { return { type: 'stack',  id: uid(), tabs, activeTab }; }
function makeTab(tag, title, state = {})   { return { type: 'tab',    id: uid(), tag, title, state, el: null }; }

// ---------------------------------------------------------------------------
// Minimal EventBus (internal only)
// ---------------------------------------------------------------------------

class EventBus {
    constructor()                  { this._handlers = new Map(); }
    on(event, fn)                  { if (!this._handlers.has(event)) this._handlers.set(event, []); this._handlers.get(event).push(fn); }
    off(event, fn)                 { const h = this._handlers.get(event); if (h) this._handlers.set(event, h.filter(f => f !== fn)); }
    emit(event, detail)            { const h = this._handlers.get(event); if (h) h.forEach(fn => { try { fn(detail); } catch(e) { console.error('[sg-layout EventBus]', e); } }); }
}

// ---------------------------------------------------------------------------
// Shadow DOM styles (embedded, no external CSS fetch required)
// ---------------------------------------------------------------------------

const SHADOW_STYLES = `
:host {
    --sgl-handle-size: 4px;
    --sgl-tab-height: 28px;
    --sgl-panel-header-height: 32px;
    --sgl-min-panel-size: 80px;
    --sgl-bg: #1A1A2E;
    --sgl-surface: #162040;
    --sgl-surface-hover: #253254;
    --sgl-border: #222d4d;
    --sgl-accent: #4ECDC4;
    --sgl-text: #e2e8f0;
    --sgl-text-muted: #5a6478;
    --sgl-transition-speed: 150ms;

    display: block;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: var(--sgl-text);
}

.sgl-root {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--sgl-bg);
    opacity: 0;
    transition: opacity var(--sgl-transition-speed) ease;
}
.sgl-root.sgl-visible {
    opacity: 1;
}

/* Row / Column containers */
.sgl-row, .sgl-column {
    display: grid;
    flex: 1;
    width: 100%;
    height: 100%;
    overflow: hidden;
    box-sizing: border-box;
}
.sgl-row    { grid-auto-flow: column; }
.sgl-column { grid-auto-flow: row;    }

/* All grid children must allow shrinking below content size */
.sgl-row > *, .sgl-column > * {
    min-width: 0;
    min-height: 0;
}

/* Stack container (single panel, or tabs in future) */
.sgl-stack {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--sgl-border);
    border-radius: 4px;
    background: var(--sgl-surface);
}
.sgl-stack-header {
    display: flex;
    align-items: center;
    height: var(--sgl-panel-header-height);
    min-height: var(--sgl-panel-header-height);
    padding: 0 8px;
    background: var(--sgl-surface);
    border-bottom: 1px solid var(--sgl-border);
    cursor: default;
    user-select: none;
    gap: 6px;
}
.sgl-stack-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 500;
    color: var(--sgl-text);
}
.sgl-collapse-btn {
    background: none;
    border: none;
    color: var(--sgl-text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 3px;
}
.sgl-collapse-btn:hover {
    background: var(--sgl-surface-hover);
    color: var(--sgl-text);
}

/* Slot wrapper — the portal contract */
.sgl-slot-wrapper {
    display: block;
    flex: 1;
    width: 100%;
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
    min-height: 0;
}

/* Collapsed state — shared */
.sgl-stack--collapsed {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
.sgl-stack--collapsed .sgl-slot-wrapper {
    display: none;
}
.sgl-stack--collapsed .sgl-collapse-btn {
    flex-shrink: 0;
}

/* Collapsed in a ROW → vertical strip (column-collapse) */
.sgl-stack--collapsed-col .sgl-stack-header {
    text-orientation: mixed;
    height: 100%;
    width: var(--sgl-tab-height);
    min-height: unset;
    min-width: var(--sgl-tab-height);
    padding: 4px 2px;
    border-bottom: none;
    border-right: 1px solid var(--sgl-border);
    flex-direction: column;
    align-items: center;
    gap: 4px;
    overflow: hidden;
}
.sgl-stack--collapsed-col .sgl-collapse-btn {
    writing-mode: horizontal-tb;
}
.sgl-stack--collapsed-col .sgl-stack-title {
    flex: 0 1 auto;
    writing-mode: vertical-lr;
    text-orientation: mixed;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
}

/* Collapsed in a COLUMN → horizontal strip (row-collapse) */
.sgl-stack--collapsed-row .sgl-stack-header {
    height: var(--sgl-tab-height);
    min-height: var(--sgl-tab-height);
    padding: 0 8px;
    border-bottom: none;
    border-bottom: 1px solid var(--sgl-border);
}
.sgl-stack--collapsed-row .sgl-stack-title {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
}

/* Resize handles */
.sgl-resize-handle {
    background: var(--sgl-border);
    flex-shrink: 0;
    z-index: 1;
    transition: background var(--sgl-transition-speed) ease;
}
.sgl-resize-handle:hover,
.sgl-resize-handle--active {
    background: var(--sgl-accent);
}
.sgl-resize-handle--col {
    cursor: col-resize;
    width: var(--sgl-handle-size);
    min-width: var(--sgl-handle-size);
}
.sgl-resize-handle--row {
    cursor: row-resize;
    height: var(--sgl-handle-size);
    min-height: var(--sgl-handle-size);
}
`;

// ---------------------------------------------------------------------------
// SgLayout — the custom element
// ---------------------------------------------------------------------------

class SgLayout extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        /** @type {object|null} Layout tree root node */
        this._tree = null;

        /** @type {EventBus} Internal event bus */
        this._events = new EventBus();

        /** @type {number} Nesting depth (0 = root) */
        this._depth = 0;

        /** @type {SgLayout|null} Parent layout reference (for nested case) */
        this._parentLayoutRef = null;

        /** @type {number} Re-entrant registration guard */
        this._registerDepth = 0;

        /** @type {Set<HTMLElement>} Elements that have registered */
        this._registeredElements = new Set();

        /** @type {Set<string>} Collapsed stack ids */
        this._collapsedStacks = new Set();

        /** @type {Map<string, HTMLElement>} node id → DOM element cache */
        this._nodeElements = new Map();

        /** @type {HTMLElement} Root container in shadow DOM */
        this._rootEl = null;
    }

    /** @returns {EventBus} */
    get events() { return this._events; }

    /** @returns {number} */
    get depth()  { return this._depth; }

    static get observedAttributes() { return ['layout']; }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === 'layout' && newVal !== oldVal && this.isConnected) {
            try { this.setLayout(JSON.parse(newVal)); } catch(e) { console.error('[sg-layout] Invalid layout JSON:', e); }
        }
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    connectedCallback() {
        // Build shadow DOM skeleton
        const style = document.createElement('style');
        style.textContent = SHADOW_STYLES;
        this.shadowRoot.appendChild(style);

        this._rootEl = document.createElement('div');
        this._rootEl.className = 'sgl-root';
        this.shadowRoot.appendChild(this._rootEl);

        // Set up registration listener before anything mounts
        this._setupRegistrationListener();

        // Try to register with a parent sg-layout (fractal case)
        this._registerWithParent();

        // Parse initial layout from attribute or child elements
        this._parseInitialLayout();

        // Render the tree to shadow DOM and mount all tabs
        if (this._tree) {
            this._renderTree();
            this._mountAllTabs();
        }

        // Emit ready, then reveal
        this._events.emit(SGL_EVENTS.LAYOUT_READY, {});
        requestAnimationFrame(() => this._rootEl.classList.add('sgl-visible'));
    }

    disconnectedCallback() {
        this._unmountAll();
        this._nodeElements.clear();
        this._registeredElements.clear();
        this._collapsedStacks.clear();
    }

    // -----------------------------------------------------------------------
    // Registration protocol
    // -----------------------------------------------------------------------

    _setupRegistrationListener() {
        this.shadowRoot.addEventListener(SGL_EVENTS.REGISTER, (event) => {
            event.stopPropagation();

            // Guard: cycle detection by call stack depth
            this._registerDepth++;
            if (this._registerDepth > 10) {
                console.error(
                    `[sg-layout] Circular registration detected. ` +
                    `Element: <${event.target.tagName.toLowerCase()}>. ` +
                    `Stack depth: ${this._registerDepth}. Breaking cycle.`
                );
                this._registerDepth--;
                return;
            }

            // Guard: cycle detection by element identity
            if (this._registeredElements.has(event.target)) {
                console.warn(
                    `[sg-layout] Element <${event.target.tagName.toLowerCase()}> ` +
                    `registered twice. Ignoring second registration.`
                );
                this._registerDepth--;
                return;
            }
            this._registeredElements.add(event.target);

            // Resolve which tab this element belongs to
            const tab = this._findTabForElement(event.target);
            if (!tab) {
                console.warn(`[sg-layout] Could not resolve panel for registered element.`);
                this._registerDepth--;
                return;
            }

            // Synchronous respond
            if (typeof event.detail?.respond === 'function') {
                event.detail.respond({
                    panelId:   tab.id,
                    layoutRef: this,
                    depth:     this._depth,
                    bounds:    this._getTabBounds(tab),
                });
            }

            this._registerDepth--;
        });
    }

    /** Attempt to register with a parent sg-layout (for the fractal/nested case). */
    _registerWithParent() {
        let config = null;
        this.dispatchEvent(new CustomEvent(SGL_EVENTS.REGISTER, {
            bubbles: true,
            composed: true,
            detail: { respond: c => { config = c; } }
        }));
        if (config) {
            this._depth = config.depth + 1;
            this._parentLayoutRef = config.layoutRef;
            this.dataset.panelId = config.panelId;
        }
    }

    // -----------------------------------------------------------------------
    // Layout parsing
    // -----------------------------------------------------------------------

    /** Build the initial tree from the `layout` attribute or from child elements. */
    _parseInitialLayout() {
        // Priority 1: JSON from attribute
        const layoutAttr = this.getAttribute('layout');
        if (layoutAttr) {
            try {
                this._tree = this._normaliseTree(JSON.parse(layoutAttr));
                return;
            } catch(e) {
                console.error('[sg-layout] Invalid layout attribute JSON:', e);
            }
        }

        // Priority 2: build from child elements in light DOM
        const children = Array.from(this.children).filter(el => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT');
        if (children.length === 0) return;

        if (children.length === 1) {
            const tab = makeTab(
                children[0].tagName.toLowerCase(),
                children[0].dataset.panelTitle || children[0].tagName.toLowerCase(),
            );
            tab.el = children[0];
            this._tree = makeStack([tab]);
        } else {
            // Multiple children → row with one stack per child
            const stacks = children.map(child => {
                const tab = makeTab(
                    child.tagName.toLowerCase(),
                    child.dataset.panelTitle || child.tagName.toLowerCase(),
                );
                tab.el = child;
                return makeStack([tab]);
            });
            this._tree = makeRow(stacks);
        }
    }

    // -----------------------------------------------------------------------
    // Tree → DOM projection
    // -----------------------------------------------------------------------

    _renderTree() {
        // Clear previous render
        this._rootEl.innerHTML = '';
        this._nodeElements.clear();

        if (!this._tree) return;
        const el = this._renderNode(this._tree);
        this._rootEl.appendChild(el);
    }

    /**
     * Recursively render a layout tree node to DOM elements.
     * @param {object} node
     * @returns {HTMLElement}
     */
    _renderNode(node, parentType) {
        if (node.type === 'row' || node.type === 'column') {
            return this._renderContainer(node);
        }
        if (node.type === 'stack') {
            return this._renderStack(node, parentType);
        }
        console.warn('[sg-layout] Unknown node type:', node.type);
        return document.createElement('div');
    }

    /**
     * Render a row or column container with resize handles between children.
     * @param {object} node
     * @returns {HTMLElement}
     */
    _renderContainer(node) {
        const el = document.createElement('div');
        el.className = node.type === 'row' ? 'sgl-row' : 'sgl-column';
        el.dataset.nodeId = node.id;
        this._nodeElements.set(node.id, el);

        // Build grid template and append children with resize handles
        const fragments = [];
        node.children.forEach((child, i) => {
            const childEl = this._renderNode(child, node.type);
            el.appendChild(childEl);

            if (i < node.children.length - 1) {
                const axis = node.type === 'row' ? 'col' : 'row';
                el.appendChild(this._makeResizeHandle(axis, node, i));
            }
        });

        this._applyGridSizes(node, el);
        return el;
    }

    /**
     * Render a stack (panel with header + slot wrapper).
     * @param {object} node
     * @returns {HTMLElement}
     */
    _renderStack(node, parentType) {
        const el = document.createElement('div');
        el.className = 'sgl-stack';
        el.dataset.nodeId = node.id;
        this._nodeElements.set(node.id, el);

        if (this._collapsedStacks.has(node.id)) {
            const axis = parentType === 'column' ? 'row' : 'col';
            el.classList.add('sgl-stack--collapsed', `sgl-stack--collapsed-${axis}`);
        }

        // Header
        const header = document.createElement('div');
        header.className = 'sgl-stack-header';

        const title = document.createElement('span');
        title.className = 'sgl-stack-title';
        const activeTab = node.tabs[node.activeTab || 0];
        title.textContent = activeTab?.title || '';
        header.appendChild(title);

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'sgl-collapse-btn';
        collapseBtn.textContent = this._collapsedStacks.has(node.id) ? '+' : '\u2013';
        collapseBtn.title = 'Collapse/expand panel';
        collapseBtn.addEventListener('click', () => this._toggleCollapse(node));
        header.appendChild(collapseBtn);

        el.appendChild(header);

        // Slot wrapper for hosted content
        const slotWrapper = document.createElement('div');
        slotWrapper.className = 'sgl-slot-wrapper';

        // Create a named slot for each tab
        node.tabs.forEach((tab, i) => {
            const slot = document.createElement('slot');
            slot.name = `p-${tab.id}`;
            slotWrapper.appendChild(slot);
        });

        el.appendChild(slotWrapper);
        return el;
    }

    // -----------------------------------------------------------------------
    // Grid sizing
    // -----------------------------------------------------------------------

    /**
     * Apply sizes to a row/column container's CSS grid template.
     * @param {object} node
     * @param {HTMLElement} [el]
     */
    _applyGridSizes(node, el) {
        el = el || this._nodeElements.get(node.id);
        if (!el) return;

        const prop = node.type === 'row' ? 'gridTemplateColumns' : 'gridTemplateRows';
        const styles = getComputedStyle(this);
        const tabH   = styles.getPropertyValue('--sgl-tab-height').trim()  || '28px';
        const handleS = styles.getPropertyValue('--sgl-handle-size').trim() || '4px';

        // Collect non-collapsed sizes and normalise so fr values sum to 1
        // (CSS Grid treats sum < 1 as percentage of free space, not filling it)
        let frTotal = 0;
        node.children.forEach((child, i) => {
            const isCollapsed = child.type === 'stack' && this._collapsedStacks.has(child.id);
            if (!isCollapsed) frTotal += node.sizes[i];
        });
        const scale = frTotal > 0 ? 1 / frTotal : 1;

        const parts = [];
        node.children.forEach((child, i) => {
            const isCollapsed = child.type === 'stack' && this._collapsedStacks.has(child.id);
            if (isCollapsed) {
                parts.push(tabH);
            } else {
                parts.push(`${node.sizes[i] * scale}fr`);
            }
            if (i < node.children.length - 1) {
                parts.push(handleS);
            }
        });

        el.style[prop] = parts.join(' ');
    }

    // -----------------------------------------------------------------------
    // Collapse
    // -----------------------------------------------------------------------

    /**
     * Toggle collapse state for a stack.
     * @param {object} node  Stack node
     */
    _toggleCollapse(node) {
        const el = this._nodeElements.get(node.id);
        if (!el) return;

        // Determine collapse axis from parent type
        const parentNode = this._findParentNode(this._tree, node.id);
        const collapseAxis = parentNode?.type === 'column' ? 'row' : 'col';

        if (this._collapsedStacks.has(node.id)) {
            this._collapsedStacks.delete(node.id);
            el.classList.remove('sgl-stack--collapsed', 'sgl-stack--collapsed-col', 'sgl-stack--collapsed-row');
            el.querySelector('.sgl-collapse-btn').textContent = '\u2013';
            this._events.emit(SGL_EVENTS.PANEL_SHOWN, { id: node.tabs[node.activeTab]?.id });
        } else {
            this._collapsedStacks.add(node.id);
            el.classList.add('sgl-stack--collapsed', `sgl-stack--collapsed-${collapseAxis}`);
            el.querySelector('.sgl-collapse-btn').textContent = '+';
            this._events.emit(SGL_EVENTS.PANEL_HIDDEN, { id: node.tabs[node.activeTab]?.id });
        }

        // Re-apply grid sizing on the parent container
        if (parentNode) {
            this._applyGridSizes(parentNode);
        }

        this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
    }

    // -----------------------------------------------------------------------
    // Resize handles
    // -----------------------------------------------------------------------

    /**
     * Create a resize handle element.
     * @param {'col'|'row'} axis
     * @param {object} parentNode  The row/column node that owns the sizes
     * @param {number} index       Index of the left/top child
     * @returns {HTMLElement}
     */
    _makeResizeHandle(axis, parentNode, index) {
        const handle = document.createElement('div');
        handle.className = `sgl-resize-handle sgl-resize-handle--${axis}`;

        let startPos, startSizes;

        handle.addEventListener('pointerdown', e => {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            startPos = axis === 'col' ? e.clientX : e.clientY;
            startSizes = [...parentNode.sizes];
            handle.classList.add('sgl-resize-handle--active');
        });

        handle.addEventListener('pointermove', e => {
            if (!handle.hasPointerCapture(e.pointerId)) return;

            const containerEl = this._nodeElements.get(parentNode.id);
            if (!containerEl) return;

            const containerSize = axis === 'col'
                ? containerEl.offsetWidth
                : containerEl.offsetHeight;

            if (containerSize <= 0) return;

            const delta = (axis === 'col' ? e.clientX : e.clientY) - startPos;
            const deltaFraction = delta / containerSize;

            const newSizes = [...startSizes];
            const minFraction = 80 / containerSize;

            newSizes[index]     = Math.max(minFraction, startSizes[index]     + deltaFraction);
            newSizes[index + 1] = Math.max(minFraction, startSizes[index + 1] - deltaFraction);

            // Renormalise pair so they still sum to the original pair sum
            const pairTotal = startSizes[index] + startSizes[index + 1];
            const newPairTotal = newSizes[index] + newSizes[index + 1];
            newSizes[index]     = newSizes[index]     / newPairTotal * pairTotal;
            newSizes[index + 1] = newSizes[index + 1] / newPairTotal * pairTotal;

            parentNode.sizes = newSizes;
            this._applyGridSizes(parentNode);
            this._notifyPanelResizes(parentNode);
        });

        handle.addEventListener('pointerup', e => {
            handle.releasePointerCapture(e.pointerId);
            handle.classList.remove('sgl-resize-handle--active');
            this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
        });

        return handle;
    }

    // -----------------------------------------------------------------------
    // Mount / unmount tabs
    // -----------------------------------------------------------------------

    /** Mount all tabs in the tree that have a tag but no el. */
    _mountAllTabs() {
        this._walkTabs(this._tree, (tab, stack) => {
            if (tab.el) {
                // Element already exists (parsed from child elements)
                this._mountExistingElement(tab);
            } else if (tab.tag) {
                this._mountNewElement(tab);
            }
        });
    }

    /**
     * Mount a pre-existing element into its slot.
     * @param {object} tab
     */
    _mountExistingElement(tab) {
        const el = tab.el;

        // Inject layout refs before slotting
        el._sgLayoutRef    = this;
        el.dataset.panelId = tab.id;
        el.dataset.layoutDepth = String(this._depth);
        if (tab.title) el.dataset.panelTitle = tab.title;

        // Assign the slot so the element projects into our shadow DOM
        el.slot = `p-${tab.id}`;
    }

    /**
     * Create and mount a new element from a tag name.
     * @param {object} tab
     */
    _mountNewElement(tab) {
        const el = document.createElement(tab.tag);

        // Inject before connectedCallback fires
        el._sgLayoutRef    = this;
        el.dataset.panelId = tab.id;
        el.dataset.layoutDepth = String(this._depth);
        if (tab.title) el.dataset.panelTitle = tab.title;

        // Restore state if component supports it
        if (tab.state && Object.keys(tab.state).length > 0 && typeof el.setLayoutState === 'function') {
            el.setLayoutState(tab.state);
        }

        tab.el = el;

        // Assign slot and append to light DOM — connectedCallback fires here
        el.slot = `p-${tab.id}`;
        this.appendChild(el);

        // Read back any title the component may have set
        if (el.dataset.panelTitle && el.dataset.panelTitle !== tab.title) {
            tab.title = el.dataset.panelTitle;
            this._updateStackTitle(tab);
        }
    }

    /** Unmount all elements — used before setLayout() rebuilds everything. */
    _unmountAll() {
        this._walkTabs(this._tree, tab => {
            if (tab.el && tab.el.parentNode === this) {
                this.removeChild(tab.el);
            }
            tab.el = null;
        });
        this._registeredElements.clear();
    }

    // -----------------------------------------------------------------------
    // Tree normalisation (for deserialised JSON)
    // -----------------------------------------------------------------------

    /**
     * Recursively normalise a tree: ensure sizes sum to 1.0 on row/column nodes.
     * @param {object} node
     * @returns {object} The same node (mutated in place)
     */
    _normaliseTree(node) {
        if (!node) return node;
        if (node.type === 'row' || node.type === 'column') {
            node.sizes = normaliseSizes(node.sizes, node.children.length);
            node.children.forEach(c => this._normaliseTree(c));
        }
        return node;
    }

    // -----------------------------------------------------------------------
    // Tree traversal helpers
    // -----------------------------------------------------------------------

    /**
     * Walk all tabs in the tree, calling fn(tab, stack) for each.
     * @param {object|null} node
     * @param {function} fn
     */
    _walkTabs(node, fn) {
        if (!node) return;
        if (node.type === 'tab') {
            // Tab is always inside a stack — fn should have been called from stack level
            return;
        }
        if (node.type === 'stack') {
            (node.tabs || []).forEach(tab => fn(tab, node));
            return;
        }
        if (node.children) {
            node.children.forEach(child => this._walkTabs(child, fn));
        }
    }

    /**
     * Find the tab node that an element belongs to.
     * @param {HTMLElement} el
     * @returns {object|null}
     */
    _findTabForElement(el) {
        let found = null;
        this._walkTabs(this._tree, tab => {
            if (tab.el === el) found = tab;
        });
        return found;
    }

    /**
     * Find the parent (row/column) of a node with the given id.
     * @param {object} tree
     * @param {string} childId
     * @returns {object|null}
     */
    _findParentNode(tree, childId) {
        if (!tree || !tree.children) return null;
        for (const child of tree.children) {
            if (child.id === childId) return tree;
            const found = this._findParentNode(child, childId);
            if (found) return found;
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Bounds & resize notifications
    // -----------------------------------------------------------------------

    /**
     * Get the bounds of a tab's slot wrapper.
     * @param {object} tab
     * @returns {{ width: number, height: number }}
     */
    _getTabBounds(tab) {
        if (!tab.el) return { width: 0, height: 0 };
        const rect = tab.el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    }

    /**
     * Notify all tabs under a node that they've been resized.
     * @param {object} node
     */
    _notifyPanelResizes(node) {
        this._walkTabs(node, tab => {
            if (tab.el) {
                const bounds = this._getTabBounds(tab);
                this._events.emit(SGL_EVENTS.PANEL_RESIZED, { id: tab.id, ...bounds });
            }
        });
    }

    /**
     * Update the title in a stack's header for a given tab.
     * @param {object} tab
     */
    _updateStackTitle(tab) {
        // Find the stack that contains this tab
        let targetStack = null;
        this._walkTabs(this._tree, (t, stack) => {
            if (t.id === tab.id) targetStack = stack;
        });
        if (!targetStack) return;

        const stackEl = this._nodeElements.get(targetStack.id);
        if (!stackEl) return;

        const titleEl = stackEl.querySelector('.sgl-stack-title');
        if (titleEl) titleEl.textContent = tab.title;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Get the current layout as a serialisable JSON tree.
     * @returns {object}
     */
    getLayout() {
        if (!this._tree) return null;
        return JSON.parse(JSON.stringify(this._serializeNode(this._tree)));
    }

    /**
     * Set and render a new layout from JSON.
     * @param {object} json
     */
    setLayout(json) {
        this._unmountAll();
        this._tree = this._normaliseTree(JSON.parse(JSON.stringify(json)));
        this._collapsedStacks.clear();
        this._renderTree();
        this._mountAllTabs();
        this._events.emit(SGL_EVENTS.LAYOUT_READY, {});
        this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
    }

    /**
     * Add a panel to the layout. If no tree exists, creates one.
     * @param {object} config  { tag, title, state, el }
     */
    addPanel(config) {
        const tab = makeTab(
            config.tag || config.el?.tagName?.toLowerCase() || 'div',
            config.title || config.tag || 'Panel',
            config.state || {},
        );
        if (config.el) tab.el = config.el;

        if (!this._tree) {
            this._tree = makeStack([tab]);
            this._renderTree();
        } else if (this._tree.type === 'stack') {
            // Single stack — wrap in a row
            const newStack = makeStack([tab]);
            this._tree = makeRow([this._tree, newStack]);
            this._renderTree();
        } else {
            // Row or column — add a new stack at the end
            const newStack = makeStack([tab]);
            this._tree.children.push(newStack);
            this._tree.sizes = normaliseSizes(null, this._tree.children.length);
            this._renderTree();
        }

        // Mount the new tab
        if (tab.el) {
            this._mountExistingElement(tab);
        } else {
            this._mountNewElement(tab);
        }

        this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
        return tab.id;
    }

    /**
     * Remove a panel by id.
     * @param {string} id
     */
    removePanel(id) {
        const removed = this._removeTabFromTree(this._tree, id);
        if (removed) {
            if (removed.el && removed.el.parentNode === this) {
                this.removeChild(removed.el);
            }
            this._registeredElements.delete(removed.el);
            this._renderTree();
            this._mountAllTabs();
            this._events.emit(SGL_EVENTS.PANEL_CLOSED, { id });
            this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
        }
    }

    /**
     * Get the bounds of a panel by id.
     * @param {string} id
     * @returns {{ width: number, height: number }|null}
     */
    getPanelBounds(id) {
        let result = null;
        this._walkTabs(this._tree, tab => {
            if (tab.id === id) result = this._getTabBounds(tab);
        });
        return result;
    }

    /**
     * Get the hosted element by panel id.
     * @param {string} id
     * @returns {HTMLElement|null}
     */
    getPanelElement(id) {
        let result = null;
        this._walkTabs(this._tree, tab => {
            if (tab.id === id) result = tab.el;
        });
        return result;
    }

    // -----------------------------------------------------------------------
    // Serialisation
    // -----------------------------------------------------------------------

    /**
     * Serialise a tree node to JSON (no element references).
     * @param {object} node
     * @returns {object}
     */
    _serializeNode(node) {
        if (node.type === 'tab') {
            const state = (typeof node.el?.getLayoutState === 'function')
                ? node.el.getLayoutState()
                : (node.state || {});
            return { type: 'tab', id: node.id, title: node.title, tag: node.tag, state };
        }
        if (node.type === 'stack') {
            return {
                type: 'stack', id: node.id,
                activeTab: node.activeTab,
                tabs: node.tabs.map(t => this._serializeNode(t)),
            };
        }
        return {
            type: node.type, id: node.id,
            sizes: [...node.sizes],
            children: node.children.map(c => this._serializeNode(c)),
        };
    }

    // -----------------------------------------------------------------------
    // Internal: remove tab from tree
    // -----------------------------------------------------------------------

    /**
     * Remove a tab from the tree, cleaning up empty stacks/containers.
     * @param {object} node
     * @param {string} tabId
     * @returns {object|null} The removed tab, or null
     */
    _removeTabFromTree(node, tabId) {
        if (!node) return null;

        if (node.type === 'stack') {
            const idx = node.tabs.findIndex(t => t.id === tabId);
            if (idx !== -1) {
                const [removed] = node.tabs.splice(idx, 1);
                if (node.activeTab >= node.tabs.length) {
                    node.activeTab = Math.max(0, node.tabs.length - 1);
                }
                return removed;
            }
            return null;
        }

        if (node.children) {
            for (let i = 0; i < node.children.length; i++) {
                const result = this._removeTabFromTree(node.children[i], tabId);
                if (result) {
                    // Clean up empty stacks
                    if (node.children[i].type === 'stack' && node.children[i].tabs.length === 0) {
                        node.children.splice(i, 1);
                        node.sizes = normaliseSizes(null, node.children.length);
                    }
                    // If only one child remains, promote it
                    if (node.children.length === 1 && node === this._tree) {
                        this._tree = node.children[0];
                    }
                    return result;
                }
            }
        }
        return null;
    }
}

customElements.define('sg-layout', SgLayout);

export { SgLayout, SGL_EVENTS };
