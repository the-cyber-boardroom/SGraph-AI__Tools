# 08 — Open Questions for observable-chat

**version** v0.27.38
**date** 13 May 2026

Decisions still needed before implementation starts. Anything not on this list can be made by the implementing agent. Each item has the designer's lean, the architect's lean, and a status.

---

## Locked decisions (no action needed)

| # | Decision | Choice | Locked by | When |
|---|---|---|---|---|
| L1 | Tool name | `observable-chat` | Dinis | 13 May 2026 |
| L2 | Tool path | `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.59/en-gb/observable-chat/` | Architect | 13 May 2026 |
| L3 | Vault → conversation relationship | Many conversations per vault, organised by user-defined folders | Dinis | 13 May 2026 |
| L4 | Coding standards source | `team/explorer/architect/v0.27.38__coding-standards__component-structure.md` (mirrored in `05__guidelines`) | Architect | 13 May 2026 |
| L5 | Default agentic loop | `sg-loop-coordinator` (promoted from `aw-loop-coordinator`), not `sg-agentic-loop` | Architect | 13 May 2026 — `sg-agentic-loop` is unused on agent-with-tools |

---

## Pending decisions (block Phase 1 start)

### Q1 — Promote `aw-*` to `components/agentic/sg-*` or keep tool-local?

| Lean | View |
|---|---|
| Designer | Promote. They are general-purpose now. |
| Architect | Promote, and apply coding standards on the way (folder structure, `SgComponent` base, i18n vars). |
| **Recommendation** | **Promote (Phase 0).** Saves duplication across all future tools. |

### Q2 — Vault storage: localStorage scratch vs sgit-backed from day 1?

| Lean | View |
|---|---|
| Designer | sgit-backed from day one — keeps the "conversation is a vault" promise real. |
| Architect | sgit-backed, but allow a "scratch vault" in localStorage as a quick-start option (no sharing, no fork, but instant). |
| **Recommendation** | **sgit-backed from day 1, with a localStorage fallback only if the vault primitive isn't ready.** |

### Q3 — Graph extraction model default

| Lean | View |
|---|---|
| Designer | `qwen2.5-coder:7b` on Ollama — already proven in agent-with-tools, free, local. |
| Architect | Same default, per-conversation override. Frontier-model users can switch to `claude-haiku-4-5` or `gpt-4o-mini`. |
| **Recommendation** | **`qwen2.5-coder:7b` on Ollama by default, configurable per conversation in vault `meta.json`.** |

### Q4 — Compression engine — heuristic + LLM, or LLM-only?

| Lean | View |
|---|---|
| Designer | Heuristic baseline runs every send (free, instant). LLM refinement only when the heuristic flags low confidence. |
| Architect | Same. The heuristic is "drop tool results that are referenced no later than N turns ago, summarise long assistant turns above K tokens". |
| **Recommendation** | **Both, fallback chain. Heuristic first; LLM refines when confidence < threshold.** |

### Q5 — Pre-send-editor: blocking modal vs always non-blocking?

| Lean | View |
|---|---|
| Designer | Blocking on first send. After 3 successful clean sends, prompt to enable trust-mode; once enabled, modal is non-blocking but still records the assembled payload. |
| Architect | Agree. The "review" surface is what makes the tool a *visibility* tool. Hiding it by default undermines the value prop. |
| **Recommendation** | **Blocking on first send, trust-mode toggle after.** |

### Q6 — Sidecar budget cap default

| Lean | View |
|---|---|
| Designer | $0.001 per turn default (i.e. ~free for Ollama, ~negligible for frontier). User raises in vault meta if they want richer sidecars. |
| Architect | Same. Show the running cost live in the sidecar panel so the user can adjust. |
| **Recommendation** | **$0.001 per turn default · live cost display in sidecar panel.** |

### Q7 — Conversation graph canvas default — last-N-turns or full?

| Lean | View |
|---|---|
| Designer | Last 20 turns. Performance + focus. "Show all" button toggles. |
| Architect | Same. Force-directed layout doesn't scale past ~200 nodes without performance tuning. |
| **Recommendation** | **Last 20 turns by default.** |

### Q8 — Branch naming convention

| Lean | View |
|---|---|
| Designer | `claude/observable-chat-P{n}-{slug}` per phase. |
| Architect | Same. Phase 0 prereqs land on `claude/oc-P0-prereqs-{slug}` since they're not observable-chat-specific. |
| **Recommendation** | **As above.** Per `07__phases` §Branch discipline. |

---

## Decisions deferred to implementation time

These can be made by the implementing agent on the fly; documented here so the agent knows they don't need to escalate.

| # | Decision | Default |
|---|---|---|
| D1 | sg-layout panel sizes (right column vs left) | 70/30 row split, columns per `04__mockups` §1 — adjustable by user once visible |
| D2 | Graph node colour tokens | Per `03__ux` §11 — additive to `sg-tokens.css` |
| D3 | Edge type vocabulary in v0.1 | `supports`, `contradicts`, `derives_from`, `depends_on`, `answers`, `refutes` (per `02__strategy` §4b) |
| D4 | Vault `meta.json` schema | Designer to draft on Phase 1 start; freezes at end of Phase 1 |
| D5 | URL routing inside the tool | `?conversation={slug}` query param; deep-link to a folder via `?folder={path}` |
| D6 | Empty-state copy | Per `04__mockups` §10 |

---

## How to escalate a question

If a decision needs to be made and isn't on this list:

1. Add it to the "Pending decisions" section above with designer + architect leans drafted
2. Push to your phase branch
3. Surface in the PR description (when one is opened) or directly to Dinis
4. Do not block implementation — make a reasonable choice and flag it

---

This document is released under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
