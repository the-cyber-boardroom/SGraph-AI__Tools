# 06 — Brief: Refactor sg-video-editor v0.1.54 → v0.1.55 to consume the toolkit

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Brief revision:** rev 1 (Pass 3)
**Brief role:** the implementer task list for converting the existing video editor to use the toolkit while preserving every user-facing behaviour.
**Audience:** Sonnet implementer (Explorer team) familiar with the v0.1.54 codebase. NOT the implementer of brief 05 — they're producing the toolkit you'll consume.
**Lifetime:** archive after merge.
**Estimated effort:** 40–60 hours of Sonnet-time across 35 tasks. This is the highest-risk brief because behaviour preservation is non-negotiable.

> **Read first, in order:**
> 1. `README.md` — V.1–V.11, A-001 through A-011, **especially V.6.6** (the mapping table from existing video editor mutations to the new op categories — this drives migration)
> 2. `01__architecture__sg-toolkit.md` — §3 (the 8 pieces) and §5 (target architecture)
> 3. `02__architecture__component-catalogue.md` — read every section; you'll consume all 8 pieces
> 4. `03__guidelines__sg-component-and-ifd.md` — sections A, H (IFD), K (rules), and especially §M (op-driven architecture)
> 5. `04__verification__feature-checklist.md` — section §B is your tick-list (you must tick every B item)
> 6. **The existing v0.1.54 source** at `tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor/` — read end-to-end before starting. ~6,058 LOC.
>
> **Read brief 05 to verify** the toolkit pieces you'll consume exist and their APIs match what's in doc 02. If brief 05 isn't merged yet, this brief blocks until it is.

---

# §0 — Pre-flight checklist

- [ ] You're on a fresh branch named `claude/refactor-video-editor-{session-id}`
- [ ] Brief 05 is merged; toolkit pieces exist at their v0.1.0 paths
- [ ] You have read v0.1.54 source end-to-end (don't skim; you'll need to know every mutation pattern)
- [ ] You understand V.6.6 (the op-category mapping table) cold
- [ ] You know the difference between **state restoration** (imperative `setProject`/`setItems`/`setAssets`) and **user action** (op-shaped event), per M.11
- [ ] You understand that **v0.1.54 stays at its path forever**; you're creating v0.1.55 as a NEW folder per IFD H.1
- [ ] You can answer: "What is the migration path from v0.1.54-saved projects to v0.1.55?" Answer outline: same `localStorage` keys (per `projectKeyPrefix: 'sgve:project:'`); the save envelope schema is forward-compatible; v0.1.55 reads v0.1.54 saves on first load

If any are unclear, STOP and ask. Don't guess. (Doc 03 §K.2.)

---

# §1 — Order of work

```
Phase 1: Scaffold v0.1.55 (T-1, T-2)
   ↓
Phase 2: Wire toolkit components (T-3 through T-9)        [non-state changes first]
   ↓
Phase 3: Migrate state-history.js → sg-history (T-10 through T-15)   [highest risk]
   ↓
Phase 4: Migrate state-storage / state-asset-storage → sg-project-storage (T-16, T-17)
   ↓
Phase 5: Migrate config tab → sg-config + sg-properties-panel (T-18, T-19)
   ↓
Phase 6: Behaviour preservation regression (T-20 through T-30)   [QA-shaped; brief 08 will run these]
   ↓
Phase 7: Cleanup and pack delivery (T-31 through T-35)
```

Phase 3 is the riskiest. The op-category mapping in V.6.6 must be applied exhaustively — every existing mutation in v0.1.54 maps to exactly one category, and you implement the host's `onApply(op, direction)` for each.

---

# §2 — Phase 1: Scaffold v0.1.55

## T-1 — Create v0.1.55 directory by full duplication

**What:** Copy `tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor/` to `tools/v0/v0.1/v0.1.55/en-gb/sg-video-editor/` verbatim. This is the IFD pattern: new minor = new folder, full duplication.

**Why:** Per doc 03 §H.1 (no edits to frozen versions; new minor = new folder). v0.1.54 stays at its path indefinitely. v0.1.55 is the active line.

**How:**
```bash
cp -r tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor tools/v0/v0.1/v0.1.55/en-gb/sg-video-editor
```

Update the manifest's version to v0.1.55. Update the version pill (the `v0.1.0` ALPHA badge in the bottom-right footer per the v0.1.54 screenshot) to read `v0.1.55`.

**Done when:**
- New folder exists at v0.1.55 path
- Original v0.1.54 folder is unchanged (verified by `git diff` returning empty for `tools/v0/v0.1/v0.1.54/...`)
- Manifest version updated

**Checklist refs:** §E.1, §E.4

**DO NOT:**
- Edit any file in v0.1.54. Per §E.4.
- Skip the duplication; "we'll just symlink" is wrong. v0.1.54 is frozen at exactly that path.

---

## T-2 — Verify v0.1.55 loads as-is and works identically to v0.1.54

**What:** Before changing any code in v0.1.55, load both versions in browser tabs. Verify v0.1.55 is functionally identical to v0.1.54.

**Why:** Establishes the baseline. If v0.1.55 doesn't work as a copy of v0.1.54, something went wrong in T-1. Also surfaces any v0.1.54 paths that hardcoded `v0.1.54` in URLs/imports — those need updating.

**How:**
1. Load `/en-gb/sg-video-editor/v0.1.55/`
2. Compare side-by-side against `/en-gb/sg-video-editor/v0.1.54/`
3. Walk through: load existing project, drag item, trim, split, play, save, reload
4. If any difference: investigate paths, imports, manifest references

**Done when:** Both versions behave identically.

**DO NOT:** Start changing code in v0.1.55 before this baseline check. You'd lose the ability to bisect what broke.

---

# §3 — Phase 2: Wire toolkit components

## T-3 — Replace `<sg-timeline>` with `<sg-track-strip>`

**What:** In `main.html` (or wherever `<sg-timeline>` is mounted), replace the `<sg-timeline>` element with `<sg-track-strip>`. Update the manifest's dependency from `components/sg-timeline/v0/v0.1/v0.1.0` to `components/sg-track-strip/v0/v0.1/v0.1.0`.

**Why:** The new component is generic; the old `<sg-timeline>` had video-editor-specific event names and field assumptions. Per A-001, the toolkit's track-strip replaces the editor-specific timeline.

**How:**
1. In main.html: change tag.
2. In manifest.json: update dependency path.
3. In main.js: update import statements.
4. The toolkit component's events have new names per V.2.1; you'll wire them in T-4.

**Done when:**
- v0.1.55 mounts `<sg-track-strip>` instead of `<sg-timeline>`
- Manifest references the new component's path
- No imports of `<sg-timeline>` remain in v0.1.55 source

**Checklist refs:** §E.3

**DO NOT:**
- Try to make `<sg-track-strip>` accept the old `<sg-timeline>`'s API. The new API is what's specified in doc 02 §1.3.

---

## T-4 — Wire `<sg-track-strip>` events to host state

**What:** In main.js, listen for all 20 events from V.2.1. For each, write a host-side handler that updates the host's state container (`this._state`).

**Why:** Each event is op-shaped. Forward apply happens here (immediately, before sg-history records). sg-history records the op; on undo, the host's `onApply(op, 'backward')` reverses it.

**How:**
1. Import `SGTS_EVENTS` from `components/sg-track-strip/v0/v0.1/v0.1.0/sg-track-strip-events.js`
2. For each event name in `SGTS_EVENTS.values`:
   - `trackStrip.addEventListener(name, (e) => this._handleEvent(name, e.detail.op))`
3. `_handleEvent(name, op)`:
   - Apply op forward to state (e.g. `item-moved`: state.moveItem(itemId, toTrackId, toStart))
   - Record op via `history.record(op)`
4. After applying forward, re-render the affected portion via `setItems({trackId: state.getTrackItems(trackId)})`

**Pattern:** The host has roughly 20 forward-apply handlers, one per op type. Each is small. Document each in a code comment with the V.6.6 entry it corresponds to.

**Done when:**
- All 20 events wire to handlers
- Forward apply works for each (verified by Playwright specs in §B.2–§B.10)

**Checklist refs:** §B.2–§B.10 (each maps to one or more events)

**DO NOT:**
- Bypass `history.record(op)` for any state-changing event. Per M.8.
- Apply the op via the component's setter and ALSO via state mutation; pick one path.

---

## T-5 — Replace bespoke toolbar with `<sg-toolbar>`

**What:** Remove the existing toolbar markup. Add `<sg-toolbar>` element. Register all existing toolbar buttons via `tb.addButton({...})`.

**Why:** Per doc 02 §2 — generic toolbar. v0.1.54's hand-rolled buttons go.

**How:**
1. Inventory existing toolbar buttons in v0.1.54: Undo, Redo, Zoom-in, Zoom-out, Fit, px/s display, Split, Copy, Paste, +Track, fit-grid toggle.
2. Register each via `tb.addButton({id, label, shortcut, ...})`
3. Add separators between groups
4. Listen for `sg-toolbar:button-clicked` in main.js; dispatch to handler per button id

**Done when:**
- Toolbar renders identical to v0.1.54 (visually)
- All shortcuts work (§B.16)
- Undo/redo wire to `history.undo()` / `history.redo()`
- Bounds-changed events from sg-history disable the buttons appropriately

**Checklist refs:** §B.16, §C.3

**DO NOT:**
- Add new buttons. Scope is "preserve behaviour," not "add features." Per K.4 (DO NOT is binding).
- Remove keyboard shortcuts. Even if a button is hidden in some mode, the shortcut must still work in the same modes as v0.1.54.

---

## T-6 — Replace bespoke asset panel with `<sg-asset-panel>`

**What:** Replace the existing asset panel markup with `<sg-asset-panel>`. Wire `setAssets`, listen for `asset-add-requested` and `asset-remove-requested`.

**How:**
1. Drop in `<sg-asset-panel>` element in main.html
2. main.js: on project load, call `panel.setAssets(this._state.assets)`
3. Listen for `asset-add-requested`:
   ```javascript
   panel.addEventListener('sg-asset-panel:asset-add-requested', async (e) => {
       const {file, suggestedAssetId} = e.detail.op.payload;
       
       // Side effect: write blob to IDB
       await this._assetStorage.writeBlob(suggestedAssetId, file);
       
       // Probe video metadata (host-specific):
       const meta = await this._probeVideoMetadata(file);
       
       // Update state with full asset record:
       this._state.addAsset({
           id: suggestedAssetId,
           name: file.name,
           mimeType: file.type,
           ...meta,  // duration, dimensions, etc.
       });
       
       // Re-render panel:
       panel.setAssets(this._state.assets);
       
       // Record op (already routed via the standard event listener)
   });
   ```
4. Listen for `asset-remove-requested` similarly: schedule blob deletion in onSideEffect, remove metadata in onApply.

**Done when:**
- Asset panel shows existing assets on project load (§B.10 part 1)
- File drop uploads correctly (§B.8)
- Asset removal works (§B.9)
- Drag-asset-onto-track works (§B.10 part 2)

**Checklist refs:** §B.8, §B.9, §B.10

**DO NOT:**
- Update asset panel state from the component's events directly. State updates flow: event → host handler → host state → setAssets re-render.
- Lose the existing v0.1.54 file-probe logic. Re-use it; just trigger it from the new event handler.

---

## T-7 — Replace bespoke properties tab with `<sg-properties-panel>`

**What:** The right rail's "Properties" tab becomes a `<sg-properties-panel>` instance. Wire selection from track-strip to populate sections; wire `field-changed` to host state updates.

**How:** Per doc 02 §4.7.1.

**Done when:**
- Selecting an item shows transform fields (§B.11)
- Editing a field updates state and re-renders (§B.12)
- Undo restores the prior field value (§B.12 + §C.2.a)

**Checklist refs:** §B.11, §B.12, §B.13

---

## T-8 — Replace player surface with `<sg-player-transport>`

**What:** The Preview region (`<sg-preview-canvas>` and the controls below it) is restructured. The transport controls become `<sg-player-transport>`; the actual canvas is slotted into the transport's `surface` slot.

**How:**
1. Implement a `VideoComposerPlayable` adapter that wraps the existing video composer
2. Mount `<sg-player-transport>` with the canvas element slotted in
3. Call `transport.attachPlayable(playable)`
4. Listen for transport events; dispatch to composer

**Done when:** §B.15 ticks (play, pause, scrub all work).

**Checklist refs:** §B.15

**DO NOT:**
- Modify `<sg-preview-canvas>` v0.1.0. It's a frozen component used by both v0.1.54 and v0.1.55. The new wrapping happens at the host layer.
- Re-implement the video composer in v0.1.55. It exists; wrap it.

---

## T-9 — Verify all 5 components are wired and functional

**What:** Smoke test. Open v0.1.55 in browser. Load the existing v0.1.54 demo project. Walk through: drag, trim, split, copy, paste, save, undo, redo.

**Done when:** All operations succeed without console errors.

**Checklist refs:** §B.1–§B.18 (smoke; full ticks happen in Phase 6)

---

# §4 — Phase 3: Migrate state-history.js → sg-history

This is the highest-risk phase. v0.1.54's `state-history.js` uses snapshot-stack history (capped at 50 snapshots). v0.1.55 uses op-based sg-history. The migration is exhaustive: every mutation in v0.1.54's state container maps to an op category per V.6.6.

## T-10 — Inventory all mutations in v0.1.54

**What:** Open v0.1.54's state container (`state-container.js` and friends). List every mutation method:
- `addItem`, `removeItem`, `moveItem`, `trimItem`, `splitItem`, `copyItem`, ...
- `addTrack`, `removeTrack`, `renameTrack`, `muteTrack`, `lockTrack`, `reorderTrack`, ...
- `addAsset`, `removeAsset`, ...
- `setSelectedItem`, `setPlayhead`, ...
- `setProjectName`, `setMetadata`, ...

For each, identify what it does (the state delta) and check it against V.6.6's mapping table. Confirm or flag the category.

**Done when:** Spreadsheet/table mapping every mutation to a V.6.6 entry. Print this; you'll reference it for T-11 through T-15.

**Why:** Without this exhaustive inventory, you'll miss mutations and subtly break things.

---

## T-11 — Implement host's `onApply(op, direction)` dispatcher

**What:** The host's main.js gets a single `onApply(op, direction)` function that switches on `op.type` and calls the appropriate forward/backward handler.

**How:**
```javascript
const OP_HANDLERS = {
    'item-moved':    moveItem_op,
    'item-trimmed':  trimItem_op,
    'item-deleted':  deleteItem_op,
    'item-split':    splitItem_op,
    'item-color':    colorItem_op,
    // ... ~20 entries
};

_applyOp(op, direction) {
    const handler = OP_HANDLERS[op.type];
    if (!handler) {
        console.warn('[sgve] unknown op type:', op.type);
        return;
    }
    handler(this._state, op, direction);
    
    // Re-render affected component:
    if (op.payload.trackId) {
        const items = this._state.getTrackItems(op.payload.trackId);
        this.shadowRoot.querySelector('sg-track-strip').setItems({[op.payload.trackId]: items});
    }
}
```

Each handler takes `(state, op, direction)` and applies forward or backward.

**Done when:** The dispatcher exists and routes all op types from V.6.6.

---

## T-12 — Implement op handlers for `pure` ops

**What:** Per V.6.6, the pure ops (state-only, derived inverse from payload). Examples: `item-moved`, `item-trimmed`, `item-color`, `item-track-changed`, `track-renamed`, `track-mute`, `track-lock`, `track-rearranged`.

**How:** For each, write a handler that uses `op.payload.fromX` for backward direction and `op.payload.toX` for forward direction.

```javascript
function moveItem_op(state, op, direction) {
    const {itemId, fromTrackId, toTrackId, fromStart, toStart} = op.payload;
    const targetTrackId = direction === 'forward' ? toTrackId : fromTrackId;
    const targetStart   = direction === 'forward' ? toStart   : fromStart;
    state.moveItem(itemId, targetTrackId, targetStart);
}
```

**Done when:** All pure-category ops in V.6.6 have handlers. Sandbox-style undo→redo→undo cycle for each preserves state.

**Checklist refs:** §C.2.a, §B.2 (drag within track), §B.3 (drag across tracks), §B.4–§B.5 (trim)

---

## T-13 — Implement op handlers for `snapshot` ops

**What:** Per V.6.6, the snapshot ops carry full priorState. Examples: `item-added`, `item-deleted`, `item-split`, `item-copied`, `track-add-requested`, `track-remove-requested`.

**How:** For each, the forward handler uses `op.payload`; the backward handler uses `op.priorState`.

```javascript
function deleteItem_op(state, op, direction) {
    const {itemId, trackId} = op.payload;
    if (direction === 'forward') {
        state.removeItem(itemId, trackId);
    } else {
        state.insertItem(op.priorState.item, trackId, op.priorState.atIndex);
    }
}

function splitItem_op(state, op, direction) {
    const {originalItemId, newItemIds, atPosition, trackId} = op.payload;
    if (direction === 'forward') {
        const original = op.priorState.item;
        const left = {...original, id: newItemIds[0], end: atPosition,
                       inPoint: original.inPoint,
                       outPoint: original.inPoint + (atPosition - original.start)};
        const right = {...original, id: newItemIds[1], start: atPosition,
                        inPoint: original.inPoint + (atPosition - original.start),
                        outPoint: original.outPoint};
        state.removeItem(originalItemId, trackId);
        state.insertItem(left, trackId, op.priorState.atIndex);
        state.insertItem(right, trackId, op.priorState.atIndex + 1);
    } else {
        state.removeItem(newItemIds[0], trackId);
        state.removeItem(newItemIds[1], trackId);
        state.insertItem(op.priorState.item, trackId, op.priorState.atIndex);
    }
}
```

Note that for `item-split`, the host (which knows about `inPoint`/`outPoint`) does the field math. The toolkit knows nothing about these fields.

**Done when:** All snapshot-category ops have handlers. Operations like delete-track-with-items round-trip cleanly.

**Checklist refs:** §C.2.b, §B.6 (split), §B.7 (copy/paste)

---

## T-14 — Implement op handlers for `with-side-effects` ops

**What:** Per V.6.6, the with-side-effects ops have an external resource component. Examples: `asset-add-requested`, `asset-remove-requested`, possibly `composer-rebuild` if you treat composer-state as a side-effect.

**How:** Two parts:
1. `onApply` mutates state (metadata only).
2. `onSideEffect` (passed to `createHistory`) handles the external resource.

```javascript
async _handleSideEffect(op, direction) {
    if (op.type === 'asset-add-requested') {
        const {suggestedAssetId, file} = op.payload;
        if (direction === 'backward') {
            // Undo: remove the blob
            await this._assetStorage.deleteBlob(suggestedAssetId);
        } else {
            // Redo: re-write the blob (caller passes file in op.payload)
            await this._assetStorage.writeBlob(suggestedAssetId, file);
        }
    }
    // ... other side-effect ops
}
```

**Note:** The `file` object can't be JSON-serialized (per M.10), so for redo to work after a save/load cycle, the host must persist blobs separately. After load, side-effect-driven redo would re-fetch from IDB by `assetId`. For pre-save redo within the same session, the file is held in memory.

**Done when:** All with-side-effects ops have handlers. Asset add → undo removes blob from IDB → redo re-allocates blob.

**Checklist refs:** §C.2.c, §B.8 (asset upload), §B.9 (asset remove)

---

## T-15 — Wire sg-history; remove state-history.js

**What:** Replace v0.1.55's reference to v0.1.54's `state-history.js` with `createHistory` from sg-history. Delete the v0.1.55 copy of `state-history.js`.

**How:**
1. Import `createHistory` from `core/sg-history/v0/v0.1/v0.1.0/`
2. Instantiate per the standard pattern (doc 02 §9.1):
   ```javascript
   this._history = createHistory({
       eventTarget: this,
       onApply:     (op, dir) => this._applyOp(op, dir),
       onSideEffect: (op, dir) => this._handleSideEffect(op, dir),
       onSnapshot:  () => this._state.snapshot(),
   });
   ```
3. Wire toolbar Undo/Redo to `history.undo()` / `history.redo()`
4. Listen for `sg-history:bounds-changed` to update toolbar button disabled state
5. Delete `state-history.js` from v0.1.55 (do NOT touch v0.1.54)

**Done when:**
- `history.undo()` reverses the last op for any of the 5 categories (§C.2)
- 30 ops + 30 undos restores load state (§B.17)
- `state-history.js` is removed from v0.1.55

**Checklist refs:** §B.17, §C.2.a–§C.2.e, §C.6

**DO NOT:**
- Delete `state-history.js` from v0.1.54. That folder is frozen.
- Try to make `state-history.js` and sg-history coexist. Pick sg-history.

---

# §5 — Phase 4: Migrate state-storage / state-asset-storage → sg-project-storage

## T-16 — Replace state-storage.js with sg-project-storage usage

**What:** v0.1.55's save/load/list/delete operations use sg-project-storage's exports. The localStorage keys remain the same so v0.1.54-saved projects still load.

**How:**
1. Import `saveProject, loadProject, listSavedProjects, deleteSavedProject, autosave, getAutosave` from `core/sg-project-storage/...`
2. Wrap each existing call site in v0.1.55's main.js. Pass `projectKeyPrefix: 'sgve:project:'`, `dbName: 'sgve-storage'`, `storeName: 'assets'` to preserve compatibility with v0.1.54 saves.
3. Delete v0.1.55's `state-storage.js` (do NOT touch v0.1.54's).

**Done when:**
- Loading a v0.1.54-saved project in v0.1.55 produces identical state (§B.1)
- Save round-trip works (§B.18)
- Autosave-after-crash works (§B.19)
- `state-storage.js` removed from v0.1.55

**Checklist refs:** §B.1, §B.18, §B.19, §E.4

---

## T-17 — Replace state-asset-storage.js with sg-project-storage's IDB layer

**What:** v0.1.54's `state-asset-storage.js` becomes redundant; sg-project-storage handles IDB.

**How:** Same approach as T-16. Replace call sites; delete file.

**Done when:** Asset blobs persist correctly across reloads. Round 9-K race fixes still hold (§B.20).

**Checklist refs:** §B.20

---

# §6 — Phase 5: Migrate config tab → sg-config + sg-properties-panel

## T-18 — Define the v0.1.55 config schema

**What:** Per the v0.1.54 Config tab screenshot, the schema includes:
- `preview-composer` (boolean, default false)
- `timeline-renders` (boolean, default true)
- `autosave` (boolean, default false)
- `memory-probe` (boolean, default false, debug: true)
- `log-composer-rebuilds` (boolean, default false, debug: true)
- `log-level` (select: silent | warn | info | verbose, default: verbose)
- Plus URL-enable: `enable-url` (string, default '')

**How:**
1. Create `MY_CONFIG_SCHEMA` constant in main.js.
2. `createConfig({namespace: 'sgve', schema: MY_CONFIG_SCHEMA})` — note that v0.1.54's storage key for config (if any) maps to `sgve:config` — verify there's no collision and decide on a migration: read old key, copy values, save under new key, delete old key.

**Done when:**
- Schema declared
- Config instance created with namespace `sgve`
- Existing config values from v0.1.54 (if any) are migrated correctly

---

## T-19 — Wire config tab to sg-properties-panel

**What:** The right rail's Config tab uses `<sg-properties-panel>`. The existing v0.1.54 hand-rolled config UI is replaced.

**How:**
```javascript
const propsConfig = this.shadowRoot.querySelector('sg-properties-panel#config');
propsConfig.addSection({
    id: 'config',
    title: 'CONFIG',
    fields: this._config.toFields({includeDebug: false}),
});
propsConfig.addSection({
    id: 'debug',
    title: 'DEBUG',
    fields: this._config.toFields({includeDebug: true}).filter(f => f.debug),
});

propsConfig.addEventListener('sg-properties-panel:field-changed', (e) => {
    const {sectionId, fieldId, toValue} = e.detail.op.payload;
    if (sectionId === 'config' || sectionId === 'debug') {
        this._config.set(fieldId, toValue);
    }
});

// Reset to defaults button: section action
propsConfig.addEventListener('sg-properties-panel:section-action', (e) => {
    if (e.detail.op.payload.actionId === 'reset-defaults') {
        this._config.reset();
    }
});
```

**Done when:**
- All v0.1.54 config checkboxes work in v0.1.55 (§B.14)
- Log level select works
- Reset to defaults works
- URL overrides work (e.g. `?config.log-level=silent`)

**Checklist refs:** §B.14, §C.8, §C.9

**DO NOT:**
- Hardcode field rendering in main.html. Use `addSection` with the schema.
- Make config changes bypass the op pipeline. Per M.12, config IS state, undoable.

---

# §7 — Phase 6: Behaviour preservation regression

This phase is the manual + Playwright walk-through of every §B item in doc 04. Most items are owned by brief 08 (QA), but you initiate the suite here.

## T-20 — Verify §B.1 (project import / load round-trip)

**What:** Load a v0.1.54-saved project in v0.1.55. Verify pixel-identical timeline, identical assets, identical properties, identical playhead.

**How:** Save a complex project in v0.1.54. Open v0.1.55, click "Open" → select the saved project. Compare visually.

**Done when:** §B.1 ticks.

---

## T-21 through T-30 — Verify §B.2 through §B.20

For each item in §B.2 through §B.20:
- Run the corresponding scenario manually in v0.1.55
- If it works, mark the checklist item ticked
- If it fails, file a bug with the exact step-by-step repro

Brief 08 will run the formal Playwright suite; T-21 through T-30 are your sanity checks before handing off.

---

# §8 — Phase 7: Cleanup and pack delivery

## T-31 — Remove orphaned files from v0.1.55

**What:** Files that existed in v0.1.54 but are no longer needed in v0.1.55:
- `state-history.js` (replaced by sg-history)
- `state-storage.js` (replaced by sg-project-storage)
- `state-asset-storage.js` (replaced by sg-project-storage's IDB layer)
- The bespoke config tab markup/logic
- Any timeline-renderer helper that's now in sg-track-strip

For each: confirm not used in v0.1.55, then delete.

**Done when:** v0.1.55 has no dead code. `git diff` shows reasonable LOC reduction (target: ~1,500 LOC removed; the toolkit consumes the equivalent surface).

**Checklist refs:** §E.3 (v0.1.55 uses new paths)

---

## T-32 — Verify v0.1.54 is unchanged

**What:** `git diff main -- tools/v0/v0.1/v0.1.54/` returns empty.

**Done when:** §E.4 ticks.

**Checklist refs:** §E.4

---

## T-33 — Update reality doc

**What:** `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` gets a paragraph noting that sg-video-editor v0.1.55 exists at its path and consumes the toolkit. The v0.1.54 entry stays (it still exists at its path, frozen).

**Done when:** §E.10 ticks.

**Checklist refs:** §E.10

---

## T-34 — Architect review

**What:** Notify architect that the refactor is ready for review. Architect runs scripts (§A.7, §D.1, §D.2, §D.3, §D.4, §D.5) and walks through §B items.

**Done when:** Architect signs off. Branch is at the tagged commit.

**Checklist refs:** §H.8

---

## T-35 — Hand off to brief 08

**What:** Notify the QA implementer (brief 08) that v0.1.55 is ready for the Playwright regression suite. Provide the branch name and commit SHA.

**Done when:** Brief 08 starts.

---

# §9 — Common Sonnet drift patterns to avoid (specific to refactor)

1. **Modifying v0.1.54.** Frozen. Per §E.4. The hardest discipline; the urge to "fix something while I'm in here" is strong. Resist.
2. **Re-implementing what the toolkit provides.** If you find yourself writing a snapshot-stack history alongside sg-history, STOP. The toolkit IS the history.
3. **Changing user-visible behaviour silently.** Per K.4 (DO NOT is binding) and the "preserve behaviour, not code" principle (A.6 in doc 03). If a v0.1.54 user double-clicks an item and the item enters edit mode, v0.1.55 must do the same. If the toolkit doesn't offer a primitive for it, file a brief-extension request rather than dropping the feature.
4. **Skipping the V.6.6 inventory in T-10.** It's tempting to start coding handlers as you encounter them. Don't. Inventory first; code second.
5. **Mixing `_state.moveItem(...)` and `setItems(...)`.** Pick a clear ownership: `_state` is the source of truth; `setItems` is the rendering hint. If they ever drift (e.g. `_state` says item is at position 5 but the component shows 7), you have a bug.
6. **Forgetting to update toolbar bounds when sg-history bounds change.** Per T-15. Without this, Undo/Redo buttons stay enabled when there's nothing to undo/redo, and clicking them is a no-op (worse: confusing UX).
7. **Adding new features.** Out of scope. Brief 06 is "preserve behaviour while consuming the toolkit." New features are separate packs.

---

# §10 — Definition of done for this brief

All 35 tasks ticked. All §B items in doc 04 ticked (formally by brief 08, but you must have walked through them manually first).

When done:
- Branch named `claude/refactor-video-editor-{session-id}` is at a tagged commit
- v0.1.55 exists at `tools/v0/v0.1/v0.1.55/en-gb/sg-video-editor/`
- v0.1.54 unchanged
- v0.1.55 imports all 8 toolkit pieces, deletes its old state-history/state-storage/state-asset-storage helpers
- All §B items walked through manually (formal Playwright suite is brief 08)
- Architect signs off

End of brief 06. ~35 tasks. Estimated 40–60 hours of Sonnet-time.
