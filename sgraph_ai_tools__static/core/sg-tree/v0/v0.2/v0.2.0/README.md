# sg-tree v0.2.0

PROPOSED — does not exist yet.

Major version increment from v0.1.x. Consolidates all surgical override layers (v0.1.1 through v0.1.6) into a single, cohesive implementation with a clean architecture and a stable public API surface.

---

## Scope

v0.2.0 is a clean-room reimplementation incorporating the lessons and API contracts established by v0.1.x overrides. It is NOT a patch on top of v0.1.0; it is a standalone file.

---

## Key changes from v0.1.x

| Feature | v0.1.x | v0.2.0 |
|---------|--------|--------|
| Editor mode | v0.1.1 override | First-class `editable` prop |
| Virtual scroll | v0.1.2 override | Built-in, always on |
| Multi-select | v0.1.3 override | `selectable="multi"` fully implemented |
| Drag (intra) | v0.1.4 override | Built-in |
| Drag (cross-tree) | v0.1.5 override | Built-in |
| Connectors | v0.1.6 override | `connectors="true"` attribute |
| Override queue | Necessary hack | Deprecated (kept for compat) |
| Architecture | Prototype patches | Clean class, no monkey-patching |

---

## File

`core/sg-tree/v0/v0.2/v0.2.0/sg-tree.js`

Also: `core/sg-tree/v0/v0.2/v0.2.0/sg-tree-events.js` (superset of v0.1.0 + v0.1.5 events)

---

## Public API

v0.2.0 is fully backwards compatible with v0.1.0's public API (all 15 methods, all attributes). Additions:

| Method / Property | Description |
|-------------------|-------------|
| `getSelectedIds()` | Multi-select: all selected ids |
| `selectAll()` | Select all non-disabled nodes |
| `deselectAll()` | Clear all selections |
| `editable` | Boolean property — enables editor mode |
| `connectors` | Boolean property — enables connector lines |

---

## Events

Superset of v0.1.0 + v0.1.5 events. All `SGT_EVENTS` from v0.1.0 are preserved with identical names. New cross-tree events from v0.1.5 are merged in.

---

## Acceptance criteria

- [ ] All v0.1.0 tests pass against v0.2.0 without modification
- [ ] Multi-select fully functional
- [ ] Virtual scroll built in, no override needed
- [ ] Editor mode enabled via `editable="true"` attribute
- [ ] Connector lines enabled via `connectors="true"` attribute
- [ ] Cross-tree drag works without v0.1.5 override file
- [ ] Override queue (`window._SgTreeQ`) preserved for backwards compat but documented as deprecated
- [ ] No prototype monkey-patching in v0.2.0 source itself

---

## Test file

`tests/sg-tree/v0.2.0.test.html`
