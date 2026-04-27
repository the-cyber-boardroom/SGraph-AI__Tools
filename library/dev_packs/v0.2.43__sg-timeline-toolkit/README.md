# SG Toolkit Extraction — Briefing Pack

**Pack version:** v0.22.17
**Created:** 2026-04-27
**Author:** Villager Architect (consulted) + Conductor (orchestrating)
**Status:** Pass 1 of 3 — foundations only (00, 01, 03). Docs 02, 04, 05, 06, 07, 08 pending Pass 2 / Pass 3.
**Owning team:** Explorer (the refactor produces new components and new tool versions; Villager is consulted for QA only)

---

## Why this pack exists

`sg-video-editor` v0.1.54 took **86 commits across 9 numbered rounds** to ship. Roughly 60% of those commits — every drag-drop primitive, every snap-abut helper, every save/load/IDB hook, every undo/redo wiring — built **generic UI infrastructure that the next tool (audio editor, animation editor, timeline log viewer, scheduler) will need too**. If we don't extract it now, we'll pay the same 60% tax on every new editor-shaped tool.

This pack extracts six generic building blocks from the video editor into `core/` and `components/`, gives them a sandbox tool to be tested against, then refactors `sg-video-editor` onto the new toolkit (no behaviour change), then specifies a greenfield `sg-audio-editor` that consumes the toolkit (cheap, because the toolkit is free), then provides the QA regression net that proves the refactor was non-destructive.

The extraction is non-trivial. It touches one of the more complex tools in the repo. The pack is sized to remove margin for error: every spec is exhaustive, every brief has a `DO NOT` section as long as its `DO` section, every event/method/CSS-variable name is pinned in the vocabulary appendix at the bottom of this README. **The Sonnet-class agents executing the build briefs do not get to invent names, paths, or contracts — those decisions are made here.**

---

## Pack contents

| # | Doc | Pass | Status | Audience | Lifetime |
|---|---|---|---|---|---|
| 00 | `README.md` (this file) | 1 | ✅ written (rev 3) | All | Durable |
| 01 | `01__architecture__sg-toolkit.md` | 1 | ✅ written (rev 3) | Architects, all team leads | Durable |
| 03 | `03__guidelines__sg-component-and-ifd.md` | 1 | ✅ written (rev 3) | All implementers | Durable |
| 09 | `09__future__graph-based-version-control.md` | 1 | ✅ written | Future-pack architects (parking-lot) | Durable, **OUT OF SCOPE** for this pack |
| 02 | `02__architecture__component-catalogue.md` | 2 | ✅ written | Implementers of 05 | Durable |
| 04 | `04__verification__feature-checklist.md` | 2 | ✅ written | All implementers + QA | Durable |
| 05 | `05__brief__explorer__sg-toolkit-core-and-sandbox.md` | 3 | ✅ written | Explorer team | Archive after merge |
| 06 | `06__brief__explorer__sg-video-editor-refactor.md` | 3 | ✅ written | Explorer team | Archive after merge |
| 07 | `07__brief__explorer__sg-audio-editor-new.md` | 3 | ✅ written | Explorer team (new) | Archive after merge |
| 08 | `08__brief__qa__sg-video-editor-regression.md` | 3 | ✅ written | Villager QA team | Archive after merge |

**Pass 1 was revised twice.** Rev 2 added `sg-history` as a 7th toolkit module, op-shaped events as a first-class principle, the 5-category op-support taxonomy, and the parking-lot doc 09. Rev 3 added `sg-config` as the 8th toolkit module, raised the op-log default budget (10,000 ops / 25 MB), confirmed the sandbox name as `sg-timeline-toolkit-sandbox`, and locked in answers to the Tier 1 / Tier 2 / Tier 3 decisions raised at the start of Pass 2. See §"Pass 1 revision history" near the end of this README for the full rev log; see §"Decisions locked at the start of Pass 2" for the full set of resolved questions.

**Pass 1** ships the durable foundations: vocabulary, architecture spine, coding guidelines. Everything later in the pack depends on these.
**Pass 2** ships the component catalogue (heavy spec for all six components) and the verification checklist (the project plan).
**Pass 3** ships the four execution briefs.

---

## Reading order

Read once in **dependency order**:

```
03 (guidelines)
 └→ 01 (architecture spine)
     └→ 02 (component catalogue)
         └→ 04 (verification checklist — references 02)
             ├→ 08 (QA regression — must complete BEFORE 06 starts)
             ├→ 05 (build the toolkit + sandbox — must complete BEFORE 06 and 07)
             ├→ 06 (refactor video editor — depends on 05 and 08)
             └→ 07 (build audio editor — depends on 05)
```

The README (this file, 00) is read **before everything**, because every other doc references the vocabulary appendix at the bottom.

---

## Execution order (the project plan)

```
Phase 1: foundations             (Pass 1 of pack)
  ├→ Pack 00, 01, 03 reviewed
  └→ Decisions in §"Open decisions" below resolved by human

Phase 2: specs                   (Pass 2 of pack)
  ├→ 02 written
  └→ 04 written

Phase 3: QA net                  (Brief 08 executed, Villager QA)
  └→ Regression suite passing on sg-video-editor v0.1.54
       └→ Quality gate: ALL tests in 04 §B pass against v0.1.54 BEFORE Phase 4 starts

Phase 4: build the toolkit       (Brief 05 executed, Explorer)
  ├→ All 6 components built in NEW versioned paths
  ├→ Sandbox tool built and exercising every checklist item in 04
  └→ sg-video-editor v0.1.54 untouched throughout

Phase 5: refactor                (Brief 06 executed, Explorer)
  ├→ sg-video-editor v0.1.55 created (new IFD minor version, new folder)
  ├→ Adapter layer wraps generic toolkit into the editor
  └→ Quality gate: regression suite from Phase 3 passes 100% against v0.1.55

Phase 6: greenfield consumer     (Brief 07 executed, Explorer, NEW team)
  └→ sg-audio-editor v0.1.0 ships, consumes toolkit, no fork

Phase 7: deprecation             (post-pack)
  ├→ sg-video-editor v0.1.54 marked deprecated (still deployed)
  ├→ Old <sg-timeline> v0.1.0 marked deprecated (still deployed)
  └→ After 2-4 weeks of v0.1.55 in production with no rollback: delete v0.1.54 + v0.1.0
```

Phases 4 and 6 can run in parallel (different teams, different code paths). Phase 5 cannot start until 3 and 4 are both green.

---

## What's IN scope

- Six generic core components, each at a new versioned path under `components/` or `core/`
- One sandbox tool that exercises every component with synthetic data (no video, no audio, no domain — just rectangles in lanes)
- New IFD minor version of `sg-video-editor` (`v0.1.55`) that consumes the toolkit; identical user-visible behaviour
- New tool: `sg-audio-editor` `v0.1.0`, Phase 0 + Phase 1 only (single-track, drop, trim, export — mirrors video editor Phase 1 scope)
- Regression test suite for `sg-video-editor` v0.1.54 that gates the v0.1.55 refactor
- Coding guidelines doc that codifies the patterns this codebase already implicitly follows
- Verification checklist used as a project plan (not just a final gate)

## What's OUT of scope

- Performance optimisation of the toolkit (Villager work, future pack)
- Production deployment of any new tool (Villager work, future pack)
- Adding NEW features to sg-video-editor (Explorer track, separate roadmap)
- Adding new features beyond the listed components (e.g. timeline-with-keyframes for animation — future pack)
- Migrating other tools currently using the standalone `<sg-timeline>` to the new toolkit (currently only sg-video-editor uses it; if that changes mid-execution, replan)
- Internationalisation of the new components beyond what they inherit from existing patterns
- Mobile / touch input parity (separate pack; the existing video editor is desktop-first, the toolkit inherits that constraint)

---

## Open decisions (must resolve before Pass 3)

These decisions are **not yet made**. The Pass 1 docs include both options where relevant. Resolve before Pass 3 briefs are written.

### D-001: New tool path for the audio editor

**Question:** Where does `sg-audio-editor` live? Options:
- (a) `tools/v0/v0.1/v0.1.X/en-gb/sg-audio-editor/` — sits alongside sg-video-editor in the same versioned tools tree
- (b) `tools/v0/v0.2/v0.2.0/en-gb/sg-audio-editor/` — bumps the tools major to mark "post-toolkit"

**Architect recommendation:** (a). The tools-tree version is independent of any individual tool's lifecycle.

### D-002: ~~Deprecation tag on `<sg-timeline>` v0.1.0~~ — RESOLVED, removed

This decision is removed. **Deprecation is built into IFD by reference-decay**: a frozen version stays at its path forever (in case any in-flight reference still uses it), and "deprecation" simply means no new tools or new pack work creates new references to it. There is no "deprecation tag" or "delete after N weeks." The old `<sg-timeline>` v0.1.0 stays at its path indefinitely, deployed, frozen. No new consumer references it. That is the deprecation. See §"Pass 1 revision history" below.

### D-003: Sandbox tool URL

**Question:** Public URL for the sandbox tool that exercises the toolkit?
- (a) `dev.tools.sgraph.ai/en-gb/sg-timeline-toolkit-sandbox/` — public, anyone can play with it
- (b) Internal-only, behind auth — sandbox is for the team, not users
- (c) Public, but explicitly marked "internal demo, not a product"

**Architect recommendation:** (c). The sandbox IS the spec; public visibility forces it to be polished, which forces the toolkit to be polished.

### D-004: Generic schema field for "the time-axis position"

**Question:** sg-video-editor uses `timelineStart`. The toolkit needs a generic name. Options:
- (a) Keep `timelineStart` — accept the slight time-axis bias; it's just a name
- (b) Rename to `position` — fully generic; works for non-time axes (Gantt rows, kanban-with-positions)
- (c) Rename to `start` — short, generic enough, doesn't read as "always-time"

**Architect recommendation:** (c). Short and unambiguous. The toolkit specifies `start` (number) is the position on whatever the host's axis represents — time, distance, line number in a log, frame number, whatever.

### D-005: Where the toolkit's `core/` modules live (path)

**Question:** Path for the non-component modules (`sg-project-storage`, anything else not a Web Component):
- (a) `core/sg-toolkit/v0/v0.1/v0.1.0/` — single bundled path
- (b) `core/sg-project-storage/v0/v0.1/v0.1.0/` etc. — one path per module, mirrors components

**Architect recommendation:** (b). Matches `core/sg-tool-api/`, `core/sg-layout/`, etc. The repo has no precedent for bundled core paths.

### D-006: ~~`sg-component` upgrade for the toolkit~~ — RESOLVED, removed

This decision is removed. With D-002 reframed (no deprecation events, just reference-decay), the question of retroactively upgrading `<sg-timeline>` v0.1.0 to extend `SgComponent` doesn't arise: v0.1.0 stays exactly as it is, frozen. New toolkit components extend `SgComponent` per A-002. The old component is left at its path; nothing in the new pack references it. See §"Pass 1 revision history" below.

### D-007: Manifest `loader.phase` numbering for the toolkit

**Question:** sg-video-editor's manifest uses 3 phases (CSS / JS deps / entry). The toolkit's sandbox tool will need to load 6+ components. Do we keep 3 phases?
- (a) Yes — phase 1 = all CSS, phase 2 = all components + helpers, phase 3 = entry
- (b) Add a phase 1.5 = "shared CSS tokens" before component CSS

**Architect recommendation:** (a). The shared tokens already load via `SgComponent.sharedCssPaths`; phase 1 doesn't need to know about them.

---

## How this pack relates to existing rules

This pack is governed by:

- **`.claude/CLAUDE.md`** — master rules. The "Villager does not add features" rule is why brief 06 is Explorer, not Villager.
- **`.claude/explorer/CLAUDE.md`** — Explorer team rules apply to briefs 05, 06, 07.
- **`library/development/ifd/v1.2.1__ifd__intro-and-how-to-use.md`** — IFD methodology. Toolkit components ship at `v0.1.0` (new majors); video editor refactor is a new minor (`v0.1.54` → `v0.1.55`).
- **`library/development/ifd/v1.3.0__ifd__surgical-overrides-version-stamped-filenames.md`** — surgical override rules. The video editor refactor is NOT a surgical override; it's a full rewrite of the integration layer at a new minor version.
- **`team/humans/dinis_cruz/briefs/02/16/v0.4.4__briefs__briefing-packs-for-agents.md`** — briefing pack iron rule (one folder per pack). This pack obeys it.
- **The Reality Document** at `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` is updated by the Librarian after the pack lands. This pack does NOT update reality on its own — that's a Librarian task post-merge.

---

## Architectural decisions encoded in this pack

These decisions are **made**, not open. They're called out here so any reviewer can challenge them in one place rather than hunting through eight docs.

### A-001: The toolkit is eight pieces, not one

The original framing was "extract the timeline." The decision is to extract **eight** pieces in one pack: five Web Components — `<sg-track-strip>`, `<sg-toolbar>`, `<sg-asset-panel>`, `<sg-properties-panel>`, `<sg-player-transport>` — and three JS modules — `sg-project-storage`, `sg-history`, `sg-config`. Rationale: these were all built together for the video editor (or, in the case of `sg-history` and `sg-config`, exist in some form already and need genericising) and they share contracts (events, drag-drop MIME types, project-state shape, op shape, config schema). Extracting them one-at-a-time means re-deriving those contracts eight times. See doc 01 §3.

### A-002: New components extend `SgComponent`, not raw `HTMLElement`

The current `<sg-timeline>`, `<sg-preview-canvas>`, `<sg-json-viewer>` extend raw `HTMLElement`. The repo's standard is `SgComponent` (newer components like `<sg-locale-picker>`, `<sg-key-input>`, `<sg-upload-dropzone>` use it). Toolkit components MUST extend `SgComponent`. See doc 03 §2.

### A-003: HTML, CSS, JS in separate sibling files for every component

Toolkit components MUST follow the `tag-name.{html,css,js}` sibling-file pattern that `SgComponent` enforces. The current `<sg-timeline>` violates this (CSS is separate but template is inlined into JS via `sr.innerHTML`). See doc 03 §3.

### A-004: Generic schema, no domain leakage

The toolkit's components consume a generic schema (`{tracks: [{id, items: [{id, start, end?, ...}]}]}`). They do NOT consume `assetId`, `kind: 'video'`, `clipId`, `inPoint`/`outPoint`. Domain mapping is the host's job, done at the boundary via an adapter. See doc 01 §5.

### A-005: Sandbox tool with synthetic data is the toolkit's spec

The toolkit's correctness is judged against the sandbox tool, which exercises every component with **synthetic, non-domain data**. If the sandbox renders Gantt rows correctly, log events correctly, fake video clips correctly — the toolkit is generic. If the sandbox needs to know about videos, the toolkit has leaked. See doc 01 §6.

### A-006: Behaviour preservation in the video editor refactor is non-negotiable

Brief 06 is a **swap**, not an evolution. Every saved project from v0.1.54 must round-trip through v0.1.55 without loss. Every test in the QA suite (08) must pass on v0.1.55. The IFD release notes for v0.1.55 say "no new features." Any feature change is a separate brief. See doc 03 §6.

### A-007: One Sonnet task = one acceptance check

Build briefs (05, 06, 07) are decomposed into numbered tasks, each with a falsifiable acceptance check. Sonnet performs better against numbered task lists than against large work items. See doc 03 §10.

### A-008: The verification checklist (04) is a project plan, not a quality gate

Each task in 05/06/07 references the checklist item(s) it satisfies. A task isn't "done" — a checklist item is "ticked." This forces the implementer to read 04 before starting, not after. See doc 03 §11.

### A-009: Pass 1 docs are durable; Pass 3 briefs are archive-after-merge

Docs 00, 01, 02, 03, 04 stay current and get amended over time. Briefs 05, 06, 07, 08 are execution artefacts — they describe a one-shot build and are NOT maintained after the merge. Marked accordingly in their headers.

### A-010: Components emit op-shaped events; ops are the durable record

Every toolkit component emits events whose detail is **op-shaped**: it carries the operation type, payload, before-state (for non-pure ops), reversal info, timestamp, and source. This is at the same priority as A-002 (`SgComponent`) and A-003 (sibling files). Adapters convert events into ops and feed them to `sg-history` (the new 7th toolkit module). Hosts can intercept, log, persist, replay, and attribute ops. See doc 01 §3.7 and doc 03 §M (op-driven architecture).

Each op falls into one of five categories declared in V.6: **pure**, **snapshot**, **with-side-effects**, **never** (one-way), **noisy** (coalesced). Each component declares the op categories it emits in a new manifest section `ops.emits`. This is parallel to how manifests already declare `actions` and `events`. See doc 03 §N (documenting undo support).

### A-011: Tree-based undo, sgit-vault storage, and git-named API are explicitly out of scope

This pack ships flat-stack undo only. The graph/tree-undo conversation, the sgit-vault future-storage story, the question of whether git verbs (clone/branch/push/pull/merge) should ever appear in a public undo API, and several related design questions are all captured in **doc 09 — `09__future__graph-based-version-control.md`**, tagged `OUT OF SCOPE`. The sg-history module's internal data structure is designed so a future tree-undo implementation can replace the flat backend without changing consumer code. See doc 09 for the full conversation, the precedents (Vim/Gundo), the rejected designs, and the open questions a future pack must resolve.

---

# Vocabulary appendix — the source of truth for names, paths, and contracts

Every name in the rest of this pack — every event, every method, every path, every CSS variable, every schema field — is pinned here. **If a later document disagrees with this appendix, this appendix wins.** Implementers reading later docs should grep this appendix to resolve any ambiguity.

This appendix exists because the pack will be read by multiple Sonnet sessions, each doing one brief in isolation. Without a single source of vocabulary truth, the briefs will drift.

## V.1 — Component names and their versioned paths

The eight new generic components / modules:

| Name | Type | Path | Initial version |
|---|---|---|---|
| `<sg-track-strip>` | Web Component | `components/sg-track-strip/v0/v0.1/v0.1.0/` | `v0.1.0` |
| `<sg-toolbar>` | Web Component | `components/sg-toolbar/v0/v0.1/v0.1.0/` | `v0.1.0` |
| `<sg-asset-panel>` | Web Component | `components/sg-asset-panel/v0/v0.1/v0.1.0/` | `v0.1.0` |
| `<sg-properties-panel>` | Web Component | `components/sg-properties-panel/v0/v0.1/v0.1.0/` | `v0.1.0` |
| `<sg-player-transport>` | Web Component | `components/sg-player-transport/v0/v0.1/v0.1.0/` | `v0.1.0` |
| `sg-project-storage` | JS module | `core/sg-project-storage/v0/v0.1/v0.1.0/` | `v0.1.0` |
| `sg-history` | JS module | `core/sg-history/v0/v0.1/v0.1.0/` | `v0.1.0` |
| `sg-config` | JS module | `core/sg-config/v0/v0.1/v0.1.0/` | `v0.1.0` |

The sandbox tool:

| Name | Type | Path | Initial version |
|---|---|---|---|
| `sg-timeline-toolkit-sandbox` | Tool | `tools/v0/v0.1/v0.1.X/en-gb/sg-timeline-toolkit-sandbox/` | `v0.1.0` |

(`X` is the next available tools-tree minor version at the time of brief 05's execution. Resolved by the implementer; do not pin a specific number here.)

The refactored video editor:

| Name | Type | Path | Initial version |
|---|---|---|---|
| `sg-video-editor` (refactored) | Tool | `tools/v0/v0.1/v0.1.55/en-gb/sg-video-editor/` | `v0.1.55` (new) |
| `sg-video-editor` (old, frozen) | Tool | `tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor/` | `v0.1.54` (unchanged) |

The new audio editor:

| Name | Type | Path | Initial version |
|---|---|---|---|
| `sg-audio-editor` | Tool | `tools/v0/v0.1/v0.1.X/en-gb/sg-audio-editor/` | `v0.1.0` |

(`X` resolved by the implementer at brief 07 execution time. See open decision D-001.)

## V.2 — Event names and op-shaped detail

All events are dispatched on the host element with `bubbles: true, composed: true`. Names are frozen — the constants exported from the `*-events.js` file are the source of truth in code; this table is the source of truth across documentation.

**Op-shaped events (per A-010).** Every event detail in this section follows the **op-shape envelope**:

```
{
    op: {
        type:        string,        // op type, matching the event name's last segment (e.g. "item-moved")
        payload:     object,        // op-specific fields (the "what changed")
        priorState:  object | null, // captured before-state for non-pure ops; null for pure ops
        reversible:  string,        // one of: 'pure' | 'snapshot' | 'with-side-effects' | 'never' | 'noisy' (see V.6)
        timestamp:   number,        // Date.now() at emission
        source:      string,        // 'user-drag' | 'user-button' | 'user-keyboard' | 'user-input' | 'agent' | 'replay' | other host-defined
    },
    // Some events may carry additional non-op fields (e.g. drag metadata). Documented per-event.
}
```

The op envelope is uniform across every component. Hosts that want only the after-state read `e.detail.op.payload`. Hosts that want full op semantics read `e.detail.op` and forward to `sg-history.record(op)`. The toolkit components NEVER call `sg-history` directly — they emit op-shaped events and let the host adapter route them.

**Pure ops** carry `priorState: null` and rely on the inverse being deterministic from the payload alone (e.g. an `item-moved` op with `{fromStart, toStart}` is reversible by swapping the two values).

**Snapshot ops** carry `priorState` containing whatever the host needs to restore the prior state (e.g. an `item-deleted` op carries the deleted item's full record).

**With-side-effects ops** carry `priorState` plus a `sideEffects` array naming side effects the host's rollback handlers know how to reverse (e.g. `['blob-allocated']`).

**Never ops** are recorded for audit/replay but the history component refuses to undo past them (or treats them as no-ops on undo, host's call).

**Noisy ops** are coalesced — the history component's default behaviour is to drop them from the undo stack unless the host opts in (`historyConfig.captureNoisy: true`).

### V.2.1 — `<sg-track-strip>` events (`SGTS_EVENTS`)

Each event detail is `{op: {...}}` per the envelope above. The `op.type` matches the last segment of the event name. The table below specifies `op.payload` (the type-specific payload) and `op.reversible` category. `op.priorState` shape follows from the category: pure ops have `null`, snapshot ops carry a host-shaped record, side-effect ops carry both.

| Event name | `op.payload` | `op.reversible` | Emitted when |
|---|---|---|---|
| `sg-track-strip:item-added` | `{trackId, item, snapped}` | `snapshot` (priorState = `null` since item didn't exist; inverse is `item-deleted`) | Host should add the item; emitted by drop |
| `sg-track-strip:item-moved` | `{itemId, fromTrackId, toTrackId, fromStart, toStart, snapped}` | `pure` | User dragged an item to a new position |
| `sg-track-strip:item-trimmed` | `{itemId, fromStart, fromEnd, toStart, toEnd}` | `pure` | User dragged an edge handle |
| `sg-track-strip:item-selected` | `{itemId, priorItemId}` (`itemId: null` clears) | `noisy` | User clicked an item |
| `sg-track-strip:item-deleted` | `{itemId}` (priorState carries full deleted item record) | `snapshot` | User clicked the × button on an item |
| `sg-track-strip:item-split-requested` | `{itemId, atPosition}` | `snapshot` (priorState carries the un-split item; inverse is delete-new-merge-back) | User pressed S with an item selected |
| `sg-track-strip:item-color-requested` | `{itemId, fromColor, toColor}` (`toColor: null` resets) | `pure` | User picked a colour for the selected item |
| `sg-track-strip:item-copied` | `{newItemId, sourceItemId, fromTrackId?, toTrackId?, start?}` | `snapshot` (inverse is `item-deleted` of newItemId) | User Cmd-dragged or pressed Cmd+C |
| `sg-track-strip:item-paste-requested` | `{}` | `noisy` (the actual paste creates a new op via `item-added`) | User pressed Cmd+V or clicked Paste |
| `sg-track-strip:item-track-changed` | `{itemId, fromTrackId, toTrackId, fromStart, toStart}` | `pure` | User dragged item to a different lane |
| `sg-track-strip:playhead-changed` | `{fromPosition, toPosition}` | `noisy` | User scrubbed the ruler |
| `sg-track-strip:track-add-requested` | `{kind?, atIndex?}` | `snapshot` (inverse is `track-remove`) | User clicked +Track |
| `sg-track-strip:track-remove-requested` | `{trackId}` (priorState carries full track + items) | `snapshot` | User clicked × on a lane header |
| `sg-track-strip:track-mute-requested` | `{trackId, fromMuted, toMuted}` | `pure` | User clicked M toggle |
| `sg-track-strip:track-lock-requested` | `{trackId, fromLocked, toLocked}` | `pure` | User clicked lock toggle |
| `sg-track-strip:track-renamed` | `{trackId, fromName, toName}` | `pure` | User committed an inline rename |
| `sg-track-strip:track-selected` | `{trackId, priorTrackId}` (`trackId: null` clears) | `noisy` | User clicked a lane header |
| `sg-track-strip:undo-requested` | `{}` | `noisy` (a request, not a state change) | User clicked Undo (if toolbar wired) |
| `sg-track-strip:redo-requested` | `{}` | `noisy` | User clicked Redo (if toolbar wired) |
| `sg-track-strip:editor-mode-requested` | `{fromMode, toMode}` | `pure` | User clicked an editor-mode button |

These names mirror the existing `SGT_EVENTS` from `<sg-timeline>` but with three deliberate renames (`clip` → `item`, `timeline` → `track-strip` in the prefix, `timelineStart` → `start`) PLUS the op-shape envelope. The renames are intentional and force every reference to be re-evaluated — see doc 03 §A.2 (DO-NOT list).

### V.2.2 — `<sg-toolbar>` events (`SGTB_EVENTS`)

Toolbar events are mostly `noisy` ops since the toolbar's clicks don't change project state directly — they signal the host to do something else.

| Event name | `op.payload` | `op.reversible` | Emitted when |
|---|---|---|---|
| `sg-toolbar:button-clicked` | `{buttonId, groupId?}` | `noisy` | User clicked a registered button |
| `sg-toolbar:popover-opened` | `{popoverId}` | `noisy` | A popover-anchored button was clicked |
| `sg-toolbar:popover-closed` | `{popoverId, reason}` (`reason: 'select'\|'dismiss'\|'blur'`) | `noisy` | A popover closed |

Toolbar buttons are registered, not declared in DOM. See doc 02 §2 (component catalogue, sg-toolbar section) — written in Pass 2.

### V.2.3 — `<sg-asset-panel>` events (`SGAP_EVENTS`)

| Event name | `op.payload` | `op.reversible` | Emitted when |
|---|---|---|---|
| `sg-asset-panel:asset-add-requested` | `{file, suggestedAssetId}` | `with-side-effects` (sideEffects: `['blob-allocated']`; priorState carries `null` since the asset is new) | User dropped a file into the panel |
| `sg-asset-panel:asset-remove-requested` | `{assetId}` (priorState carries asset record + reference to blob) | `with-side-effects` (sideEffects: `['blob-may-orphan']`) | User clicked × on an asset row |
| `sg-asset-panel:asset-drag-started` | `{assetId, mime}` | `noisy` | User started dragging an asset row out |
| `sg-asset-panel:asset-drag-ended` | `{assetId, accepted}` | `noisy` | Drag ended (drop succeeded or was cancelled) |
| `sg-asset-panel:asset-selected` | `{assetId, priorAssetId}` (`assetId: null` clears) | `noisy` | User clicked an asset row |

### V.2.4 — `<sg-properties-panel>` events (`SGPP_EVENTS`)

| Event name | `op.payload` | `op.reversible` | Emitted when |
|---|---|---|---|
| `sg-properties-panel:field-changed` | `{sectionId, fieldId, fromValue, toValue}` | `pure` | User committed an edit |
| `sg-properties-panel:section-action` | `{sectionId, actionId}` | `noisy` (action triggers other ops) | User clicked a section action button |

### V.2.5 — `<sg-player-transport>` events (`SGPT_EVENTS`)

Transport events are largely `noisy` — playback position is rarely something users want to undo.

| Event name | `op.payload` | `op.reversible` | Emitted when |
|---|---|---|---|
| `sg-player-transport:play-requested` | `{}` | `noisy` | User clicked play |
| `sg-player-transport:pause-requested` | `{}` | `noisy` | User clicked pause |
| `sg-player-transport:seek-requested` | `{fromPosition, toPosition}` | `noisy` | User dragged the position indicator |
| `sg-player-transport:refresh-requested` | `{}` | `noisy` | User clicked the redraw button |
| `sg-player-transport:position-changed` | `{fromPosition, toPosition}` | `noisy` | The attached playable advanced (re-broadcast for hosts) |
| `sg-player-transport:state-changed` | `{fromState, toState}` (`'playing'\|'paused'\|'ended'`) | `noisy` | The attached playable changed state |

### V.2.6 — `sg-history` events (`SGH_EVENTS`)

`sg-history` is a JS module (not a Web Component), but it dispatches events on a host-supplied `EventTarget` (typically the tool's root element or a dedicated `<EventTarget>` instance). Detail follows the standard op-shape envelope.

| Event name | `op.payload` | `op.reversible` | Emitted when |
|---|---|---|---|
| `sg-history:op-recorded` | `{recordedOp, position}` (where `recordedOp` is the op just appended; `position` is the new index) | `never` (it's a record-of-record, doesn't undo) | An op is recorded via `record(op)` |
| `sg-history:undone` | `{undoneOp, fromPosition, toPosition}` | `never` | `undo()` was called and a position change occurred |
| `sg-history:redone` | `{redoneOp, fromPosition, toPosition}` | `never` | `redo()` was called and a position change occurred |
| `sg-history:cleared` | `{discardedCount}` | `never` | `clear()` was called |
| `sg-history:position-changed` | `{fromPosition, toPosition}` | `never` | `goTo(position)` was called |
| `sg-history:bounds-changed` | `{canUndo, canRedo}` | `never` | Convenience event re-broadcast on every position change for toolbar wiring |
| `sg-history:branched` | `{discardedOpIds}` | `never` | A new op was recorded after an undo, discarding the redo tail (in flat-stack v0.1.0); future tree-undo will reframe this — see doc 09 |

## V.3 — Public method signatures

Every Web Component in the toolkit has a stable public method surface. Methods listed here are **the contract**. Implementers may add private methods (`#name`) freely, but adding a public method requires updating this appendix and bumping the component to the next minor version.

### V.3.1 — `<sg-track-strip>` methods

```
setProject(project: Project): void
setSelectedItem(itemId: string | null): void
setSelectedTrack(trackId: string | null): void
setPlayheadPosition(position: number): void
setPixelsPerUnit(pps: number): void
fitToView(): void
setHistoryFlags({canUndo: boolean, canRedo: boolean}): void
setClipboardFlags({canPaste: boolean}): void
setEditorMode(mode: string | null): void
```

### V.3.2 — `<sg-toolbar>` methods

```
addButton({id, label, icon?, group?, popover?, onClick?}): void
removeButton(id: string): void
setButtonEnabled(id: string, enabled: boolean): void
setButtonActive(id: string, active: boolean): void
addSeparator(group?: string): void
addPopover({id, anchorButtonId, contentEl}): void
```

### V.3.3 — `<sg-asset-panel>` methods

```
setAssets(assets: Asset[]): void
setSelectedAsset(assetId: string | null): void
setDragMime(mime: string): void
setMissingAssets(assetIds: string[]): void
```

### V.3.4 — `<sg-properties-panel>` methods

```
addSection({id, title, fields: Field[]}): void
removeSection(id: string): void
setFieldValue(sectionId: string, fieldId: string, value: any): void
setSectionVisible(id: string, visible: boolean): void
```

### V.3.5 — `<sg-player-transport>` methods

```
attachPlayable(playable: Playable): void
detachPlayable(): void
setPosition(position: number): void
setDuration(duration: number): void
setEnabled(enabled: boolean): void
```

`Playable` interface:
```
{
  play(): void
  pause(): void
  seek(position: number): void
  refresh(): void
  getCurrentPosition(): number
  getDuration(): number
  // Dispatches 'sg-playable:position-changed' and 'sg-playable:state-changed' on the host
}
```

### V.3.6 — `sg-project-storage` module exports

The save shape is a `{project, ui?, ops?}` envelope. The `project` slot carries the host's domain project. The `ui` slot is **host-defined** — the toolkit does not specify its shape; hosts use it for sg-layout panel sizes, scroll positions, zoom levels, selected-item-on-load, expanded property sections, etc. The `ops` slot optionally carries a serialised op log (from `sg-history.getOps()`) so a "load and replay" or "load and rewind to op N" workflow is trivial. Saving `ui` and `ops` is opt-in per tool.

```
saveProject(opts: {project, slug, ui?, ops?, blobsById?, indexKey?, projectKeyPrefix?}): Promise<{slug, savedAt, json}>
loadProject(opts: {slug, indexKey?, projectKeyPrefix?}): Promise<{project, ui, ops, blobsById, missingBlobIds}>
listSavedProjects(opts: {indexKey?}): Promise<Array<{slug, name, savedAt, byteSize}>>
deleteSavedProject(opts: {slug, indexKey?, ...}): Promise<{deleted: boolean, prunedBlobIds: string[]}>
autosave(opts: {project, ui?, ops?, blobsById?, slotKey?}): Promise<{savedAt, json}>
getAutosave(opts: {slotKey?}): Promise<{savedAt, project, ui, ops} | null>
discardAutosave(opts: {slotKey?}): Promise<void>
isAutosaveNewer(opts: {savedAt, indexKey?}): Promise<{newer: boolean}>
hydrateBlobs(opts: {assetIds, dbName?, storeName?}): Promise<{blobsById, missingIds}>
pruneOrphanBlobs(opts: {referencedIds, dbName?, storeName?}): Promise<{prunedIds}>
computeStorageUsage(opts: {dbName?, storeName?, indexKey?, projectKeyPrefix?}): Promise<{totalBytes, blobBytes, blobCount, projectJsonBytes}>
hashProject(project: Project): string
```

All async methods return Promises. `slug`, `indexKey`, `projectKeyPrefix`, `slotKey`, `dbName`, `storeName` are host-configurable so two tools can co-exist in localStorage / IDB without colliding.

### V.3.7 — `sg-history` module exports

```
createHistory(opts?: {
    eventTarget?:    EventTarget,    // where to dispatch SGH_EVENTS; defaults to a new EventTarget
    maxOps?:         number,         // default 10000; soft cap, prunes oldest non-snapshot-anchored ops
    maxBytes?:       number,         // default 25_000_000 (25 MB); hard cap, errors on overflow
    snapshotEvery?:  number,         // default 100; capture full state every N ops for fast scrub
    captureNoisy?:   boolean,        // default false; include 'noisy' ops in the undo stack
    onSideEffect?:   (op, direction) => Promise<void>,  // host-supplied rollback for 'with-side-effects' ops
    onSnapshot?:     () => any,      // host-supplied "give me the current full state" for snapshot anchors
    onApply?:        (op, direction: 'forward'|'backward') => void,  // host-supplied applicator
}): History

History = {
    record(op: Op): void                       // append op; discards redo tail (in flat-stack v0.1.0)
    undo(): {applied: Op | null}               // step backward; null if nothing to undo
    redo(): {applied: Op | null}               // step forward; null if nothing to redo
    canUndo(): boolean
    canRedo(): boolean
    getOps(): Op[]                             // full op log (immutable copy)
    getOpAt(index: number): Op | null
    getPosition(): number                      // current head position (0 = no ops applied)
    goTo(position: number): {appliedOps: Op[]} // jump to position; replays or rewinds via onApply
    replayOps(ops: Op[]): void                 // bulk-load ops from save; calls onApply per op
    clear(): {discardedCount: number}
    getStorageUsage(): {opCount, byteSize, snapshotCount}
    getEventTarget(): EventTarget              // for hosts that want to listen to SGH_EVENTS
}

Op = {
    type:        string,
    payload:     object,
    priorState:  object | null,
    reversible:  'pure' | 'snapshot' | 'with-side-effects' | 'never' | 'noisy',
    timestamp:   number,
    source:      string,
    id?:         string,                       // optional uuid for op-by-op addressing (used by goTo via id-resolution)
}
```

The host wires `onApply` to its state container's mutation methods. When `undo()` is called, sg-history calls `onApply(op, 'backward')`, and the host applies the inverse of the op. When `redo()` is called, `onApply(op, 'forward')`. The host is responsible for the actual state mutation; sg-history is responsible for the bookkeeping.

For `with-side-effects` ops, sg-history calls `onSideEffect(op, direction)` BEFORE `onApply` so the host can roll back side effects (e.g. delete an orphaned blob) before applying the state change.

For `snapshot` ops, sg-history captures `onSnapshot()` output every `snapshotEvery` records as a fast-scrub anchor; `goTo(position)` finds the nearest snapshot ≤ target and replays forward from there.

For `noisy` ops, sg-history records them only if `captureNoisy: true`; otherwise they pass through silently and never enter the undo stack (selection clicks, playhead scrubs, hover events).

For `never` ops, sg-history records them but `undo()` skips past them invisibly (or refuses to cross them, host-configurable via a future opt). v0.1.0 ships skip-past-them behaviour.

### V.3.8 — `sg-config` module exports

`sg-config` is a small JS module (~250 LOC target) that holds per-tool configuration with persistence, defaults, URL-parameter overrides, and a helper to render into `<sg-properties-panel>`. It is the "Config tab" plumbing for every toolkit-consuming tool — replacing bespoke per-tool config code with a single shared module.

```
createConfig(opts: {
    namespace:    string,                 // unique per tool, e.g. 'sgve' for sg-video-editor
    schema:       Record<string, FieldSchema>,  // declarative field definitions
    storage?:     'localStorage' | 'memory',    // default 'localStorage'; 'memory' for tests
    storageKey?:  string,                 // default `<namespace>:config`; override for migration
    urlOverrides?: boolean,               // default true; ?config.<key>=<value> overrides for one session
    eventTarget?: EventTarget,            // dispatches SGCFG_EVENTS; defaults to a new EventTarget
}): Config

FieldSchema = {
    type:         'boolean' | 'number' | 'string' | 'select' | 'color',
    default:      any,
    label:        string,                 // shown in the panel
    description?: string,                 // shown below the label in the panel
    options?:     Array<{value, label}>,  // for type: 'select'
    min?:         number,                 // for type: 'number'
    max?:         number,
    step?:        number,
    debug?:       boolean,                // default false; when true, only shown when host enables debug mode
    deprecated?:  boolean,                // default false; field exists for migration but is not shown
}

Config = {
    get(key: string): any                       // returns current value (URL override > stored > default)
    set(key: string, value: any): void          // updates and persists; emits SGCFG_EVENTS.changed
    reset(key?: string): void                   // resets one field or all to defaults
    getAll(): Record<string, any>               // current values for all fields
    getSchema(): Record<string, FieldSchema>    // for inspection
    toFields(opts?: {includeDebug?: boolean}): Field[]  // helper: maps schema → V.4 Field[] for sg-properties-panel
    setDebugMode(on: boolean): void             // toggles whether debug:true fields are exposed by toFields()
    onChange(cb: (key, newValue, oldValue) => void): () => void  // subscribe; returns unsubscribe
    getEventTarget(): EventTarget               // for hosts that want to listen to SGCFG_EVENTS
    exportSnapshot(): object                    // serialisable snapshot for support/debug bundles
    importSnapshot(snapshot: object): void      // restore from a snapshot
}
```

The host registers fields with the schema, mounts a section in `<sg-properties-panel>` populated by `config.toFields()`, and listens for `sg-properties-panel:field-changed` events. When a field changes, the host calls `config.set(...)` — which persists, emits the change event, and triggers any registered `onChange` listeners.

Config field changes flow through the standard op pipeline: the `<sg-properties-panel>:field-changed` event is op-shaped (`reversible: 'pure'`), so config changes are undoable like any other field change.

URL overrides: `?config.log-level=silent` reads as `config.get('log-level') === 'silent'` for the duration of the session, regardless of stored value. This is for support, debugging, and automation. Overrides do NOT persist; they are session-scoped.

`SGCFG_EVENTS`:
- `sg-config:changed` — payload `{key, fromValue, toValue, source: 'user'|'url-override'|'reset'}`. Op-shaped (`reversible: 'pure'` for `'user'`; `'never'` for `'url-override'`; `'snapshot'` for `'reset'`).
- `sg-config:debug-mode-changed` — payload `{from, to}`. `reversible: 'noisy'`.
- `sg-config:imported` — payload `{snapshotKeys}`. `reversible: 'snapshot'` (priorState is the prior full config snapshot).

## V.3.X — Note on "view" methods (panels, sg-layout state)

Hosts that want to round-trip UI state (panel widths, splitter positions, selected items, zoom, scroll) write their own UI-state object and pass it to `saveProject({ui: ...})`. The toolkit components do NOT serialise UI state automatically. Hosts MAY use `<sg-layout>`'s existing layout-state methods (if/when sg-layout exposes them) or maintain their own; either way the data lands in the `ui` slot of the save envelope. The `<sg-properties-panel>` MAY emit a `sg-properties-panel:section-toggled` op-shaped event (`reversible: 'noisy'`) so hosts can capture expand/collapse state if they want.

Note that **config state and UI state are separate concerns**: config (via `sg-config`) is per-tool persistent settings (autosave on/off, log level, etc.); UI state is per-project visual state (panel widths, scroll, selected item). Config is global to the tool; UI state is tied to a project save.

## V.4 — Generic schema (the `Project` shape)

The toolkit's components consume this shape. `?` denotes optional. Hosts MAY add additional fields — the toolkit ignores anything it doesn't recognise.

```
Project = {
  schemaVersion: number,         // toolkit consumers read but don't write — host owns this
  name: string,
  tracks: Track[],
  // any number of host-specific fields, ignored by toolkit
}

Track = {
  id: string,                    // unique per project
  kind?: string,                 // host-defined opaque tag; toolkit doesn't filter on it
  name?: string,                 // optional display name; falls back to "Track N"
  color?: string,                // optional override; falls back to palette[i % 6]
  muted?: boolean,
  locked?: boolean,
  items: Item[],
}

Item = {
  id: string,                    // unique per project
  start: number,                 // position on the host's axis (time, distance, line number, ...)
  end?: number,                  // for items with extent; absent → point-in-time item rendered as a marker
  color?: string,                // optional; overrides track.color and palette
  label?: string,                // optional display label; host may compute via hooks
  // any number of host-specific fields, ignored by toolkit
}

Asset = {
  id: string,
  name: string,
  // any number of host-specific fields, ignored by toolkit
  // hosts that use sg-asset-panel commonly add: blob, mimeType, kind, dimensions, duration, etc.
}

Field = {                        // for sg-properties-panel
  id: string,
  type: 'text' | 'number' | 'select' | 'color' | 'checkbox' | 'button',
  label: string,
  value: any,
  options?: Array<{value, label}>, // for type: 'select'
  readonly?: boolean,
}
```

Fields the toolkit does NOT define — these belong to the host's domain mapping:
- `assetId` (video editor uses this; audio editor would too; sandbox doesn't)
- `inPoint` / `outPoint` (video editor's source-media trim points; toolkit knows only `start`/`end`)
- `kind: 'video' | 'audio' | 'shape' | 'text'` (host-defined opaque string passed via `track.kind` or `item.kind`)
- `transform` / `crop` (video editor's per-clip canvas transform; sandbox-irrelevant)

## V.4.5 — Op schema (used by sg-history and op-shaped events)

Every op recorded in sg-history and every op-shaped event detail uses this shape:

```
Op = {
  id?:         string,    // optional uuid — assigned by sg-history if missing; used for op-by-op addressing and future tree-undo branching
  type:        string,    // matches the event-name's last segment (e.g. 'item-moved', 'item-deleted', 'track-renamed')
  payload:     object,    // op-specific fields. For pure ops, contains both from-state and to-state. For snapshot ops, contains the to-state.
  priorState:  object | null,  // for snapshot and with-side-effects ops, the captured before-state needed for undo. null for pure ops.
  reversible:  'pure' | 'snapshot' | 'with-side-effects' | 'never' | 'noisy',  // see V.6
  sideEffects?: string[], // for 'with-side-effects' ops, names side effects the host's onSideEffect handler will reverse (e.g. ['blob-allocated'])
  timestamp:   number,    // Date.now() at emission
  source:      string,    // 'user-drag' | 'user-button' | 'user-keyboard' | 'user-input' | 'agent' | 'replay' | other host-defined
  // host-specific fields permitted; sg-history preserves them across save/load
}
```

Hosts MAY add custom fields to the op (e.g. `userId`, `sessionId`, `agentName` for attribution). sg-history preserves unknown fields.

## V.5 — CSS custom properties exposed by the toolkit

Components read these from `:host`. Hosts override by setting the variable on the component element. Fallbacks come from `sg-tokens.css`.

```
--sgts-lane-height          (default: 44px)        sg-track-strip lane row height
--sgts-ruler-height         (default: 28px)
--sgts-handle-size          (default: 4px)         resize handle width
--sgts-track-header-width   (default: 96px)        sticky-left header column
--sgts-min-item-width       (default: 2px)         clamp at zero-duration items
--sgts-bg                   (token: --sg-bg)
--sgts-surface              (token: --sg-surface)
--sgts-accent               (token: --sg-color-teal)
--sgts-border               (token: --sg-color-slate)

--sgtb-button-height        (default: 28px)        sg-toolbar button height
--sgtb-button-gap           (default: 4px)
--sgtb-bg                   (token: --sg-surface)

--sgap-row-height           (default: 32px)        sg-asset-panel asset row height
--sgpp-section-gap          (default: 12px)        sg-properties-panel section vertical gap
--sgpt-control-size         (default: 32px)        sg-player-transport control button size
```

Toolkit components use the prefix matching their tag (`sgts` for `<sg-track-strip>`, etc.). Hosts NEVER override `--sg-*` tokens directly on toolkit components — those are global.

## V.6 — Op-support taxonomy (the 5 categories)

Every op recorded in sg-history declares its `reversible` category. This taxonomy is **the** mechanism by which different ops get different undo treatment. It is generic — it works across every tool — and it is exhaustive: every op the existing video editor emits maps cleanly onto one of these five.

### V.6.1 — `pure`

The op carries enough information to reverse itself with no side effects and no captured prior state. Both forward and backward apply are deterministic from the payload alone.

**Payload convention.** Pure ops MUST contain both before-state and after-state in the payload, named symmetrically. Examples: `{fromStart, toStart}`, `{fromColor, toColor}`, `{fromMuted, toMuted}`, `{fromName, toName}`.

**Use cases (existing video editor).** `item-moved`, `item-trimmed`, `item-color`, `track-mute`, `track-lock`, `track-renamed`, `field-changed` (per V.2.4), `editor-mode`, `item-track-changed`.

**Memory cost.** Lowest. ~50–200 bytes per op.

**Inverse strategy.** Swap from-fields and to-fields. The host's `onApply(op, 'backward')` reads from-fields; `onApply(op, 'forward')` reads to-fields.

### V.6.2 — `snapshot`

The op causes a destructive structural change (deletion, addition, split). To reverse it, the captured prior state is required.

**Payload convention.** The `payload` describes what the op does going forward; `priorState` carries the full before-state needed to restore.

**Use cases (existing video editor).** `item-added` (priorState: null; inverse is delete), `item-deleted` (priorState: full item record), `item-split` (priorState: the un-split item), `item-copied` (priorState: null on forward; inverse is delete the copy), `track-add` (priorState: null), `track-remove` (priorState: full track + items).

**Memory cost.** Moderate. ~200 bytes – 50 KB per op depending on what was deleted (a single small clip vs a whole track of clips).

**Inverse strategy.** Forward apply uses payload; backward apply uses priorState to reconstruct.

### V.6.3 — `with-side-effects`

The op causes a non-state side effect (allocating a blob in IndexedDB, registering a worker, opening a network connection) that the history component cannot undo by itself. The host registers `onSideEffect(op, direction)` to roll the side effect back.

**Payload convention.** Same as snapshot ops, plus a `sideEffects: string[]` array naming the side effects so the host can route to the right rollback.

**Use cases (existing video editor + audio editor).** `asset-add-requested` (sideEffects: `['blob-allocated']`), `asset-remove-requested` (sideEffects: `['blob-may-orphan']` — host's onSideEffect either prunes the blob immediately or marks for later orphan-pruning), future `media-probed` (sideEffects: `['probe-cached']` for the hidden-`<video>` async dimension probe).

**Memory cost.** Moderate to high.

**Inverse strategy.** sg-history calls `onSideEffect(op, direction)` BEFORE the state-change `onApply` so the host's rollback runs first. If `onSideEffect` rejects, the undo aborts and the op stays current.

### V.6.4 — `never` (one-way)

The op happened in the world; the world doesn't unhappen. Recording the op is still valuable (audit trail, replay log, agent observation), but the op cannot be undone.

**Payload convention.** Whatever describes the action.

**Use cases (existing video editor + downstream).** `mp4-exported` (file landed on disk; user can't un-download), future `external-share-sent` (Slack/email message went out), future `payment-confirmed`. Some `with-side-effects` ops are also `never` if the side effect is irrevocable (e.g. emitting a webhook).

**Memory cost.** Low (no priorState).

**Inverse strategy.** sg-history's default behaviour (v0.1.0): `undo()` skips past `never` ops invisibly, advancing the position pointer through them without applying anything. Hosts MAY future-configure to refuse to cross `never` ops (e.g. "you've exported; further undo is blocked"). Not in v0.1.0.

### V.6.5 — `noisy` (coalesced / not on the undo stack by default)

The op was a UI gesture that has no useful reversal. Selection clicks, hover events, playhead scrubs, focus changes. Capturing them as ops is valuable for replay/observation; putting them on the undo stack is bad UX (Ctrl+Z would walk back through every selection click before reaching a real change).

**Payload convention.** Same as pure ops (with from-fields and to-fields).

**Use cases (existing video editor).** `item-selected`, `track-selected`, `playhead-changed`, `seek-requested`, `play-requested`, `pause-requested`, `popover-opened`, `popover-closed`, `button-clicked`, `paste-requested` (the actual paste creates a separate `item-added` op).

**Memory cost.** Low — but only kept if the host opts in via `historyConfig.captureNoisy: true`.

**Inverse strategy.** sg-history default (v0.1.0): `noisy` ops are NOT recorded into the undo stack at all. The op is silently dropped (or, if `captureNoisy: true`, recorded but flagged as skip-on-undo so undo passes over them).

### V.6.6 — Mapping summary (current sg-video-editor → categories)

This table is what brief 06's refactor uses to migrate the existing snapshot-stack history to op-based history. Every existing mutation maps to a category.

| Existing op | Category | Notes |
|---|---|---|
| `loadAsset` | `with-side-effects` | sideEffects: `['blob-allocated']` |
| `removeAsset` | `with-side-effects` | sideEffects: `['blob-may-orphan']` |
| `addClip` | `snapshot` | priorState: null; inverse is `removeClip` |
| `removeClip` | `snapshot` | priorState: full clip record |
| `moveClip` | `pure` | from/to start, optional from/to track |
| `trimClip` | `pure` | from/to outPoint (or in/outPoint pair) |
| `splitClip` | `snapshot` | priorState: the un-split clip |
| `setClipColor` | `pure` | from/to color |
| `setClipTransform` | `pure` | from/to transform |
| `setClipCrop` | `pure` | from/to crop |
| `addTrack` | `snapshot` | priorState: null |
| `removeTrack` | `snapshot` | priorState: full track + clips |
| `reorderTracks` | `pure` | from/to index for the moved track |
| `setTrackMuted` | `pure` | from/to muted |
| `setTrackLocked` | `pure` | from/to locked |
| `renameTrack` | `pure` | from/to name |
| `setProjectName` | `pure` | from/to name |
| `selectClip` | `noisy` | dropped from undo stack by default |
| `selectTrack` | `noisy` | dropped from undo stack by default |
| `scrubPlayhead` | `noisy` | dropped from undo stack by default |
| `exportMp4` (completed) | `never` | recorded for replay/audit; undo skips past |
| `setEditorMode` | `pure` | from/to mode |
| `addShape` / `addText` | `snapshot` | discriminated-union case of `addClip` |

This table is reproduced in brief 06 as the migration spec.

## V.7 — Drag-drop MIME types

The toolkit uses **host-supplied** MIME types for drag-drop. The toolkit does not define `application/x-sg-asset` (that's a video-editor convention).

| Use case | MIME source | Notes |
|---|---|---|
| Drag from asset panel to track strip | `<sg-asset-panel>.setDragMime('application/x-sg-something')` | Host picks; toolkit just forwards |
| Drag from track strip to OS / external | Not toolkit's job; host wires this on item-drag if needed | |
| Drag-out of exported result | Not toolkit's job (this lives in the player or a host-specific export panel) | |

The current video editor uses `application/x-sg-asset` and that's fine — but the toolkit has no opinion. The audio editor MAY use `application/x-sg-audio-asset` if it wants to be distinguishable to drop targets.

## V.8 — Storage keys (used by `sg-project-storage` and configurable per host)

| Default key | Purpose | Host override param |
|---|---|---|
| `sg-storage:project:<slug>` | Saved project JSON | `projectKeyPrefix` |
| `sg-storage:projects-index` | Array of saved-project metadata | `indexKey` |
| `sg-storage:autosave:current` | Autosave slot | `slotKey` |
| `sg-storage` (IndexedDB DB name) | Asset blobs | `dbName` |
| `assets` (IDB store name) | Asset blob store | `storeName` |

Hosts SHOULD override these. Defaults are what `sg-timeline-toolkit-sandbox` uses. The video-editor refactor MUST override (e.g. `projectKeyPrefix: 'sgve:project:'`) so old v0.1.54 saves don't collide with new v0.1.55 saves until migration is explicit.

## V.9 — Manifest entries the toolkit expects from consumer tools

A tool consuming the toolkit declares dependencies in its `manifest.json` `dependencies.shared` array. The exact paths are:

```json
{ "module": "sg-component",          "path": "/components/base/v1/v1.0/v1.0.0/sg-component.js" },
{ "module": "sg-tool-api",           "path": "/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js" },
{ "module": "sg-track-strip",        "path": "/components/sg-track-strip/v0/v0.1/v0.1.0/sg-track-strip.js" },
{ "module": "sg-toolbar",            "path": "/components/sg-toolbar/v0/v0.1/v0.1.0/sg-toolbar.js" },
{ "module": "sg-asset-panel",        "path": "/components/sg-asset-panel/v0/v0.1/v0.1.0/sg-asset-panel.js" },
{ "module": "sg-properties-panel",   "path": "/components/sg-properties-panel/v0/v0.1/v0.1.0/sg-properties-panel.js" },
{ "module": "sg-player-transport",   "path": "/components/sg-player-transport/v0/v0.1/v0.1.0/sg-player-transport.js" },
{ "module": "sg-project-storage",    "path": "/core/sg-project-storage/v0/v0.1/v0.1.0/sg-project-storage.js" },
{ "module": "sg-history",            "path": "/core/sg-history/v0/v0.1/v0.1.0/sg-history.js" },
{ "module": "sg-config",             "path": "/core/sg-config/v0/v0.1/v0.1.0/sg-config.js" },
```

Tools include only the modules they actually use. Loader phases:
- **Phase 1 (CSS)**: `/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css` + tool's own CSS
- **Phase 2 (JS)**: every component module above the tool consumes
- **Phase 3 (entry)**: tool's own entry JS (e.g. `./api/sg-{tool-name}-api.js`)

### V.9.1 — `ops.emits` manifest section

Each toolkit component (and each tool that emits its own ops) declares ops in a NEW top-level manifest section called `ops.emits`. This is parallel to `actions` and `events`. It is the source of truth for which ops the component emits and what category each falls into. Drives `SKILL__api.md` op tables and the dev panel's op explorer.

Example from `<sg-track-strip>`'s manifest.json:

```json
"ops": {
    "emits": [
        {"type": "item-added",       "reversible": "snapshot"},
        {"type": "item-moved",       "reversible": "pure"},
        {"type": "item-trimmed",     "reversible": "pure"},
        {"type": "item-selected",    "reversible": "noisy"},
        {"type": "item-deleted",     "reversible": "snapshot"},
        {"type": "item-split",       "reversible": "snapshot"},
        {"type": "item-color",       "reversible": "pure"},
        {"type": "item-copied",      "reversible": "snapshot"},
        {"type": "item-track-changed","reversible": "pure"},
        {"type": "playhead-changed", "reversible": "noisy"},
        {"type": "track-add",        "reversible": "snapshot"},
        {"type": "track-remove",     "reversible": "snapshot"},
        {"type": "track-mute",       "reversible": "pure"},
        {"type": "track-lock",       "reversible": "pure"},
        {"type": "track-renamed",    "reversible": "pure"},
        {"type": "track-selected",   "reversible": "noisy"},
        {"type": "editor-mode",      "reversible": "pure"}
    ]
}
```

Tools that wrap and forward toolkit op events MAY redeclare them in their own manifest's `ops.emits`. Tools that emit their own additional ops (e.g. `mp4-exported` in the video editor) MUST declare them.

## V.10 — Reserved names (toolkit MUST NOT use)

These names are reserved by the existing repo and must NOT be reused by toolkit components:

- `<sg-timeline>` (existing; frozen at v0.1.0; new tools use `<sg-track-strip>` instead)
- `<sg-preview-canvas>` (existing; new tools use `<sg-player-transport>` with their own slotted surface)
- `<sg-json-viewer>` (existing; toolkit may consume but does not extend)
- `<sg-layout>` (existing; toolkit components mount inside it)
- `<sg-tool-api>` (existing core)
- `<sg-site-header>` (existing chrome)
- `SGT_EVENTS` (existing; new events use `SGTS_EVENTS`)

## V.11 — Versioning rules summary

- **Toolkit components ship at `v0.1.0`** (new majors, no prior history). Future minor versions follow IFD (`v0.1.1`, `v0.1.2`, …).
- **`sg-video-editor` refactor is `v0.1.55`** — a new IFD minor of the existing tool. No new feature work in this minor.
- **`sg-audio-editor` ships at `v0.1.0`** — new tool, no prior versions.
- **The sandbox tool ships at `v0.1.0`** — new tool, no prior versions.
- **Old `<sg-timeline>` v0.1.0 is FROZEN** — no edits during or after this pack. Stays at its path indefinitely (in case any in-flight reference still uses it). No new tool consumes it.
- **Old `sg-video-editor` v0.1.54 is FROZEN** — no edits during or after this pack. Stays deployed at its URL alongside v0.1.55.

When a toolkit component lands a behaviour change after v0.1.0, it ships at `v0.1.1` with surgical override per `library/development/ifd/v1.3.0__ifd__surgical-overrides-version-stamped-filenames.md`. This pack does NOT specify any minor versions beyond v0.1.0; that's the next pack's problem.

---

# Pass 1 revision history

This README and its sibling Pass-1 docs (01, 03) were revised once after the initial draft to incorporate four major decisions made in conversation. The revisions are summarised here so reviewers can see what changed.

### Rev 1 → Rev 2

**Decision: deprecation framing was wrong.** IFD already has built-in deprecation by reference-decay. There is no separate "deprecation tag" or "delete after N weeks" — a frozen version stays at its path indefinitely; "deprecation" simply means no new tools or new pack work creates new references to it. **Changes:** D-002 removed (was: deprecation timing decision); D-006 removed (was: retroactive `SgComponent` upgrade for old `<sg-timeline>` — moot once D-002 is reframed); §V.10 reserved-names entries reworded; §V.11 versioning summary reworded; doc 01 §7.3 reworded (in doc 01 rev 2).

**Decision: sg-history is a 7th toolkit module.** Op-based undo/redo is generic infrastructure; every editor-shaped tool needs it; extracting it is part of "what already exists in the video editor" not "new invention." **Changes:** V.1 component table grows by one row (`sg-history`); V.2.6 added (sg-history events); V.3.7 added (sg-history method signatures); V.9 manifest deps grows by one entry; A-010 added (op-shaped events principle); doc 01 gains §3.7 (sg-history) and §5.7 (op-based use cases) (in doc 01 rev 2); doc 03 gains a new Section M (op-driven architecture) and Section N (documenting undo support) (in doc 03 rev 2).

**Decision: every toolkit event detail is op-shaped.** Components don't just say "user moved an item to position X" — they say "here's the op, with type, payload, prior state if needed, reversibility category, timestamp, source." This is a coding-guideline rule at the same priority as "extend SgComponent." **Changes:** V.2 (all events tables) reshaped to declare `op.payload` and `op.reversible` per event; V.4.5 added (Op schema); doc 03 §C.5 added describing the op envelope (in doc 03 rev 2).

**Decision: 5-category op-support taxonomy.** Pure / snapshot / with-side-effects / never / noisy. Generic, exhaustive against the existing video editor, simple enough to teach. Each component declares its ops in a new `ops.emits` manifest section. **Changes:** V.6 added (the taxonomy); V.6.6 added (mapping table from existing video editor ops to categories); V.9.1 added (manifest `ops.emits` example); A-011 added (tree-undo and git-verbs explicitly out of scope, parking-lot in doc 09).

**Decision: parking-lot doc 09.** The graph/tree-undo conversation contained genuinely good ideas that should not be lost, but they're out of scope for this pack and need separate design conversations (UX, memory model, persistence story, sgit-vault future, why git-verbs are wrong despite being tempting). **Changes:** doc 09 created (`09__future__graph-based-version-control.md`); pack contents table at top of README updated to list it; A-011 references it.

### Rev 2 → Rev 3

**Decision: sg-config is the 8th toolkit piece.** The video editor has a Config tab (`Preview/Composer`, `Timeline renders`, `Autosave`, `Memory probe`, `Log composer rebuilds`, `Log level`, `Reset to defaults`). The audio editor will need similar. The animation editor will need similar. Config is per-tool persistent settings with schema, defaults, URL overrides, and a render-into-properties-panel helper — generic infrastructure parallel to `sg-project-storage` and `sg-history`. **Changes:** V.1 grows by one row (`sg-config`); V.3.8 added (sg-config method signatures, `SGCFG_EVENTS`); V.9 manifest deps grows by one entry; A-001 reworded ("eight pieces, not six"); doc 01 §3.8 added (in doc 01 rev 3); doc 03 §M.11 mentions config-as-op briefly (in doc 03 rev 3).

**Decision: op-log default budget raised to 10,000 ops / 25 MB.** The 5,000 / 10 MB defaults from rev 2 were too tight for video projects (where individual asset blobs are routinely 100+ MB and users naturally make many fine-grained edits). Raised to 10,000 ops / 25 MB; usage shown to the user via the Config tab; warning thresholds at 70%/90% surface UI affordances. The numbers are sensible-for-most defaults, not hard ceilings — hosts MAY raise them. **Changes:** V.3.7 default values updated; doc 01 §3.7 budget explanation reworded.

**Decision: sandbox name is `sg-timeline-toolkit-sandbox`.** Earlier candidate `sg-toolkit-sandbox` was too generic; `sg-tools-sandbox` confused with other tools in the repo. `sg-timeline-toolkit` acknowledges that the prominent and most-coupled component is `<sg-track-strip>` (timeline-shaped) while signalling "toolkit" so future timeline-shaped tools find it naturally. The sandbox tool is `sg-timeline-toolkit-sandbox`; there is no separate "the toolkit" entity — the eight pieces in V.1 ARE the toolkit. **Changes:** doc 01 §6 references updated; manifest paths and tool slugs locked.

**Decision: full Tier 1 / Tier 2 / Tier 3 question lock.** See §"Decisions locked at the start of Pass 2" below.

### Rev 2 invariants (things that DID NOT change in rev 3)

- A-001 was reworded but the substantive meaning stands; A-002 through A-011 unchanged
- D-001, D-003, D-004, D-005, D-007 open decisions all confirmed at architect recommendation
- All Pass 2 and Pass 3 deliverables are unchanged in scope (docs 02, 04, 05, 06, 07, 08)
- Vocabulary appendix sections V.2, V.4, V.5, V.6, V.7, V.8, V.10, V.11 unchanged
- The op shape (V.4.5) is unchanged
- The 5-category taxonomy (V.6) is unchanged

---

# Decisions locked at the start of Pass 2

This section records the answers to the questions raised between Pass 1 rev 2 and Pass 2 (the "what's next" decision review). Every answer here is binding for Pass 2 and Pass 3.

### Tier 1 — must decide before Pass 2

**Q1. Open decisions D-001, D-003, D-004, D-005, D-007 — all confirmed at architect recommendation:**

| ID | Decision |
|---|---|
| D-001 | Audio editor path: `tools/v0/v0.1/v0.1.X/en-gb/sg-audio-editor/` (mirrors existing pattern; X resolved by implementer at brief 07 time) |
| D-003 | Sandbox URL: public, marked "internal demo" |
| D-004 | Generic time-axis field: `start` (also `end`); `timelineStart` is video-editor-specific |
| D-005 | Core module paths: one path per module — `core/sg-history/v0/v0.1/v0.1.0/`, `core/sg-project-storage/v0/v0.1/v0.1.0/`, `core/sg-config/v0/v0.1/v0.1.0/`. **Rationale (per user):** these separations are critical for surgical fixes and effective management of agent context windows. |
| D-007 | Loader phases: 3 phases (CSS / JS deps / entry) — no phase 1.5 |

**Q2. Op `id` field: optional in v0.1.0.** sg-history auto-assigns when missing. Components MAY pass an id when emitting if they want to address their own op (e.g. for "I just emitted op X, await application, then do Y" patterns); when they don't, sg-history fills in a `crypto.randomUUID()` at `record()` time. Rationale: lowest-friction path; ids are present at storage time; future tree-undo can rely on them.

**Q3a. `sg-properties-panel:field-changed` payload allows nested objects.** Hosts pass complex `fromValue`/`toValue` (transform matrices, bezier curves, JSON configs) where appropriate. Host's responsibility to keep them JSON-serialisable per M.10. Toolkit imposes no scalars-only constraint.

**Q3b. Field-`type: 'button'` emits `section-action`, not `field-changed`.** Buttons are UI affordances, not value carriers. V.4 Field schema gets a clarifying note.

**Q4. `<sg-track-strip>:item-split` is one snapshot op, not composed.** Cleaner log, cleaner undo, matches user mental model. Op carries new IDs in payload (`payload: {originalItemId, newItemIds: [id1, id2], atPosition}`); priorState carries the un-split item. Symmetric and explicit. **User noted:** this is starting to be the business-logic-of-the-component territory, which is appropriate — the component owns its own op shape because it's the thing that needs to know how to undo.

**Q5. No `embedBlobs` option in `saveProject()`.** Self-contained export is a separate concern from local save/load. Future packs may add `sg-project-export` for vault-backed sharing; this pack keeps `sg-project-storage` focused on save-and-restore from local browser storage.

### Tier 2 — should decide before Pass 2

**Q6. `<sg-toolbar>` registration is imperative-only.** `host.toolbar.addButton({...})` after `customElements.whenDefined('sg-toolbar')` resolves. No declarative `<sg-toolbar-button>` element. Hosts that want declarative wrap it themselves.

**Q7. Asset upload (drop) and asset display-on-load are distinct.** Drop emits `sg-asset-panel:asset-add-requested` (`with-side-effects`, sideEffects: `['blob-allocated']`). Project-load showing existing assets emits NO event — host calls `setAssets(...)` imperatively; this is state restoration, not an op. **Pinned as a guideline rule:** state restoration is imperative; user actions are op-shaped events.

**Q8. `sg-history.replayOps()` does NOT re-emit toolkit events.** Replay calls `onApply(op, 'forward')` only; UI listeners, telemetry listeners, side-effect listeners are NOT re-fired. sg-history dispatches `sg-history:replay-started` and `sg-history:replay-completed` for hosts that want to know.

**Q9. Op log defaults: 10,000 ops / 25 MB per project.** Per-project scope (`history.clear()` on project switch). Asset blob storage and project JSON are NOT bounded by sg-project-storage — bounded by browser quotas, with usage surfaced via `computeStorageUsage()` and warning thresholds at 70%/90% in the host's Config tab.

**Q9 follow-up: `sg-config` as the 8th toolkit piece. Confirmed (in pack).** The video editor's Config tab and the audio editor's day-one need both demand it; reproducing config logic per tool is exactly the duplication this pack exists to prevent. ~250 LOC target.

**Q10. Op `timestamp` is `Date.now()`; sg-history maintains its own monotonic position counter for ordering.** Wall-clock for human display, monotonic counter for invariants. Op log ordered by position, not timestamp.

### Tier 3 — defer to Pass 3 (now confirmed)

**Q11. Sandbox name: `sg-timeline-toolkit-sandbox`.** Acknowledges timeline-shaped framing while signalling toolkit. **User noted:** "since there are already quite a lot of tools which not all will go into this toolkit." The toolkit's prominent component IS `<sg-track-strip>` (timeline-shaped); naming the sandbox after that helps discoverability without misclaiming the toolkit applies universally. Other tools in the repo (`<sg-json-viewer>`, etc.) are explicitly NOT in this toolkit's scope.

**Q12. Audio engine choice deferred to brief 07 implementer.** Brief gives strong guidance: "use Web Audio API directly unless the implementer can demonstrate Tone.js gives material benefit."

**Q13. Graveyard of rejected names: yes, in doc 03 §A.6.** Captures: `sg-clip-strip` (rejected: clips are video-specific), `sg-undoable` (rejected: verb shouldn't appear in name), git verbs for sg-history API (rejected per doc 09 §4), `sg-toolkit-sandbox` (rejected per Q11), `sg-tools-sandbox` (rejected: confused with broader tool family), `sg-timeline-toolkit` alone (rejected: sandbox suffix is required to distinguish exec vs library scope).

---

# End of README

If you are a Sonnet implementer arriving at this pack:

1. Read **00 (this file)** end-to-end. Do not skip the vocabulary appendix — every name you'll need is here.
2. Read **03 (guidelines)** end-to-end. Every rule applies to every brief.
3. Read **01 (architecture spine)** to understand WHY the toolkit looks the way it does.
4. Read **02 (component catalogue)** for the component you're implementing.
5. Read **04 (verification checklist)** for the items your work must tick.
6. Read your specific brief (05, 06, 07, or 08) and execute one task at a time.

If any of those documents disagree with this README's vocabulary appendix, **the appendix wins**. Report the disagreement to the Conductor before proceeding.
