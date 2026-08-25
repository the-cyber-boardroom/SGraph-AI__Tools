# Strategy: Observable LLM Orchestration — Graph-Based Chat for Open-Source and Frontier Models

**version** v0.27.38
**date** 13 May 2026
**from** Architect
**to** Developer
**source brief** `team/humans/dinis_cruz/briefs/.../v0.27.38__devbrief__observablellmorchestrationtool.md`
**predecessor** `team/explorer/architect/v0.2.55__arch-brief__agent-with-tools.md` (agent-with-tools — just shipped)

---

## 1. Vision in one paragraph

A chat tool that treats every LLM call as a one-shot question whose context the user can see, edit, and replay before it leaves the browser. The conversation is not a flat scrollback but a graph of facts, hypotheses, decisions, and questions; each turn rebuilds the model's context from that graph instead of accumulating linear history. Sidecar LLMs run in parallel to score tool relevance, extract graph nodes, and suggest compressions — observation that *reasons* instead of just records. The whole conversation is a vault: versioned, shareable, forkable, archivable. This is the orchestration layer that sits above the model and below the chat. The chat is just one surface on it.

This is the next layer on top of `agent-with-tools`. agent-with-tools proved the browser can drive a real agentic loop against open-source models. This tool turns that loop into something the operator owns end-to-end.

---

## 2. The three user-facing pillars

Mapped to the brief's emphasis:

| Pillar | What the user sees | Brief sections this serves |
|---|---|---|
| **Request visibility** | Every prompt is renderable, editable, and diffable before it leaves the browser | Components 1 + 6 (Inspector + Replay) |
| **History manipulation** | Compression decisions are explicit, overridable, and saved as patterns; the graph view lets the user pin / drop nodes from the next context | Components 2 + 4 (Compression Workbench + Conversation Graph) |
| **Sidecar LLM data extraction** | Cheap parallel models extract graph nodes, score tools, suggest phrasings — visible in a non-blocking strip alongside the main response | Components 3 + 5 (Tool Router + Parallel Analyst) |

Everything else (vault storage, replay, graph queries) supports these three.

---

## 3. Reality check — what already exists

We already ship ~80% of the building blocks. Sources:
- `team/explorer/librarian/reality/v0.1.0__what-exists-today__1__libraries.md`
- `team/humans/dinis_cruz/debriefs/05/13/v0.1.58__debrief__agent-with-tools__1__what-we-built.md` (agent-with-tools session 2 — added an extraction/validation/queue/execute/loop pipeline with live visibility)

| Brief component | Existing module(s) | Reuse strategy |
|---|---|---|
| Prompt Inspector | `sg-llm-debug` v0.1.1, `sg-llm-token-viz` v0.1.1, `sg-llm-response-inspector` v0.1.0, `sg-llm-stats` v0.1.1, `aw-step-tracer` (session 2) | Compose into a pre-send "Inspect & Edit" panel. Add one new `llm:before-send` interceptor so the inspector can mutate the request. Promote `aw-step-tracer` to `components/agentic/sg-step-tracer/`. |
| Compression Workbench | `sg-llm-reality` v0.1.0 (block-typed editor: system / context / history / memory / question), `sg-llm-attachments` v0.1.0 | The block model already maps to compression sections. Add a compression-proposal layer that tags each block kept / summarised / dropped with reasoning. |
| Tool Router | `sg-tool-definition` v0.1.1, `sg-local-bridge` v0.1.0 (auto-pushes schemas on connect), `sg-tool-runner` v0.1.1, `aw-tool-extractor` (session 2 — multi-format extraction), `aw-execution-inspector` (session 2 — auto/manual queue UI) | Add a scoring layer above the existing schema list. Auto-toggle `enabled` based on score. The router itself is a sidecar call. Promote `aw-tool-extractor` and `aw-execution-inspector` to `components/agentic/`. |
| Conversation Graph | — (new) | New components needed (§4). Stored under the conversation vault. |
| Parallel Analyst | `sg-llm-request` v0.1.6 (multi-provider, OK for parallel fan-out) | New orchestrator runs N cheap-model calls fanned out from the bus. Results stream into a non-blocking strip. |
| Replay Surface | `sg-llm-bundle` v0.1.7 (with `parent_id` fork tree), `sg-llm-bundle-list` v0.1.3, `sg-llm-bundle-viewer` v0.1.0, `aw-loop-coordinator` (session 2) | Already supports time-travel, fork, import, export. Add "replay with modified params" UI. `aw-loop-coordinator` promotes to `sg-loop-coordinator` for multi-step replay. |
| Vault storage | `vault-client` v1.2.2 + the sgit skill | Folder tree of conversations (§6). |
| Pipeline visibility | `aw-pipeline-view` (session 2) | Promote to `sg-pipeline-view`. Generalise the 5 stage labels (EXTRACT → VALIDATE → QUEUE → EXECUTE → DONE) to be config-driven. |

The composition layer is the `[data-llm-bus]` element + the frozen `SGL_LLM` event contract (41 events today). All new code rides on the same bus.

### Patterns inherited from agent-with-tools session 2

These are proven and should be reused (not reinvented) in observable-chat:

1. **Capture-phase `llm:send` interceptor** — exactly the pre-send-editor mechanism. Stop the original event, re-fire with an edited body. Pattern lives in `tools/.../agent-with-tools/api/agent-with-tools-api.js`.
2. **`llm:tool-calls` argument normalisation** — `LB_REQUIRED_PARAMS` table + split/parse logic that fixes malformed Ollama tool calls (bare strings, packed positionals). Promote to a `sg-tool-runner-normalise.js` helper.
3. **`aw-chat-pane:ready` for sg-layout mount timing** — the panel tree is async-instantiated, so events fired before mount are missed. The `:ready` re-fire pattern fixes it. Reuse for any sg-layout-instantiated component that needs a first push (system prompt, graph context).
4. **`bus.__sgLlmChatHistory` registration pattern** — find shadow-DOM-encapsulated components across the bus boundary by writing a reference to the bus element on connect.
5. **`sg-local-bridge._pushToToolDef()`** — auto-register schemas with `sg-tool-definition` on connect. Will become Swagger-driven (read `/openapi.json`) in Phase 0.

### Coding standards

All new components (and refactors when promoting `aw-*` to `sg-*`) must follow the standards in `team/explorer/architect/v0.27.38__coding-standards__component-structure.md`:

- One component = one folder (`<name>.js` + `<name>.css` + `<name>.html`)
- Snake_Pascal class names (`Sg_Pre_Send_Editor`)
- Extend `SgComponent` base
- Minimal `connectedCallback` — only method calls whose names describe what they do
- All UI strings as `const LABELS = {...}` (i18n-ready)
- Bus finding via `this.closest('[data-llm-bus]')`
- Explicit over clever

---

## 4. The actual new code

Four new components plus two visualisations. Everything else is composition.

### 4a. `sg-llm-pre-send-editor` (Phase 1)

Headless intercept of `llm:send`. When fired, the editor:

1. Pauses the original request
2. Captures the assembled messages array, the tools array, the model + provider
3. Surfaces a "Review & Send" overlay populated with the captured payload
4. On Accept, re-emits a (possibly edited) `llm:send`. On Cancel, drops the request

New events: `llm:before-send { messages, tools, model, cost_estimate }`, `llm:before-send-resolved { messages, tools, model, edited: boolean }`.

A per-conversation `always-send-without-review` toggle bypasses the overlay after the user trusts it.

### 4b. `sg-llm-graph-store` (Phase 4)

Headless component. Consumes `llm:request-complete` and runs an extraction step (cheap sidecar model) to identify new graph nodes and edges. Persists to the conversation vault.

- Node types: `fact`, `hypothesis`, `decision`, `question`, `analysis`, `opinion`
- Edge types: `supports`, `contradicts`, `derives_from`, `depends_on`, `answers`, `refutes`
- Public API: `getNodes(filter)`, `getEdges()`, `addNode(node)`, `pinNode(id)`, `dropNode(id)`
- Events: `graph:node-added`, `graph:edge-added`, `graph:node-pinned`, `graph:node-dropped`

### 4c. `sg-llm-graph-context-builder` (Phase 4)

Replaces (or sits in front of) `sg-llm-chat-history`'s linear assembly. On `llm:chat-message`, queries the graph store for the relevant subgraph (pinned nodes + recent decisions + active hypotheses + open questions + facts cited by the user's message) and packs that subgraph into a messages array before emitting `llm:send`.

This is the "halfway house" the brief describes: each send looks like a one-shot prompt rebuilt from the graph, not an accumulation of scrollback.

### 4d. `sg-llm-sidecar` (Phase 5)

Parallel-analyst orchestrator. Listens for `llm:chat-message` and fans out lightweight requests on cheap, configurable models:

- **Phrasing analyst** — proposes a tighter version of the user's question
- **Ambiguity analyst** — flags unclear references or missing constraints
- **Relevance analyst** — searches the graph store for related prior context
- **Tool predictor** — guesses which tools the model is about to call

Each runs with a configurable provider/model and a per-request budget cap. Results stream into a `sg-llm-sidecar-panel` UI without blocking the main request. The main response always fires; sidecar suggestions are non-blocking pills.

Events: `sidecar:suggestion { kind, content, score }`, `sidecar:complete { count, total_cost_ms_tokens }`.

### 4e. Visualisations (used across phases)

- **`sg-llm-graph-canvas`** — SVG graph view. Node-typed colours, edge labels, filters (`active` / `open` / `resolved` / `last N turns`). Click to inspect, pin, or drop a node from the next context.
- **`sg-llm-compression-diff`** — two-column before / after diff. Each chunk tagged kept / summarised / dropped, hover for reason, click to flip the tag. User overrides are saved as patterns the engine respects next time.

---

## 5. The bus contract — extensions

Today: 41 events frozen in `sg-llm-events` v0.1.1. Proposal: bump to **v0.1.2** with the additive event set below. No removals, no renames. Existing components keep working.

```js
// Pre-send interception (Phase 1)
LLM.BEFORE_SEND              // { messages, tools, model, cost_estimate }
LLM.BEFORE_SEND_RESOLVED     // { messages, tools, model, edited }

// Compression (Phase 2)
COMPRESS.PROPOSED            // { plan: [{ block_id, action, reason }] }
COMPRESS.OVERRIDDEN          // { block_id, new_action }
COMPRESS.APPLIED             // { kept, dropped, summarised, savings_tokens }

// Tool router (Phase 3)
ROUTE.SCORES                 // { scores: [{ name, score, reason }] }
ROUTE.PINNED                 // { name }
ROUTE.EXCLUDED               // { name }

// Conversation graph (Phase 4)
GRAPH.NODE_ADDED             // { node }
GRAPH.EDGE_ADDED             // { edge }
GRAPH.NODE_PINNED            // { node_id }
GRAPH.NODE_DROPPED           // { node_id }
GRAPH.CONTEXT_BUILT          // { messages, node_ids_included }

// Sidecar (Phase 5)
SIDECAR.START                // { kinds_dispatched, models }
SIDECAR.SUGGESTION           // { kind, content, score, model }
SIDECAR.COMPLETE             // { kinds, total_cost, total_ms }
```

---

## 6. Vault integration

A vault holds many conversations, organised by folders the user creates. Structure:

```
{conversation-vault}/
  meta.json                       # vault: title, default model, default sidecar config
  conversations/
    {folder-path}/
      {conversation-slug}/
        meta.json                 # conversation: title, created_at, model, tags, parent_id
        graph/
          nodes.jsonl             # append-only graph nodes (CRDT-friendly)
          edges.jsonl             # append-only edges
        turns/
          NNNN.json               # full payload: messages, tools, response, cost, latency
        bundles/
          {id}.json               # sg-llm-bundle export format (already standardised)
        compressions/
          NNNN.json               # proposed + final compression per round
        sidecar/
          NNNN.jsonl              # sidecar suggestions per round
```

Folders are arbitrary path segments the user chooses (`client-acme/`, `research/`, `personal/`, `2026/Q2/`). Conversations themselves carry their own graph and history — folders are just organisation. Moving a conversation to a different folder is a path-rename in the vault, no data migration.

One user message → one commit. Vault read-key sharing = read-only share of the whole vault (all folders); per-conversation share = export the conversation slug as a fresh single-conversation vault. Fork = vault clone or single-conversation export. Re-open months later = pull vault, hydrate the folder tree, click a conversation.

This rides on the existing vault primitive — **no vault changes required**. The folder tree is a convention inside the vault, not a vault feature.

---

## 7. Build sequence (revised — accelerated by reuse)

Original brief proposes six phases. With the existing components, each phase is roughly one focused Sonnet-agent week. Phase 1 alone is shippable and useful.

| Phase | Scope | New code (rough) | Reuse | Ship target |
|---|---|---|---|---|
| **P1** | Pre-send Inspector + edit + Replay | `sg-llm-pre-send-editor` (~200) + tool page (~500) | debug, token-viz, bundle, bundle-viewer | Week 1 |
| **P2** | Compression Workbench | `sg-llm-compression-engine` (~300) + `sg-llm-compression-diff` (~250) | sg-llm-reality blocks | Week 2 |
| **P3** | Tool Router with scoring | `sg-llm-tool-router` (~250, cheap-model scoring loop) + sg-tool-definition patch | sg-tool-definition, sg-local-bridge, sg-llm-request | Week 3 |
| **P4** | Conversation Graph (basic) | `sg-llm-graph-store` (~250) + `sg-llm-graph-context-builder` (~200) + `sg-llm-graph-canvas` (~400) | vault-client, sg-llm-reality | Week 4–5 |
| **P5** | Parallel Analyst | `sg-llm-sidecar` (~250) + `sg-llm-sidecar-panel` (~200) | sg-llm-request fan-out | Week 6 |
| **P6** | Graph queries + advanced viz | Filter UI + small query DSL (~300) | Phase 4 components | Week 7 |

Total new code: ~3,300 lines across six phases. Compare to the agent-with-tools build, which was ~2,500 lines including the FastAPI bridge.

---

## 8. Tool naming and path

Proposed name: **`observable-chat`**.

Rationale: matches the brief's framing ("Observable LLM Orchestration"), is distinct from `agent-with-tools`, and reads cleanly in the URL. Alternatives considered: `chat-observatory` (too clinical), `prompt-lab` (too narrow — implies one-shot only), `glasshouse` (cute but obscure).

Path: `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.59/en-gb/observable-chat/`.

Manifest pattern: same as agent-with-tools (phase-based loader, SgToolApi entry, three SKILL files).

The tool is multi-provider from day one: Ollama (default), OpenRouter, Anthropic, OpenAI. Sidecar models are independently configurable from the main model so the user can pay $0.01 of sidecar to save $1 of main-model wasted context.

---

## 9. Open decisions for the architect

Four items block implementation. Everything else can be decided inline by the implementing agent.

| # | Decision | Default proposal |
|---|---|---|
| 1 | Graph extraction model | `qwen2.5-coder:7b` on Ollama by default; user-configurable per conversation. Free, local, good enough for entity extraction. |
| 2 | Compression engine — heuristic or LLM-driven | Both, in a fallback chain. Heuristic baseline (recency + reference-graph weight) runs synchronously and cheaply. LLM-driven refinement runs as a sidecar when the heuristic isn't confident. |
| 3 | Vault → conversation relationship | **Many conversations per vault**, organised by user-defined folders (see §6). Per-conversation export to a fresh single-conversation vault remains available for sharing. (Locked by Dinis, 13 May 2026.) |
| 4 | Pre-send editor blocking vs non-blocking | **Modal-blocking on first send**, then a per-conversation "trust mode" toggle that skips the modal but still records the assembled payload for retroactive inspection. |

---

## 10. Non-goals for v0.1.0

- No agent-to-agent collaboration over the graph (multi-agent layer comes later)
- No service-worker offline cache of the tool page (backlog)
- No remote graph sync — vault sync via sgit handles this
- No automated regression-test generation from bundles (Phase 1 *produces* fixtures; the harness comes later)
- No support for non-text node types in the graph (images, audio) — the graph is text-typed in v0.1; multimodal context is still carried in the turn payload

---

## 11. Risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | Graph extraction is too noisy to be useful | Sidecar model is configurable; user can disable extraction per conversation; manual node add/edit always available |
| 2 | Sidecar costs add up across all conversations | Per-conversation budget cap, default-off for low-cost models like Ollama; cost shown live in the sidecar panel |
| 3 | Pre-send modal annoys the user | Trust-mode toggle (decision 4); modal collapses to a "diff vs previous" pill on subsequent sends |
| 4 | Graph as a primitive doesn't compose well with frontier models (Anthropic/OpenAI tool-use) | The graph-built messages array is just an OpenAI-format messages array; the only difference is *how* it was assembled. All four providers consume it identically. |
| 5 | Compression overrides become stale as the conversation evolves | Pattern store is per-conversation; user can clear / migrate via the vault |

---

## 12. Handover prompt (for the implementing Sonnet agent)

> You are implementing **Phase 1** of `observable-chat`, the next tool after `agent-with-tools`. Read this strategy doc, the UX doc (`team/explorer/designer/v0.27.38__ux__observable-llm-orchestration.md`), and the source brief (`team/humans/dinis_cruz/briefs/.../v0.27.38__devbrief__observablellmorchestrationtool.md`).
>
> Phase 1 ships: tool page at `tools/.../v0.1.59/en-gb/observable-chat/`, manifest, three SKILL files, the new `sg-llm-pre-send-editor` component, and an sg-layout panel tree that composes the existing inspector / token-viz / bundle / bundle-viewer components into the observability rail.
>
> Reuse everything in `components/llm/` and `components/agentic/`. Do not build new versions of existing components — if behaviour is missing, prefer a new versioned patch of the existing component over a parallel implementation.
>
> Stop after Phase 1 lands. Commit per phase. Push to `claude/observable-chat-PHASE-{n}-{slug}`. Do not open a PR unless asked.

---

## Appendix A — Mapping to existing arch briefs

| Earlier brief | Relationship |
|---|---|
| `v0.19.16__arch-brief__sg-llm-chat.md` | Foundational sg-llm-chat work; observable-chat is the operator-facing surface above it |
| `v0.19.17__arch-brief__sg-layout-llm-integration.md` | Layout pattern reused — observable-chat is another sg-layout consumer |
| `v0.2.55__arch-brief__agent-with-tools.md` | The agentic loop and bridge primitives we sit on |
| `v0.27.5__dev-brief__ontologist-semantic-knowledge-graphs.md` | Same graph-extraction pattern, different domain |
| `v0.27.5__arch-brief__sg-app-sandboxed-javascript-applications.md` | observable-chat is built as a vault-backed SG/App |
| `v0.22.18__arch-brief__observability-pipeline-capture-transform-project.md` | LETS pattern; observable-chat is LETS for LLM conversations |

---

This document is released under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
