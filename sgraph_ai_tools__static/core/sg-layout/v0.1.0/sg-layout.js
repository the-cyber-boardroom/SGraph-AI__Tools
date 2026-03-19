/**
 * sg-layout.js
 * Fractal window management Web Component.
 * v0.1.3 — drag to dock (within one layout).
 * v0.1.2 — fractal registration (nested sg-layout, depth tracking, nested serialisation).
 * v0.1.1 — tab stacks (multiple tabs per panel, click to switch, close tab).
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
function makeTab(tag, title, state = {}, locked = false) { return { type: 'tab', id: uid(), tag, title, state, el: null, locked }; }

/** Check if a stack is locked (all tabs locked → no drops allowed on it). */
function isStackLocked(stackNode) {
    return stackNode.tabs.length > 0 && stackNode.tabs.every(t => t.locked);
}

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

/* Depth-based visual differentiation for nested layouts */
:host([data-depth="1"]) {
    --sgl-bg: #1E1E32;
    --sgl-surface: #1A2448;
    --sgl-border: #2A3558;
}
:host([data-depth="2"]) {
    --sgl-bg: #22223A;
    --sgl-surface: #1E2850;
    --sgl-border: #323D62;
}
:host([data-depth="3"]) {
    --sgl-bg: #262642;
    --sgl-surface: #222C58;
    --sgl-border: #3A476C;
}
:host([data-depth="4"]) {
    --sgl-bg: #2A2A4A;
    --sgl-surface: #263060;
    --sgl-border: #425076;
}

.sgl-root {
    position: relative;
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

/* Stack container */
.sgl-stack {
    display: flex;
    flex-direction: column;
    flex: 1;
    width: 100%;
    height: 100%;
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
    padding: 0;
    background: var(--sgl-surface);
    border-bottom: 1px solid var(--sgl-border);
    cursor: default;
    user-select: none;
    gap: 0;
    overflow: hidden;
}

/* Tab bar — horizontal strip of tabs inside the stack header */
.sgl-tab-bar {
    display: flex;
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    min-width: 0;
}
.sgl-tab-bar::-webkit-scrollbar { display: none; }

.sgl-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    height: 100%;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 400;
    color: var(--sgl-text-muted);
    cursor: grab;
    border-right: 1px solid var(--sgl-border);
    background: transparent;
    transition: color var(--sgl-transition-speed) ease,
                background var(--sgl-transition-speed) ease;
    flex-shrink: 0;
}
.sgl-tab:hover {
    color: var(--sgl-text);
    background: var(--sgl-surface-hover);
}
.sgl-tab--locked {
    cursor: default;
}
.sgl-tab--locked .sgl-tab-close,
.sgl-tab--no-close .sgl-tab-close {
    display: none;
}
.sgl-tab--active {
    color: var(--sgl-text);
    font-weight: 500;
    background: var(--sgl-bg);
    border-bottom: 2px solid var(--sgl-accent);
}
.sgl-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
}
.sgl-tab-close {
    background: none;
    border: none;
    color: var(--sgl-text-muted);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0 2px;
    border-radius: 3px;
    opacity: 0;
    transition: opacity var(--sgl-transition-speed) ease;
}
.sgl-tab:hover .sgl-tab-close,
.sgl-tab--active .sgl-tab-close {
    opacity: 1;
}
.sgl-tab-close:hover {
    color: var(--sgl-text);
    background: rgba(255,255,255,0.1);
}

/* Single-tab mode — title group keeps title + close together */
.sgl-title-group {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 0 8px;
}
.sgl-stack-title {
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
.sgl-header-close-btn {
    background: none;
    border: none;
    color: var(--sgl-text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 3px;
}
.sgl-header-close-btn:hover {
    background: rgba(255,255,255,0.1);
    color: var(--sgl-text);
}

/* Header actions area (collapse button etc.) — pushed to far right */
.sgl-header-actions {
    display: flex;
    align-items: center;
    padding: 0 4px;
    flex-shrink: 0;
    margin-left: auto;
}

/* Slot wrapper — the portal contract */
.sgl-slot-wrapper {
    display: flex;
    flex: 1;
    width: 100%;
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
    min-height: 0;
    flex-direction: column;
}

/* Only the active tab's slot is visible */
.sgl-slot-wrapper slot {
    display: none;
}
.sgl-slot-wrapper slot.sgl-slot--active {
    display: flex;
    flex: 1;
    min-height: 0;
}

/* Slotted elements fill the entire panel area */
::slotted(*) {
    flex: 1;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
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

/* --- Drag to dock --- */

/* Dragging state on host */
:host(.sgl-dragging) {
    cursor: grabbing;
}

/* Dim the tab being dragged */
.sgl-tab--dragging {
    opacity: 0.3;
}

/* Floating ghost that follows the pointer */
.sgl-drag-ghost {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 500;
    color: var(--sgl-text);
    background: var(--sgl-surface);
    border: 1px solid var(--sgl-accent);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    opacity: 0.85;
    white-space: nowrap;
}

/* Dock overlay — covers the target stack, shows cross indicator */
.sgl-dock-overlay {
    position: absolute;
    z-index: 100;
    pointer-events: none;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    grid-template-rows: 1fr auto 1fr;
    place-items: center;
    padding: 8px;
}

/* The cross container sits in the center of the overlay */
.sgl-dock-cross {
    grid-column: 2;
    grid-row: 2;
    display: grid;
    grid-template-columns: 40px 40px 40px;
    grid-template-rows: 40px 40px 40px;
    gap: 3px;
}

/* Each dock zone indicator */
.sgl-dock-zone {
    border-radius: 4px;
    border: 2px solid rgba(78, 205, 196, 0.35);
    background: rgba(78, 205, 196, 0.08);
    transition: background var(--sgl-transition-speed) ease,
                border-color var(--sgl-transition-speed) ease,
                transform var(--sgl-transition-speed) ease;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Zone icon labels */
.sgl-dock-zone::after {
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
}
.sgl-dock-zone--top::after    { content: '▲'; }
.sgl-dock-zone--left::after   { content: '◀'; }
.sgl-dock-zone--center::after { content: '●'; }
.sgl-dock-zone--right::after  { content: '▶'; }
.sgl-dock-zone--bottom::after { content: '▼'; }

/* Cross layout: top/bottom in center column, left/right on sides */
.sgl-dock-zone--top    { grid-column: 2; grid-row: 1; }
.sgl-dock-zone--left   { grid-column: 1; grid-row: 2; }
.sgl-dock-zone--center { grid-column: 2; grid-row: 2; }
.sgl-dock-zone--right  { grid-column: 3; grid-row: 2; }
.sgl-dock-zone--bottom { grid-column: 2; grid-row: 3; }

/* Active (hovered) zone highlight */
.sgl-dock-zone--active {
    background: rgba(78, 205, 196, 0.35);
    border-color: var(--sgl-accent);
    transform: scale(1.1);
}
.sgl-dock-zone--active::after {
    opacity: 1;
}

/* Full-panel highlight showing where the drop will go */
.sgl-dock-preview {
    position: absolute;
    background: rgba(78, 205, 196, 0.1);
    border: 2px dashed rgba(78, 205, 196, 0.4);
    border-radius: 4px;
    transition: all var(--sgl-transition-speed) ease;
    pointer-events: none;
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

        /** @type {Map<string, SgLayout>} panelId → child SgLayout instance */
        this._childLayouts = new Map();

        /** @type {HTMLElement} Root container in shadow DOM */
        this._rootEl = null;

        /** @type {object|null} In-progress drag state */
        this._dragState = null;

        /** Bound drag handlers (for add/remove on document) */
        this._boundDragMove = this._onDragMove.bind(this);
        this._boundDragEnd  = this._onDragEnd.bind(this);
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
        if (this._dragState) this._cancelDrag();
        this._unmountAll();
        this._nodeElements.clear();
        this._registeredElements.clear();
        this._collapsedStacks.clear();

        // Unregister from parent layout
        if (this._parentLayoutRef) {
            this._parentLayoutRef._childLayouts.delete(this.dataset.panelId);
            this._parentLayoutRef = null;
        }
        this._childLayouts.clear();
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

            // Track child sg-layout instances
            if (event.target instanceof SgLayout) {
                this._childLayouts.set(tab.id, event.target);
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
            // Set data-depth attribute for CSS depth styling
            this.dataset.depth = String(this._depth);
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
     * Multi-tab: shows a tab bar when tabs.length > 1, single title otherwise.
     * @param {object} node
     * @param {string} [parentType]
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

        if (node.tabs.length > 1) {
            // Multi-tab: render a tab bar
            const tabBar = document.createElement('div');
            tabBar.className = 'sgl-tab-bar';

            node.tabs.forEach((tab, i) => {
                tabBar.appendChild(this._renderTabElement(node, tab, i));
            });

            header.appendChild(tabBar);
        } else {
            // Single tab: show title + close button together
            const titleGroup = document.createElement('div');
            titleGroup.className = 'sgl-title-group';
            const title = document.createElement('span');
            title.className = 'sgl-stack-title';
            const activeTab = node.tabs[node.activeTab || 0];
            title.textContent = activeTab?.title || '';
            // Drag initiation from single-tab title (unless locked)
            if (activeTab && !activeTab.locked) {
                title.style.cursor = 'grab';
                title.addEventListener('pointerdown', (e) => {
                    if (e.button !== 0) return;
                    this._onTabPointerDown(e, node, activeTab, title);
                });
            }
            titleGroup.appendChild(title);

            // Close button right next to title
            if (activeTab && !activeTab.locked && activeTab.closable !== false) {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'sgl-header-close-btn';
                closeBtn.textContent = '\u00d7';
                closeBtn.title = 'Close panel';
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._closeTab(node, activeTab);
                });
                titleGroup.appendChild(closeBtn);
            }

            header.appendChild(titleGroup);
        }

        // Header actions (collapse button)
        const actions = document.createElement('div');
        actions.className = 'sgl-header-actions';

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'sgl-collapse-btn';
        collapseBtn.textContent = this._collapsedStacks.has(node.id) ? '+' : '\u2013';
        collapseBtn.title = 'Collapse/expand panel';
        collapseBtn.addEventListener('click', () => this._toggleCollapse(node));
        actions.appendChild(collapseBtn);

        header.appendChild(actions);
        el.appendChild(header);

        // Slot wrapper for hosted content
        const slotWrapper = document.createElement('div');
        slotWrapper.className = 'sgl-slot-wrapper';

        // Create a named slot for each tab — only active one is visible
        node.tabs.forEach((tab, i) => {
            const slot = document.createElement('slot');
            slot.name = `p-${tab.id}`;
            if (i === (node.activeTab || 0)) {
                slot.classList.add('sgl-slot--active');
            }
            slotWrapper.appendChild(slot);
        });

        el.appendChild(slotWrapper);
        return el;
    }

    /**
     * Render a single tab element for the tab bar.
     * @param {object} stackNode  The parent stack node
     * @param {object} tab        The tab data
     * @param {number} index      Tab index within the stack
     * @returns {HTMLElement}
     */
    _renderTabElement(stackNode, tab, index) {
        const tabEl = document.createElement('div');
        tabEl.className = 'sgl-tab';
        tabEl.dataset.tabId = tab.id;
        if (index === (stackNode.activeTab || 0)) {
            tabEl.classList.add('sgl-tab--active');
        }
        const isClosable = !tab.locked && tab.closable !== false;
        if (tab.locked) {
            tabEl.classList.add('sgl-tab--locked');
        }
        if (!isClosable) {
            tabEl.classList.add('sgl-tab--no-close');
        }

        const label = document.createElement('span');
        label.className = 'sgl-tab-label';
        label.textContent = tab.title || tab.tag || 'Tab';
        tabEl.appendChild(label);

        // Close button (hidden if locked or closable === false)
        if (isClosable) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'sgl-tab-close';
            closeBtn.textContent = '\u00d7';
            closeBtn.title = 'Close tab';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._closeTab(stackNode, tab);
            });
            tabEl.appendChild(closeBtn);
        }

        // Click to switch
        tabEl.addEventListener('click', () => {
            if (!this._dragState) this._switchTab(stackNode, index);
        });

        // Drag initiation
        tabEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            this._onTabPointerDown(e, stackNode, tab, tabEl);
        });

        return tabEl;
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

        // Collect non-collapsed, non-fixed sizes and normalise so fr values sum to 1
        // (CSS Grid treats sum < 1 as percentage of free space, not filling it)
        let frTotal = 0;
        node.children.forEach((child, i) => {
            const isCollapsed = child.type === 'stack' && this._collapsedStacks.has(child.id);
            const isFixed = child.fixedSize != null;
            if (!isCollapsed && !isFixed) frTotal += node.sizes[i];
        });
        const scale = frTotal > 0 ? 1 / frTotal : 1;

        const parts = [];
        node.children.forEach((child, i) => {
            const isCollapsed = child.type === 'stack' && this._collapsedStacks.has(child.id);
            if (isCollapsed) {
                parts.push(tabH);
            } else if (child.fixedSize != null) {
                // Fixed size — use the CSS value directly (e.g. '250px', '20%')
                parts.push(String(child.fixedSize));
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
    // Tab switching
    // -----------------------------------------------------------------------

    /**
     * Switch the active tab in a stack.
     * @param {object} stackNode
     * @param {number} newIndex
     */
    _switchTab(stackNode, newIndex) {
        if (newIndex === stackNode.activeTab) return;
        if (newIndex < 0 || newIndex >= stackNode.tabs.length) return;

        stackNode.activeTab = newIndex;

        const stackEl = this._nodeElements.get(stackNode.id);
        if (!stackEl) return;

        // Update tab bar active state
        const tabs = stackEl.querySelectorAll('.sgl-tab');
        tabs.forEach((tabEl, i) => {
            tabEl.classList.toggle('sgl-tab--active', i === newIndex);
        });

        // Update slot visibility
        const slots = stackEl.querySelectorAll('.sgl-slot-wrapper slot');
        slots.forEach((slot, i) => {
            slot.classList.toggle('sgl-slot--active', i === newIndex);
        });

        this._events.emit(SGL_EVENTS.TAB_CHANGED, {
            stackId: stackNode.id,
            tabId: stackNode.tabs[newIndex].id,
        });
        this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
    }

    /**
     * Close a tab in a stack. If last tab, remove the stack from the layout.
     * @param {object} stackNode
     * @param {object} tab
     */
    _closeTab(stackNode, tab) {
        if (tab.locked || tab.closable === false) return;
        const tabIndex = stackNode.tabs.indexOf(tab);
        if (tabIndex === -1) return;

        // Remove element from light DOM
        if (tab.el && tab.el.parentNode === this) {
            this.removeChild(tab.el);
        }
        this._registeredElements.delete(tab.el);

        // Remove from tabs array
        stackNode.tabs.splice(tabIndex, 1);

        if (stackNode.tabs.length === 0) {
            // Stack is empty — remove it from the tree
            this._removeEmptyStack(stackNode.id);
            this._renderTree();
            this._mountAllTabs();
        } else {
            // Adjust activeTab index
            if (stackNode.activeTab >= stackNode.tabs.length) {
                stackNode.activeTab = stackNode.tabs.length - 1;
            } else if (tabIndex < stackNode.activeTab) {
                stackNode.activeTab--;
            }
            // Re-render the stack (tab count may have changed single↔multi)
            this._renderTree();
            this._mountAllTabs();
        }

        this._events.emit(SGL_EVENTS.PANEL_CLOSED, { id: tab.id });
        this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
    }

    /**
     * Remove an empty stack from the tree, cleaning up parent containers.
     * @param {string} stackId
     */
    _removeEmptyStack(stackId) {
        this._removeNodeFromTree(this._tree, stackId);
    }

    /**
     * Remove a node by id from the tree, collapsing single-child containers.
     * @param {object} node
     * @param {string} targetId
     * @returns {boolean} true if removed
     */
    _removeNodeFromTree(node, targetId) {
        if (!node || !node.children) return false;

        for (let i = 0; i < node.children.length; i++) {
            if (node.children[i].id === targetId) {
                node.children.splice(i, 1);
                node.sizes = normaliseSizes(null, node.children.length);

                // If only one child remains and this is the root, promote it
                if (node.children.length === 1 && node === this._tree) {
                    this._tree = node.children[0];
                }
                return true;
            }
            if (this._removeNodeFromTree(node.children[i], targetId)) {
                // Child may now have only one child — promote
                const child = node.children[i];
                if (child.children && child.children.length === 1) {
                    node.children[i] = child.children[0];
                }
                return true;
            }
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // Drag to dock
    // -----------------------------------------------------------------------

    /** Threshold in px before a pointerdown becomes a drag. */
    static DRAG_THRESHOLD = 5;

    /**
     * Handle pointerdown on a tab or single-tab title.
     * Records start position; actual drag starts after threshold movement.
     */
    _onTabPointerDown(e, stackNode, tab, el) {
        if (this._collapsedStacks.has(stackNode.id)) return;
        if (tab.locked) return;
        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;
        let started = false;

        const onMove = (me) => {
            const dx = me.clientX - startX;
            const dy = me.clientY - startY;
            if (!started && Math.sqrt(dx * dx + dy * dy) >= SgLayout.DRAG_THRESHOLD) {
                started = true;
                this._startDrag(stackNode, tab, el, startX, startY);
            }
            if (started) {
                this._onDragMove(me);
            }
        };

        const onUp = (ue) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if (started) {
                this._onDragEnd(ue);
            }
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    /**
     * Initiate a drag operation.
     */
    _startDrag(stackNode, tab, tabEl, startX, startY) {
        // Cache bounding rects of all stacks
        const stackRects = [];
        this._walkTree(this._tree, (node) => {
            if (node.type === 'stack') {
                const el = this._nodeElements.get(node.id);
                if (el && !this._collapsedStacks.has(node.id)) {
                    stackRects.push({ node, el, rect: el.getBoundingClientRect() });
                }
            }
        });

        // Create ghost
        const ghost = document.createElement('div');
        ghost.className = 'sgl-drag-ghost';
        ghost.textContent = tab.title || tab.tag || 'Tab';
        ghost.style.left = startX + 'px';
        ghost.style.top  = (startY - 14) + 'px';
        this.shadowRoot.appendChild(ghost);

        // Dim the original tab
        if (tabEl.classList.contains('sgl-tab')) {
            tabEl.classList.add('sgl-tab--dragging');
        }

        this.classList.add('sgl-dragging');

        this._dragState = {
            tab,
            sourceStackId: stackNode.id,
            sourceStack: stackNode,
            ghost,
            tabEl,
            stackRects,
            overlayEl: null,
            currentTargetStackId: null,
            activeZone: null,
        };

        this._events.emit(SGL_EVENTS.DRAG_START, {
            panelId: tab.id,
            sourceLayoutId: this,
        });
    }

    /**
     * Update ghost position and dock zone overlay during drag.
     */
    _onDragMove(e) {
        const ds = this._dragState;
        if (!ds) return;

        // Move ghost
        ds.ghost.style.left = e.clientX + 'px';
        ds.ghost.style.top  = (e.clientY - 14) + 'px';

        // Hit-test stacks
        const x = e.clientX;
        const y = e.clientY;
        let hit = null;

        for (const entry of ds.stackRects) {
            const r = entry.rect;
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                // Skip locked stacks — they don't accept drops
                if (isStackLocked(entry.node)) continue;
                hit = entry;
                break;
            }
        }

        if (hit) {
            if (ds.currentTargetStackId !== hit.node.id) {
                this._removeDockOverlay();
                ds.currentTargetStackId = hit.node.id;
                this._showDockOverlay(hit.el, hit.rect);
            }
            this._updateDockZoneHighlight(x, y, hit.rect);
        } else {
            if (ds.currentTargetStackId) {
                this._removeDockOverlay();
                ds.currentTargetStackId = null;
                ds.activeZone = null;
            }
        }
    }

    /**
     * Finish the drag — execute dock or cancel.
     */
    _onDragEnd(e) {
        const ds = this._dragState;
        if (!ds) return;

        const zone = ds.activeZone;
        const targetStackId = ds.currentTargetStackId;

        // Clean up visuals first
        this._cleanupDrag();

        if (!zone || !targetStackId) {
            this._events.emit(SGL_EVENTS.DRAG_END, { panelId: ds.tab.id, accepted: false });
            return;
        }

        // Same stack + center = no-op
        if (targetStackId === ds.sourceStackId && zone === 'center') {
            this._events.emit(SGL_EVENTS.DRAG_END, { panelId: ds.tab.id, accepted: false });
            return;
        }

        // Find the target stack node
        const targetStack = this._findNodeById(this._tree, targetStackId);
        if (!targetStack) {
            this._events.emit(SGL_EVENTS.DRAG_END, { panelId: ds.tab.id, accepted: false });
            return;
        }

        this._executeDock(ds.tab, ds.sourceStack, targetStack, zone);
        this._events.emit(SGL_EVENTS.DRAG_END, { panelId: ds.tab.id, accepted: true });
    }

    /**
     * Cancel an in-progress drag.
     */
    _cancelDrag() {
        this._cleanupDrag();
    }

    /**
     * Remove ghost, overlay, and reset drag state.
     */
    _cleanupDrag() {
        const ds = this._dragState;
        if (!ds) return;

        if (ds.ghost?.parentNode) ds.ghost.parentNode.removeChild(ds.ghost);
        if (ds.tabEl) ds.tabEl.classList.remove('sgl-tab--dragging');
        this._removeDockOverlay();
        this.classList.remove('sgl-dragging');
        this._dragState = null;
    }

    /**
     * Show the 5-zone dock overlay on top of a target stack.
     */
    _showDockOverlay(stackEl, rect) {
        const rootRect = this._rootEl.getBoundingClientRect();
        const overlay = document.createElement('div');
        overlay.className = 'sgl-dock-overlay';
        overlay.style.left   = (rect.left - rootRect.left) + 'px';
        overlay.style.top    = (rect.top  - rootRect.top)  + 'px';
        overlay.style.width  = rect.width  + 'px';
        overlay.style.height = rect.height + 'px';

        // Cross container holds the 5 zone indicators
        const cross = document.createElement('div');
        cross.className = 'sgl-dock-cross';

        const zones = ['top', 'left', 'center', 'right', 'bottom'];
        for (const z of zones) {
            const zoneEl = document.createElement('div');
            zoneEl.className = `sgl-dock-zone sgl-dock-zone--${z}`;
            zoneEl.dataset.zone = z;
            cross.appendChild(zoneEl);
        }

        // Preview element shows where the panel will land
        const preview = document.createElement('div');
        preview.className = 'sgl-dock-preview';
        overlay.appendChild(preview);

        overlay.appendChild(cross);
        this._rootEl.appendChild(overlay);
        if (this._dragState) {
            this._dragState.overlayEl = overlay;
            this._dragState.previewEl = preview;
        }
    }

    /**
     * Highlight the active dock zone based on pointer position.
     */
    _updateDockZoneHighlight(x, y, rect) {
        const ds = this._dragState;
        if (!ds?.overlayEl) return;

        const relX = (x - rect.left) / rect.width;
        const relY = (y - rect.top)  / rect.height;

        let zone;
        if (relY < 0.25)      zone = 'top';
        else if (relY > 0.75) zone = 'bottom';
        else if (relX < 0.25) zone = 'left';
        else if (relX > 0.75) zone = 'right';
        else                  zone = 'center';

        if (zone !== ds.activeZone) {
            ds.activeZone = zone;
            const zoneEls = ds.overlayEl.querySelectorAll('.sgl-dock-zone');
            zoneEls.forEach(el => {
                el.classList.toggle('sgl-dock-zone--active', el.dataset.zone === zone);
            });

            // Update preview highlight to show where the panel will land
            const preview = ds.previewEl;
            if (preview) {
                const w = rect.width;
                const h = rect.height;
                const inset = 4;
                switch (zone) {
                    case 'top':
                        preview.style.cssText = `left:${inset}px; top:${inset}px; width:${w - inset*2}px; height:${h/2 - inset}px;`;
                        break;
                    case 'bottom':
                        preview.style.cssText = `left:${inset}px; top:${h/2}px; width:${w - inset*2}px; height:${h/2 - inset}px;`;
                        break;
                    case 'left':
                        preview.style.cssText = `left:${inset}px; top:${inset}px; width:${w/2 - inset}px; height:${h - inset*2}px;`;
                        break;
                    case 'right':
                        preview.style.cssText = `left:${w/2}px; top:${inset}px; width:${w/2 - inset}px; height:${h - inset*2}px;`;
                        break;
                    case 'center':
                        preview.style.cssText = `left:${inset}px; top:${inset}px; width:${w - inset*2}px; height:${h - inset*2}px;`;
                        break;
                }
            }
        }
    }

    /**
     * Remove the dock overlay.
     */
    _removeDockOverlay() {
        const ds = this._dragState;
        if (ds?.overlayEl?.parentNode) {
            ds.overlayEl.parentNode.removeChild(ds.overlayEl);
            ds.overlayEl = null;
            ds.previewEl = null;
        }
    }

    /**
     * Execute the dock: move a tab to a new location in the tree.
     * @param {object} tab         The tab being dragged
     * @param {object} sourceStack The stack it came from
     * @param {object} targetStack The stack it's being docked to
     * @param {string} zone        'center'|'left'|'right'|'top'|'bottom'
     */
    _executeDock(tab, sourceStack, targetStack, zone) {
        // 1. Remove tab from source stack
        const tabIndex = sourceStack.tabs.indexOf(tab);
        if (tabIndex === -1) return;

        sourceStack.tabs.splice(tabIndex, 1);

        // Fix activeTab on source
        if (sourceStack.tabs.length > 0) {
            if (sourceStack.activeTab >= sourceStack.tabs.length) {
                sourceStack.activeTab = sourceStack.tabs.length - 1;
            }
        }

        // 2. Dock based on zone
        if (zone === 'center') {
            // Add as new tab in target stack
            targetStack.tabs.push(tab);
            targetStack.activeTab = targetStack.tabs.length - 1;
        } else {
            // Split: create a new stack for the dragged tab
            const newStack = makeStack([tab]);

            // Determine split direction
            const isHorizontal = (zone === 'left' || zone === 'right');
            const containerType = isHorizontal ? 'row' : 'column';
            const insertBefore = (zone === 'left' || zone === 'top');

            this._insertNodeBesideTarget(targetStack.id, newStack, containerType, insertBefore);
        }

        // 3. Clean up empty source stack
        if (sourceStack.tabs.length === 0) {
            this._removeEmptyStack(sourceStack.id);
        }

        // 4. Re-render
        this._renderTree();
        this._mountAllTabs();
        this._events.emit(SGL_EVENTS.LAYOUT_CHANGED, { tree: this.getLayout() });
    }

    /**
     * Insert a node beside a target node in the tree, creating or extending a row/column container.
     * @param {string} targetId       The id of the target node
     * @param {object} newNode        The new node to insert
     * @param {string} containerType  'row' or 'column'
     * @param {boolean} insertBefore  true to insert before the target, false for after
     */
    _insertNodeBesideTarget(targetId, newNode, containerType, insertBefore) {
        // Special case: target is the root
        if (this._tree.id === targetId) {
            const oldRoot = this._tree;
            const children = insertBefore ? [newNode, oldRoot] : [oldRoot, newNode];
            this._tree = {
                type: containerType,
                id: uid(),
                sizes: normaliseSizes(null, 2),
                children,
            };
            return;
        }

        // Find parent of target
        const parent = this._findParentNode(this._tree, targetId);
        if (!parent) return;

        const idx = parent.children.findIndex(c => c.id === targetId);
        if (idx === -1) return;

        // If parent is already the same container type, insert as sibling
        if (parent.type === containerType) {
            const insertIdx = insertBefore ? idx : idx + 1;
            parent.children.splice(insertIdx, 0, newNode);
            // Redistribute sizes evenly
            parent.sizes = normaliseSizes(null, parent.children.length);
        } else {
            // Wrap the target in a new container
            const target = parent.children[idx];
            const children = insertBefore ? [newNode, target] : [target, newNode];
            const wrapper = {
                type: containerType,
                id: uid(),
                sizes: normaliseSizes(null, 2),
                children,
            };
            parent.children[idx] = wrapper;
        }
    }

    /**
     * Walk all nodes in the tree (not just tabs).
     * @param {object} node
     * @param {function} visitor
     */
    _walkTree(node, visitor) {
        if (!node) return;
        visitor(node);
        if (node.children) {
            node.children.forEach(c => this._walkTree(c, visitor));
        }
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

        // If either neighbor has fixedSize, disable resizing for this handle
        const leftChild  = parentNode.children[index];
        const rightChild = parentNode.children[index + 1];
        if (leftChild?.fixedSize != null || rightChild?.fixedSize != null) {
            handle.style.pointerEvents = 'none';
            handle.style.cursor = 'default';
            return handle;
        }

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

        // For nested sg-layout: pass the layout tree via attribute before connecting
        if (tab.tag === 'sg-layout' && tab.state?.layout) {
            el.setAttribute('layout', JSON.stringify(tab.state.layout));
        }

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
     * Find a node by id anywhere in the tree.
     * @param {object} node
     * @param {string} id
     * @returns {object|null}
     */
    _findNodeById(node, id) {
        if (!node) return null;
        if (node.id === id) return node;
        if (node.children) {
            for (const child of node.children) {
                const found = this._findNodeById(child, id);
                if (found) return found;
            }
        }
        return null;
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
     * Handles both single-tab (title span) and multi-tab (tab bar label) modes.
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

        // Single-tab mode: update the title span
        const titleEl = stackEl.querySelector('.sgl-stack-title');
        if (titleEl) {
            titleEl.textContent = tab.title;
            return;
        }

        // Multi-tab mode: update the tab label
        const tabEl = stackEl.querySelector(`.sgl-tab[data-tab-id="${tab.id}"]`);
        if (tabEl) {
            const label = tabEl.querySelector('.sgl-tab-label');
            if (label) label.textContent = tab.title;
        }
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
            !!config.locked,
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
     * Add a tab to an existing stack.
     * @param {string} stackId  The id of the stack node
     * @param {object} config   { tag, title, state, el }
     * @param {boolean} [activate=true]  Whether to switch to the new tab
     * @returns {string|null}  The new tab id, or null if stack not found
     */
    addTabToStack(stackId, config, activate = true) {
        const stack = this._findNodeById(this._tree, stackId);
        if (!stack || stack.type !== 'stack') return null;

        const tab = makeTab(
            config.tag || config.el?.tagName?.toLowerCase() || 'div',
            config.title || config.tag || 'Tab',
            config.state || {},
            !!config.locked,
        );
        if (config.el) tab.el = config.el;

        stack.tabs.push(tab);

        if (activate) {
            stack.activeTab = stack.tabs.length - 1;
        }

        // Re-render to update tab bar
        this._renderTree();
        this._mountAllTabs();

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

    /**
     * Lock a panel so it cannot be dragged, dropped onto, or closed.
     * @param {string} id  Panel/tab id
     */
    lockPanel(id) {
        this._walkTabs(this._tree, tab => {
            if (tab.id === id) {
                tab.locked = true;
                this._renderTree();
                this._mountAllTabs();
            }
        });
    }

    /**
     * Unlock a previously locked panel.
     * @param {string} id  Panel/tab id
     */
    unlockPanel(id) {
        this._walkTabs(this._tree, tab => {
            if (tab.id === id) {
                tab.locked = false;
                this._renderTree();
                this._mountAllTabs();
            }
        });
    }

    /**
     * Check if a panel is locked.
     * @param {string} id  Panel/tab id
     * @returns {boolean}
     */
    isPanelLocked(id) {
        let locked = false;
        this._walkTabs(this._tree, tab => {
            if (tab.id === id) locked = !!tab.locked;
        });
        return locked;
    }

    // -----------------------------------------------------------------------
    // Fractal API (nested layouts)
    // -----------------------------------------------------------------------

    /**
     * Get all child sg-layout instances registered within this layout.
     * @returns {Map<string, SgLayout>} panelId → child SgLayout
     */
    getChildLayouts() {
        return new Map(this._childLayouts);
    }

    /**
     * Get the parent sg-layout instance, if this layout is nested.
     * @returns {SgLayout|null}
     */
    getParentLayout() {
        return this._parentLayoutRef;
    }

    /**
     * Get the nesting depth (0 = root layout).
     * @returns {number}
     */
    getDepth() {
        return this._depth;
    }

    /**
     * Walk the entire fractal tree (this layout + all nested child layouts).
     * Calls visitor(layout, depth) for each sg-layout instance.
     * @param {function} visitor  Called with (sgLayoutInstance, depth)
     */
    walkLayouts(visitor) {
        visitor(this, this._depth);
        for (const [, child] of this._childLayouts) {
            child.walkLayouts(visitor);
        }
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
            let state = (typeof node.el?.getLayoutState === 'function')
                ? node.el.getLayoutState()
                : (node.state || {});

            // Capture nested sg-layout tree in state
            if (node.el instanceof SgLayout) {
                state = { ...state, layout: node.el.getLayout() };
            }

            const out = { type: 'tab', id: node.id, title: node.title, tag: node.tag, state };
            if (node.locked) out.locked = true;
            if (node.closable === false) out.closable = false;
            return out;
        }
        if (node.type === 'stack') {
            const stackOut = {
                type: 'stack', id: node.id,
                activeTab: node.activeTab,
                tabs: node.tabs.map(t => this._serializeNode(t)),
            };
            if (node.fixedSize != null) stackOut.fixedSize = node.fixedSize;
            return stackOut;
        }
        const containerOut = {
            type: node.type, id: node.id,
            sizes: [...node.sizes],
            children: node.children.map(c => this._serializeNode(c)),
        };
        if (node.fixedSize != null) containerOut.fixedSize = node.fixedSize;
        return containerOut;
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
