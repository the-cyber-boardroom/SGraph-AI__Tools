# UX: Observable LLM Orchestration — Screens, Surfaces, and Interactions

**version** v0.27.38
**date** 13 May 2026
**from** Designer
**to** Developer
**source brief** `team/humans/dinis_cruz/briefs/.../v0.27.38__devbrief__observablellmorchestrationtool.md`
**companion strategy** `team/explorer/architect/v0.27.38__strategy__observable-llm-orchestration.md`

---

## 1. Anchor principles → UI rules

The brief states four principles. Each becomes a concrete UI rule.

| Principle | UI rule |
|---|---|
| Over-index on visibility | The observability rail is always on screen. Cost, tokens, graph, tools are first-class panels, not collapsed sidebars. The user can collapse them; they're never hidden by default. |
| Halfway house between one-shot and multi-turn | Every send has an explicit "Review & Send" gate (skippable but never hidden). The pre-send view is the one-shot prompt — readable, editable, copyable. |
| Active observability | Sidecar suggestions render *during* the main request, not after. The user sees the system reasoning in parallel with the model. |
| Conversation is a graph | The graph canvas is the primary right-side surface, not a tab buried under "Advanced". The linear chat is the input/output interface; the graph is the truth. |

---

## 2. The screen — sg-layout panel tree

Top-level layout, expressed as the sg-layout config it will use:

```
row [70% / 30%]
├─ column [22% / 68% / 10%]                ← centre work column
│  ├─ stack
│  │   tabs: [System & Reality] [Graph Filter]
│  ├─ stack
│  │   tabs: [Chat] [Inspector] [Compression] [Replay]
│  └─ stack (sidecar strip — collapsible)
│      tabs: [Sidecar Suggestions]
└─ column [42% / 28% / 30%]                ← right observability rail
   ├─ stack
   │   tabs: [Graph Canvas]
   ├─ stack
   │   tabs: [Tokens & Cost] [Bundles]
   └─ stack
       tabs: [Tools (scored)] [Connection] [Vault]
```

Defaults rationale: the chat is the largest panel because writing happens there. The graph canvas dominates the right column because the user is meant to watch it grow. The bottom-left strip is reserved for non-blocking sidecar messages so they never interrupt the chat flow.

All sg-layout panels are draggable / dockable / closeable, so the user can collapse the right column entirely and get a "calmer" view (still observable, but minimised). Closing the graph canvas opens a "show graph" pill that re-opens it.

---

## 3. Screen — the Chat panel (centre, primary)

Familiar layout but with two non-obvious additions:

- **Above the chat history**: a "Context built from N graph nodes · M turns" pill. Click to expand the inline view of which graph nodes informed the assembled context for the most recent send. This is the always-visible answer to "where did the model's input come from?".
- **Below the chat input**: a one-line "Pre-send" status row — model · estimated tokens · estimated cost · "Review →" link. Click "Review →" before submitting (or after, to inspect what was sent).

The chat itself uses `sg-llm-chat-history` v0.1.10 unchanged. The two additions are sibling DOM nodes in the centre column.

Streaming responses render the same way as today; sidecar pills appear in the bottom strip as the main response streams.

---

## 4. Screen — the Pre-send Inspector (modal-ish slide-over)

This is the centrepiece of the visibility pillar.

Triggered by clicking "Review →" before a send, or auto-triggered if `trust-mode` is off. Renders as a slide-over from the right edge, covering the right observability rail but leaving the chat input visible at the bottom so the user can still cancel and retype.

**Header strip**
- Model dropdown · provider badge · `change`
- Estimated tokens (assembled / max-context) · Estimated cost · Estimated TTFT
- `[Send]` `[Send & remember]` `[Cancel]`

**Tabs**

1. **Assembled** — the messages array, rendered as labelled sections:
   - `system` (the live system prompt)
   - `pinned facts` (3 nodes from the graph)
   - `active hypotheses` (2 nodes)
   - `recent decisions` (1 node)
   - `open questions` (1 node)
   - `last 3 turns` (verbatim history)
   - `user message` (the pending message)
   Each section has a fold handle. Folding a section drops it from this send only; double-fold pins it as "always drop" for this conversation. The token count beside each section updates live.

2. **Tools** — the JSON schemas being sent, one per row, with the scores from the tool router. The user can untick a tool to remove it from this send only. "+ add tool" opens the existing `sg-tool-definition` add form.

3. **Diff vs previous** — a unified diff of this assembled messages array against the most recent successful send. Helps the user spot accidental context bloat or unexpected drops.

4. **Raw JSON** — the exact request body the provider will receive. Copyable. This is the "show me the bytes" surface that closes the loop on visibility.

**Footer**
- `Save as template` — captures the assembled shape as a reusable pre-send template
- `Always send without review (this conversation)` — toggles trust mode
- `Cancel` returns to chat without firing

---

## 5. Screen — Compression Workbench

Tabbed into the centre column, opens when:
- Context size crosses a configurable threshold (default 60% of model context window)
- User explicitly clicks "Compress now"
- A new turn is about to push context over the limit

**Layout: two columns side by side**

| Before (current history) | Proposed After (compressed) |
|---|---|
| Turn 1 user · 80 tok | Turn 1 user · 80 tok · **kept** |
| Turn 1 assistant · 1,200 tok | Turn 1 assistant · summarised → 180 tok |
| Turn 2 user · 60 tok | Turn 2 user · 60 tok · **kept** |
| Turn 2 tool_call lb_read_file · 400 tok | Turn 2 tool_call · **dropped** (its result was already summarised into the graph) |
| Turn 2 tool_result · 8,400 tok | Turn 2 tool_result · summarised → 220 tok |
| Turn 3 assistant · 2,100 tok | Turn 3 assistant · **kept** (referenced in pending question) |
| Total: 12,240 tok | Total: 2,640 tok · **savings: 78%** |

Each row in the right column has a tag (`kept` / `summarised` / `dropped`) and a hover-revealed reason. The tags are click-to-flip; if the user flips a row, the engine recomputes and updates the totals.

**Header**
- "Compression for the next send" · cost-of-uncompressed vs cost-of-compressed · `[Apply]` `[Apply for this send only]` `[Reject]`

**Footer**
- "Save overrides as a pattern" — captures `{block_type, block_role, action}` rules so the engine respects this user's preferences on future rounds.

---

## 6. Screen — Tool Router (right column tab)

A vertical list of every available tool, each row:

```
[✓] 87 ▍▍▍▍▍▍▍▍▍   lb_read_file       📌
[✓] 64 ▍▍▍▍▍▍       lb_run_bash
[✓] 52 ▍▍▍▍▍        lb_list_folder
[ ] 12 ▍            lb_fetch_url       🚫
[ ] 04              web_search
```

Columns:
- Checkbox — enabled for the next send (auto-toggled by score, user can override)
- Score 0–100, with horizontal bar
- Tool name
- Pin (📌) — always include for this conversation
- Exclude (🚫) — never include for this conversation

Above the list:
- "Scored against your pending message · model qwen2.5-3b · 84 ms"
- `Refresh` button (forces a re-score)
- Threshold slider (default 30 — tools below auto-disabled)

Below the list:
- "+ Add tool" opens existing `sg-tool-definition` add form (templates and custom JSON)

This is `sg-tool-definition` augmented with a scoring column, not replaced. Existing add / import / export keeps working.

---

## 7. Screen — Conversation Graph (right column, primary tab)

SVG canvas. Force-directed layout by default; alternative layouts: chronological columns, decision-tree, dependency-DAG.

**Nodes**
- **Fact** — green — established truth, e.g. "lb_read_file returns UTF-8"
- **Hypothesis** — amber — proposed but not confirmed, e.g. "the README is in en-GB"
- **Decision** — purple — a choice made, e.g. "we'll use Ollama as default"
- **Question** — cyan — open, awaiting evidence
- **Analysis** — blue — derived reasoning that depends on facts
- **Opinion** — grey — subjective stance

**Edges**
- `supports` — solid line
- `contradicts` — red dashed
- `derives_from` — thin arrow
- `depends_on` — thick arrow
- `answers` — dotted (question → fact/decision)
- `refutes` — red dashed bidirectional

**Filters (left rail of the canvas)**
- Time: last N turns / last hour / all
- State: active / resolved / open / contradicted
- Type: any combination of node types
- Source: this conversation only / cross-conversation (later)

**Interactions**
- Single click — selects, highlights neighbours, shows panel with source turn + cost + provenance
- Right click — context menu: pin / drop / edit text / merge with another node / mark resolved
- Drag — repositions (free layout) or moves between columns (chronological layout)
- Double click — opens the source turn in the chat history

**Pinned nodes** are marked with 📌 and are guaranteed to be in the assembled context of the next send. **Dropped nodes** are crossed out and excluded from context until un-dropped.

The graph is the user's lever for "history manipulation" — pin what matters, drop what doesn't.

---

## 8. Screen — Sidecar Suggestions strip (centre bottom)

A horizontal strip below the chat panel. Renders as the main response streams.

```
💡 Phrasing      "show me the bash output, not the markdown"    [Use]
🔍 Ambiguity     'the file' — README.md or new file from turn 3? [Clarify]
🧠 Graph         Turn 4 established lb_read_file returns UTF-8     [Pin]
🔧 Tools         predicted: lb_read_file 95%, lb_run_bash 8%       [Lock-in]
```

Each pill:
- Icon by kind
- One-line summary
- Action button (Use / Clarify / Pin / Lock-in)
- Dismiss × on hover

Pills slide in left-to-right as their sidecar models finish. The strip is collapsible — the user can hide it for a calmer view; the suggestions still record in the vault.

Below the pills, a one-line cost row: "Sidecar this turn: 412 tok · $0.0002 · 1.8 s". Keeps the cost of observability honest.

---

## 9. Screen — Replay surface

Bundle list in the right column (existing `sg-llm-bundle-list` v0.1.3 with one new column: **Replay →**).

Clicking Replay opens a centre-column tab:

**Header**
- Source bundle ID + title + timestamp
- Controls: change model · swap tool subset · alter compression strategy · alter sidecar enabled

**Body**
- Original request (left) — exactly as sent, frozen
- New response (right) — after the user clicks `Replay`. Renders the same way as a live chat response (streaming, with cost, with sidecar pills)
- A diff strip between the two responses

**Footer**
- `Save as new bundle` (creates a `parent_id` link to the source — the existing fork tree)
- `Promote to fixture` (later — captures the request/response for regression testing)

This is how the tool becomes its own development environment, as the brief says. Every turn produces fixtures for the next turn's improvements.

---

## 10. Cross-cutting interaction patterns

| Pattern | Where it appears | Why |
|---|---|---|
| **Hover for reason** | Compression tags, tool scores, graph edges | Every automated decision exposes its reasoning on hover. No silent decisions. |
| **Single-click to override** | Tool router checkboxes, compression tags, graph pin/drop | One click flips the decision. No menus. |
| **Always-visible cost** | Chat footer, pre-send header, sidecar strip, replay surface | Cost is shown at the moment of cost, not in retrospect. |
| **Token bar per section** | Pre-send Inspector, Compression Workbench, Token Viz panel | The user sees *where* the tokens are going, not just the total. |
| **Pill, never modal, for sidecar** | Suggestions strip | Sidecar suggestions are advisory and non-blocking by definition. |

---

## 11. The colour vocabulary (extends `sg-tokens.css`)

| Token | Use |
|---|---|
| `--obs-node-fact: #48bb78` | Graph: facts |
| `--obs-node-hypothesis: #f6ad55` | Graph: hypotheses |
| `--obs-node-decision: #b794f4` | Graph: decisions |
| `--obs-node-question: #4fd1c5` | Graph: open questions |
| `--obs-node-analysis: #7c9ef8` | Graph: derived analysis |
| `--obs-node-opinion: #a0aec0` | Graph: opinions |
| `--obs-edge-supports: #48bb78` | Edge type |
| `--obs-edge-contradicts: #fc8181` | Edge type |
| `--obs-kept: #48bb78` | Compression: kept blocks |
| `--obs-summarised: #f6ad55` | Compression: summarised blocks |
| `--obs-dropped: #4a5568` | Compression: dropped blocks |
| `--obs-sidecar: #b794f4` | Sidecar pills accent |

All additive to the existing token surface — no overrides.

---

## 12. Mobile / small-screen behaviour (v0.1.0 — partial)

v0.1.0 is desktop-first. On viewports below 1024px:

- Right observability rail collapses to a slide-over drawer (toggled by a 📊 button in the header)
- The graph canvas falls back to a list view (typed nodes, indented, click for source turn)
- Sidecar pills move from horizontal strip to a vertical stack at the bottom

Full mobile UX is a v0.2 effort. The chat itself is usable on mobile in v0.1 thanks to existing `sg-llm-chat-input` v0.1.5 resize behaviour.

---

## 13. Accessibility notes

- Every graph node has an accessible-name attribute (`fact: lb_read_file returns UTF-8`)
- Compression tags are not colour-only — each has an explicit text label (kept / summarised / dropped)
- The pre-send Inspector is fully keyboard-navigable (Tab through sections, Space to fold, Enter on `[Send]`)
- Sidecar pills are screen-reader-announced when they arrive (polite live region)
- Cost and token counts are never the only way to convey information — there's always a label alongside

---

## 14. What this UX does *not* try to do (yet)

- No automatic graph layout that "explains itself" — force-directed is fine for v0.1; richer layouts come later
- No real-time collaboration cursors on the graph — multi-agent collab is later
- No undo/redo for graph edits — the vault commit history *is* the undo
- No keyboard shortcut cheatsheet UI — the slash-command surface is a v0.2 feature
- No theming beyond light/dark inheritance from `sg-tokens.css`

---

## 15. Open UX decisions (need a call)

| # | Question | Designer's lean |
|---|---|---|
| 1 | Where does the Pre-send Inspector live — modal slide-over, or its own panel? | Slide-over over the right rail. Keeps chat input visible at the bottom; less intrusive than a full modal. |
| 2 | Sidecar pills auto-dismiss or persist? | Persist for the current turn, fade after the next user message. User can pin a pill to keep it. |
| 3 | Default trust-mode after first send? | Off — the modal opens on every send by default. Toggle to on after 3 successful clean sends, with a notification. |
| 4 | Compression Workbench auto-open threshold | 60% of model context. Configurable in vault meta. |
| 5 | Graph canvas default — full-conversation or last-N-turns? | Last-N-turns (default 20) for performance and focus. "Show all" button toggles. |

---

This document is released under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
