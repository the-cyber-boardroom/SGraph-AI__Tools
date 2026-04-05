# sg-tree v0.1.0

Standalone vanilla JS + Web Components tree view. Zero dependencies. ES module. Shadow DOM. Flat row rendering (not nested DOM). Mirrors sg-layout's patterns.

---

## What v0.1.0 delivers

- Shadow DOM Web Component (`<sg-tree>`)
- CSS custom property theming (dark palette by default, all tokens overridable)
- Canonical data format: `{ id, label, type, children?, icon?, meta?, badge?, disabled? }`
- Flat row rendering (`_buildVisibleList` → flat array, not nested DOM)
- Single-select mode (`selectable="single"`)
- Expand / collapse with fold-state tracking (`_expanded` Set)
- `filter(fn)` — show nodes where fn returns true (ancestors shown automatically)
- Full keyboard navigation: ArrowUp/Down, j/k, ArrowLeft/Right, Enter, Home, End, *
- ARIA attributes: `role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-selected`, `aria-disabled`
- All 15 public methods (see below)
- All 9 events from `SGT_EVENTS` (see sg-tree-events.js)
- Override queue (`window._SgTreeQ`) for surgical v0.1.x overrides

---

## Public API — all 15 methods

| Method | Description |
|--------|-------------|
| `setData(root)` | Set and render tree |
| `getData()` | Deep clone of current data |
| `getSelectedId()` | Currently selected id or null |
| `select(id)` | Programmatic select + scroll into view |
| `expand(id)` | Expand a node |
| `collapse(id)` | Collapse a node |
| `expandAll()` | Expand all nodes |
| `collapseAll()` | Collapse all nodes |
| `expandPath(id)` | Expand all ancestors + scroll node into view |
| `scrollTo(id)` | Scroll to make node visible |
| `getScrollTop()` | Current scroll offset (for serialisation) |
| `setScrollTop(px)` | Restore scroll offset |
| `filter(fn)` | Show only matching nodes; null clears filter |
| `getExpandedIds()` | Array of currently expanded ids |
| `setExpandedIds(ids)` | Restore expansion state |
| `getLayoutState()` | `{ expandedIds, selectedId, scrollTop }` |
| `setLayoutState(state)` | Called by sg-layout serialisation |

---

## Configuration

| Property / Attribute | Type | Default | Notes |
|----------------------|------|---------|-------|
| `selectable` / `selectable` | `'single'\|'multi'\|'none'` | `'single'` | v0.1.0 treats 'multi' as 'single' |
| `showRoot` / `show-root` | `boolean` | `true` | Show or hide the root node |
| `indentPx` / `indent-px` | `number` | `16` | Pixels per depth level |
| `expandableTypes` | `string[]` | `['folder']` | Node types that can be expanded |
| `iconMap` | `object` | see source | Map of type → icon string |
| `sortFn` | `Function\|null` | `null` | Custom sort; null = folders first, alpha |

---

## NOT in this version

The following are explicitly deferred to surgical override versions:

| Feature | Target version |
|---------|---------------|
| Editor mode (rename, delete, create) | v0.1.1 |
| Virtual scrolling (row recycling) | v0.1.2 |
| Multi-select (Shift+click, Ctrl+click, Space) | v0.1.3 |
| Drag-and-drop within tree | v0.1.4 |
| Cross-tree drag | v0.1.5 |
| Connector lines + custom sort enhancement | v0.1.6 |

---

## Internal properties required by override versions

### `_rowHeight` (number, default 28)

Required by **v0.1.2** (virtual scroll). This property stores the expected pixel height of each row, matching `--sgt-row-height`. The v0.1.2 override reads `this._rowHeight` to compute which rows are in the visible viewport range.

### `_renderRow(node, depth, path) → HTMLElement`

Required by **v0.1.1** (editor mode). The method MUST return the created row element. The v0.1.1 override replaces this method to inject edit affordances (rename button, inline input). Any future override of `_renderRow` must also return the element.

### `_visible` (Array)

Flat visible list rebuilt on each `_render()`. Required by **v0.1.2** to know total row count and by **v0.1.3** for range-selection.

### `_renderVisibleRows()`

Overridden by **v0.1.2** to implement virtual scrolling with a row recycling pool.

### `_onKeydown(e)`

Extended by **v0.1.1** (F2 = rename, Delete = delete) and **v0.1.3** (Space = toggle selection).

### `_onRowClick(e)`

Overridden by **v0.1.3** (Shift+click range, Ctrl+click toggle).

---

## Override queue

```js
// Queue an override before sg-tree.js loads:
window._SgTreeQ = window._SgTreeQ || [];
window._SgTreeQ.push(SgTree => {
    SgTree.prototype._renderRow = function(node, depth, path) { /* ... */ };
});
```

After `sg-tree.js` loads, `window._SgTreeQ` is replaced with `{ push: fn => fn(SgTree) }` so live applications can push overrides at any time.

---

## Usage

```html
<sg-tree id="my-tree" selectable="single" show-root="true" indent-px="16"></sg-tree>

<script type="module">
import { SgTree } from './sg-tree.js';

const tree = document.getElementById('my-tree');
tree.setData({
    id: 'root',
    label: 'Project',
    type: 'folder',
    children: [
        { id: 'src', label: 'src', type: 'folder', children: [
            { id: 'main', label: 'main.js', type: 'file' },
        ]},
        { id: 'readme', label: 'README.md', type: 'file', badge: 'new' },
    ]
});

tree.addEventListener('sg-tree:node-selected', e => {
    console.log('selected', e.detail.id);
});
</script>
```
