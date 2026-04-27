# 01 — Architecture: SG Toolkit

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Doc revision:** rev 3 (Pass 1 update — adds sg-config as 8th piece, raises op-log budget defaults to 10k ops / 25 MB, locks sandbox name as `sg-timeline-toolkit-sandbox`)
**Doc role:** the spine — explains the WHY of the toolkit, the current state, and the target design. Every other doc in the pack assumes you've read this one.
**Audience:** architects, all team leads, every implementer.
**Lifetime:** durable. Update when the architecture changes.

> Read first: **`README.md`** in this folder, especially the **vocabulary appendix** (V.1–V.11), the **Decisions locked at the start of Pass 2** section, and the **Pass 1 revision history**. Every name in this doc is pinned in the README.

---

## §1 — What we have today

### §1.1 — sg-video-editor v0.1.54 in numbers

| Metric | Value |
|---|---|
| Tool path | `tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor/` |
| Lines of code (tool) | ~6,058 across 27 JS files in `ui/` and `api/` |
| Lines of code (sg-timeline component) | ~2,730 across 22 files |
| Lines of code (sg-video-composer core) | ~3,500 across 15 files |
| Public methods exposed via `window.__tool` | 40 |
| Custom events emitted | 21 (timeline) + 10 (preview) + 6 (export) |
| Persistence layers | localStorage (project JSON) + IndexedDB (asset blobs) |
| Numbered build rounds to ship | 9 (Round 1 through Round 9-L) |
| Commits touching the editor | 86 |

The reality-document paragraph for this tool runs ~12,000 words — long enough that the Librarian flagged it for decomposition. The full text is at `team/explorer/librarian/reality/v0.1.0__what-exists-today.md`, line containing "SG Video Editor".

### §1.2 — How the editor was built (compressed)

The editor was developed in nine numbered rounds. Each round delivered a coherent capability bundle. Compressed for the spine:

| Round | Headline | New code areas |
|---|---|---|
| 1 | Phase-0 probe — manifest scaffold + composer-schema + minimal preview | `composer-schema.js`, manifest, scaffold |
| 2 | Single-track timeline with drag/trim/click-select | `<sg-timeline>` v0.1.0, `<sg-preview-canvas>` v0.1.0 |
| 3 | Split + delete + auto-advance playback into dead space | `splitClip` op, hover-× delete, composer playback advance |
| 4 | Asset registry (Blobs in memory) + image clips + auto track-creation | `state.js` AssetRegistry, image-asset support |
| 5 | JSON pane + per-clip colour override + colour picker | `<sg-json-viewer>`, `setClipColor` op + UI |
| 6 | Undo/redo with snapshot stack (max 50) | `state-history.js`, Cmd+Z global shortcut |
| 7 | Overlap rejection (`Error{code:'overlap'}`) | `state-overlap.js` |
| 8 | Multi-track schema + composer rendering bottom-up stack | `addTrack`, `removeTrack`, `moveClipToTrack`, `reorderTracks`, multi-track composer scheduler |
| 9-A | Per-clip transform `{x, y, scale}` + crop `{x, y, w, h}` in composer | `composer-clip-fields.js`, `setClipTransform`, `setClipCrop` |
| 9-B | On-canvas overlay handles for move/crop modes | `preview-overlay-{move,crop,utils}.js`, mode buttons on toolbar |
| 9-C | Live mid-drag preview without composer rebuild | `composer-playback.updateProject` |
| 9-D | Shape + text clips (discriminated union via `kind` field) | `composer-clip-kinds.js`, `addShapeClip`, `addTextClip` |
| 9-E | Drag-drop polish: snap-abut, atomic cross-track move, auto-track-above on full overlap | `state-overlap.snapToClearSlot`, `withOverlapAutoTrackAbove` |
| 9-F | Track lock/rename + global keyboard shortcuts + cheatsheet panel | `setTrackLocked`, `renameTrack`, `ui-keyboard.js`, `ui-shortcuts-panel.js` |
| 9-G | Preview refresh fix + redraw button on transport bar | `composer.refresh()`, transport-bar button |
| 9-H | Editable project name + manual save/load to localStorage + beforeunload guard + debounced autosave + auto-select parent track + lock-check on splitClip | `state-storage.js`, `ui-save-load.js`, `ui-autosave.js`, beforeunload listener |
| 9-I | Timeline scroll fix + compact lanes + distinct track colours + fixed-width export button + post-export Download/Drag-out actions | sticky ruler/header CSS, `state-track-palette.js`, `ui-export-progress.js`, `ui-export-actions.js` |
| 9-J | Asset blobs in IndexedDB + async storage methods + storage-usage line | `state-asset-storage.js`, async `saveProject`/`loadProject`/`autosave`/`deleteSavedProject` |
| 9-K | Three surgical fixes: save-toast filename race + beforeunload-fires-after-clean-save + clip vs track selection visual prominence | `flushFocusedInput`, `markSaved(savedJson)`, CSS rebalance |
| 9-L | Removed Delete/Backspace shortcut (user feedback: "deleting a clip is a big thing, button is enough") | `timeline-keyboard.js` shortcut removed |

This compressed history is critical for the toolkit work. Each round's headline maps onto a generic capability the toolkit will preserve. The toolkit's verification checklist (doc 04) will reference these rounds by name.

### §1.3 — What this implies

The video editor is the **most architecturally interesting tool in the repo today**. It exercises every pattern the codebase uses:
- Web Components with shadow DOM
- Manifest-driven loader phases
- The `SgToolApi` JS-API primitive
- Frozen event-name constants
- File-size discipline (no file > 340 LOC)
- Skill-driven discoverability (`SKILL__{human,browser,api}.md`)
- Localstorage + IndexedDB persistence with orphan-pruning
- Per-tool versioned paths
- The sg-layout fractal panel system

Every one of those patterns is a candidate for a generic component or module. The **toolkit extraction is not "one tool became reusable"** — it's "the implicit toolkit that this one tool grew is being made explicit so the next five tools can use it without re-deriving it."

---

## §2 — What's coupled to what

This is the audit. Three categories: things already generic, things easy to genericise, things genuinely video-specific.

### §2.1 — Already generic (95% of `<sg-timeline>` is fine as-is)

The current `<sg-timeline>` component is, by line count, **about 95% domain-agnostic**. Listing what's already generic:

- **Ruler rendering** (`timeline-render.renderRuler`) — picks a tick interval based on pixels-per-second, formats as mm:ss. Time-axis-biased but works for any number axis with a label formatter swap.
- **Lane rendering** (`timeline-render.renderLanes`, `timeline-lane-render`) — iterates tracks, builds rectangles for items. Uses `clipDuration` and the auto-shade palette. No video-specific logic in the geometry.
- **Drag/drop interactions** (`timeline-interactions.js`, `timeline-clip-drag.js`, `timeline-drop.js`, `timeline-feedback.js`) — pointer-down → pointer-move → pointer-up state machines for trim, move, drop. Dispatches abstract events (`CLIP_MOVED`, `CLIP_TRIMMED`). Doesn't care what's IN a clip.
- **Track headers** (`timeline-track-headers.js`) — name, mute toggle, lock toggle, remove button, inline rename. None of this is video-specific.
- **Toolbar dom + zoom + clipboard buttons** (`timeline-toolbar-dom.js`, `timeline-zoom.js`, `timeline-clipboard-buttons.js`, `timeline-history-buttons.js`, `timeline-mode-buttons.js`, `timeline-split-button.js`, `timeline-track-buttons.js`, `timeline-color-picker.js`) — Undo/Redo, Copy/Paste, Split, +Track, zoom in/out/fit, mode buttons. None video-specific.
- **Keyboard handling** (`timeline-keyboard.js`, `timeline-focus.js`) — text-entry guard pierces shadow DOM correctly; the keyboard handler dispatches abstract events.
- **Selection state** (clip-selected, track-selected) — abstract.
- **Lock-aware UI** — locked tracks show stripe pattern, reject mutations. Abstract.
- **Sticky ruler / sticky header CSS** — Round-9-I scroll fix. Pure CSS, no domain.
- **Compact-lane heights** — pure CSS.

If all of the above stayed in place untouched, you'd have ~2,500 lines of working timeline component that just happens to be dressed in video-editor clothes.

### §2.2 — Easy to genericise (the thin coupling layer)

The actual coupling to video is **paper-thin**. Seven imports across seven files reach into `core/video-composer/` for **five helpers**:

| Importer file | What it imports | Coupling? |
|---|---|---|
| `timeline-render.js` | `getProjectDuration`, `getVideoTracks` | Coupled — `getVideoTracks` filters by `kind === 'video'` |
| `timeline-lane-render.js` | `clipDuration` | Generic — pure subtraction |
| `timeline-interactions.js` | `snapToFps` | Generic — pure rounding |
| `timeline-clip-drag.js` | `snapToFps` | Generic — pure rounding |
| `timeline-keyboard.js` | `snapToFps`, `clipTimelineEnd` | Generic — pure math |
| `timeline-split-button.js` | `snapToFps`, `clipTimelineEnd` | Generic — pure math |
| `timeline-zoom.js` | `getProjectDuration` | Coupled (transitively) — `getProjectDuration` calls `getVideoTracks` |

The genericisation removes one filter and renames one function:

- `getVideoTracks(project)` → `getAllTracks(project)`. Drops the `kind === 'video'` filter. Hosts that need filtering filter on their own side, before passing the project to the toolkit.
- `getProjectDuration(project)` → unchanged in name, but uses the new `getAllTracks`.
- `snapToFps(t, fps)` → `snapToGrid(t, gridSize)`. Same math, generic name.
- `clipDuration(clip)` → `itemDuration(item)`. Same math.
- `clipTimelineEnd(clip)` → `itemEnd(item)`. Same math.

These five helpers move into the toolkit's own module (`core/sg-track-strip-math/v0/v0.1/v0.1.0/sg-track-strip-math.js` or similar — final path TBD by the implementer of brief 05). They're 50 lines of code total. **The current "video-coupling" is five renames and one removed filter.**

### §2.3 — Genuinely video-specific (and where it lives in a clean toolkit)

A small layer is irreducibly video-specific. This is what doesn't extract — and that's correct, because a toolkit that contained it wouldn't be generic.

| Concern | File today | Where it lives in the toolkit world |
|---|---|---|
| Resolving an asset's display name | `timeline-clip-label.js` (`clipAsset`, `clipLabel`) | Host's adapter — passes a `getItemLabel(item)` callback to the toolkit, or sets `item.label` directly |
| `kind: 'video'` track filter | `composer-schema.getVideoTracks` | Host's adapter — tracks pass through unfiltered; host can filter before passing |
| Image-asset detection (`[img]` label prefix) | `timeline-clip-label.clipLabel` | Host's adapter — host computes the label string from its own asset registry |
| `application/x-sg-asset` drag MIME | Implicit in `<sg-timeline>` drop handler + asset-row drag handler | Host configures via `<sg-asset-panel>.setDragMime(...)` |
| Clip transform/crop fields | composer + preview overlay | Stays in the video editor's own code — toolkit's `<sg-track-strip>` doesn't know about per-frame transforms |
| Composer playback / export | composer modules | Stays in the video editor's own code — toolkit's `<sg-player-transport>` is a generic surface that the host attaches a Playable to |
| `inPoint`/`outPoint` source-media trim | composer-schema | Stays in the video editor — toolkit knows only `start`/`end` on the timeline axis |

The right way to think about this: **the toolkit knows about the timeline, items on tracks, drag, snap, lock, and selection. It does NOT know about media, playback, source-media trimming, frames, or codecs.** Those are the host's domain.

### §2.4 — File-by-file coupling map

For brief 05's implementer: this is the exhaustive map of what changes vs what stays.

```
components/sg-timeline/v0/v0.1/v0.1.0/        components/sg-track-strip/v0/v0.1/v0.1.0/
─────────────────────────────────────         ──────────────────────────────────────────

sg-timeline.js                       ──→     sg-track-strip.js              (rename + extend SgComponent)
sg-timeline.css                      ──→     sg-track-strip.css             (rename CSS classes from .clip → .item, .track-* unchanged)
                                              sg-track-strip.html            (NEW — extracted from inline innerHTML, per A-003)

timeline-events.js                   ──→     events.js                      (rename SGT_EVENTS → SGTS_EVENTS, see V.2.1)
timeline-render.js                   ──→     render.js                      (drop video-composer imports, use local math module)
timeline-lane-render.js              ──→     lane-render.js                 (rename .clip → .item)
timeline-track-headers.js            ──→     track-headers.js               (verbatim, just rename)
timeline-toolbar-dom.js              ──→     [REMOVED — toolbar is now sg-toolbar component]
timeline-zoom.js                     ──→     zoom.js                        (drop video-composer import)
timeline-clipboard-buttons.js        ──→     [MOVED to sg-toolbar consumer wiring in sandbox / video editor]
timeline-history-buttons.js          ──→     [MOVED to sg-toolbar consumer wiring]
timeline-mode-buttons.js             ──→     [MOVED to sg-toolbar consumer wiring]
timeline-split-button.js             ──→     [MOVED to sg-toolbar consumer wiring]
timeline-track-buttons.js            ──→     [MOVED to sg-toolbar consumer wiring]
timeline-color-picker.js             ──→     [MOVED to sg-toolbar consumer wiring]
timeline-clip-label.js               ──→     [REMOVED — host computes labels via item.label or callback]
timeline-clip-drag.js                ──→     item-drag.js                   (drop video-composer import)
timeline-drop.js                     ──→     drop.js                        (rename .clip → .item)
timeline-events.js                   ──→     events.js                      (already covered)
timeline-feedback.js                 ──→     feedback.js                    (rename .clip → .item)
timeline-focus.js                    ──→     focus.js                       (verbatim — already generic)
timeline-interactions.js             ──→     interactions.js                (drop video-composer import; add itemMime parameter)
timeline-keyboard.js                 ──→     keyboard.js                    (drop video-composer import)
timeline-lane-finder.js              ──→     lane-finder.js                 (verbatim)
timeline-render.js                   ──→     render.js                      (already covered)

                                              sg-track-strip-math.js         (NEW — 5 generic math helpers extracted from composer-schema)
```

The toolbar buttons being removed from `<sg-track-strip>` is **the most consequential change** in the refactor. The track-strip becomes purely a surface; the toolbar is a separate component the host composes into the page. This is decision A-001 in the README.

---

## §3 — The eight toolkit pieces, conceptually

(Doc 02 will give the heavy spec for each. This section gives the **why** for each one — what it IS and what its existence proves.)

### §3.1 — `<sg-track-strip>`

The surface. Ruler, lanes, items rendered as rectangles, playhead, drag/trim/snap/select/lock semantics.

**Why it exists:** Every editor-shaped tool has this. Audio editors do (waveform-displayed clips on lanes). Animation editors do (keyframes on property tracks). Schedulers do (Gantt rows). Log viewers do (events on a time axis). The geometry is the same; only the contents of the rectangles differ.

**What its existence proves:** That the geometry of "things on tracks against a ruler" is a generic primitive in this codebase, not video-editor-specific.

### §3.2 — `<sg-toolbar>`

A generic toolbar component. Buttons registered programmatically, optional groups, optional popovers, enable/disable/active state controlled by the host.

**Why it exists:** sg-video-editor has 5+ toolbar implementations scattered across `timeline-*-buttons.js` files. Each one re-derives popover focus management, enable-state plumbing, and click handling. The audio editor would do it again. The animation editor would do it again. Extracting it once costs less than three re-derivations.

**What its existence proves:** That UI chrome can be extracted from domain logic without losing the link between them — buttons are just registered listeners; the host decides what they DO.

### §3.3 — `<sg-asset-panel>`

A list of asset rows with selection, drag-source, and missing-blob-placeholder semantics.

**Why it exists:** sg-video-editor has `ui/ui-asset-panel.js` and `ui/asset-row.js` doing this. Every editor that imports media (video, audio, images, animations, fonts, code-snippets-as-attachments) needs the same pattern: row with name, optional thumbnail, drag handle, × delete, "missing — re-upload" hint when the underlying blob isn't in IDB.

**What its existence proves:** The asset-management UI is decoupled from what an asset IS. The toolkit knows "items in a list, draggable, removable, possibly missing." The host knows "this asset is a 4K video with a 30-second probe duration."

### §3.4 — `<sg-properties-panel>`

A right-rail key/value editor with sectioned fields. Inline-rename pattern (Enter saves, Escape cancels, blur saves, focus-aware re-rendering). Field types: text, number, select, color, checkbox, button.

**Why it exists:** sg-video-editor has `ui/ui-properties-panel.js`, `ui/ui-prop-fields.js`, `ui/ui-prop-project.js` doing this — ~500 LOC of properties machinery. The Round-9-H notes in the reality doc explicitly call out the field/row builders being extracted "so future per-project settings (fps, output resolution, …) plug in there as one-block extensions." That extraction was already done within the editor — this pack pulls it one level higher into the toolkit.

**What its existence proves:** Edit-in-place inspector UI is a primitive, not an editor-specific feature. The same component drives properties for clips in a video editor, properties for events in a log viewer, properties for nodes in a graph editor.

### §3.5 — `<sg-player-transport>`

A preview surface (canvas or other "viewport") + transport bar (back / play / forward / refresh + position readout). Host attaches a `Playable` (something that can play, pause, seek, refresh, report position).

**Why it exists:** sg-video-editor's `<sg-preview-canvas>` is half-this. It currently bakes in the canvas surface, but the transport bar pattern is generic. An audio editor needs a transport. An animation player needs a transport. A debugger that steps through frames of a captured render needs a transport.

**What its existence proves:** Transport controls are decoupled from what's being played. The toolkit's transport doesn't know about pixels or audio samples; it knows about positions and play/pause/seek/refresh.

**Note:** the **canvas itself** does NOT extract — `<sg-player-transport>` provides a slot/host element that the consumer fills with their own surface (canvas for video, waveform for audio, SVG for animations). Extracting the canvas would couple the toolkit to a specific render technology.

### §3.6 — `sg-project-storage` (JS module, not Web Component)

The save / load / autosave / IDB-blob pattern from Round-9-H + Round-9-J + the Round-9-K race-fixes, generalised. Host-configurable storage keys so multiple tools coexist in the same browser without collision.

**Why it exists:** sg-video-editor's `ui/state-storage.js` + `ui/state-asset-storage.js` + the Round-9-K race-fixes are ~600 LOC of subtle, well-tested persistence machinery. The audio editor needs identical machinery. The animation editor needs identical machinery. Re-deriving it would re-introduce the same bugs (Round-9-K's filename-race + beforeunload-after-clean-save) the video editor already debugged.

**Why a module not a component:** Persistence has no UI. Components are for things with shadow DOM and event surfaces; persistence is pure async functions. Don't conflate the two.

**What its existence proves:** The browser-side state-management problem is solved once, well, in this repo, and it's reusable.

**What it now also stores:** With Pass-1 rev-2, the save shape is a `{project, ui?, ops?}` envelope. The `ui` slot is host-defined — it lets tools round-trip sg-layout panel widths, scroll positions, zoom levels, and any other UI state. The `ops` slot optionally carries a serialised op log from `sg-history`, enabling "load and replay" or "load and rewind" workflows. Both are opt-in per tool.

### §3.7 — `sg-history` (JS module, not Web Component)

The op-based history component. Replaces the snapshot-stack history at `sg-video-editor/ui/state-history.js` with an op-shaped, category-aware, side-effect-aware history store.

**Why it exists.** The current sg-video-editor has flat-stack history with full-project snapshots, capped at 50. It works but has three problems: (1) memory cost — 50 snapshots of a non-trivial project is 5–50 MB, (2) opacity — you can scrub the project state forward and backward, but you can't see *what changed*, (3) re-derivation — every editor-shaped tool would re-implement this and re-introduce the same bugs.

The op-based approach fixes all three: ops are 50–200 bytes each (100x more history for less memory), each op describes the change explicitly (great for debugging, telemetry, agent observation, replay), and the implementation is shared infrastructure not per-tool code.

**The 5-category taxonomy.** Every op declares a `reversible` category — see V.6 in the README. The five categories — `pure`, `snapshot`, `with-side-effects`, `never`, `noisy` — are exhaustive against the existing video editor's mutations (see V.6.6 mapping table) and generic enough to cover audio editors, animation editors, log viewers. Each category gets different undo treatment: pure ops swap from/to fields, snapshot ops restore captured priorState, side-effect ops trigger host-registered rollback handlers, never ops record-but-block-undo, noisy ops are coalesced out of the undo stack.

**Why a module not a component.** Same reason as `sg-project-storage`: history has no UI. The toolbar buttons (Undo/Redo) are part of `<sg-toolbar>`; the tree visualization (when it eventually lands) will be a separate component built ON TOP of `sg-history`. The history module itself is pure event/data.

**What its existence proves.** That op-driven undo/redo is generic infrastructure, not editor-specific. And — through the deliberate API choice of `record/undo/redo/goTo/replayOps` instead of git verbs — that storage compatibility (with sgit vaults, future) is a serialisation question, separable from API semantics.

**What's NOT in this v0.1.0 (and is parking-lotted in doc 09):**
- Tree-based undo with branching (current v0.1.0 is flat-stack; data structure designed to support tree extension without API changes)
- UI for navigating the history (toolbar buttons only; no timeline-of-history viewer)
- sgit-vault as undo storage backend (current backend is in-memory; serialisation shape is sgit-compatible for future)
- Git-named API (clone/branch/push/pull/merge — explicitly rejected in doc 09)
- Collaborative ops (remote-source ops merging with local pending — `source` field accommodates them but no merge semantics)

**Performance budget.** v0.1.0 targets 10,000 ops or 25 MB whichever first. Snapshot anchors every 100 ops for fast `goTo(position)`. Beyond budget: oldest non-snapshot-anchored ops are pruned (lossy but bounded; tools that need lossless history use the `ops` slot of `sg-project-storage` to persist). The host's Config tab (via `sg-config` + `<sg-properties-panel>`) surfaces current usage to the user; warning thresholds at 70%/90% drive UI affordances. Hosts that want lossless full history beyond the budget MAY raise `maxOps` and `maxBytes` arbitrarily — the defaults are sensible-for-most, not hard ceilings.

### §3.8 — `sg-config` (JS module, not Web Component)

The per-tool configuration component. Holds settings like "Autosave on/off," "Log level: verbose," "Re-render timeline on every state change," "Memory probe enabled," etc. Persists to localStorage. Supports URL-parameter overrides for support and debugging.

**Why it exists.** The video editor v0.1.54 has a Config tab (visible in the screenshot from the lock-in conversation) with checkboxes for `Preview/Composer`, `Timeline renders`, `Autosave`, `Memory probe`, `Log composer rebuilds`, a select for `Log level`, and a `Reset to defaults` button. The audio editor will need similar. The animation editor will need similar. The agent-replay tool will need similar. Each tool's config schema is different, but the machinery (schema-driven UI, persistence, defaults, overrides, reset, snapshot/restore) is identical.

Without `sg-config`, every tool re-derives config plumbing. With `sg-config`, the tool declares its schema and the rest is inherited.

**Why a module not a component.** Same reason as `sg-project-storage` and `sg-history`: config has no native UI of its own. The UI is `<sg-properties-panel>` — a separate component that already does sectioned key-value editing. `sg-config` provides a `toFields()` helper that maps the config schema into the V.4 Field shape that `<sg-properties-panel>` consumes. Two existing pieces compose; no third UI primitive needed.

**What it IS, concretely:**
- A schema-declared key-value store with typed fields (boolean, number, string, select, color)
- localStorage persistence under a per-tool namespace (e.g. `sgve:config`, `sgae:config`)
- URL-parameter overrides for one-session changes (`?config.log-level=silent` overrides the stored value for the tab)
- A `reset(key?)` method for "Reset to defaults" UX
- Op-shaped change events so config edits flow through the standard op pipeline (and are therefore undoable)
- Debug-tier fields (e.g. `Memory probe`) hidden by default, exposed via `setDebugMode(true)`
- Snapshot export/import for support bundles ("export your config so I can reproduce")

**What it is NOT:**
- A general-purpose forms library
- A user-preferences/account-settings system (those are server-side; this is per-tool browser-local)
- A feature-flag service (no remote source-of-truth; URL overrides are the closest)

**What its existence proves:** that the config concern is generic and orthogonal to UI shape. A graph editor's config has the same plumbing as a video editor's; only the schema differs.

**Scope vs. UI state.** Config is per-tool persistent settings (autosave, log level, debug toggles). UI state is per-project visual state (panel widths, scroll, selected item). They are stored in different places, addressed by different scopes, and serve different purposes:

| Concern | Storage | Scope | Example |
|---|---|---|---|
| Config | `localStorage` via `sg-config` | Per tool | "Autosave: on" |
| UI state | `ui` slot of save envelope via `sg-project-storage` | Per project | "Asset panel width: 280px" |
| Project state | `project` slot of save envelope | Per project | tracks, items, assets |
| Op log | `ops` slot of save envelope (optional) | Per project | recorded ops since project load |

Tools that get this distinction right have predictable cross-project behaviour. Tools that conflate them get bug reports like "my config disappeared when I opened a different project" or "my zoom level reset every time I reload."

---

## §4 — Target architecture

This is what the world looks like after this pack lands.

### §4.1 — Layered diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  HOST TOOL  (e.g. sg-video-editor v0.1.55, sg-audio-editor v0.1.0)   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Tool-specific code:                                           │  │
│  │   - manifest.json + SKILL files                                │  │
│  │   - api/{tool}-api.js (registers SgToolApi methods)            │  │
│  │   - ui/state.js (tool state container)                         │  │
│  │   - ui/{tool}-adapter.js (maps tool schema ↔ toolkit schema)   │  │
│  │   - ui/ui-shell.js (composes the toolkit components)           │  │
│  │   - tool-specific UI bits (e.g. preview canvas for video)      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                  │ uses
┌──────────────────────────────────────────────────────────────────────┐
│  THE TOOLKIT (this pack's deliverable)                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │ <sg-track-strip> │  │  <sg-toolbar>    │  │ <sg-asset-panel> │    │
│  │  (the surface)   │  │  (chrome)        │  │  (asset list)    │    │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
│  ┌──────────────────┐  ┌──────────────────────┐  ┌─────────────────┐ │
│  │ <sg-properties-  │  │ <sg-player-          │  │ sg-project-     │ │
│  │  panel>          │  │  transport>          │  │  storage (mod)  │ │
│  │ (inspector)      │  │ (transport+slot)     │  │ (LS + IDB)      │ │
│  └──────────────────┘  └──────────────────────┘  └─────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                                  │ extends / consumes
┌──────────────────────────────────────────────────────────────────────┐
│  EXISTING REPO PRIMITIVES (unchanged by this pack)                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │  <sg-layout>     │  │  SgToolApi       │  │  SgComponent     │    │
│  │  (panels)        │  │  (JS-API base)   │  │  (component base)│    │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
│  ┌──────────────────────────────────────┐                            │
│  │  sg-tokens.css (design tokens)       │                            │
│  └──────────────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────────────┘
```

### §4.2 — Composition rules

A host tool composes the toolkit by:

1. **Declaring dependencies in `manifest.json`** — see vocabulary V.8.
2. **Registering with `SgToolApi`** — the tool's API methods (e.g. `loadAsset`, `addClip`, `exportMp4` for the video editor) are registered through SgToolApi as today. The toolkit components are NOT `SgToolApi` consumers — they're plain Web Components.
3. **Writing an adapter layer** — a `ui/{tool}-adapter.js` file maps the tool's domain schema (e.g. clips with `assetId`, `inPoint`, `outPoint`) to the toolkit's generic `Item` schema (with `start`, `end`, `label`). The adapter is the only place where domain meets generic.
4. **Composing the components inside `<sg-layout>`** — the existing fractal layout pattern. The toolkit components mount inside layout panels just like any other Web Component would.
5. **Wiring events through the adapter** — the toolkit emits `sg-track-strip:item-moved`; the adapter translates to `state.moveClipOp({clipId, timelineStart})`; the state container fires its `change` event; the host re-renders by passing the new project through the adapter back to `<sg-track-strip>.setProject(...)`.

Crucial: **the toolkit components NEVER call `state.*` methods directly.** They emit events, the adapter routes events to state, state emits change, host re-renders. This is the strict event-driven flow the codebase already uses. See doc 03 §5.

### §4.3 — The adapter layer in concrete terms

The smallest possible adapter for the video editor would look like this (illustrative, not the actual brief 06 spec):

```js
// ui/video-editor-adapter.js (sg-video-editor v0.1.55, illustrative)

import { SGTS_EVENTS } from '/components/sg-track-strip/v0/v0.1/v0.1.0/events.js';

/**
 * Map the editor's video-domain project to the toolkit's generic shape.
 * Called whenever state.change fires — cheap, runs in <1ms for typical projects.
 */
export function projectToGeneric(project) {
    return {
        schemaVersion: project.schemaVersion,
        name: project.project.name,
        tracks: project.tracks.map(track => ({
            id: track.id,
            kind: track.kind,                    // toolkit doesn't filter; passes through
            name: track.name,
            color: track.color,
            muted: track.muted,
            locked: track.locked,
            items: track.clips.map(clip => ({
                id: clip.id,
                start: clip.timelineStart,
                end: clip.timelineStart + (clip.outPoint - clip.inPoint),
                color: clip.color,
                label: resolveClipLabel(clip, project),  // [img] / [shape] / asset name
                // host-specific fields preserved for round-trip
                _clip: clip,
            })),
        })),
    };
}

/**
 * Translate toolkit events back to state operations.
 */
export function attachAdapter(trackStripEl, state, api) {
    trackStripEl.addEventListener(SGTS_EVENTS.ITEM_MOVED, (e) => {
        api.moveClip({clipId: e.detail.itemId, timelineStart: e.detail.start, snap: e.detail.snapped});
    });
    trackStripEl.addEventListener(SGTS_EVENTS.ITEM_TRIMMED, (e) => {
        // toolkit knows start/end on timeline axis; editor needs to translate to inPoint/outPoint
        const clip = state.getClipById(e.detail.itemId);
        const newDur = e.detail.end - e.detail.start;
        api.trimClip({clipId: e.detail.itemId, outPoint: clip.inPoint + newDur});
    });
    // ... etc for every event in V.2.1
}
```

This adapter is ~200 lines for the full video editor. It's the entire delta between "v0.1.54 did everything itself" and "v0.1.55 delegates to the toolkit."

### §4.4 — What stays in the host (sg-video-editor v0.1.55)

After the refactor, the editor still owns:
- The composer (`core/video-composer/`) — frames, audio, MP4 export, none of which is toolkit territory
- Per-clip transform/crop overlay UI (the `<sg-preview-canvas>` overlay handles in `'move'`/`'crop'` modes)
- Source-media trim (`inPoint`/`outPoint`) semantics — the toolkit only knows timeline `start`/`end`
- Asset probing (the hidden `<video>` element that reads dimensions/duration on `loadAsset`)
- Export pipeline (`exportMp4`, the `MediaRecorder` orchestration, the WebM→MP4 fallback via FFmpeg WASM)
- Shape and text clips (these are video-editor-specific; the toolkit is item-shape-agnostic)

What it stops owning:
- The timeline surface (now `<sg-track-strip>`)
- Toolbar buttons (now `<sg-toolbar>` with registered listeners)
- The asset panel chrome (now `<sg-asset-panel>`)
- The properties panel chrome (now `<sg-properties-panel>`)
- The save/load/autosave/IDB machinery (now `sg-project-storage`)
- The transport bar (now `<sg-player-transport>`, with the editor's own canvas as the slotted surface)

---

## §5 — Use cases the toolkit must support

These are the use cases the toolkit's design must accommodate. Doc 04 turns each into a verification item. The sandbox tool (in brief 05) must demonstrate at least the first three.

### §5.1 — Video editor (the existing case, refactored)

- Tracks are video tracks (one or more lanes, top wins z-order)
- Items are clips with `start`/`end` (mapped from `timelineStart` + `inPoint`/`outPoint`)
- Items have host-computed labels (asset name, `[img]` prefix for images, `[shape]` / `[text]` for synthetic clips)
- Drag from asset panel to track strip with MIME `application/x-sg-asset`
- Transport plays the composer's playback handle
- Properties panel shows project name, project metadata, and per-clip transform/crop
- Save/load via `sg-project-storage` with `projectKeyPrefix: 'sgve:project:'`

**Validation:** brief 06's regression suite (08) must pass 100%.

### §5.2 — Audio editor (greenfield, brief 07)

- Tracks are audio tracks (one or more lanes; muting silences, locking prevents edits)
- Items are audio clips with `start`/`end` plus host-specific waveform-cache fields
- Items have host-computed labels (clip filename, optional duration formatted as `h:mm:ss`)
- Drag from asset panel to track strip with MIME `application/x-sg-audio-asset`
- Transport plays a Web-Audio-graph handle (host-provided `Playable`)
- Properties panel shows project metadata, per-clip gain, per-clip pan
- Save/load via `sg-project-storage` with `projectKeyPrefix: 'sgae:project:'`

**Validation:** brief 07 ships a working Phase 1 audio editor. Sandbox tool's audio mode must render audio-shaped synthetic data.

### §5.3 — Gantt scheduler (illustrative, sandbox-only)

- Tracks are resources (people, machines, rooms)
- Items are tasks with `start`/`end` (positions in time, days/weeks)
- No transport (scheduling has no playback)
- No asset panel (tasks are created from a different UX)
- Properties panel shows task assignee, deadline, dependencies
- Save/load via `sg-project-storage` with `projectKeyPrefix: 'gantt:project:'`

**Validation:** sandbox tool can render 3-track Gantt synthetic data with non-time positions. Proves the toolkit doesn't bake in time-axis assumptions in geometry.

### §5.4 — Log viewer (illustrative, sandbox-only)

- Tracks are log streams (different services, different log levels)
- Items are log events with `start` only (no `end` — point-in-time markers, rendered as zero-width pins)
- No transport (logs don't replay; though some will want a "scrubber" semantic)
- No asset panel
- Properties panel shows log message, severity, source, raw payload

**Validation:** sandbox tool's log mode renders point-in-time items (items with no `end`) correctly. Proves zero-width items work.

### §5.5 — Animation timeline (illustrative, sandbox-only)

- Tracks are properties of an animated object (x, y, opacity, scale)
- Items are keyframes with `start` only (point-in-time) and a `value` field (host-specific, ignored by toolkit)
- Transport plays the animation
- Properties panel shows keyframe value, easing curve, interpolation type

**Validation:** sandbox tool's animation mode renders keyframes with property-track headers. Proves track-headers component works for non-asset use cases.

### §5.6 — Agentic workflow timeline (illustrative, future)

- Tracks are agents (Conductor, Sherpa, AppSec, Architect, Dev, ...)
- Items are LLM calls / tool invocations with `start`/`end` (wall-clock duration)
- No transport (history viewer)
- Asset panel could show recordings of each call
- Properties panel shows prompt, response, tokens used, tool calls made

**Validation:** sandbox tool COULD render this; not required for v0.1.0 of the toolkit but should not be precluded by design.

### §5.7 — Op-based use cases (cross-cutting; enabled by sg-history)

These are use cases that don't have a "shape" of their own (they're not a new editor type) but are unlocked by the op-driven architecture. Each one was either impossible or expensive in the current sg-video-editor; each becomes cheap once op-shaped events and `sg-history` are in place.

**Replay-from-log.** Save a project's op log to localStorage or to an sgit vault; later, load the empty project and replay the ops to reach the same state. This is the foundation of "show me how the user got here" workflows. Cost in this pack: zero — falls out of `sg-history.replayOps()` and the `ops` slot in `sg-project-storage`'s save envelope.

**Time-travel debugging.** A bug report includes the op log; the developer loads it and steps through ops one by one until the bug surfaces. No screen recording needed; the op log IS the bug-reproduction script. Especially valuable for transient state bugs (drag mid-trim crashes; race in autosave) where the snapshot-before-bug is hard to capture but the op-sequence-leading-to-bug is trivial.

**Agent observation.** When an agent operates a tool through `window.__tool` API methods, every action emits an op (the `source: 'agent'` field distinguishes from user ops). The history is auditable, replayable, attributable. This is the foundation of "what did the agent do during this session" workflows.

**Telemetry without invasive instrumentation.** Aggregating ops by `type` answers questions like "how often do users use Split vs. just delete-and-re-add?" without adding new tracking calls. The ops are already there.

**Auto-suggest from patterns.** "User has snapped manually 3 times in the last 5 ops; offer 'Snap mode'." Pattern matching against the op log. Not in scope for this pack; enabled by it.

**Conditional warnings.** "User is about to delete 10 clips; show confirmation." The pre-op event lets the host inspect what's coming and gate destructively-categorised ops. Especially powerful with the `reversible: 'never'` category.

**UI state round-trip.** Save panel widths, scroll positions, expanded property sections in the `ui` slot of the save envelope. User reopens the project and finds it visually identical to where they left off. Not strictly an op-based use case, but lands in the same Pass-1 rev-2 expansion of `sg-project-storage`.

These use cases are not ALL implemented in this pack. Some are: replay-from-log (sandbox demonstrates it), agent observation (the op shape's `source` field is in place), UI state round-trip (the `ui` envelope slot exists). Others are seeds for future work — but the architecture in this pack does not preclude any of them.

---

## §6 — The sandbox tool: why it's the spec

Brief 05 ships two things: the toolkit, and a sandbox tool. The sandbox is the toolkit's **executable spec**.

### §6.1 — What the sandbox does

The sandbox tool (`tools/.../sg-timeline-toolkit-sandbox/v0.1.0/`) is a single page with:

- A mode switcher: Video, Audio, Gantt, Log, Animation
- Each mode loads synthetic data shaped for that domain
- The toolkit components are mounted in `<sg-layout>` and driven by the synthetic data
- A "fuzz" button that randomly mutates data to stress-test edge cases (1000 items, items with negative `start`, overlapping items, locked tracks, very long names, very short items)
- A debug pane that shows every event the toolkit emits, the project JSON, and storage usage

### §6.2 — Why the sandbox IS the spec

If the sandbox renders Gantt rows correctly without anything in the toolkit knowing about Gantt, the toolkit is generic. If the sandbox needs an `if (mode === 'gantt')` somewhere in the toolkit, the toolkit has leaked. The sandbox is therefore the test that proves genericness.

The sandbox is also:
- The reproducer for any bug found in the video editor refactor (does the bug repro in the sandbox? if not, it's the editor's problem; if yes, it's the toolkit's problem)
- The demo for the audio-editor team to learn what the toolkit can do
- The verification environment for every checklist item in doc 04 §A (genericness) and §C (capability matrix)

### §6.3 — Why the sandbox tool ships before the video editor refactor

Phase 4 (build toolkit + sandbox) and Phase 5 (refactor video editor) are sequential, not parallel. The reason: if the sandbox isn't there to validate the toolkit independently, the refactor team will end up debugging the toolkit and the editor at the same time. That's how subtle regressions get introduced. Sandbox first. Sandbox passes verification. Then refactor.

---

## §7 — Migration strategy

### §7.1 — Old code stays

- `<sg-timeline>` v0.1.0 stays at its current path, untouched, deployed.
- `sg-video-editor` v0.1.54 stays at its current path, untouched, deployed.
- The new `<sg-track-strip>` v0.1.0 ships at a new path.
- The new `sg-video-editor` v0.1.55 ships at a new path (under `tools/v0/v0.1/v0.1.55/`).

This is standard IFD: a new minor version of a tool means a new versioned folder. Per `library/development/ifd/v1.2.1__ifd__intro-and-how-to-use.md`.

### §7.2 — User-saved projects

Users have saved projects in localStorage from v0.1.54 sessions. Those projects use the keys `sgve:project:*`, `sgve:projects-index`, `sgve:autosave:current`. Asset blobs are in IndexedDB DB `sgve`, store `assets`.

Strategy:
- v0.1.55 of sg-video-editor MUST configure `sg-project-storage` with the SAME keys (`projectKeyPrefix: 'sgve:project:'`, etc.) so saved projects from v0.1.54 load in v0.1.55 without migration.
- The Item schema is generated by the v0.1.55 adapter from v0.1.54's clip schema on the fly. Saved projects retain v0.1.54's clip schema; only the in-memory adapter output uses the toolkit's generic Item shape.
- This means a user can save in v0.1.54, switch URLs to v0.1.55, and their project loads. **This is the central usability requirement of the refactor.** Brief 06 calls this out as a hard acceptance criterion.

### §7.3 — Deprecation (by reference-decay, not by tag)

IFD has built-in deprecation: a frozen version stays at its path forever (in case any in-flight reference still uses it), and "deprecation" simply means **no new tools or new pack work creates new references to it**. There is no formal deprecation tag, no countdown to deletion, no scheduled removal date. The mechanism is decay, not eviction.

Concretely for this pack:
- `<sg-timeline>` v0.1.0 stays at its path indefinitely. Frozen. Currently consumed by sg-video-editor v0.1.54 and (if any) other in-flight references.
- After v0.1.55 ships, sg-video-editor v0.1.54 still references it — that's why it stays.
- After audio-editor v0.1.0 ships, the new tool does NOT reference it.
- Future tools do NOT reference it — they use `<sg-track-strip>` instead.
- Eventually, if no consumer is left, the file remains anyway. Deletion is never required and never scheduled in this pack.

This is the same pattern as every other frozen IFD version in the codebase. There is no "deprecation event." Consumers naturally migrate as they ship new versions; old code becomes unused; that's the whole story.

---

## §8 — Why this design and not alternatives

A few alternative designs were considered. Documenting why they were rejected so the rejection survives the implementation.

### §8.1 — Alternative A: keep `<sg-timeline>`, just remove the video-composer imports

**Why considered:** Smallest change. Drop 7 imports, replace with local helpers, ship.

**Why rejected:** Doesn't solve the toolkit problem. The audio editor would still need a generic toolbar component, a generic asset panel, a generic properties panel. Doing only the timeline means we re-do the conversation in three months when the audio editor team gets stuck.

### §8.2 — Alternative B: build the toolkit on top of `<sg-timeline>` as a wrapper

**Why considered:** Even smaller change. `<sg-track-strip>` wraps `<sg-timeline>` and translates events.

**Why rejected:** Coupling lives forever. The wrapper would still depend on `<sg-timeline>` v0.1.0, which depends on `core/video-composer/`. Every new editor that uses the wrapper transitively depends on the video composer. That's the opposite of generic.

### §8.3 — Alternative C: extract everything into one big `<sg-editor-shell>` mega-component

**Why considered:** "The whole editor pattern is reusable; let's make ONE component that hosts assets+timeline+properties+toolbar+transport."

**Why rejected:** Violates A-001 in spirit. It would be a god-component. The audio editor has different layout needs (different ratios, different sub-components, no transform overlay). One mega-component means every audio-editor customisation is a fork. Six small components mean the audio editor composes the ones it needs and skips the ones it doesn't.

### §8.4 — Alternative D: implement the toolkit components on top of a UI framework (Lit, Stencil, vanilla extends)

**Why considered:** Frameworks reduce boilerplate.

**Why rejected:** The repo's "no framework dependencies" rule (see `library/development/ifd/v1.2.1__ifd__intro-and-how-to-use.md` core principle 4). The `SgComponent` base class IS the codebase's framework. Toolkit components extend `SgComponent` and that's the deal.

### §8.5 — Alternative E: ship the toolkit but skip the sandbox

**Why considered:** Sandbox is overhead. Just refactor the video editor; if the editor works, the toolkit works.

**Why rejected:** Sandbox is the genericness check. Without the sandbox, there's no proof the toolkit works for anything BUT the video editor — at which point it's not generic, it's just relocated. The sandbox is also the reproduction environment for bugs in any future tool, which makes it cheap insurance for the next 5 tools that consume the toolkit.

---

## §9 — Risks and how the pack mitigates them

### §9.1 — Risk: behaviour drift in the video editor refactor

**Concern:** The refactor inadvertently changes some subtle behaviour (the dirty-hash race fix, the snap-abut max distance, the lock-on-splitClip check). User notices later. Hard to bisect.

**Mitigation:** Brief 08 (QA regression suite) specifies the regression net BEFORE brief 06 (refactor) starts. The refactor cannot merge until the regression suite passes 100% on v0.1.55. Doc 04 §B (behaviour preservation verification) lists every Round-9 fix by name and requires the refactor to preserve each one.

### §9.2 — Risk: scope creep — toolkit gains "just one more" feature

**Concern:** Brief 05 implementer thinks "the toolkit should also have X." X is a feature, not a refactor.

**Mitigation:** Doc 03 §13 (DO-NOT list) explicitly forbids adding features in brief 05. The verification checklist (04 §A) tests genericness — adding video-specific features fails the checklist.

### §9.3 — Risk: Sonnet implementer drifts from spec

**Concern:** Sonnet substitutes plausible-but-wrong defaults when the spec is silent or ambiguous.

**Mitigation:** Vocabulary appendix in README pins every name. Each brief is decomposed into numbered tasks with falsifiable acceptance checks. Cross-document consistency enforced via vocabulary. See doc 03 §10.

### §9.4 — Risk: existing v0.1.54 users lose their saved projects

**Concern:** Refactor's storage-keys diverge; user-saved projects don't load.

**Mitigation:** Brief 06 explicitly requires v0.1.55 to use the same `sgve:*` keys as v0.1.54. Round-trip test (load saved project from v0.1.54 in v0.1.55, save again, reload) is a checklist item in 04 §B.

### §9.5 — Risk: the toolkit is "generic" but actually only works for video

**Concern:** The toolkit's API surface looks generic but hides video assumptions.

**Mitigation:** Sandbox tool MUST render Gantt + Log + Animation modes correctly. Doc 04 §A.4 — A.6 are checklist items for non-time, point-in-time, and property-track use cases. If those fail, the toolkit isn't generic.

### §9.6 — Risk: parallel Sonnet sessions collide on git

**Concern:** Round-9-I/9-J had a documented `git add -A` collision between parallel agents. This pack will have parallel agents (one on brief 05, one on brief 08; one on brief 06, one on brief 07).

**Mitigation:** Doc 03 §12 mandates branching per brief, no `git add -A`, explicit file lists in commits.

---

## §10 — What this pack delivers and what it doesn't

**Delivers:**
- **Eight** new generic Web Components / modules at new versioned paths (track-strip, toolbar, asset-panel, properties-panel, player-transport, project-storage, history, **config**)
- One sandbox tool that exercises every component with synthetic data, including op-replay
- A new IFD minor version of the video editor that consumes the toolkit (no behaviour change; existing snapshot-stack history migrated to op-based history with the V.6.6 mapping table)
- A new tool (audio editor) that ships with the toolkit (cheap because the toolkit is free)
- A regression test suite for the existing video editor
- Coding guidelines codifying the patterns implicit in the codebase, including the new op-driven architecture rules
- A verification checklist used as the project plan, with op-shape and op-category coverage items
- This architecture document and a vocabulary that pins every cross-doc name (V.1–V.11 in README, including the V.6 5-category op-support taxonomy)
- A parking-lot doc (`09__future__graph-based-version-control.md`) capturing the design conversation for tree-based undo so it isn't lost

**Does not deliver:**
- Tree-based undo with branching (parked in doc 09; v0.1.0 ships flat-stack)
- A history visualisation UI (just toolbar Undo/Redo buttons; no timeline-of-history viewer)
- sgit-vault as undo storage backend (parked in doc 09; v0.1.0 keeps history in-memory + optional ops slot in saves)
- Git-named API surface for history (explicitly rejected; honest verbs only; parked in doc 09 with rationale)
- Collaborative ops / multi-author sync (the op shape's `source` field accommodates them but no merge semantics)
- Production deployment of any of the above (Villager pack, future)
- Performance hardening of the toolkit (Villager pack, future)
- Feature additions to the video editor (Explorer roadmap, separate)
- Mobile / touch parity (separate pack)
- The entire Cartography of how the toolkit interacts with `sg-layout`, `sg-tool-api`, `sg-site-header` (covered in doc 02 §1)

---

## §11 — Where to read next

If you've finished this doc:

- **All implementers** → read **03 (guidelines)** next. Every rule there applies to every brief.
- **Curious about tree-undo / git-as-undo / sgit-vault undo storage** → read **09 (out-of-scope future doc)**. Captures the design conversation; explains why those things aren't in this pack.
- **Building the toolkit (brief 05)** → read **02 (catalogue)** for the components you're building, then **04 (checklist)** for what "done" means, then **05 (your brief)**.
- **Refactoring the video editor (brief 06)** → read **08 (QA)** first (your gate), then **02 (catalogue)** to know the toolkit you're consuming, then **06 (your brief)**. Pay particular attention to V.6.6 in the README — it's your migration map from snapshot-stack history to op-based history.
- **Building the audio editor (brief 07)** → read **02 (catalogue)** for the toolkit you'll consume, then **07 (your brief)**.
- **QA on the video editor (brief 08)** → read **04 (checklist) §B** for what your tests must cover, then **08 (your brief)**.

Pass 1 of this pack ships docs 00, 01, 03, 09 (rev 2). Docs 02, 04, 05, 06, 07, 08 are pending Pass 2 and Pass 3.
