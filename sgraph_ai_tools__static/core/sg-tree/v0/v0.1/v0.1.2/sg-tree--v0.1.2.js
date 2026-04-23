/**
 * sg-tree--v0.1.2.js
 * Surgical override: Virtual Scrolling
 *
 * Replaces _renderVisibleRows with a virtual scroll implementation.
 * Only rows currently visible in the viewport (plus a buffer) exist in the DOM.
 * Scroll events trigger a lightweight re-render of the visible window — the
 * expensive _buildVisibleList() is NOT called on scroll.
 *
 * Performance target: 10,000+ nodes scrolling at 60 fps.
 *
 * Load order: import this module; it imports v0.1.1 which imports v0.1.0.
 *
 * Usage (full stack):
 *   import '../v0.1.2/sg-tree--v0.1.2.js';
 *
 * Usage (v0.1.2 only, skipping editor):
 *   import '../v0.1.0/sg-tree.js';
 *   import '../v0.1.2/sg-tree--v0.1.2.js';
 *
 * @module sg-tree--v0.1.2
 * @requires ../v0.1.1/sg-tree--v0.1.1.js
 */

import '../v0.1.1/sg-tree--v0.1.1.js';
import { SgTree } from '../v0.1.0/sg-tree.js';

// ---------------------------------------------------------------------------
// Override: connectedCallback — wire scroll listener
// ---------------------------------------------------------------------------

const _origConnected12 = SgTree.prototype.connectedCallback;

/**
 * Extends connectedCallback to wire the scroll listener on the viewport.
 */
SgTree.prototype.connectedCallback = function() {
    _origConnected12.call(this);
    if (!this._vsScrollBound) {
        this._vsScrollBound = true;
        this._viewport.addEventListener('scroll', () => this._onScroll(), { passive: true });
    }
    this._visibleRange = { start: 0, end: 0 };
};

// ---------------------------------------------------------------------------
// Override: _renderVisibleRows — virtual scrolling implementation
// ---------------------------------------------------------------------------

/**
 * Renders only the rows currently in the viewport window plus a small buffer.
 * Uses top/bottom spacer divs to maintain correct scrollbar thumb size.
 *
 * Overrides v0.1.0's full-DOM render. Called by _render() and _onScroll().
 */
SgTree.prototype._renderVisibleRows = function() {
    const total = this._visible.length;

    if (total === 0) {
        this._viewport.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'sgt-empty';
        empty.textContent = 'No items';
        this._viewport.appendChild(empty);
        this._visibleRange = { start: 0, end: 0 };
        return;
    }

    const rowH    = this._rowHeight;       // 28px default (from v0.1.0)
    const viewH   = this._viewport.clientHeight || 400;
    const scrollT = this._viewport.scrollTop;
    const buffer  = 4;                     // extra rows above/below viewport

    const startIdx = Math.max(0, Math.floor(scrollT / rowH) - buffer);
    const endIdx   = Math.min(total, Math.ceil((scrollT + viewH) / rowH) + buffer);

    this._visibleRange = { start: startIdx, end: endIdx };

    const topH    = startIdx * rowH;
    const bottomH = (total - endIdx) * rowH;

    this._viewport.innerHTML = '';

    // Top spacer (pushes rendered rows to correct scroll position)
    if (topH > 0) {
        const spacer = document.createElement('div');
        spacer.style.cssText = `height:${topH}px;flex-shrink:0;`;
        this._viewport.appendChild(spacer);
    }

    // Render visible window
    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
        const { node, depth, path } = this._visible[i];
        frag.appendChild(this._renderRow(node, depth, path));
    }
    this._viewport.appendChild(frag);

    // Bottom spacer (maintains correct total scroll height)
    if (bottomH > 0) {
        const spacer = document.createElement('div');
        spacer.style.cssText = `height:${bottomH}px;flex-shrink:0;`;
        this._viewport.appendChild(spacer);
    }
};

// ---------------------------------------------------------------------------
// New method: _onScroll — re-render visible window on scroll
// ---------------------------------------------------------------------------

/**
 * Called on viewport scroll. Re-renders the visible row window without
 * rebuilding _visible (which is expensive for large trees).
 */
SgTree.prototype._onScroll = function() {
    if (!this._visible || !this._visible.length) return;
    this._renderVisibleRows();
};

// ---------------------------------------------------------------------------
// Override: scrollTo — works correctly in virtual scroll mode
// ---------------------------------------------------------------------------

const _origScrollTo12 = SgTree.prototype.scrollTo;

/**
 * Scroll a node into view in virtual scroll mode.
 * If the node row is not currently in the DOM (outside virtual window),
 * calculate the target scroll offset and set it directly.
 * @param {string} id
 */
SgTree.prototype.scrollTo = function(id) {
    const idx = this._visible ? this._visible.findIndex(v => v.node.id === id) : -1;
    if (idx === -1) return;

    // Check if the row is currently rendered
    const row = this._viewport.querySelector(`.sgt-row[data-id="${CSS.escape(id)}"]`);
    if (row) {
        row.scrollIntoView({ block: 'nearest' });
        return;
    }

    // Row is outside the virtual window — jump scroll position to it
    const rowH   = this._rowHeight;
    const viewH  = this._viewport.clientHeight || 400;
    const targetTop = idx * rowH;
    const currentTop = this._viewport.scrollTop;

    if (targetTop < currentTop) {
        this._viewport.scrollTop = targetTop;
    } else if (targetTop + rowH > currentTop + viewH) {
        this._viewport.scrollTop = targetTop - viewH + rowH;
    }
    // After repositioning scroll, re-render the window
    this._renderVisibleRows();
};
