# 06 — Reuse Map: What observable-chat inherits from agent-with-tools

**version** v0.27.38
**date** 13 May 2026
**source debriefs**
- `team/humans/dinis_cruz/claude-code-web/v0.27.38__debrief__agent-with-tools-session-2.md`
- `team/humans/dinis_cruz/debriefs/05/13/v0.1.58__debrief__agent-with-tools__1__what-we-built.md`
- `team/humans/dinis_cruz/debriefs/05/13/v0.1.58__debrief__agent-with-tools__2__whats-next.md`
- `team/architect/v0.2.58__pipeline__agent-with-tools.md`

Observable Chat is not a green-field tool. It is the next surface on top of agent-with-tools, which during sessions 1 and 2 evolved from a chat-with-tools demo into a full **extract → validate → queue → execute → loop** pipeline with live visibility at every step.

The patterns and components below are battle-tested and must be reused or promoted, not reinvented.

---

## A. Reusable components — promote, do not copy

These `aw-*` components live today under `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.58/en-gb/agent-with-tools/ui/`. Each is general-purpose. Promote them on Phase 0 (see `07__phases`), applying the new coding standards (see `05__guidelines`) during the move.

| `aw-*` source | Becomes | What observable-chat uses it for |
|---|---|---|
| `aw-tool-extractor.js` | `components/agentic/sg-tool-extractor/v0/v0.1/v0.1.0/` | Multi-format tool-call extraction (native / JSON-in-content / code-block). Used in the replay surface when replaying with a model that doesn't emit native `tool_calls`. |
| `aw-execution-inspector.js` | `components/agentic/sg-execution-queue/v0/v0.1/v0.1.0/` | "Tool Queue" panel. Same auto/manual modes, same card UI. Maps directly to the Tool Router queue in the UX doc. |
| `aw-step-tracer.js` | `components/agentic/sg-step-tracer/v0/v0.1/v0.1.0/` | "Tracer" panel — already conceptually identical to the bus-event audit log surface. |
| `aw-pipeline-view.js` | `components/agentic/sg-pipeline-view/v0/v0.1/v0.1.0/` | The 5-stage indicator (EXTRACT → VALIDATE → QUEUE → EXECUTE → DONE). Generalise stage labels to be config-driven so observable-chat can add ROUTE / COMPRESS / SIDECAR stages. |
| `aw-loop-coordinator.js` | `components/agentic/sg-loop-coordinator/v0/v0.1/v0.1.0/` | Multi-step agentic loop with iteration ceiling. Powers the agentic mode (UX doc §6 references `sg-agentic-loop`; this is the lighter, working alternative). |
| `aw-system-prompt.js` | `components/llm/sg-llm-system-prompt/v0/v0.1/v0.1.0/` | Editable system-prompt panel with bus integration. Already aligned with observable-chat's design — adopt unchanged. |

The tool-specific `aw-*` components (`aw-chat-pane`, `aw-bridge-panel`, `aw-model-panel`, `aw-demo-panel`, `aw-llm-log`, `aw-turn-inspector`, `aw-tool-tester`) stay tool-local — they are agent-with-tools UX glue, not general components.

---

## B. Patterns to reuse (not single components)

These are coding patterns proven during agent-with-tools development. They live in `tools/.../agent-with-tools/api/agent-with-tools-api.js` today; some should be promoted to reusable helpers.

### 1. Capture-phase `llm:send` interceptor

The exact mechanism the pre-send-editor needs. Stop the original event with `e.stopImmediatePropagation()`, then re-fire a fresh `llm:send` with an edited body. Use a marker on the event (`e._toolsInjected = true` in agent-with-tools, `e._editorPassed = true` in observable-chat) to prevent recursion.

### 2. `llm:tool-calls` argument normalisation

The `LB_REQUIRED_PARAMS` table + the split/parse logic that fixes malformed Ollama tool calls (bare strings, packed positionals). Two failure patterns to handle:

```
A. arguments: '"pwd"'         → wrap in {command: "pwd"}
B. arguments: '{"path":"a", "b"}'  → distribute to {path: "a", content: "b"}
```

Promote to `core/sg-tool-normalise/v0/v0.1/v0.1.0/sg-tool-normalise.js` so observable-chat can import it as a helper.

### 3. `aw-chat-pane:ready` re-fire pattern

sg-layout async-instantiates the panel tree. Events fired before mount are missed. The fix:

```js
// Component fires 'foo:ready' on its connectedCallback
this.dispatchEvent(new CustomEvent('aw-system-prompt:ready', { bubbles: true, composed: true }));

// Boot listener catches the first ready and re-fires the missed setup
bus.addEventListener('aw-system-prompt:ready', () => _pushSystemTurn(), { once: true });
```

Reuse for every sg-layout-instantiated component that needs a first-push: graph context builder, sidecar panel, compression engine.

### 4. `bus.__sgLlmChatHistory` registration

To find shadow-DOM-encapsulated components across the bus boundary, components register a self-reference on the bus element in `connectedCallback`:

```js
connectedCallback() {
    const bus = this.closest('[data-llm-bus]');
    if (bus) bus.__sgLlmChatHistory = this;
}
```

Use the same pattern for `__sgLlmGraphStore`, `__sgLlmGraphCanvas`, `__sgLlmPreSendEditor`.

### 5. `sg-local-bridge._pushToToolDef()` schema auto-registration

The bridge already pushes `lb_*` schemas into `sg-tool-definition` on connect. Observable Chat inherits this for free. Phase 0 upgrades it to read `/openapi.json` instead of using the hardcoded `LB_TOOL_SCHEMAS` table (see C1).

---

## C. Open items from session-2 debrief — carry forward as Phase 0 prereqs

| # | Open item | Becomes |
|---|---|---|
| C1 | Swagger-driven schemas at bridge connect | **Phase 0 dependency**: refactor `sg-local-bridge` to fetch `/openapi.json` on `connect()` and synthesise schemas at runtime. Removes the hardcoded `LB_TOOL_SCHEMAS` table. Observable Chat inherits this win for free. |
| C2 | Stronger system-prompt instruction about `tool_calls` format | Observable Chat's pre-send-editor exposes the system prompt as a first-class editable section — the user iterates on this directly with visibility into every send. |
| C3 | Reality doc not yet updated for new aw-* components | Librarian pass before observable-chat work begins (Phase 0). |
| C4 | Component refactor to follow new coding standards | Apply on promotion: when an `aw-*` moves to `components/agentic/sg-*`, refactor it to folder structure + `SgComponent` base + i18n vars + `Snake_Pascal` class name. See `05__guidelines`. |
| C5 | Manual mode UX hardening (keyboard shortcuts, waiting badge) | Phase 1 inherits the manual mode unchanged; UX hardening rolls into Phase 1 polish. |
| C6 | Tool result display in chat | UX doc §3 already covers this with the "↳ used context" provenance pill. Confirm the design with the implementing agent. |
| C7 | Model compatibility layer (native vs text fallback) | Already handled by `aw-tool-extractor` (multi-format extraction). Observable Chat inherits. |
| C8 | Error recovery on tool failure | Phase 1: the queue card shows error inline (already in `aw-execution-inspector`). Phase 4+: graph store records errors as `fact` nodes with `contradicts` edges to the hypothesis that triggered them. |
| C9 | Multi-step task visibility — session summary | Phase 4 (graph) gives this for free: filter graph to `decision` + `analysis` nodes from the last N turns. |
| C10 | Agentic mode vs Chat mode toggle | Observable Chat adopts both: Chat mode uses the pre-send editor; Agentic mode uses `sg-loop-coordinator`. The toggle is a single attribute on the tool page. |

---

## D. What NOT to reuse

- **The hardcoded `LB_TOOL_SCHEMAS` table** — superseded by Swagger-driven schemas (C1).
- **The inline JSON-in-content shim** — already removed in session 2 (superseded by `aw-tool-extractor`).
- **The duplicate `sg-local-bridge:status` schema registration** in `agent-with-tools-api.js` — already removed in session 2.
- **The tool-specific `aw-llm-log`, `aw-turn-inspector`, `aw-tool-tester`, `aw-demo-panel`** — these are agent-with-tools UX glue. Observable Chat has equivalent panels via existing `sg-llm-*` components.

---

## E. Mapping summary

| Observable Chat brief component | Primary source(s) |
|---|---|
| **1. Prompt Inspector** | `sg-llm-debug` + `sg-llm-token-viz` + `sg-llm-response-inspector` + promoted `sg-step-tracer` (was `aw-step-tracer`) + new `sg-llm-pre-send-editor` |
| **2. Compression Workbench** | `sg-llm-reality` (block model) + new `sg-llm-compression-engine` + new `sg-llm-compression-diff` |
| **3. Tool Router** | `sg-tool-definition` + `sg-local-bridge` (Swagger-driven post Phase 0) + new scoring layer + promoted `sg-execution-queue` (was `aw-execution-inspector`) |
| **4. Conversation Graph** | New: `sg-llm-graph-store`, `sg-llm-graph-context-builder`, `sg-llm-graph-canvas` |
| **5. Parallel Analyst** | `sg-llm-request` fan-out + new `sg-llm-sidecar` + new `sg-llm-sidecar-panel` |
| **6. Replay Surface** | `sg-llm-bundle` + `sg-llm-bundle-list` + `sg-llm-bundle-viewer` + promoted `sg-loop-coordinator` (was `aw-loop-coordinator`) + promoted `sg-pipeline-view` (was `aw-pipeline-view`) |
| Vault folder tree | `vault-client` v1.2.2 + sgit + new browser UI |

---

This document is released under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
