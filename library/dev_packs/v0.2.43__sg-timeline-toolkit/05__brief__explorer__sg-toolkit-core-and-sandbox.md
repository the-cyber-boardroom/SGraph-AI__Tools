# 05 — Brief: Build the SG Toolkit (8 pieces) + sg-timeline-toolkit-sandbox

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Brief revision:** rev 1 (Pass 3)
**Brief role:** the implementer task list for greenfield work — building all 8 toolkit pieces and the sandbox tool that exercises them.
**Audience:** Sonnet implementer (Explorer team) building from scratch. NOT the implementer of brief 06 (refactor) or 07 (new audio editor) — they consume what this brief produces.
**Lifetime:** archive after merge. The durable record of what was built lives in docs 01, 02, 03, 04.
**Estimated effort:** 30–50 hours of Sonnet-time across 50 tasks.

> **Read first, in order:**
> 1. `README.md` — especially V.1–V.11 (vocabulary), the **Decisions locked at the start of Pass 2** section, A-001 through A-011 (architectural decisions)
> 2. `01__architecture__sg-toolkit.md` — the architecture spine, especially §3.1–§3.8 (the 8 pieces conceptually)
> 3. `02__architecture__component-catalogue.md` — heavy spec for each piece
> 4. `03__guidelines__sg-component-and-ifd.md` — the rule-book; sections A, B, C, F, H, K, M, N most relevant
> 5. `04__verification__feature-checklist.md` — every task here references checklist items there
> 6. `09__future__graph-based-version-control.md` — read once to know what is OUT OF SCOPE
>
> **Do not read** brief 06, 07, 08 unless you specifically need cross-reference. They consume; they don't constrain.

---

# §0 — Pre-flight checklist

Before starting ANY task, verify:

- [ ] You're on a fresh branch named `claude/build-toolkit-{session-id}` (per doc 03 §H.6)
- [ ] You have read items 1–6 in the "Read first" list above
- [ ] You have the v0.1.54 source available read-only at `tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor/` for reference (do NOT modify)
- [ ] You understand the difference between **state restoration** (imperative, no ops) and **user actions** (op-shaped events) per doc 03 §M.11
- [ ] You can name the 5 op categories from V.6 without looking: pure / snapshot / with-side-effects / never / noisy
- [ ] You understand that components emit ops; hosts route them to sg-history (M.8)

If any of these are unclear, STOP and ask the architect (per doc 03 §K.2 and §A.5). Do not guess.

---

# §1 — Order of work

The 50 tasks below are roughly grouped into 7 phases. Phases 1–4 can be parallelised across team members if available; phases 5–7 must follow.

```
Phase 1: Component infra (T-1)
   ↓
Phase 2: Independent components (T-2 through T-7)  [parallelisable]
   ├─ sg-track-strip
   ├─ sg-toolbar
   ├─ sg-asset-panel
   ├─ sg-properties-panel
   └─ sg-player-transport
   ↓
Phase 3: Core modules (T-8 through T-11)            [partially parallelisable]
   ├─ sg-project-storage  (independent)
   ├─ sg-history          (independent)
   └─ sg-config           (depends on sg-properties-panel for integration test)
   ↓
Phase 4: Component-level docs and manifests (T-12 through T-14)
   ↓
Phase 5: Sandbox tool (T-15 through T-30)
   ↓
Phase 6: Verification (T-31 through T-46)
   ↓
Phase 7: Pack delivery (T-47 through T-50)
```

Each task has the standard shape:

```
T-N — Title
   What:     One-paragraph description of the work
   Why:      Why this task exists (links back to architectural decisions)
   How:      Concrete approach
   Done when: Falsifiable acceptance criterion
   Checklist refs: §X.N (in doc 04)
   DO NOT:    Anti-patterns specific to this task
```

---

# §2 — Phase 1: Component infrastructure

## T-1 — Verify SgComponent base class is at v1.0.0 and reference component pattern

**What:** Read `components/base/v1/v1.0/v1.0.0/sg-component.js` end-to-end. Read `components/locale-picker/v1/v1.0/v1.0.1/sg-locale-picker.js` as the reference component pattern. Take notes on: how `SgComponent` handles shadow DOM, fetches the sibling .html and .css files, manages tracked event listeners, dispatches events, and exposes the `whenReady` Promise.

**Why:** Per doc 03 §B.1, every toolkit component MUST extend `SgComponent`. Per A-002 (README), this is non-negotiable. You'll reference this base class constantly. Reading the locale-picker is faster than re-deriving the pattern.

**How:**
1. Open `sg-component.js`. Read it fully (~300 lines).
2. Open `sg-locale-picker.js` and its sibling .html and .css. Note the registration pattern at the bottom of the .js.
3. Sketch in your scratch notes: "When my component extends SgComponent, I get X, Y, Z for free; I implement onReady/onDisconnected/onAttributeChanged."

**Done when:** You can answer (without looking): "What does `SgComponent.connectedCallback` do before calling `onReady`?" Answer outline: fetches html and css, attaches shadow root with mode: 'open', mounts the template, applies styles, calls `onReady` once everything is in place.

**Checklist refs:** §D.4

**DO NOT:**
- Modify `sg-component.js`. It's at v1.0.0 and frozen.
- Skip this task. Sonnet sessions that skip it produce components that re-implement what `SgComponent` already provides.

---

# §3 — Phase 2: Independent components

These five tasks can run in parallel. Each follows the same structure: scaffold → spec-driven implementation → events → tests → docs.

## T-2 — Build `<sg-track-strip>` v0.1.0

**What:** Implement the timeline ruler+lanes Web Component per doc 02 §1. Full event surface, internal state model, rendering rules, op shapes.

**Why:** This is the workhorse of the toolkit. ~60% of toolkit catalogue line-count. Generalises sg-video-editor v0.1.54's `<sg-timeline>` and the timeline rendering logic in v0.1.54's `state-renderer-timeline.js`.

**How:** 
1. Create the directory: `components/sg-track-strip/v0/v0.1/v0.1.0/`
2. Create six files: `sg-track-strip.html`, `sg-track-strip.css`, `sg-track-strip.js`, `sg-track-strip-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md`
3. Implement the methods listed in doc 02 §1.3.1 (state setters and view configuration)
4. Implement the events listed in doc 02 §1.3.2 (op-shaped per V.2)
5. Implement the rendering rules in doc 02 §1.5 — pay special attention to per-track diffing on `setItems` (this is the v0.1.54 Round 9-K perf bug; do NOT regress it)
6. For drag, use `transform: translateX(...)` for preview, NOT `style.left`. Final commit on mouseup uses `left`.
7. Snap behaviour: `_snapEnabled` toggle, `_snapResolution` controls grid (default 0.1s)
8. Reference v0.1.54's `<sg-timeline>` v0.1.0 source for the visual layout but DO NOT copy code — the component you're building uses different field names, different events, and extends `SgComponent` not `HTMLElement`

**Done when:**
- File exists at the named path
- Component extends `SgComponent` (verified by §D.4 script)
- All 20 events from V.2.1 emit with op-shape envelopes (verified by §A.7 script)
- Manifest's `ops.emits` matches actual code (verified by §D.2 script)
- Sandbox in mode "Video" with synthetic data renders and is interactive (§A.1 ticks via Playwright)
- File is under LOC budget (300 hard, 350 soft); split helpers if needed (§D.3)

**Checklist refs:** §A.1, §A.7, §D.2, §D.3, §D.4, §D.5, §D.7

**DO NOT:**
- Reference `assetId`, `inPoint`, `outPoint`, or any host-specific field name in this component's code, CSS, or HTML. The component's V.4 schema is `{id, start, end, color?, label?, locked?, muted?, kind?}`. Anything else passes through opaquely.
- Emit ops from `setProject(...)`, `setTracks(...)`, `setItems(...)`, or any other imperative setter. Per M.11.
- Re-render the entire component on every `setItems(...)` call. Per-track diffing per doc 02 §1.5.2.
- Call `sg-history` directly. The host routes ops; the component emits them. Per M.8.
- Add new events without first updating V.2.1 in the README. If you find you need a new event, STOP and ask the architect.

---

## T-3 — Build `<sg-toolbar>` v0.1.0

**What:** Implement the registered-button toolbar per doc 02 §2.

**Why:** Generic toolbar surface. Replaces sg-video-editor v0.1.54's bespoke toolbar markup. Used by every toolkit-consuming tool.

**How:**
1. Directory: `components/sg-toolbar/v0/v0.1/v0.1.0/`
2. Six files (same pattern as T-2)
3. Imperative-only registration per Q6 lock-in. NO declarative `<sg-toolbar-button>` element.
4. Implement keyboard shortcut handling per doc 02 §2.6: listen for `keydown` on `document`, check active element is not input/textarea/contenteditable, check active element is within the toolbar's containing root.
5. Cmd/Ctrl resolution: on Mac, `Cmd` listens for `metaKey`; on Win/Linux, `Cmd` listens for `ctrlKey`. Detect via `navigator.platform`.
6. Popover positioning: prefer CSS anchored positioning where supported; fall back to JS-computed positioning otherwise.

**Done when:**
- File exists, extends SgComponent, manifest valid
- `addButton`, `removeButton`, `setButtonActive`, `setButtonDisabled` all work per §C.3
- Keyboard shortcut for `Cmd+Z` fires `button-clicked` event with `buttonId: 'undo'` when registered
- Test coverage for the registration-order-vs-render-order invariant (§C.3)

**Checklist refs:** §A.7, §C.3, §D.1–§D.5

**DO NOT:**
- Add a declarative `<sg-toolbar-button>` element. Per Q6.
- Register button shortcuts that conflict with browser shortcuts (Cmd+W, Cmd+T, Cmd+R, Cmd+R, F5, F12). The toolbar does not override browser shortcuts.
- Auto-namespace shortcut keys across multiple toolbars on the same page. Hosts handle that.

---

## T-4 — Build `<sg-asset-panel>` v0.1.0

**What:** Implement the asset list with drag-source per doc 02 §3.

**Why:** Generic asset panel. Generalises sg-video-editor v0.1.54's asset panel logic.

**How:**
1. Directory: `components/sg-asset-panel/v0/v0.1/v0.1.0/`
2. Six files
3. Implement `setAssets`, `setSelectedAsset`, `setDragMime`, `setMissingAssets`, `setEmptyMessage`
4. Drag-out: set `dataTransfer` MIME to `_dragMime`; data is `assetId`. Drop targets read.
5. Drag-in: file drop emits `asset-add-requested` with `payload: {file, suggestedAssetId}`. Component does NOT update internal state; host does via `setAssets`.

**Done when:**
- File exists, extends SgComponent, manifest valid
- Sandbox demonstrates drag asset-row → track-strip working (§C.4)
- File-drop on dropzone emits `asset-add-requested` op (§C.4 partial; full drop-to-track is §C.4)

**Checklist refs:** §A.7, §C.4, §D.1–§D.5

**DO NOT:**
- Decode the dropped File. No `URL.createObjectURL`, no FileReader. Host owns blob handling.
- Emit `asset-add-requested` from `setAssets(...)` — that's state restoration. Per M.11.
- Assume the host's drag-MIME. Hosts override via `setDragMime`.

---

## T-5 — Build `<sg-properties-panel>` v0.1.0

**What:** Implement the sectioned key-value editor per doc 02 §4.

**Why:** This is the most-reused component. Three of the five right-rail tabs in v0.1.54's video editor (Properties, Config, Perf) can be `<sg-properties-panel>` instances in v0.1.55. Plus the audio editor's properties tab. Plus future tools.

**How:**
1. Directory: `components/sg-properties-panel/v0/v0.1/v0.1.0/`
2. Six files
3. Methods: `addSection`, `removeSection`, `setSectionFields`, `setFieldValue`, `setSectionVisible`, `setSectionCollapsed`, `clearAllSections`
4. Field types: `text`, `number`, `select`, `color`, `checkbox`, `button` per V.4
5. Field type `button` emits `section-action`, NOT `field-changed` (per Q3b)
6. Field-change emission: capture `fromValue` on input mount, emit on commit (blur/Enter for text/number; instant for checkbox/select/color)
7. Allow nested objects in `fromValue`/`toValue` (per Q3a). Host's responsibility to keep them JSON-serializable.

**Done when:**
- File exists, extends SgComponent, manifest valid
- Each field type rendered correctly in sandbox
- `field-changed` event has correct payload shape (§B.12)
- Idempotency: calling `setFieldValue(s, f, v)` does NOT re-emit `field-changed` (§B.12, M.11)

**Checklist refs:** §A.7, §B.12, §B.13, §B.14, §C.5, §C.8, §D.1–§D.5

**DO NOT:**
- Use `innerHTML` for field labels or descriptions. Render as text content via `textContent`.
- Mutate the `Field` object passed to `addSection`. Use `setFieldValue` for updates.
- Echo the `field-changed` event in a handler that calls `setFieldValue` — infinite loop.

---

## T-6 — Build `<sg-player-transport>` v0.1.0

**What:** Implement the transport bar + Playable interface slot per doc 02 §5.

**Why:** Decouples playback controls from playback medium. The video editor uses a video composer; the audio editor uses an audio engine; the animation sandbox mode uses an SVG timeline. All three are Playables.

**How:**
1. Directory: `components/sg-player-transport/v0/v0.1/v0.1.0/`
2. Six files
3. Methods: `attachPlayable`, `detachPlayable`, `setPosition`, `setDuration`, `setEnabled`, `setSurfaceSlot`
4. The Playable interface is documented in doc 02 §5.3.1. Hosts implement it; the transport calls its methods.
5. Listen for `sg-playable:position-changed`, `state-changed`, `duration-changed` on the Playable's host element.
6. Re-broadcast as transport events.

**Done when:**
- File exists, extends SgComponent, manifest valid
- Sandbox mode "Animation" uses a custom Playable; play/pause/seek/scrub all work (§A.5)

**Checklist refs:** §A.5, §B.15, §D.1–§D.5

**DO NOT:**
- Make the transport know about video, audio, or any specific media type. It's a Playable.
- Emit ops with `reversible !== 'noisy'` for transport actions. Playback position is not project state.

---

## T-7 — Component-level cross-cutting work

**What:** For each of T-2 through T-6: write the SKILL.md and SKILL__api.md, declare the manifest's `ops.emits` per V.9.1, ensure CSS uses `:host` not `:root` and uses `sg-tokens` CSS variables for all visible styling.

**Why:** Doc 03 §F.2 (`:host` not `:root`), §F.3 (use sg-tokens variables, not raw colours/values), §N.1 (manifest declares ops).

**How:**
1. SKILL.md: Plain English, one paragraph on when to use this component, one on how to wire it (refer to doc 02 §X.7 for the integration pattern, do not duplicate).
2. SKILL__api.md: Method signatures and event names. This is what fresh Sonnet sessions look at first; make it scan-able.
3. CSS: replace any hardcoded colour with the `var(--sg-color-*)` token. Same for typography, spacing, radii.
4. Manifest's `ops.emits`: list every op type the component emits, with category. Cross-check against the events file.

**Done when:**
- Each of T-2 through T-6 has a SKILL.md and SKILL__api.md
- All 5 components' CSS uses `:host` (verified by §D.5 script)
- All 5 components' manifests declare `ops.emits` matching code (verified by §D.2 script)

**Checklist refs:** §D.1, §D.2, §D.5, §E.9

**DO NOT:**
- Copy SKILL.md text from another component without adapting; the audience needs distinguishable signals about which component to use.
- Hardcode colour values like `#16a085` — always use `var(--sg-color-...)`.

---

# §4 — Phase 3: Core modules

## T-8 — Build `sg-project-storage` v0.1.0

**What:** Implement save/load/autosave/IDB-blob-storage per doc 02 §6.

**Why:** Generalises sg-video-editor v0.1.54's `state-storage.js` + `state-asset-storage.js`. Preserves the Round 9-K race fixes.

**How:**
1. Directory: `core/sg-project-storage/v0/v0.1/v0.1.0/`
2. Files: `sg-project-storage.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md`
3. Implement all methods from doc 02 §6.3 (V.3.6).
4. Save envelope shape per doc 02 §6.4. The `assetIdRefs` walking helper is the ONE place you reference the host-specific `assetId` field name. Document this clearly in a code comment.
5. IDB schema per doc 02 §6.5.
6. Round 9-K race fixes per doc 02 §6.6: filename-race, beforeunload-after-clean-save, autosave-overwrites-newer-manual. **READ v0.1.54's source** for these — don't re-derive.
7. Storage usage warnings: `computeStorageUsage()` returns `usagePercent` when `navigator.storage.estimate()` is available.

**Done when:**
- All methods exposed and tested
- Round 9-K race fixes preserved (verified by deterministic test harness, §B.20)
- File LOC under 600 hard / 700 soft (§D.3, slightly relaxed for this module)

**Checklist refs:** §B.18, §B.19, §B.20, §C.12, §D.6 (perf), §D.11

**DO NOT:**
- `JSON.stringify(blobsById)` — Blobs don't survive serialization.
- Assume localStorage and IDB are available; both can fail. try/catch and surface errors via Promise rejection.
- Concurrently call `saveProject` and `autosave` for the same project — Round 9-K fixes assume serialised access.
- Modify the `assetIdRefs` walking logic without architect approval. v0.1.55 depends on it.

---

## T-9 — Build `sg-history` v0.1.0

**What:** Implement op-based undo/redo with category-aware handling per doc 02 §7.

**Why:** Op-based replaces the snapshot-stack approach in v0.1.54's `state-history.js`. Per A-010, op-shaped events; per A-011, no tree-undo (out of scope).

**How:**
1. Directory: `core/sg-history/v0/v0.1/v0.1.0/`
2. Files: `sg-history.js`, `sg-history-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md`
3. Implement the public API from doc 02 §7.3 (V.3.7).
4. Internal data structure: array of ops, position counter. Per Q10, position counter is monotonic; timestamps are wall-clock for display.
5. Op recording flow per doc 02 §7.5.
6. Undo flow per doc 02 §7.6, including the side-effect handler invocation for `with-side-effects` ops.
7. goTo flow per doc 02 §7.7. v0.1.0: walk op-by-op (no snapshot-anchor optimization).
8. replayOps per doc 02 §7.8. Per Q8 lock-in: does NOT re-emit toolkit events; only `onApply` fires.
9. Pruning policy per doc 02 §7.9.
10. Snapshot anchors every `snapshotEvery` ops (default 100); call `onSnapshot` to get state for the anchor.

**Done when:**
- All 5 op categories handled correctly (§C.2)
- replayOps doesn't re-emit events (§C.7)
- Recording 10,000 ops under 5 seconds (§D.6)
- Pruning at budget edge correct (§C.11)

**Checklist refs:** §C.2.a–§C.2.e, §C.6, §C.7, §C.11, §D.6

**DO NOT:**
- Call `onApply` synchronously from `record()`. Forward apply was already done by host before calling record.
- Mutate the op object after `record()` captures it. Captured by reference; mutation changes history.
- Use timestamps for ordering. Position counter is the source of truth (per Q10).
- Skip `onSideEffect` for `with-side-effects` ops; that's the entire point of the category.

---

## T-10 — Build `sg-config` v0.1.0

**What:** Implement per-tool configuration with schema, persistence, URL overrides per doc 02 §8.

**Why:** 8th piece of the toolkit (Q9 follow-up). Replaces bespoke per-tool config code; consumed by the video editor (v0.1.55), audio editor (v0.1.0), and any future toolkit-consuming tool.

**How:**
1. Directory: `core/sg-config/v0/v0.1/v0.1.0/`
2. Files: `sg-config.js`, `sg-config-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md`
3. Implement the public API from doc 02 §8.3 (V.3.8).
4. URL overrides per doc 02 §8.4: read URLSearchParams on `createConfig()`, apply to active values for the session.
5. Persistence per doc 02 §8.5: write full snapshot on every `set()`. Read snapshot on `createConfig()` and merge with defaults and URL overrides.
6. Op-shaped events per doc 02 §8.6: every `set()` emits `sg-config:changed` op (pure category for `source: 'user'`, never for url-override, snapshot for reset-all).
7. Debug mode per doc 02 §8.8: `debug: true` fields excluded from `toFields()` unless `setDebugMode(true)`.
8. `toFields()` helper: maps schema → V.4 Field[] for `<sg-properties-panel>` consumption.

**Done when:**
- All methods exposed and tested
- URL overrides work (§C.9)
- Debug mode toggle works (§C.10)
- sg-config + sg-properties-panel integration (§C.8) verified end-to-end in sandbox

**Checklist refs:** §B.14, §C.8, §C.9, §C.10, §D.1, §D.2, §D.3

**DO NOT:**
- Implement migration logic for v0.1.0. Renamed fields lose values. Hosts roll their own via export/import if needed.
- Write to localStorage directly bypassing `set()`. Both `set()` and `reset()` are the only valid entry points.
- Use sg-config for user-account preferences. It's per-tool browser-local. (See "what it is NOT" in doc 02 §3.8.)

---

## T-11 — Module-level cross-cutting work

**What:** SKILL.md and SKILL__api.md for sg-project-storage, sg-history, sg-config. Manifest validation. Bundle-size check.

**Why:** Same reasons as T-7 for components. Plus: bundle size budget per §D.12.

**How:**
1. Each module has SKILL.md (when to use, simple integration sketch) and SKILL__api.md (method signatures).
2. Each module's manifest declares its `ops.emits` (where applicable; sg-project-storage emits no ops itself; sg-history's events are dispatched by sg-history but they're not "user ops").
3. Run the bundle-size script: each piece's gzipped contribution under 12 KB; total under 60 KB.

**Done when:**
- All 3 modules have SKILL files (§E.9)
- Bundle size budget met (§D.12)

**Checklist refs:** §D.12, §E.9

---

# §5 — Phase 4: Component-level docs and manifests

## T-12 — Run all manifest validation scripts

**What:** Run the validation scripts from doc 04 §D.1, §D.2, §D.3.

**Why:** Catches mismatches between code and manifests, missing manifest fields, LOC budget violations.

**How:**
```bash
bash scripts/validate-manifests.sh
bash scripts/check-ops-manifest-match.sh
bash scripts/check-loc-budgets.sh
bash scripts/check-no-host-leakage.sh
bash scripts/check-sgcomponent-extension.sh
```

**Done when:** All 5 scripts pass.

**Checklist refs:** §A.7, §D.1, §D.2, §D.3, §D.4

**DO NOT:** Fix script failures by editing the script. Fix the underlying issue.

---

## T-13 — Verify all 8 pieces have docs

**What:** Each of the 8 pieces has SKILL.md AND SKILL__api.md. Doc presence is binary; quality is reviewed in T-14.

**How:** `find components core -name "SKILL*.md" | wc -l` should return 16.

**Done when:** Count == 16.

**Checklist refs:** §E.9

---

## T-14 — Cross-doc vocabulary consistency check

**What:** Run the vocabulary consistency script from §G.1.

**Why:** Catches drift between docs (e.g. event named `asset-uploaded` in doc 02 but `asset-added` in this brief).

**How:** `bash scripts/check-vocabulary-consistency.sh`

**Done when:** Script passes.

**Checklist refs:** §G.1

**DO NOT:** "Fix" inconsistency by changing the README to match the brief. The README is the source of truth.

---

# §6 — Phase 5: Sandbox tool

The sandbox is the executable spec. It's the proof that the toolkit is generic. It's also the documentation for fresh Sonnet sessions: opening the sandbox shows you, in 30 seconds, how each piece is wired.

## T-15 — Scaffold `sg-timeline-toolkit-sandbox` v0.1.0

**What:** Create the tool directory and core files.

**How:**
1. Directory: `tools/v0/v0.1/v0.1.0/en-gb/sg-timeline-toolkit-sandbox/` (path per Q11 lock-in).
2. Files: `index.html`, `main.html`, `main.js`, `main.css`, `manifest.json`, `SKILL.md`
3. Tool extends `SgComponent`, registers with `SgToolApi.register('sg-timeline-toolkit-sandbox', {...})`.
4. Manifest declares dependencies on all 8 toolkit pieces with explicit version paths (no aliases per §E.7).

**Done when:** Tool loads at `/en-gb/sg-timeline-toolkit-sandbox/` and shows the empty layout (toolbar + asset panel + track strip + properties panel + transport).

**Checklist refs:** §E.7

---

## T-16 — Implement sandbox layout

**What:** The tool's main.html lays out the 5 components in a grid: toolbar across the top, asset panel on the left, track strip in the center, properties panel on the right, transport at the bottom.

**Why:** Mirrors the editor archetype that all editor-shaped toolkit-consuming tools will use.

**How:** Use existing `<sg-layout>` v0.1.0 if available (per the existing repo patterns); otherwise CSS grid. Each region hosts the relevant component.

**Done when:** Layout renders cleanly at 1024×768 minimum and 4K. Components don't overflow their regions.

---

## T-17 — Implement mode selector

**What:** A dropdown or button group at the top of the sandbox that switches between modes: Video, Audio, Gantt, Log, Animation, Fuzz.

**How:** Each mode loads a different synthetic project + a different per-mode adapter. Mode change clears the current project, loads new synthetic data, calls `setProject(...)` etc.

**Done when:** All 6 modes selectable. Switching modes resets state cleanly.

---

## T-18 — Implement Video mode

**What:** Synthetic video-shaped data: 3 tracks, 12 items with `assetId`/`inPoint`/`outPoint` host-specific fields. Adapter implements ops handling.

**Done when:** §A.1 ticks via Playwright spec.

**Checklist refs:** §A.1

---

## T-19 — Implement Audio mode

**What:** Synthetic audio-shaped data: 2 tracks, 8 items with `assetId`/`gain`/`fadeIn`/`fadeOut`. Adapter handles ops.

**Done when:** §A.2 ticks.

**Checklist refs:** §A.2

---

## T-20 — Implement Gantt mode

**What:** Tasks with `dependencies`, `assignee`, `progress`. No inPoint/outPoint.

**Done when:** §A.3 ticks.

**Checklist refs:** §A.3

---

## T-21 — Implement Log mode

**What:** Point-in-time items where `start === end`.

**Done when:** §A.4 ticks. Items with `end - start === 0` render at min-width without errors.

**Checklist refs:** §A.4

---

## T-22 — Implement Animation mode

**What:** Custom Playable wrapping an SVG-based animation renderer. Items represent keyframes.

**Done when:** §A.5 ticks. Play/pause/seek work via the custom Playable.

**Checklist refs:** §A.5

---

## T-23 — Implement Fuzz mode

**What:** Generate 1000 random items across 10 tracks. Test render performance.

**Done when:** §A.6 ticks. Initial render under 500ms; drag frame rate above 30fps.

**Checklist refs:** §A.6, §D.7

---

## T-24 — Wire sg-history in sandbox

**What:** Sandbox's main.js creates a `History` instance, listens for all op-shaped events from track-strip, properties-panel, asset-panel, toolbar, config; routes them via `history.record`.

**How:** Per doc 02 §9.4 standard pattern.

**Done when:** Undo button reverses the last op for any of the 5 op categories (§C.2).

**Checklist refs:** §C.2.a–§C.2.e, §C.6

---

## T-25 — Wire sg-config in sandbox

**What:** Sandbox has a Config tab in the right rail (alongside Properties). Schema includes: log-level, snap-enabled, snap-resolution, theme.

**Done when:** §C.8, §C.9, §C.10 tick.

**Checklist refs:** §B.14, §C.8, §C.9, §C.10

---

## T-26 — Wire sg-project-storage in sandbox

**What:** Save/load buttons in the toolbar. Save dialog shows existing slugs. Load dialog hydrates blobs.

**Done when:** §C.12 ticks (storage usage shown in Config tab).

**Checklist refs:** §C.12, §D.11

---

## T-27 — Implement undo/redo toolbar buttons

**What:** Toolbar has Undo and Redo buttons; clicking them calls `history.undo()` and `history.redo()`. Buttons disable when bounds are reached.

**How:** Listen for `sg-history:bounds-changed` to update button disabled state.

**Done when:** Undo/Redo work end-to-end. Buttons reflect history state.

---

## T-28 — Implement keyboard shortcuts in sandbox

**What:** Cmd+Z (undo), Cmd+Shift+Z (redo), Space (play/pause), S (split), Cmd+C/Cmd+V (copy/paste), Backspace/Delete.

**How:** All registered via `<sg-toolbar>.addButton({shortcut: ...})`.

**Done when:** All shortcuts work in all 6 modes (where applicable; Animation has play/pause/seek but no item edit shortcuts).

---

## T-29 — Sandbox SKILL.md

**What:** Plain English doc explaining what the sandbox demonstrates and how a fresh Sonnet session navigates it.

**Done when:** A new session reading the SKILL.md can identify which mode demonstrates which capability.

**Checklist refs:** §E.9

---

## T-30 — Visual polish pass

**What:** Apply sg-tokens consistently. Ensure dark mode works. Hover states. Active states. Disabled states. Focus rings (a11y).

**Done when:** Sandbox passes a11y suite (§D.8, §D.9, §D.10).

**Checklist refs:** §D.8, §D.9, §D.10

---

# §7 — Phase 6: Verification

## T-31 — Author Playwright spec for sandbox Video mode

**What:** `tools/.../sg-timeline-toolkit-sandbox/playwright/spec.video-mode.js` exercises the full Video flow.

**Done when:** Spec passes; §A.1 ticks.

---

## T-32 — Author Playwright spec for sandbox Audio mode

**Done when:** §A.2 ticks.

---

## T-33 — Author Playwright spec for sandbox Gantt mode

**Done when:** §A.3 ticks.

---

## T-34 — Author Playwright spec for sandbox Log mode

**Done when:** §A.4 ticks.

---

## T-35 — Author Playwright spec for sandbox Animation mode

**Done when:** §A.5 ticks.

---

## T-36 — Author Playwright spec for sandbox Fuzz mode

**Done when:** §A.6 ticks.

---

## T-37 — Author unit tests for sg-history op categories

**What:** `core/sg-history/v0/v0.1/v0.1.0/test.spec.js` tests all 5 op categories.

**Done when:** §C.2.a–§C.2.e all tick.

---

## T-38 — Author unit test for replayOps non-emission

**Done when:** §C.7 ticks.

---

## T-39 — Author unit test for sg-history pruning

**Done when:** §C.11 ticks.

---

## T-40 — Author unit test for sg-history performance benchmark

**Done when:** §D.6 ticks (10,000 ops under 5s).

---

## T-41 — Author unit test for sg-track-strip rendering performance

**Done when:** §D.7 ticks (1000 items under 500ms).

---

## T-42 — Author unit test for sg-project-storage Round 9-K race fixes

**What:** Deterministic test harness simulating each race condition. Verify the fix prevents the bug.

**Done when:** §B.20 ticks.

**Checklist refs:** §B.20

---

## T-43 — Run accessibility suite

**What:** Playwright a11y suite covering keyboard navigation, ARIA roles, contrast.

**Done when:** §D.8, §D.9, §D.10 all tick.

---

## T-44 — Run bundle-size budget check

**Done when:** §D.12 ticks.

---

## T-45 — Run vocabulary consistency check across docs

**Done when:** §G.1 ticks.

---

## T-46 — Verify reality doc updated

**What:** Update `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` to mention the 8 new toolkit pieces with paths.

**Done when:** §E.10 ticks.

**Checklist refs:** §E.10

---

# §8 — Phase 7: Pack delivery

## T-47 — Final cross-pack invariants check

**What:** Run all §G items in doc 04.

**Done when:** §G.1–§G.5 all tick.

---

## T-48 — Confirm A-001 through A-011 all referenced by tasks

**Done when:** §G.4 ticks.

---

## T-49 — Verify §H release gate items

**Done when:** §H.1, §H.3, §H.4, §H.5, §H.7 all tick (B and F are owned by other briefs).

---

## T-50 — Branch ready for review

**What:** Push the branch. Tag the commit. Notify the architect.

**Done when:** Branch named `claude/build-toolkit-{session-id}` is at the tagged commit. Architect sign-off recorded.

**Checklist refs:** §H.8

---

# §9 — Common Sonnet drift patterns to avoid

These are mistakes Sonnet implementers make often. Cross-reference doc 03 for each:

1. **Re-emitting events from imperative setters.** `setProject(...)` is state restoration, not a user action. M.11. Caught by Playwright tests where load shouldn't generate ops.
2. **Adding `assetId` to the toolkit.** The temptation: "Just one tiny thing for video." STOP. Per A-004 and §A.7. The component takes Item, opaque on host fields.
3. **Calling `sg-history` from inside a component.** Components emit; hosts route. M.8. Imports of `sg-history` in components are a §A.9 violation.
4. **Hardcoded colours.** Always `var(--sg-color-...)`. F.3.
5. **Re-rendering whole component on every setItems.** Per-track diffing per doc 02 §1.5.2.
6. **Skipping the SKILL.md.** Future Sonnet sessions need it. E.9.
7. **Fixing unrelated bugs along the way.** A.4. Open a separate issue/branch.
8. **Adding new events without updating V.2 in the README.** §1.9.4 in doc 02. Vocab is the source of truth.
9. **Splitting components prematurely.** F.1 budget is 300 hard / 350 soft. Don't split at 250.
10. **Forgetting `:host`.** Shadow DOM scoping. F.2.

---

# §10 — Definition of done for this brief

All 50 tasks ticked. All §A, §C, §D, §E, §G items in doc 04 ticked (sections B and F belong to brief 06 / 08; you don't tick those).

When done:
- Branch named `claude/build-toolkit-{session-id}` is at a tagged commit
- All 8 toolkit pieces exist at their v0.1.0 paths under `components/` and `core/`
- The `sg-timeline-toolkit-sandbox` v0.1.0 exists at `tools/v0/v0.1/v0.1.0/en-gb/sg-timeline-toolkit-sandbox/`
- All sandbox modes (Video, Audio, Gantt, Log, Animation, Fuzz) work
- Unit tests and Playwright specs pass
- Architect signs off in commit message

End of brief 05. ~50 tasks. Estimated 30–50 hours of Sonnet-time.
