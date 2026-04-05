# sg-tree v0.1.4 — Drag-and-Drop (Within Tree)

Surgical override layer on top of v0.1.3 (or v0.1.0). Adds drag-and-drop reordering and reparenting of nodes within a single tree.

---

## Scope

Intra-tree drag-and-drop. Nodes can be dragged to reorder within a parent or to reparent into a different folder. A drop indicator line shows the insertion point. On drop, `DATA_CHANGED` is emitted with the updated tree.

---

## File

`sg-tree--v0.1.4.js`

---

## Override pattern

```js
window._SgTreeQ = window._SgTreeQ || [];
window._SgTreeQ.push(SgTree => {
    const _origRenderRow = SgTree.prototype._renderRow;
    SgTree.prototype._renderRow = function(node, depth, path) {
        const row = _origRenderRow.call(this, node, depth, path);
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', e => this._onDragStart(e, node));
        row.addEventListener('dragover',  e => this._onDragOver(e, node));
        row.addEventListener('drop',      e => this._onDrop(e, node));
        row.addEventListener('dragend',   e => this._onDragEnd(e));
        return row; // MUST return element
    };

    SgTree.prototype._onDragStart  = function(e, node) { /* ... */ };
    SgTree.prototype._onDragOver   = function(e, node) { /* show drop indicator */ };
    SgTree.prototype._onDrop       = function(e, node) { /* mutate _data, dispatch DATA_CHANGED */ };
    SgTree.prototype._onDragEnd    = function(e)       { /* cleanup indicator */ };
    SgTree.prototype._dropIndicator = null; // DOM element for the drop line
});
```

---

## Methods overridden / added

| Method | Action |
|--------|--------|
| `_renderRow(node, depth, path)` | Adds `draggable="true"` and pointer event listeners; calls super and returns element |
| `_onDragStart(e, node)` | Stores dragged node id; sets drag data |
| `_onDragOver(e, node)` | Calculates drop position (before/into/after), shows `_dropIndicator` |
| `_onDrop(e, node)` | Mutates `_data` tree, re-renders, dispatches `DATA_CHANGED` |
| `_onDragEnd(e)` | Removes `_dropIndicator`, resets drag state |
| `_dropIndicator` | DOM element (absolute-positioned line) showing insertion point |

---

## New events

None (uses existing `DATA_CHANGED` from v0.1.0).

---

## Acceptance criteria

- [ ] Drag handle / draggable row attribute set correctly
- [ ] Drop indicator line appears at correct position during drag
- [ ] Dropping before a node inserts it before that sibling
- [ ] Dropping into a folder (on the node itself) reparents as last child
- [ ] Dropping after a node inserts it after that sibling
- [ ] Cannot drop a node into its own descendant
- [ ] Cannot drop root node
- [ ] `DATA_CHANGED` fires with updated tree after drop
- [ ] `_renderRow` still returns the element (v0.1.5 compat)
- [ ] Touch drag is NOT required in v0.1.4 (mouse/pointer only)

---

## Test file

`tests/sg-tree/v0.1.4.test.html`
