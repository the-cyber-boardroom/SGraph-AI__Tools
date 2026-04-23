# sg-tree v0.1.2 — Virtual Scrolling

Surgical override layer on top of v0.1.1 (or v0.1.0). Replaces `_renderVisibleRows` with a virtual scroll implementation that recycles a fixed pool of DOM row elements instead of creating/destroying rows on every render.

---

## Scope

Virtual scrolling for large trees (thousands of nodes). Only the rows currently visible in the viewport are in the DOM at any time. Row elements are recycled from a pool.

---

## File

`sg-tree--v0.1.2.js`

---

## Override pattern

```js
window._SgTreeQ = window._SgTreeQ || [];
window._SgTreeQ.push(SgTree => {
    SgTree.prototype._renderVisibleRows = function() { /* virtual scroll */ };
    SgTree.prototype._onScroll          = function() { /* recalculate _visibleRange */ };

    // Patch connectedCallback to wire scroll listener
    const _origConnected = SgTree.prototype.connectedCallback;
    SgTree.prototype.connectedCallback = function() {
        _origConnected.call(this);
        this._viewport.addEventListener('scroll', () => this._onScroll());
    };
});
```

---

## Methods overridden / added

| Method | Action |
|--------|--------|
| `_renderVisibleRows()` | Virtual scroll: renders only rows in `_visibleRange`, recycles pool |
| `_onScroll()` | Called on viewport scroll; recalculates `_visibleRange`, updates pool |
| `_visibleRange` | `{ start, end }` — indices into `this._visible` currently in DOM |

---

## Internal properties required from v0.1.0

| Property | Purpose |
|----------|---------|
| `this._rowHeight` | Row height in pixels (default 28). Used to compute scroll offsets and visible range. |
| `this._visible` | Flat visible list. Length × `_rowHeight` = total scroll height. |
| `this._viewport` | The scrollable container element. |
| `this._renderRow(node, depth, path)` | Called for each recycled row to (re)populate it. |

---

## New events

None.

---

## Acceptance criteria

- [ ] Trees with 10,000+ nodes scroll smoothly (60fps target)
- [ ] DOM never contains more rows than `ceil(viewportHeight / _rowHeight) + 2` buffer rows
- [ ] `scrollTo(id)` works correctly in virtual scroll mode
- [ ] `getScrollTop()` / `setScrollTop()` round-trip correctly
- [ ] Keyboard navigation (ArrowUp/Down) works across virtual boundary
- [ ] All v0.1.0 and v0.1.1 tests still pass

---

## Test file

`tests/sg-tree/v0.1.2.test.html`
