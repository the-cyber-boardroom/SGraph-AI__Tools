# 04 — Verification Checklist

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Doc revision:** rev 1 (Pass 2)
**Doc role:** the project plan. Every brief task in 05/06/07/08 references one or more items here. Implementers tick items as they go; "done" = "every referenced item ticked."
**Audience:** all implementers (build, refactor, QA). QA owns Section B execution; build/refactor implementers own A, C, D, E for their respective work.
**Lifetime:** durable. Add items as scope grows; never remove.

> **Read first:** README V.1–V.11, doc 01 §3 (eight pieces), doc 02 (component catalogue), doc 03 §A.8 (don't ship without ticking).

---

# §0 — How to read this checklist

Every item has the same shape:

```
- [ ] §X.N — Short title
  Description of what's being verified.
  How: [script] / [human] / [playwright] — who or what does this
  Where: file path or commit reference
  Brief refs: 05/T-N, 06/T-N, etc.
```

**Tags:**
- `[script]` — automated (grep, line counts, manifest validation, type checks)
- `[human]` — manual code review or visual inspection by a person
- `[playwright]` — Playwright E2E test (lives in `tools/.../playwright/`)
- `[unit]` — unit test (lives next to the module)

**Status meanings:**
- `[ ]` — unticked, not yet verified
- `[x]` — ticked, verified at the named commit
- `[~]` — partially verified, with note explaining what's outstanding (every `[~]` blocks pack completion)

**Brief refs:** every checklist item is referenced by at least one brief task. Items without brief refs are gaps; flag them to the architect.

---

# §A — Genericness (the toolkit must NOT leak host concepts)

The toolkit is "host-agnostic." Section A tests that. If any of these items fail, the toolkit isn't actually generic and would couple to whatever tool implemented it first.

## §A.1 — Sandbox mode "Video" works

- [ ] §A.1 — `sg-timeline-toolkit-sandbox` mode "Video" exercises sg-track-strip with synthetic video-shaped data
  Loads a project with 3 tracks, 12 items, items have `assetId` and `inPoint`/`outPoint` host-specific fields. User can drag, trim, split, delete, undo, redo. No errors in console.
  How: [playwright]
  Where: `tools/v0/v0.1/v0.1.0/en-gb/sg-timeline-toolkit-sandbox/playwright/spec.video-mode.js`
  Brief refs: 05/T-12

## §A.2 — Sandbox mode "Audio" works

- [ ] §A.2 — Same surface as Video, with audio-shaped synthetic data
  Items have `assetId`, `gain`, `fadeIn`, `fadeOut` fields. No video-specific code path is invoked. Drag/trim/split/undo all work.
  How: [playwright]
  Where: `.../playwright/spec.audio-mode.js`
  Brief refs: 05/T-13

## §A.3 — Sandbox mode "Gantt" works

- [ ] §A.3 — Items represent tasks with `dependencies`, `assignee`, `progress`
  Items have no `inPoint`/`outPoint` (Gantt items don't have media trim concepts). The component renders, drag/trim/delete work. The "Gantt" mode demonstrates the toolkit's neutrality on item-shape beyond the V.4 minimum.
  How: [playwright]
  Where: `.../playwright/spec.gantt-mode.js`
  Brief refs: 05/T-14

## §A.4 — Sandbox mode "Log" works (point-in-time items)

- [ ] §A.4 — Items where `start === end` (point events) render and behave correctly
  Edge case: zero-duration items render at minimum width (`var(--sgts-min-item-width)`). Selecting, deleting, undoing all work. No "duration must be > 0" assertion fires.
  How: [playwright]
  Where: `.../playwright/spec.log-mode.js`
  Brief refs: 05/T-15

## §A.5 — Sandbox mode "Animation" works (custom Playable)

- [ ] §A.5 — A custom Playable (animated SVG) attaches to sg-player-transport
  The Playable interface is implemented by an SVG-based animation renderer (NOT video, NOT audio). Play/pause/seek/scrub all work. This proves sg-player-transport's media-agnosticism.
  How: [playwright]
  Where: `.../playwright/spec.animation-mode.js`
  Brief refs: 05/T-16

## §A.6 — Fuzz mode survives 1000 items

- [ ] §A.6 — Sandbox in "Fuzz" mode generates 1000 random items across 10 tracks
  Component renders within 500ms. Frame rate during drag stays above 30fps on a mid-tier machine. No console errors, no memory leaks (heap stable for 60s of interaction).
  How: [playwright]
  Where: `.../playwright/spec.fuzz.js`
  Brief refs: 05/T-17

## §A.7 — No host-specific terms in toolkit source

- [ ] §A.7 — `grep -r` across all toolkit files (components and core modules) finds no occurrences of: `assetId`, `inPoint`, `outPoint`, `videoDuration`, `audioGain`, `mediaUrl`, `clipKind`, `mp4`, `webm`, `wav`, `mp3`, `frame`, `composer`
  Exception: `sg-project-storage.js` MAY contain `assetId` in the `assetIdRefs` walking helper (per doc 02 §6.4 — deliberate compromise documented).
  How: [script] — `scripts/check-no-host-leakage.sh`
  Where: every component / core module file
  Brief refs: 05/T-18

```bash
# scripts/check-no-host-leakage.sh
#!/bin/bash
PATHS=(
  components/sg-track-strip/v0/v0.1/v0.1.0/
  components/sg-toolbar/v0/v0.1/v0.1.0/
  components/sg-asset-panel/v0/v0.1/v0.1.0/
  components/sg-properties-panel/v0/v0.1/v0.1.0/
  components/sg-player-transport/v0/v0.1/v0.1.0/
  core/sg-history/v0/v0.1/v0.1.0/
  core/sg-config/v0/v0.1/v0.1.0/
  # sg-project-storage excluded; deliberate assetId reference
)
LEAKS=(assetId inPoint outPoint videoDuration audioGain mediaUrl clipKind mp4 webm wav mp3 frame composer)
for p in "${PATHS[@]}"; do
  for term in "${LEAKS[@]}"; do
    HITS=$(grep -rIn "\b$term\b" "$p" --include="*.js" --include="*.html" --include="*.css" --include="*.json" || true)
    if [[ -n "$HITS" ]]; then
      echo "LEAK: $term found in $p"
      echo "$HITS"
      exit 1
    fi
  done
done
echo "OK: no host-specific terms in toolkit source"
```

## §A.8 — V.4 schema is implementable without host knowledge

- [ ] §A.8 — Sandbox's project state container uses ONLY V.4-defined fields
  The sandbox's own state container has fields `id, start, end, color, label, locked, muted, kind` — and host-extension fields ONLY in the per-mode adapters (video/audio/gantt/log/animation), NOT in the core sandbox.
  How: [human] code review
  Where: `tools/.../sg-timeline-toolkit-sandbox/state-container.js`
  Brief refs: 05/T-19

## §A.9 — Toolkit components compile without core modules

- [ ] §A.9 — Each component can be imported and instantiated without `sg-history` or `sg-config` or `sg-project-storage`
  No component imports any core module. Verified by `grep -l "import.*sg-history\|sg-project-storage\|sg-config"` returning empty for component directories.
  How: [script]
  Where: all component dirs
  Brief refs: 05/T-20

## §A.10 — Manifest declares NO host-specific dependencies

- [ ] §A.10 — Each toolkit component's `manifest.json` `dependencies` lists ONLY: `sg-component`, `sg-tokens`, optionally `sg-tool-api` (for sandbox)
  No component manifest references `video-composer`, `audio-engine`, host-specific helpers, or other tools.
  How: [script]
  Where: all manifest.json files
  Brief refs: 05/T-21

---

# §B — Behaviour preservation (sg-video-editor v0.1.55 must equal v0.1.54)

Section B is owned by QA (brief 08). The bar: a user picks up v0.1.55 and finds it functionally equivalent to v0.1.54. No regressions, no missing features, no UX surprises.

## §B.1 — Project import / load round-trip

- [ ] §B.1 — Loading a v0.1.54-saved project in v0.1.55 produces visually identical state
  Pixel-identical timeline, identical assets, identical properties, identical playhead. `localStorage` migration path: v0.1.55 reads v0.1.54's `sgve:project:*` keys without modification.
  How: [playwright]
  Where: `tools/.../sg-video-editor/v0.1.55/playwright/spec.import-from-v054.js`
  Brief refs: 08/T-1

## §B.2 — Drag item within track

- [ ] §B.2 — User drags an item left/right within the same track
  Dispatches one `item-moved` op (pure). Snap behaviour matches v0.1.54 (snap to 100ms grid by default). Visual: drag preview follows cursor smoothly, drops on release with snap applied.
  How: [playwright]
  Where: `.../playwright/spec.drag-within-track.js`
  Brief refs: 08/T-2

## §B.3 — Drag item across tracks

- [ ] §B.3 — User drags an item from Track 1 to Track 3
  Dispatches one `item-moved` op (pure) with `fromTrackId !== toTrackId`. Item visually moves to Track 3 lane on drop. Track 1 lane no longer contains the item.
  How: [playwright]
  Where: `.../playwright/spec.drag-cross-track.js`
  Brief refs: 08/T-3

## §B.4 — Trim start handle

- [ ] §B.4 — User drags the start handle of an item to the right (shorten from start)
  Dispatches `item-trimmed` op (pure) with `payload.edge === 'start'`. The item's `start` field updates; `end` stays. If host-specific `inPoint` field exists (video editor only), the host updates it via its own logic in onApply.
  How: [playwright]
  Where: `.../playwright/spec.trim-start.js`
  Brief refs: 08/T-4

## §B.5 — Trim end handle

- [ ] §B.5 — User drags the end handle of an item to the left (shorten from end)
  Dispatches `item-trimmed` op with `payload.edge === 'end'`. The item's `end` field updates; `start` stays.
  How: [playwright]
  Where: `.../playwright/spec.trim-end.js`
  Brief refs: 08/T-5

## §B.6 — Split item at playhead

- [ ] §B.6 — User selects an item, positions playhead within it, presses 'S'
  Dispatches one `item-split` op (snapshot) per Q4 lock-in. Two new items appear with new IDs (in op.payload.newItemIds). The original item is removed. Undo restores the un-split item.
  How: [playwright]
  Where: `.../playwright/spec.split-item.js`
  Brief refs: 08/T-6

## §B.7 — Copy / paste item

- [ ] §B.7 — User selects an item, presses Cmd+C, repositions playhead, presses Cmd+V
  Dispatches `item-copied` op (snapshot) on paste — paste creates a new item at playhead position with a new ID, on the currently selected track. Undo removes the pasted item.
  How: [playwright]
  Where: `.../playwright/spec.copy-paste.js`
  Brief refs: 08/T-7

## §B.8 — Asset upload (drop file)

- [ ] §B.8 — User drops a video file onto the asset panel
  Dispatches `asset-add-requested` op (with-side-effects) with `sideEffects: ['blob-allocated']`. Host writes blob to IDB, registers asset metadata, calls `setAssets(updated)`. Asset appears in panel.
  How: [playwright]
  Where: `.../playwright/spec.asset-upload.js`
  Brief refs: 08/T-8

## §B.9 — Asset removal

- [ ] §B.9 — User clicks × on an asset row
  Dispatches `asset-remove-requested` op (with-side-effects). Host's onSideEffect schedules blob deletion; host's onApply removes the metadata. Asset disappears from panel.
  Edge case: items referencing the asset are NOT auto-removed; they show with a "missing" badge until user resolves.
  How: [playwright]
  Where: `.../playwright/spec.asset-remove.js`
  Brief refs: 08/T-9

## §B.10 — Asset drag onto track

- [ ] §B.10 — User drags an asset row onto Track 2
  Dispatches `asset-drag-started` (noisy) at drag start, then sg-track-strip emits `item-added` (snapshot) at drop. Host's onApply creates the item with the dropped asset's ID in its host-specific `assetId` field.
  How: [playwright]
  Where: `.../playwright/spec.asset-to-track.js`
  Brief refs: 08/T-10

## §B.11 — Properties panel: select item

- [ ] §B.11 — User clicks an item; properties panel shows the item's editable fields
  Section "TRANSFORM" with X, Y, Scale (number fields). Section "TIMING" with start, end (number fields, readonly per v0.1.54 convention). Section "VISUAL" with color, opacity. All fields show current values.
  How: [playwright]
  Where: `.../playwright/spec.properties-show.js`
  Brief refs: 08/T-11

## §B.12 — Properties panel: edit field

- [ ] §B.12 — User changes "X" from 100 to 200
  `<sg-properties-panel>` dispatches `field-changed` op (pure) with `fromValue: 100, toValue: 200`. Host's onApply mutates `item.transform.x` to 200. Item visibly moves on the canvas. Undo restores X=100.
  How: [playwright]
  Where: `.../playwright/spec.properties-edit.js`
  Brief refs: 08/T-12

## §B.13 — Properties panel: edit nested object field (per Q3a)

- [ ] §B.13 — Field type allows nested object value
  A field with `type: 'json'` (or similar) holds a nested transform matrix object. fromValue and toValue in the op are full JSON-serializable objects. Round-trip through save / load preserves them.
  How: [unit] + [playwright]
  Where: `components/sg-properties-panel/v0/v0.1/v0.1.0/test.spec.js` and `.../playwright/spec.properties-nested.js`
  Brief refs: 08/T-13

## §B.14 — Config panel replaces bespoke v0.1.54 implementation

- [ ] §B.14 — v0.1.55's Config tab uses `<sg-properties-panel>` + `sg-config`
  All checkboxes (Preview/Composer, Timeline renders, Autosave, Memory probe, Log composer rebuilds) work identically to v0.1.54. Log level select works identically. Reset to defaults button works.
  How: [playwright]
  Where: `.../playwright/spec.config-tab.js`
  Brief refs: 08/T-14

## §B.15 — Playback: play / pause / scrub

- [ ] §B.15 — Transport controls work via the Playable interface
  Play button starts playback (composer plays). Pause stops. Scrubber drag updates position smoothly. Time display updates every animation frame during playback. Behavior matches v0.1.54.
  How: [playwright]
  Where: `.../playwright/spec.playback.js`
  Brief refs: 08/T-15

## §B.16 — Keyboard shortcuts

- [ ] §B.16 — All v0.1.54 keyboard shortcuts work in v0.1.55
  Cmd+Z (undo), Cmd+Shift+Z (redo), Cmd+C (copy), Cmd+V (paste), S (split), Space (play/pause), Backspace/Delete (delete item), Cmd+drag (copy clip during drag).
  How: [playwright]
  Where: `.../playwright/spec.shortcuts.js`
  Brief refs: 08/T-16

## §B.17 — Undo all the way back

- [ ] §B.17 — Starting from an arbitrary state, repeated Cmd+Z reaches the project's load state
  After 30 ops (mixed pure/snapshot/with-side-effects), 30 undos restore the exact load-state including all blob storage. Redo 30 times restores the post-30-ops state.
  How: [playwright]
  Where: `.../playwright/spec.undo-deep.js`
  Brief refs: 08/T-17

## §B.18 — Save round-trip

- [ ] §B.18 — User saves a project, reloads page, opens the project — state is identical
  Tracks, items, assets, blobs, ui state (panel widths, zoom, selection) all restored. Op log restored if the host opted to persist it.
  How: [playwright]
  Where: `.../playwright/spec.save-load-roundtrip.js`
  Brief refs: 08/T-18

## §B.19 — Autosave-after-crash recovery

- [ ] §B.19 — User makes 5 edits, browser crashes (simulated via process kill), reopens — autosave is offered
  Recovery dialog shows the autosave's timestamp. Accepting restores all 5 edits.
  How: [playwright]
  Where: `.../playwright/spec.autosave-recovery.js`
  Brief refs: 08/T-19

## §B.20 — Round 9-K race fixes preserved

- [ ] §B.20 — All three race conditions documented in doc 02 §6.6 still don't trigger
  filename-race, beforeunload-after-clean-save, autosave-overwrites-newer-manual — verified via deterministic test harness that simulates the timing windows.
  How: [unit]
  Where: `core/sg-project-storage/v0/v0.1/v0.1.0/test.race-conditions.spec.js`
  Brief refs: 06/T-9

---

# §C — Capability matrix (features × components)

Section C verifies that the toolkit supports the capabilities listed in V.6 (op categories) across all components.

## §C.1 — Multi-track-rearrangement

- [ ] §C.1 — Drag item from Track 1 to Track 3, undo, redo
  Forward op records correctly. Backward apply re-inserts on Track 1 at correct index. Forward apply re-inserts on Track 3.
  How: [playwright]
  Where: sandbox
  Brief refs: 05/T-22

## §C.2 — Op category coverage (5 of 5)

- [ ] §C.2.a — `pure` op: undo + redo restores both states
  Test op: `item-moved`. After move, undo, redo: position is correct in all three states. No side-effect handler invoked.
  How: [unit]

- [ ] §C.2.b — `snapshot` op: undo restores full prior state
  Test op: `item-deleted`. After delete, undo: full item record restored from priorState (including all host-specific fields). No state loss.
  How: [unit]

- [ ] §C.2.c — `with-side-effects` op: side-effect handler invoked on undo
  Test op: `asset-add-requested`. After add, undo: onSideEffect called with `direction: 'backward'`. Blob is removed from IDB. Forward redo re-allocates blob.
  How: [unit] + [playwright]

- [ ] §C.2.d — `never` op: skipped past on undo
  Test op: telemetry-fire. Recorded but undo skips past it without invoking onApply.
  How: [unit]

- [ ] §C.2.e — `noisy` op: dropped by default (captureNoisy: false)
  Test op: `playhead-changed`. Recorded only if `captureNoisy: true`. Without capture, history.getOps() does NOT include it.
  How: [unit]
  Brief refs: 05/T-23

## §C.3 — Toolbar registration order matches render order

- [ ] §C.3 — Buttons added in order A, B, C render in order A, B, C
  Even with separators. Even with grouped buttons. Even with mid-life `removeButton` calls.
  How: [unit]
  Where: `components/sg-toolbar/v0/v0.1/v0.1.0/test.spec.js`
  Brief refs: 05/T-24

## §C.4 — Cross-component drag-drop (asset → track)

- [ ] §C.4 — Drag asset from sg-asset-panel to sg-track-strip
  MIME types match (panel sets the MIME, strip reads it). Drop fires `item-added` op on track-strip with `payload.assetRef` (host-specific field). Asset row's `asset-drag-ended` op fires with `accepted: true`.
  How: [playwright]
  Brief refs: 05/T-25

## §C.5 — Properties panel reacts to track-strip selection

- [ ] §C.5 — Selecting an item in sg-track-strip updates sg-properties-panel
  Host wires `item-selected` event to populate properties panel sections. Selection clearing clears panel.
  How: [playwright]
  Brief refs: 05/T-26

## §C.6 — sg-history op pipeline end-to-end

- [ ] §C.6 — Op flows: component → host listener → history.record → onApply (forward already done by host) → undo → onApply backward
  Telemetry, replay, persistence all observe the same op shape.
  How: [unit] + [playwright]
  Brief refs: 05/T-27

## §C.7 — replayOps does NOT re-emit toolkit events (per Q8)

- [ ] §C.7 — During replayOps, NO `sg-track-strip:*` events fire
  Replay calls onApply only. UI listeners don't re-fire. Test: attach event listener to track-strip, call replayOps, listener counts MUST stay at 0.
  How: [unit]
  Where: `core/sg-history/v0/v0.1/v0.1.0/test.replay.spec.js`
  Brief refs: 05/T-28

## §C.8 — sg-config + sg-properties-panel integration

- [ ] §C.8 — Config schema → toFields() → addSection → field-changed event → config.set
  Round trip: changing a checkbox in the panel updates localStorage. Reloading retrieves the new value.
  How: [unit] + [playwright]
  Brief refs: 05/T-29

## §C.9 — sg-config URL overrides

- [ ] §C.9 — `?config.log-level=silent` overrides stored value
  Stored value remains 'verbose' but `config.get('log-level')` returns 'silent' for the session. After tab close + reopen without URL param: 'verbose' again.
  How: [playwright]
  Brief refs: 05/T-30

## §C.10 — sg-config debug-mode

- [ ] §C.10 — `setDebugMode(true)` exposes debug fields in toFields()
  Field with `debug: true` not included by default. After enabling debug mode, toFields includes it. Re-rendering the panel section shows the field.
  How: [unit]
  Brief refs: 05/T-31

## §C.11 — sg-history pruning at budget edge

- [ ] §C.11 — At 10,001 ops, oldest non-snapshot-anchored op is pruned
  Test: record 10,005 pure ops. After each beyond 10,000, getOps().length stays at 10,000. Snapshot anchors (every 100th op) are preserved unless pruning crosses one.
  How: [unit]
  Brief refs: 05/T-32

## §C.12 — sg-project-storage usage reporting

- [ ] §C.12 — `computeStorageUsage()` returns accurate totals
  Save a project with 5 blobs (each 1 MB). Returned `blobBytes` ≈ 5_000_000 ± 5%. `usagePercent` reflects browser quota when available.
  How: [unit]
  Brief refs: 05/T-33

---

# §D — Quality gates

Section D covers cross-cutting concerns: performance, accessibility, manifest correctness, IFD discipline.

## §D.1 — Manifests validate

- [ ] §D.1 — Every toolkit component / module has a valid `manifest.json`
  Validates against schema in `library/components/manifest-schema/`. Required fields: `name`, `version`, `description`, `dependencies`, `actions` (for tools), `ops.emits` (for op-emitting components/modules).
  How: [script]
  Where: `scripts/validate-manifests.sh`
  Brief refs: 05/T-34

## §D.2 — `ops.emits` matches actual code

- [ ] §D.2 — Every op type in `manifest.json` `ops.emits` is actually emitted by the component's code
  And vice versa: every emitted op type appears in manifest. Detected by static analysis: regex-find `dispatchEvent(new CustomEvent(` strings, cross-check against manifest.
  How: [script]
  Where: `scripts/check-ops-manifest-match.sh`
  Brief refs: 05/T-35

## §D.3 — File LOC budgets

- [ ] §D.3 — Every component file is under its budget per doc 03 §F.1
  300 LOC hard for component JS, 350 soft. Exceeded files require explicit architect approval (recorded in commit message).
  How: [script]
  Where: `scripts/check-loc-budgets.sh`
  Brief refs: 05/T-36

## §D.4 — All components extend SgComponent

- [ ] §D.4 — Every component class declaration is `class X extends SgComponent { ... }`
  Verified by AST grep. NO `class X extends HTMLElement` in toolkit code.
  How: [script]
  Where: `scripts/check-sgcomponent-extension.sh`
  Brief refs: 05/T-37

## §D.5 — Three sibling files per component

- [ ] §D.5 — Each component dir has `tag.html`, `tag.css`, `tag.js`
  No template inlining via innerHTML in JS. CSS is in the .css file, not the .js.
  How: [script]
  Brief refs: 05/T-38

## §D.6 — sg-history performance under load

- [ ] §D.6 — Recording 10,000 ops completes in under 5 seconds on a mid-tier machine
  Each `record()` call is O(1) amortized. Pruning at the budget edge is O(1). Snapshot capture is O(state-snapshot-cost), governed by host's `onSnapshot`.
  How: [unit] perf benchmark
  Where: `core/sg-history/v0/v0.1/v0.1.0/test.perf.spec.js`
  Brief refs: 05/T-39

## §D.7 — sg-track-strip render performance

- [ ] §D.7 — Rendering 1000 items completes in under 500ms initial; under 16ms per re-render
  Per-track diffing avoids whole-component re-render on `setItems`.
  How: [unit] perf benchmark
  Brief refs: 05/T-40

## §D.8 — Accessibility: keyboard navigation

- [ ] §D.8 — All interactive elements reachable via Tab/Shift+Tab
  Focused element has visible focus ring. Enter/Space activates buttons. Escape closes popovers.
  How: [playwright] a11y suite
  Brief refs: 05/T-41

## §D.9 — Accessibility: ARIA roles

- [ ] §D.9 — Toolbar has `role="toolbar"`. Asset list has `role="list"`. Items have `role="listitem"`. Buttons have `aria-label` when icon-only.
  How: [playwright] a11y suite
  Brief refs: 05/T-42

## §D.10 — Accessibility: contrast

- [ ] §D.10 — Text contrast meets WCAG AA against `--sg-color-bg`
  All toolkit-defined CSS variables produce contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text.
  How: [playwright] a11y suite
  Brief refs: 05/T-43

## §D.11 — Storage usage warnings

- [ ] §D.11 — At 70% storage usage, warning appears in Config tab
  At 90%, blocking modal appears. Dismissing the modal does NOT prevent recurrence — every save attempt re-checks.
  How: [playwright]
  Brief refs: 06/T-10

## §D.12 — Bundle size budget

- [ ] §D.12 — Total toolkit JS payload (all 8 pieces, minified, gzipped) is under 60 KB
  Verified by build script. Each piece's contribution tracked in budget table; no piece exceeds 12 KB gzipped.
  How: [script]
  Where: `scripts/check-bundle-size.sh`
  Brief refs: 05/T-44

---

# §E — IFD discipline

Section E ensures the pack follows IFD per `library/development/ifd/v1.3.0__ifd__surgical-overrides-version-stamped-filenames.md`.

## §E.1 — All toolkit code at v0.1.0 paths

- [ ] §E.1 — Every toolkit file is under `vX/vX.Y/vX.Y.Z/` paths with `vX.Y.Z` immutable
  No edits to existing v0.1.0 paths after first commit. Bug fixes cause a v0.1.1 minor increment with full path duplication.
  How: [human] git log review
  Brief refs: all build briefs

## §E.2 — No edits to frozen versions

- [ ] §E.2 — `<sg-timeline>` v0.1.0 (existing component) is unchanged in this pack
  `git diff HEAD~N -- components/sg-timeline/v0/v0.1/v0.1.0/` returns empty for any N >= the pack's commit count.
  How: [script]
  Brief refs: 06/T-11

## §E.3 — sg-video-editor v0.1.55 uses NEW paths

- [ ] §E.3 — v0.1.55's import statements reference `components/sg-track-strip/v0/v0.1/v0.1.0/...`, NOT v0.1.0 of `<sg-timeline>`
  Plus other toolkit imports at their new paths. No imports of v0.1.54 internals.
  How: [script]
  Brief refs: 06/T-12

## §E.4 — sg-video-editor v0.1.54 unchanged

- [ ] §E.4 — `tools/v0/v0.1/v0.1.54/` has no diffs after the pack's first commit
  v0.1.54 is frozen; v0.1.55 is the active line. v0.1.54 stays at its path indefinitely.
  How: [script]
  Brief refs: 06/T-13

## §E.5 — Branch per session

- [ ] §E.5 — Every Sonnet implementer's work is on a branch named `claude/<description>-<session-id>`
  No direct commits to main from this pack's work. Main receives PR-merged commits only.
  How: [human] git log review
  Brief refs: all briefs

## §E.6 — One task = one acceptance check = one commit

- [ ] §E.6 — Per doc 03 §K.1: each commit message references a brief task ID and a checklist item
  Format: `feat(toolkit/<component>): [<brief-id>/T-N] [§<checklist-id>] <description>`
  Example: `feat(sg-track-strip): [05/T-1] [§A.7] Initial scaffold; no host leakage`
  How: [human] git log review
  Brief refs: all briefs

## §E.7 — Manifest deps point to specific versions

- [ ] §E.7 — Every `manifest.json` `dependencies` entry points to a specific version path, not a "latest" alias
  No `components/sg-component/v1/v1.0/latest/`; always `components/sg-component/v1/v1.0/v1.0.0/`.
  How: [script]
  Brief refs: 05/T-45

## §E.8 — No `git add -A` in commit history

- [ ] §E.8 — Commit history shows explicit `git add <path>` only
  Verified by reflog inspection of the implementer's working session.
  How: [human] reflog audit
  Brief refs: all briefs

## §E.9 — SKILL.md per component

- [ ] §E.9 — Every toolkit component / core module has a `SKILL.md` and `SKILL__api.md`
  SKILL.md describes when to use the component (in plain English for future Sonnet sessions). SKILL__api.md documents the API surface.
  How: [script] presence check
  Brief refs: 05/T-46

## §E.10 — Reality doc updated

- [ ] §E.10 — `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` mentions the new toolkit pieces
  Each new piece has a one-paragraph entry indicating its path, version, and purpose.
  How: [human]
  Brief refs: 06/T-14

---

# §F — Sonnet-implementer-friendliness gates

Section F is meta: did the brief tell the implementer enough? Caught at QA review.

## §F.1 — Each brief task has exactly one acceptance criterion

- [ ] §F.1 — Every task in 05, 06, 07 has a "Done when..." sentence
  No "Done when X works" — must specify the verifiable state (e.g. "Done when §B.4 is ticked").
  How: [human] brief review
  Brief refs: 05, 06, 07 (all)

## §F.2 — Each brief task has a DO-NOT section

- [ ] §F.2 — Every task with potential ambiguity has a "Do NOT do these" callout
  Especially: do not preserve old field names, do not import from sibling tools, do not fix unrelated bugs.
  How: [human] brief review
  Brief refs: 05, 06, 07 (all)

## §F.3 — Each brief task references a checklist item

- [ ] §F.3 — Every task in 05, 06, 07, 08 has a "Checklist refs: §X.N, §Y.M, ..." line
  Cross-checked against this doc.
  How: [script] regex scan of brief files
  Brief refs: all briefs

## §F.4 — Glossary on first reference

- [ ] §F.4 — In each brief, the first occurrence of a V.* vocabulary term is footnoted with a README ref
  Subsequent occurrences need no footnote.
  How: [human] brief review
  Brief refs: 05, 06, 07, 08

---

# §G — Cross-pack invariants

These items span the entire pack. They're checked once, late.

## §G.1 — Vocabulary consistency across docs

- [ ] §G.1 — Every event, op, method, and schema name in docs 02, 04, 05, 06, 07, 08 matches the README V.* section EXACTLY
  No "asset-uploaded" vs "asset-added"; no "track-strip" vs "trackstrip"; no fixed-up casing variants. Verified by extracting all backtick-quoted identifiers from each doc and cross-referencing.
  How: [script]
  Where: `scripts/check-vocabulary-consistency.sh`
  Brief refs: pack release

## §G.2 — All 8 pieces represented in every doc

- [ ] §G.2 — Docs 01, 02, 04 each cover all 8 pieces from V.1
  No piece missing from doc 02's component catalogue. No piece missing from §A or §C of this checklist.
  How: [human]
  Brief refs: pack release

## §G.3 — All 5 op categories represented in §C

- [ ] §G.3 — §C.2.a–§C.2.e cover all 5 categories from V.6
  Pure, snapshot, with-side-effects, never, noisy. Each has at least one verification item.
  How: [human]
  Brief refs: pack release

## §G.4 — All 11 architectural decisions referenced

- [ ] §G.4 — Every A-001 through A-011 from README is referenced by at least one task in 05, 06, 07, or 08
  No orphaned architectural commitment.
  How: [script]
  Brief refs: pack release

## §G.5 — Doc 09 parking-lot items NOT in any brief

- [ ] §G.5 — Tree-undo, sgit-vault storage, git-named API are NOT mentioned as in-scope by any brief
  These are doc 09 items, explicitly out of scope per A-011. Briefs may reference doc 09 for "if you find yourself needing this, stop and ask" guidance.
  How: [script] reverse-grep
  Brief refs: pack release

---

# §H — Pack release gate

When all of §A through §G are ticked, the pack is "complete." This is when the architect signs off.

- [ ] §H.1 — All §A items ticked (toolkit is generic)
- [ ] §H.2 — All §B items ticked (v0.1.55 preserves v0.1.54 behaviour)
- [ ] §H.3 — All §C items ticked (capability matrix complete)
- [ ] §H.4 — All §D items ticked (quality gates passed)
- [ ] §H.5 — All §E items ticked (IFD discipline observed)
- [ ] §H.6 — All §F items ticked (briefs are Sonnet-implementer-ready)
- [ ] §H.7 — All §G items ticked (cross-pack invariants hold)
- [ ] §H.8 — Architect (Villager) sign-off recorded in commit message

End of doc 04. Pass 2 part 2 of 2.
