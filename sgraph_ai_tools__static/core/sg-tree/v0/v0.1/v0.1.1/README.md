# sg-tree v0.1.1 — Editor Mode

Surgical override layer on top of v0.1.0. Adds inline rename, delete, create-folder, and add-files affordances when `editable="true"`.

---

## Scope

Adds editor mode to the tree. When `editable="true"` attribute is set:
- Each row gets an edit affordance (pencil icon / hover button)
- F2 on focused row starts inline rename
- Delete key on focused row triggers delete confirmation
- Toolbar or context menu can trigger `_createFolder` and `_addFiles`

---

## File

`sg-tree--v0.1.1.js`

---

## Override pattern

Imports and extends v0.1.0:

```js
import { SgTree } from '../v0.1.0/sg-tree.js';
import { SGT_EVENTS } from '../v0.1.0/sg-tree-events.js';

window._SgTreeQ = window._SgTreeQ || [];
window._SgTreeQ.push(SgTree => {
    SgTree.prototype._renderRow = function(node, depth, path) { /* ... */ };
    SgTree.prototype._onKeydown = function(e) { /* calls super pattern, then F2/Delete */ };
    SgTree.prototype._startRename  = function(id) { /* ... */ };
    SgTree.prototype._commitRename = function(id, newLabel) { /* ... */ };
    SgTree.prototype._deleteNode   = function(id) { /* ... */ };
    SgTree.prototype._createFolder = function(parentId, label) { /* ... */ };
    SgTree.prototype._addFiles     = function(parentId, fileList) { /* ... */ };
});
```

---

## Methods overridden / added

| Method | Action |
|--------|--------|
| `_renderRow(node, depth, path)` | Injects edit affordances into row; MUST still return the element |
| `_onKeydown(e)` | Extends base: F2 → `_startRename`, Delete → `_deleteNode` |
| `_startRename(id)` | Shows inline text input over the label span |
| `_commitRename(id, newLabel)` | Updates node label in `_data`, dispatches `DATA_CHANGED` |
| `_deleteNode(id)` | Removes node from `_data`, dispatches `DATA_CHANGED` |
| `_createFolder(parentId, label)` | Inserts new folder node, dispatches `DATA_CHANGED` |
| `_addFiles(parentId, fileList)` | Inserts file nodes from a FileList, dispatches `DATA_CHANGED` |

---

## Events used

Uses `DATA_CHANGED` from v0.1.0's SGT_EVENTS. No new events in v0.1.1.

---

## New events

None.

---

## Acceptance criteria

- [ ] `editable="true"` attribute enables editor mode (no attribute = read-only)
- [ ] F2 on focused row shows inline rename input
- [ ] Escape cancels rename without change
- [ ] Enter commits rename, dispatches `DATA_CHANGED`
- [ ] Delete key on non-root node removes it and its subtree
- [ ] `_createFolder(parentId, label)` inserts folder and re-renders
- [ ] `_addFiles(parentId, fileList)` inserts file nodes for each file
- [ ] `_renderRow` still returns the element (v0.1.2 depends on this contract)
- [ ] All v0.1.0 tests still pass when v0.1.1 is loaded

---

## Test file

`tests/sg-tree/v0.1.1.test.html`
