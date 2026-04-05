# sg-tree v0.1.6 — Connectors + Custom Sort + Filter Enhancement

Surgical override layer on top of v0.1.5 (or v0.1.0). Adds connector lines between tree nodes (L-shaped guide lines), activates `sortFn` via `_buildVisibleList`, and optionally enhances the `filter(fn)` API with match highlighting.

---

## Scope

Visual connectors (CSS line art linking parent–child nodes), full `sortFn` wiring into `_buildVisibleList`, and optional filter enhancements (highlight matched text, expand-to-match behaviour).

Note: basic `filter(fn)` is already in v0.1.0. v0.1.6 can enhance it (highlight, debounce) or leave it unchanged.

---

## File

`sg-tree--v0.1.6.js`

---

## Override pattern

```js
window._SgTreeQ = window._SgTreeQ || [];
window._SgTreeQ.push(SgTree => {
    // Override _renderRow to inject connector elements
    const _origRenderRow = SgTree.prototype._renderRow;
    SgTree.prototype._renderRow = function(node, depth, path) {
        const row = _origRenderRow.call(this, node, depth, path);
        this._injectConnectors(row, node, depth, path);
        return row; // MUST return element
    };

    SgTree.prototype._injectConnectors = function(row, node, depth, path) {
        // Inject connector line elements based on depth and last-child status
    };

    // Override _buildVisibleList to add full sortFn support
    const _origBuildVisible = SgTree.prototype._buildVisibleList;
    SgTree.prototype._buildVisibleList = function() {
        // Identical logic but ensures sortFn is always applied at every level
        // (v0.1.0 already does this; v0.1.6 may refine or extend the behaviour)
        return _origBuildVisible.call(this);
    };

    // Optional: filter highlight
    SgTree.prototype._highlightMatch = function(label, query) { /* ... */ };
});
```

---

## Methods overridden / added

| Method | Action |
|--------|--------|
| `_renderRow(node, depth, path)` | Extends to inject connector `<span>` elements; calls super and returns element |
| `_injectConnectors(row, node, depth, path)` | Adds `.sgt-connector` spans for vertical and horizontal guide lines |
| `_buildVisibleList()` | May extend v0.1.0 base to pass `isLastChild` metadata to rows for correct connector rendering |
| `_highlightMatch(label, query)` | Optional: wraps matched substring in `<mark>` for filter highlight |

---

## CSS additions

New CSS custom property:

```css
:host {
    --sgt-connector-color: rgba(255, 255, 255, 0.06); /* already in v0.1.0 theme */
}
```

Connector elements:

```
.sgt-connector-v  — vertical line segment (top to bottom of row)
.sgt-connector-h  — horizontal line segment (to node)
.sgt-connector-corner — L-shape corner for last child
```

---

## New events

None.

---

## Acceptance criteria

- [ ] Connector lines appear between parent and child nodes
- [ ] Last child in a group gets an L-shaped connector (not straight line)
- [ ] Connectors use `--sgt-connector-color` CSS custom property
- [ ] Connectors align correctly with indentation at each depth level
- [ ] `sortFn` is applied at every tree level when set
- [ ] Default sort (null sortFn): folders first, then alphabetical — unchanged
- [ ] `filter(fn)` still works (v0.1.0 behaviour preserved)
- [ ] Optional: filter match highlighting with `<mark>` elements
- [ ] `_renderRow` still returns the element

---

## Test file

`tests/sg-tree/v0.1.6.test.html`
