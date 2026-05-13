# 07 — Build Sequence (Phases) for observable-chat

**version** v0.27.38
**date** 13 May 2026
**supersedes** the original brief's 6-phase plan (`01__brief` §Build Sequence). The original plan is preserved there for reference but does not account for the ~80% existing-component reuse mapped in `02__strategy` and `06__reuse-map`.

---

## Phase 0 — prerequisites (1–2 days)

Land these BEFORE Phase 1 starts. They unblock all later phases and pay off agent-with-tools-style tools too.

1. **Promote 6 `aw-*` components → `sg-*` in `components/agentic/`** per `06__reuse-map` §A. Apply coding standards on the way (folder structure, separate CSS, `SgComponent` base, `Snake_Pascal`, i18n `LABELS`, `closest('[data-llm-bus]')`).
2. **Swagger-driven schemas in `sg-local-bridge`**. Fetch `/openapi.json` on `connect()`; synthesise tool schemas at runtime. Remove the hardcoded `LB_TOOL_SCHEMAS` table.
3. **Promote `LB_REQUIRED_PARAMS` normaliser** to a `core/sg-tool-normalise/v0/v0.1/v0.1.0/` helper. Generalise from `lb_*` to "any tool with a runtime-discovered schema".
4. **Reality-doc pass** — Librarian adds the 6 promoted components + the new helper.

**Acceptance:** agent-with-tools still works end-to-end with promoted imports; reality doc reflects new entries.

---

## Phase 1 — Pre-send Inspector + Replay (5 days) — SHIPPABLE

Phase 1 alone is more useful than what's used today (brief acceptance #13).

**New code**
- `sg-llm-pre-send-editor` (~200 lines, `SgComponent` base, folder structure)
- Tool page `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.59/en-gb/observable-chat/`:
  - `index.html` (manifest-loader shell)
  - `manifest.json`
  - `api/observable-chat-api.js` (SgToolApi, system-prompt loading, capture-phase interceptor wiring, vault scaffold)
  - `ui/oc-layout.js` (sg-layout panel tree per `04__mockups` §1)
  - `prompts/system.md`
  - `SKILL-human.md`, `SKILL-browser.md`, `SKILL-api.md`
  - `styles/observable-chat.css`

**Compose existing modules**
- `sg-llm-chat-history`, `sg-llm-chat-input`, `sg-llm-system-prompt`
- `sg-llm-debug`, `sg-llm-token-viz`, `sg-llm-response-inspector`, `sg-llm-stats`
- `sg-llm-bundle`, `sg-llm-bundle-list`, `sg-llm-bundle-viewer`
- `sg-tool-definition`, `sg-local-bridge`, `sg-tool-runner`
- Promoted: `sg-pipeline-view`, `sg-execution-queue`, `sg-step-tracer`, `sg-tool-extractor`, `sg-loop-coordinator`
- `sg-llm-connection`, `sg-llm-request`

**Vault scaffold (Phase 1 — minimal)**
- Read `meta.json` if present, else create on first send
- Write `turns/NNNN.json` per send (full payload: messages, tools, response, cost, latency)
- Folder browser stub — fixed default folder for v0.1; full folder browser lands in Phase 4

**Acceptance**
- Open the tool → connect bridge → ask "list files in src/" → review modal opens with assembled prompt → click Send → tool calls execute → response arrives → bundle saved
- Click Replay on a bundle → change model in dropdown → Replay → new response arrives in the right pane with a diff strip
- Empty state matches `04__mockups` §10

---

## Phase 2 — Compression Workbench (5 days)

**New code**
- `sg-llm-compression-engine` (~300 lines) — heuristic baseline + LLM-driven refinement
  - Heuristic: recency weight × reference-graph weight × token cost. Synchronous, free.
  - LLM refinement: opt-in, runs as a sidecar call when heuristic confidence is low
- `sg-llm-compression-diff` (~250 lines) — two-column before/after UI per `04__mockups` §5
  - Tags: kept / summarised / dropped
  - Hover for reason · click to flip
  - Pattern store (per-conversation, saved as JSON in the vault)

**Compose**
- `sg-llm-reality` (block model) + the new diff
- Auto-open threshold at 60% of model context (configurable in vault meta)

**Acceptance**
- Trigger by user click `Compress now` or by context >60%
- Each block tagged with reason · click to flip
- Apply → next send uses compressed messages array
- Saved override patterns respected on subsequent compression rounds

---

## Phase 3 — Tool Router scoring (3 days)

**New code**
- `sg-llm-tool-router` (~250 lines) — cheap-model scoring loop
  - Listens for `llm:chat-message` (user input)
  - Fans out one cheap-model call: "score these N tools 0–100 for relevance to: {message}"
  - Emits `ROUTE.SCORES` event
- Patch `sg-tool-definition` v0.1.2 — add score column to the row UI

**Compose**
- Promoted `sg-execution-queue` already handles auto/manual modes for tool execution; the router only changes which tools enter the queue

**Acceptance**
- Set up 20 enabled tools · type a user message about file editing
- Router scores file-related tools 70+ and bash/web tools <30
- Threshold slider (default 30) auto-disables low-score tools
- Pin and exclude toggles per tool

---

## Phase 4 — Conversation Graph (basic) (8–10 days)

**New code**
- `sg-llm-graph-store` (~250 lines) — headless component
  - Vault-backed `nodes.jsonl` and `edges.jsonl`
  - Public API: `getNodes(filter)`, `getEdges()`, `addNode`, `pinNode`, `dropNode`
  - On `llm:request-complete`, runs an extraction sidecar (qwen2.5-coder:7b on Ollama by default)
- `sg-llm-graph-context-builder` (~200 lines)
  - Replaces (or sits in front of) `sg-llm-chat-history`'s assembly
  - Queries graph store on `llm:chat-message`, packs subgraph + recent turns into messages array
- `sg-llm-graph-canvas` (~400 lines)
  - SVG viz, force-directed default
  - Node typing per `04__mockups` §7
  - Filters, pin/drop on click, right-click context menu
- `sg-llm-vault-folder-browser` (~250 lines)
  - The vault & folder tree per `04__mockups` §2
  - New conversation · move · rename · duplicate · share read-key

**Acceptance**
- Have a 10-turn conversation about a project
- Graph canvas shows ~15 nodes (mix of facts, hypotheses, decisions, questions) with typed edges
- Pin a `decision` node → next send's pre-send inspector shows the pinned decision in the assembled context
- Drop a `fact` node → next send omits it
- Folder browser shows the current vault tree; create new conversation under a new folder

---

## Phase 5 — Parallel Analyst (sidecar) (5 days)

**New code**
- `sg-llm-sidecar` (~250 lines) — orchestrator
  - 4 sidecar kinds: phrasing, ambiguity, relevance, tool-predictor
  - Each on a configurable model with per-request budget cap
  - Fan-out via `sg-llm-request` (already supports parallel calls)
- `sg-llm-sidecar-panel` (~200 lines)
  - Pills strip per `04__mockups` §8
  - Live cost row at the bottom

**Acceptance**
- Type a user message → 4 pills slide in as sidecar models finish → main response continues uninterrupted
- Each pill has an action (Use / Clarify / Pin / Lock-in) that applies the suggestion
- Cost shown live · sidecar disabled if budget cap exceeded

---

## Phase 6 — Graph queries + advanced viz (5 days)

**New code**
- Filter UI (active / open / resolved / last N turns / by node type) — extends `sg-llm-graph-canvas`
- Small query DSL — `find facts that contradict decision #14`
- Alternative layouts — chronological columns, dependency-DAG

**Acceptance**
- Filter sets reduce visible nodes correctly
- DSL query in the URL hash deep-links to a filtered graph view
- Layout toggle in the panel header switches between force-directed / chronological / DAG

---

## Total estimated effort

| Phase | Days | Cumulative |
|---|---|---|
| 0 prereqs | 2 | 2 |
| 1 inspector + replay | 5 | 7 |
| 2 compression workbench | 5 | 12 |
| 3 tool router scoring | 3 | 15 |
| 4 conversation graph | 10 | 25 |
| 5 parallel analyst | 5 | 30 |
| 6 graph queries + viz | 5 | 35 |

~35 working days for one Sonnet agent. Phase 1 alone is shippable.

---

## Branch discipline

| Phase | Branch | Merge target |
|---|---|---|
| 0 prereqs | `claude/oc-P0-prereqs-{slug}` | `dev` |
| 1 inspector + replay | `claude/observable-chat-P1-{slug}` | `dev` |
| 2 compression | `claude/observable-chat-P2-{slug}` | `dev` |
| 3 tool router | `claude/observable-chat-P3-{slug}` | `dev` |
| 4 graph | `claude/observable-chat-P4-{slug}` | `dev` |
| 5 analyst | `claude/observable-chat-P5-{slug}` | `dev` |
| 6 graph queries | `claude/observable-chat-P6-{slug}` | `dev` |

Commit per acceptance criterion. Push after each. No PR until phase is fully green unless asked.

---

## Handover prompt template (per phase)

> You are implementing **Phase N** of `observable-chat`. Read the dev pack at `library/dev_packs/v0.27.38__observable-chat/` top to bottom — every doc in order. The architect strategy is `02__strategy`; the UX is `03__ux`; the ASCII mockups are `04__mockups`; the coding standards you must follow are `05__guidelines`; the reuse map is `06__reuse-map`; this phase's scope is `07__phases` §Phase N.
>
> Stop after Phase N's acceptance criteria are green. Commit per criterion. Push to the branch named in §Branch discipline. Do not open a PR unless asked.

---

This document is released under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
