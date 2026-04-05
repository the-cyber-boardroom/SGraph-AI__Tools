# sg-tree v0.1.3 — Multi-Select

Surgical override layer on top of v0.1.2 (or v0.1.0). Adds multi-selection via Shift+click (range), Ctrl+click (toggle), and Space (toggle focused node).

---

## Scope

Multi-select mode. When `selectable="multi"`:
- Shift+click selects a contiguous range from last selected to clicked node
- Ctrl+click (or Cmd+click on Mac) toggles individual nodes in/out of selection
- Space toggles the focused node in/out of selection
- `getSelectedIds()` returns all selected ids
- `getSelectedId()` still returns the first selected id (backwards compatible)

---

## File

`sg-tree--v0.1.3.js`

---

## Override pattern

```js
window._SgTreeQ = window._SgTreeQ || [];
window._SgTreeQ.push(SgTree => {
    // Replace single _selectedId with a Set
    const _origSetData = SgTree.prototype.setData;
    SgTree.prototype.setData = function(root) {
        this._selectedIds = new Set();
        _origSetData.call(this, root);
    };

    SgTree.prototype._onRowClick = function(e) { /* Shift/Ctrl handling */ };
    SgTree.prototype._onKeydown  = function(e) { /* extends base; Space = toggle */ };
    SgTree.prototype.selectAll   = function()  { /* ... */ };
    SgTree.prototype.deselectAll = function()  { /* ... */ };
    SgTree.prototype.getSelectedIds = function() { return Array.from(this._selectedIds); };

    // Backwards-compat: getSelectedId returns first
    SgTree.prototype.getSelectedId = function() {
        return this._selectedIds.size ? this._selectedIds.values().next().value : null;
    };
});
```

---

## Methods overridden / added

| Method | Action |
|--------|--------|
| `_onRowClick(e)` | Shift+click → range select; Ctrl+click → toggle; plain click → single |
| `_onKeydown(e)` | Extends base; Space = toggle focused node |
| `_selectedIds` | `Set<string>` — replaces `_selectedId` string for multi mode |
| `selectAll()` | Select all non-disabled visible nodes |
| `deselectAll()` | Clear all selections |
| `getSelectedIds()` | `string[]` — all currently selected ids |
| `getSelectedId()` | `string|null` — first selected id (backwards compatible) |

---

## New events

None (uses existing `SELECTION_CHANGED` with full `selectedIds` array).

---

## Acceptance criteria

- [ ] `selectable="single"` still works exactly as v0.1.0
- [ ] `selectable="multi"`: plain click = single select
- [ ] `selectable="multi"`: Shift+click selects contiguous range
- [ ] `selectable="multi"`: Ctrl/Cmd+click toggles individual node
- [ ] Space toggles focused node in multi mode
- [ ] `selectAll()` selects all non-disabled visible nodes
- [ ] `deselectAll()` clears selection
- [ ] `getSelectedIds()` returns correct array
- [ ] `getSelectedId()` returns first selected (backwards compat)
- [ ] `SELECTION_CHANGED` fires with full `selectedIds` array
- [ ] `this._visible` is used for range calculation (v0.1.2 compat)

---

## Test file

`tests/sg-tree/v0.1.3.test.html`
