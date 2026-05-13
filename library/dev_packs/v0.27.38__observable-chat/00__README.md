# 00 — Observable Chat Dev Pack

**version** v0.27.38
**date** 13 May 2026
**status** Strategy + UX + Mockups locked. Phase 1 ready to start once Phase 0 prereqs land.
**tool** `observable-chat` — `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.59/en-gb/observable-chat/`

---

## What this pack is

Everything an implementing Sonnet agent needs to start building `observable-chat` — the next browser tool from tools.sgraph.ai. The pack is read top-to-bottom; later docs depend on earlier ones.

The pack is **self-contained**. You do not need to fetch other files to start. Cross-references to the wider repo (reality docs, agent-with-tools source, vault library) are noted where relevant but every concept you need is repeated here.

---

## Reading order

| # | Doc | Read for | ~lines |
|---|---|---|---|
| 00 | This README | Map of the pack, status, who-to-ask | 80 |
| 01 | Original Dinis brief | Vision · the 4 design principles · the 6 components · acceptance criteria | 220 |
| 02 | Architecture strategy | Reuse map (~80% of building blocks exist) · 4 new components · build sequence · bus event extensions · vault structure | 280 |
| 03 | UX design | Screen designs · interaction patterns · colour vocabulary · 5 open UX decisions | 280 |
| 04 | ASCII mockups | All 11 surfaces drawn — top layout, vault browser, chat, pre-send inspector, compression workbench, tool router, graph canvas, sidecar pills, replay, empty state, focus mode | 440 |
| 05 | Coding standards | Folder structure · `SgComponent` base · `Snake_Pascal` class names · i18n LABELS · `closest('[data-llm-bus]')` · explicit over clever | 175 |
| 06 | Reuse map from agent-with-tools | What we inherit from sessions 1 + 2: 6 components to promote, 5 patterns to reuse, 10 open items to carry forward, 4 things NOT to reuse | 145 |
| 07 | Build sequence (phases) | Phase 0 prereqs · Phase 1–6 scope, new code, acceptance criteria · branch discipline · handover prompt template | 165 |
| 08 | Open questions | 5 locked decisions · 8 pending decisions blocking Phase 1 · 6 decisions deferred to implementation time | 110 |

---

## The one-paragraph summary

A chat tool that treats every LLM call as a one-shot question whose context the user can see, edit, and replay before it leaves the browser. The conversation is not a flat scrollback but a graph of facts, hypotheses, decisions, and questions; each turn rebuilds the model's context from that graph instead of accumulating linear history. Sidecar LLMs run in parallel to score tool relevance, extract graph nodes, and suggest compressions. The whole conversation is stored as a folder under the user's vault — many conversations per vault, organised by user-defined folders. The chat is one surface; the orchestration layer is the product.

---

## The three user-facing pillars

| Pillar | What the user sees | Brief sections |
|---|---|---|
| **Request visibility** | Every prompt is renderable, editable, and diffable before send | Components 1 + 6 (Inspector + Replay) |
| **History manipulation** | Compression decisions are explicit and overridable; graph view lets user pin/drop nodes from the next context | Components 2 + 4 (Compression + Graph) |
| **Sidecar LLM extraction** | Cheap parallel models extract graph nodes, score tools, suggest phrasings — non-blocking | Components 3 + 5 (Tool Router + Analyst) |

---

## What's NOT in this pack

- **The agent-with-tools source code itself.** Read `team/humans/dinis_cruz/debriefs/05/13/v0.1.58__debrief__agent-with-tools__*.md` for the narrative, and the live code under `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.58/en-gb/agent-with-tools/` for the patterns to reuse.
- **The wider component library.** See `team/explorer/librarian/reality/v0.1.0__what-exists-today__*.md` for the authoritative inventory.
- **Vault primitives.** Use `vault-client` v1.2.2 and the sgit skill at `library/skills/use_sgit-and-vaults/SKILL.md`.

---

## Who to ask

| Topic | Person / role |
|---|---|
| Architecture decisions (component boundaries, event contract, versioning) | @architect — Dinis is final reviewer |
| UX decisions (screen flow, copy, interactions) | @designer |
| Component patterns (folder structure, base class, helpers) | See `05__guidelines` first, then @architect |
| Vault structure (folder tree, meta.json, share-keys) | @architect — `02__strategy` §6 is the current proposal |
| Tool path / versioning | Architect — current proposal `tools/v0/v0.1/v0.1.59/en-gb/observable-chat/` |
| Sidecar models / costs | @architect — `08__open-questions` §Q3, §Q6 |

---

## Pack lifecycle

This pack is a **snapshot at v0.27.38**. The source docs may evolve in their team folders:

- `team/explorer/architect/v0.27.38__strategy__observable-llm-orchestration.md`
- `team/explorer/designer/v0.27.38__ux__observable-llm-orchestration.md`
- `team/explorer/designer/v0.27.38__mockups__observable-chat.md`
- `team/explorer/architect/v0.27.38__coding-standards__component-structure.md`

When the implementing agent picks up the work, this pack version is the contract. Updates to the source docs after pack creation should produce a new pack version (`v0.27.39__observable-chat/` etc.) so each phase has a stable reading list.

---

This README is released under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
