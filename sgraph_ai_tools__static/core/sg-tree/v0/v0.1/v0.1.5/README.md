# sg-tree v0.1.5 — Cross-Tree Drag

Surgical override layer on top of v0.1.4. Extends drag-and-drop to work across multiple `<sg-tree>` instances on the same page, including trees inside different sg-layout panels.

---

## Scope

Cross-boundary drag-and-drop. A node dragged from one tree can be dropped into a different tree. New events are added to coordinate the source and target trees.

---

## File

`sg-tree--v0.1.5.js`

Also requires: `sg-tree-events--v0.1.5.js` (new event constants)

---

## Override pattern

```js
// Must load sg-tree-events--v0.1.5.js first to get SGT_EVENTS_V015
import { SGT_EVENTS_V015 } from '../v0.1.5/sg-tree-events--v0.1.5.js';

window._SgTreeQ = window._SgTreeQ || [];
window._SgTreeQ.push(SgTree => {
    const _origOnDragStart = SgTree.prototype._onDragStart;
    SgTree.prototype._onDragStart = function(e, node) {
        _origOnDragStart.call(this, e, node);
        // Tag the drag with a cross-tree payload
        e.dataTransfer.setData('application/sg-tree-node', JSON.stringify({
            sourceTreeId: this.id || this._instanceId,
            nodeId: node.id,
        }));
        this._dispatch(SGT_EVENTS_V015.DRAG_START, { id: node.id, node });
    };

    const _origOnDrop = SgTree.prototype._onDrop;
    SgTree.prototype._onDrop = function(e, targetNode) {
        const payload = e.dataTransfer.getData('application/sg-tree-node');
        if (!payload) { _origOnDrop.call(this, e, targetNode); return; }
        const { sourceTreeId, nodeId } = JSON.parse(payload);
        if (sourceTreeId === (this.id || this._instanceId)) {
            _origOnDrop.call(this, e, targetNode); // same tree
        } else {
            this._onCrossDrop(e, targetNode, sourceTreeId, nodeId);
        }
    };

    SgTree.prototype._onCrossDrop = function(e, targetNode, sourceTreeId, nodeId) { /* ... */ };
});
```

---

## Methods overridden / added

| Method | Action |
|--------|--------|
| `_onDragStart(e, node)` | Extends v0.1.4; adds `application/sg-tree-node` MIME type to drag data; dispatches `DRAG_START` |
| `_onDrop(e, targetNode)` | Extends v0.1.4; detects cross-tree drops and routes to `_onCrossDrop` |
| `_onCrossDrop(e, targetNode, sourceTreeId, nodeId)` | Handles cross-tree node transfer; dispatches `NODE_MOVED_OUT` on source, `NODE_MOVED_IN` on target |

---

## New events (in `sg-tree-events--v0.1.5.js`)

```js
export const SGT_EVENTS_V015 = Object.freeze({
    DRAG_START:     'sg-tree:drag-start',     // { id, node } — fired on source tree
    DRAG_END:       'sg-tree:drag-end',       // { id } — fired on source tree
    NODE_MOVED_OUT: 'sg-tree:node-moved-out', // { id, node, targetTreeId } — fired on source tree
    NODE_MOVED_IN:  'sg-tree:node-moved-in',  // { id, node, sourceTreeId } — fired on target tree
});
```

---

## Acceptance criteria

- [ ] Drag from Tree A, drop into Tree B: node appears in Tree B
- [ ] Source tree fires `NODE_MOVED_OUT` with correct `targetTreeId`
- [ ] Target tree fires `NODE_MOVED_IN` with correct `sourceTreeId`
- [ ] Both trees fire `DATA_CHANGED` after cross-tree drop
- [ ] Same-tree drops (v0.1.4 behaviour) still work unchanged
- [ ] `application/sg-tree-node` MIME type used for cross-tree identification
- [ ] Works across sg-layout panel boundaries (Shadow DOM composed)

---

## Test file

`tests/sg-tree/v0.1.5.test.html`
