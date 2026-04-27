# 09 — FUTURE: Graph-based version control for JS tools and components

> **🚧 OUT OF SCOPE FOR THIS PACK 🚧**
>
> This document is a **parking lot**. It captures a design conversation that produced genuinely good ideas, none of which are being implemented in `v0.22.17__pack__sg-toolkit-extraction`. It exists so the thinking is not lost. Before any of this becomes a future pack, multiple architectural questions must be resolved (see §"Open questions a future pack must resolve" near the end).
>
> If you are an implementer of brief 05, 06, 07, or 08 in this pack: **do not read this doc as a spec**. Read it only if you're curious about why the toolkit's `sg-history` v0.1.0 ships with the API surface it does — the v0.1.0 design is deliberately compatible with the future direction described here, but the future direction is not in scope.
>
> If you are an architect considering a future pack on this topic: this document is your starting point.

**Pack:** `v0.22.17__pack__sg-toolkit-extraction` (parking lot)
**Doc role:** future-direction capture; explicitly NOT a spec
**Audience:** future-pack architects
**Lifetime:** durable. Updated when future thinking advances; promoted into a pack's spec when a future pack starts.

---

## §1 — What this document captures

A conversation during the writing of the v0.22.17 pack identified that **op-based undo/redo, taken to its full conclusion, becomes a version-control system**. The data structure is a DAG. The operations are ops. The "branches" are user actions that diverge from a previous state. The "merges" would be (someday) reconciliations between branches. The "remotes" would be (someday) sgit-vault stores or other persistent backends.

This is, on inspection, very close to what git already is — but applied to in-tool state rather than to source files.

The conversation explored:
1. Whether tree-based undo (with branching) should be in `v0.22.17__pack__sg-toolkit-extraction`
2. Whether the `sg-history` API should use git terminology (clone/branch/push/pull/merge)
3. Whether the storage backend should be sgit-vault-compatible
4. What the user experience would look like
5. What the precedents are (mostly: Vim's `:undolist`/`:earlier`/`:later`, the Gundo and undotree plugins)

The conclusions, recorded for posterity:

1. **Tree-undo is NOT in this pack.** The data structure (DAG) is in v0.1.0; the API supports it; the UI and branching semantics are deferred. See §3.
2. **Git terminology is NOT used in the API.** The honest verbs are `record`, `undo`, `redo`, `goTo`, `replayOps`. See §4 for why.
3. **sgit-vault compatibility IS designed in but not implemented.** The op log serialises to a shape sgit can store; the actual integration is future work. See §5.
4. **The UX is the unsolved problem.** Vim's tree-undo is famously underused because it has no good UI. Future pack must address this. See §6.
5. **Several open questions remain.** See §7.

---

## §2 — Why this is a "killer feature" if done right

The conversation flagged this multiple times because the use cases are unusually compelling. Listing them so a future architect inherits the motivation:

### §2.1 — Recovering "lost" work after exploratory undos

Today's flat-stack undo behaves destructively when users undo and then make a new change: everything past the new change is **erased**. Users who've explored "what if I delete this clip?" by pressing undo five times, then made a different change, have permanently lost the five operations they undid. They cannot navigate back to that exploratory branch.

Tree-based undo preserves it. The new change becomes a **branch point**. The old timeline is still there; the user can switch between branches. This is genuinely valuable for creative work where experimentation is normal.

### §2.2 — "What if" exploration without commitment

A user could deliberately branch: "let me try a completely different edit; if I don't like it, I'll go back to the main branch." Today this requires duplicating the whole project. With tree-undo it's a free local operation.

### §2.3 — Replay attribution and audit

Each branch is a different "story" of what the user (or agent) did. Reviewing a branch shows the decision path. For team workflows or agent-driven workflows, this is investigative gold.

### §2.4 — Git-like collaboration (very far future)

If the storage layer is sgit-vault-compatible, two users editing the same project on different machines could `pull` each other's branches and `merge` them. This is collaborative editing without a centralised real-time-sync server. The hard parts are conflict resolution and CRDT-like ordering, both genuinely hard problems.

### §2.5 — Time-travel debugging in production

A user reports a bug. They share their op-log (or a sgit-vault snapshot). The developer loads it, scrubs to the moment before the bug, single-steps through the next op. The bug repros deterministically. No "I can't reproduce" tickets.

These are not minor UX wins. They are **product-level capabilities** that don't exist in most editors today. Figma has some of this (revision history and live multi-user); few standalone JS tools do.

---

## §3 — Why tree-undo is not in pack v0.22.17

### §3.1 — Scope hygiene

The original framing of pack v0.22.17 was "extract what already exists in sg-video-editor into reusable form." The current undo is a flat stack. Extracting it generically gets the audio editor (and every future tool) free undo for the cost of one shared module. That's the win.

Adding tree-undo to the same pack changes the work from **extraction** to **invention**. Extraction is well-understood: copy proven code, rename it, generalise. Invention is risky: design decisions, UX exploration, edge cases. Mixing them in one pack means the extraction work waits for the invention work, and the invention work absorbs the urgency of the extraction work, and both come out worse.

### §3.2 — Vim is the precedent — and a warning

Vim has had tree-based undo for years (`:undolist`, `:earlier 10m`, `:later 5m`). It's powerful. **Almost nobody uses it.** Vim users who DO use it usually use plugins (Gundo, mundo, undotree.vim) to visualise the tree as ASCII art in a side panel.

Why? Because tree navigation is hard. Without a good visualisation, the user knows the tree exists but can't see it. Without naming for branches, the user can't refer to them. Without merge semantics, branches drift apart with no way to combine them.

Tree-undo without exceptional UX support is a feature that is **theoretically powerful and practically invisible**. Pack v0.22.17 cannot fix this in the scope it has. A future pack focused exclusively on tree-undo can.

### §3.3 — The data structure IS a DAG already

`sg-history` v0.1.0 internally backs its op log with a directed-acyclic-graph data structure, NOT a flat array. The flat-stack semantics are a usage choice (current head is the latest leaf; redo is forward to that leaf; undo is backward; new ops trim the redo tail). The DAG can support tree-undo without an internal redesign — only the public API and the UI need to change.

This is the deliberate seed. Future tree-undo gets to inherit a working DAG. v0.1.0 consumers experience flat stack and don't know the DAG is there.

---

## §4 — Why the API does NOT use git verbs

This was the most contentious point in the conversation. The argument FOR git verbs:

- Git's vocabulary is universal among developers
- `clone`, `branch`, `push`, `pull`, `merge` are familiar
- Compatibility with sgit-vault storage feels natural if the API speaks git

The argument AGAINST (which won):

### §4.1 — Git's verbs mean things git's setting allows

`clone` means "copy a remote repository to local." `push` means "send local commits to a named remote." `pull` means "fetch from a remote and merge into the current branch." All three assume **a remote**, an **other authority**, a **separate machine or process**.

In a single-tab in-browser undo system, **there is no remote**. The user is editing alone. The undo "tree" is purely local. `clone` to where? `push` to whom? `pull` from where? The verbs are nonsensical in the context.

### §4.2 — Familiar terminology for unfamiliar semantics is worse than unfamiliar terminology

A developer who reads `history.merge(branchA, branchB)` and knows git will assume git semantics: conflict markers, three-way merge, ancestor commit, etc. They will then be confused when those semantics don't apply (or apply differently). Confusion from broken expectation is harder to debug than confusion from genuine novelty — the latter prompts the developer to read the docs; the former leaves them confidently wrong.

### §4.3 — Honest verbs survive re-reading

`record`, `undo`, `redo`, `goTo`, `replayOps` describe what the operations DO. A developer reading them for the first time understands them immediately. There's no expectation to violate.

### §4.4 — Storage compatibility is a serialisation question, not an API question

The argument that "git verbs let us use sgit storage" conflates two layers. Storage compatibility is purely about whether the data structure (the DAG of ops) serialises into a shape sgit can store. It does. The API surface above that storage doesn't have to use git terminology to make storage interchangeable.

You can have an undo system whose API is `record/undo/redo/goTo` AND whose storage backend is an sgit vault. The two are orthogonal. We chose orthogonal.

### §4.5 — A future pack MAY revisit this

If a future pack genuinely surfaces git-like collaborative semantics (multiple users editing a vault-backed project, with sync events being meaningful), it MAY introduce a `Collaborative` API extension that uses git verbs honestly. That's a different layer on top of the honest core. The core stays honest.

---

## §5 — Sgit-vault as undo storage: design seeds

This is genuinely exciting and entirely future work. Capturing the seeds.

### §5.1 — Why sgit is a natural fit

sgit (the SGraph encrypted vault tool) already provides:
- Zero-knowledge encrypted persistent storage
- Git-like commit semantics
- Branching and tagging
- Snapshot tokens for sharing
- Cross-machine sync (the user's vault is the same on every device they auth)

If a tool's op log persists in a sgit vault:
- Undo state survives across browser tabs, browser restarts, machines
- Two users (or two devices of one user) can share a vault and see the same op history
- Operations get cryptographic attestation (the vault knows who recorded what, when)
- Time-travel becomes time-travel-across-devices
- Bug reproduction can be shared as a vault token

### §5.2 — What a future pack needs to design

- **When does an op flush from in-memory to vault?** Every op? Debounced? On undo? On save? The current `sg-project-storage` model is "explicit save." sgit-vault would shift toward "ambient sync."
- **What's the auth model?** sgit vaults require keys. Does each tool prompt for a key on load? Use the user's session vault? Inherit from the page's existing sgit context?
- **How are conflicts resolved?** Two devices edit offline, both record ops, then sync. Two op chains diverge from a common ancestor. How does the merge work? CRDT-style auto-merge? User-mediated? Last-write-wins?
- **What's the cost model?** Storing every op in a vault costs storage. Quotas? Pruning? Snapshot anchors as the persistence unit instead of every op?

### §5.3 — What v0.1.0 of sg-history DOES that helps a future pack

- The op shape (V.4.5 in pack README) round-trips through `JSON.stringify` losslessly. Vault storage is just JSON-in-blob.
- The `source` field accommodates `'remote'` or `'sync'` values without schema change.
- Each op has an optional `id` field for content-addressing (future packs may switch to content-addressed ids for cryptographic attestation).
- The `replayOps()` method is the natural "apply remote ops" entry point.

### §5.4 — What v0.1.0 of sg-history does NOT do

- It is in-memory only. There is no persistence layer beyond what `sg-project-storage` does (which writes to localStorage / IndexedDB).
- It has no "remote" concept.
- It does not handle CRDT-style ordering or vector clocks.
- It does not detect or resolve conflicts.

A future "sgit-vault as undo storage" pack would add all of these.

---

## §6 — UX: the unsolved problem

The single biggest reason tree-undo is hard to ship is the UX. A future pack MUST resolve this. Capturing the design problems:

### §6.1 — The visualisation problem

A tree of 50 ops with 5 branches needs to be visible. Linear undo lists work fine; tree visualisations don't have a universal shape. Options:

- **Inline timeline** (Gundo style): vertical list with branch indents
- **Side panel graph** (git-graph-style): horizontal lanes for each branch
- **Floating node graph** (Figma-style): pannable canvas with nodes and edges
- **Hover-only preview**: undo button shows a tree on long-press; otherwise hidden

Each has trade-offs. None has emerged as "the" answer in the wild.

### §6.2 — The branch-naming problem

Branches in tree-undo are usually unnamed (just "the state I left when I undid here"). Without names they're hard to refer to. Options:

- **Auto-named** ("branch-3", "the branch from 3 minutes ago")
- **User-named** ("colour experiment", "before the cut")
- **Action-named** (the name of the op that started the branch)
- **Untitled, addressed by visualisation only**

### §6.3 — The merge-vs-discard problem

When two branches drift, what does "merging" mean? Probably: cherry-pick ops from one branch into another. But:

- **Conflict detection.** What if two branches both moved the same item to different positions?
- **User involvement.** Does the user resolve conflicts manually? Auto-resolve with a strategy?
- **Result placement.** Does the merged result become a new branch or replace one of the originals?

### §6.4 — The discoverability problem

Users don't know tree-undo exists unless we tell them. How? A new icon? An overlay tutorial? A "look here, you have other timelines" notification?

### §6.5 — The safety problem

Today's flat-undo "discards" the redo tail when a new change is made. That's destructive but predictable. Tree-undo preserves it, which is non-destructive but creates an UNBOUNDED tree. The user's project now has 1, 5, 100, 1000 branches. Memory and cognitive load. Pruning policy required.

### §6.6 — Precedent does not solve this

- **Vim** has tree-undo since 7.x. Most users don't know it exists.
- **Photoshop/Lightroom** have non-linear history but only Photoshop's "Snapshots" feature is widely used.
- **Figma** has linear-but-rich history; no branching.
- **Google Docs / Google Sheets** have linear history with named "named versions" — closer to a single-branch named-tag system.

Building a great tree-undo UX would be **product novelty**. That's high-value but high-risk.

---

## §7 — Open questions a future pack must resolve

Before a future pack can be written, these questions need answers:

### §7.1 — Product

1. **Is tree-undo a feature users will actually use?** Run user research. Test with prototypes against real projects.
2. **What's the right visualisation?** Prototype 2-3 styles. A/B test with users.
3. **What's the discovery story?** When does a user learn tree-undo exists?
4. **What's the safety story?** When does a branch get pruned? When does the user get warned?

### §7.2 — Architecture

5. **Does each tool ship its own tree-undo UI, or is there a shared `<sg-history-tree>` component?** Answer is probably "shared" but the shape is unclear.
6. **How does sg-history-tree integrate with `<sg-toolbar>`?** Replace the Undo/Redo buttons? Add a third "history" button? Both?
7. **What's the JSON schema for the persisted DAG?** Future-compatibility matters. Versioning matters.
8. **What's the memory budget?** A tree of 1000 ops × 5 branches × 5 KB priorState = 25 MB. Per project. In the browser. Limits required.

### §7.3 — Storage

9. **Where does the tree persist?** localStorage (small)? IndexedDB (better)? Sgit vault (best, but auth needed)?
10. **When does it persist?** Every op (heavy)? Debounced (loss window)? On save (might lose between saves)?
11. **What's the share model?** Can a user share their tree with another user? Read-only? Forkable?

### §7.4 — Multi-user (very far future)

12. **Is collaborative editing an explicit goal?** If yes, the architecture choices for §7.2 and §7.3 change substantially.
13. **What's the conflict-resolution model?** CRDT? Operational Transform? User-mediated?
14. **What's the auth model for shared vaults?** Sgit's existing model? Something new?

### §7.5 — Ecosystem

15. **Do other tools (outside the editor family) want this?** A graph editor? A kanban? An IDE? If yes, the abstraction must be more general than "video/audio/animation editor."
16. **Is there an opportunity to publish this as an open-source primitive?** "JS in-browser DVCS for tool state" is a category that doesn't really exist. Could be a foundational contribution.

---

## §8 — What v0.22.17 (this pack) actually delivers toward this future

To make sure the future pack inherits the right starting point, here's what's actually in v0.22.17:

✅ **Op-based history.** `sg-history` v0.1.0 ships op-shaped events, op categories, op-shaped events as a guideline rule.

✅ **DAG-shaped backing structure.** v0.1.0 uses a DAG internally. Flat-stack semantics are a usage policy, not a data-structure constraint.

✅ **JSON-serialisable ops.** Every op round-trips through `JSON.stringify`/`parse`. Ready for any persistence layer.

✅ **`source` field on every op.** Distinguishes user / agent / replay / future-remote sources.

✅ **`ops` slot in `sg-project-storage` save envelope.** Optional, opt-in. Tools that want op-log persistence get it.

✅ **`replayOps()` method.** The natural entry point for "apply ops from a saved log" or future "apply ops from a remote sync."

✅ **5-category op-support taxonomy (V.6).** Pure / snapshot / with-side-effects / never / noisy. Generic enough that future tree-undo can use the same categories.

✅ **Honest API verbs.** `record / undo / redo / goTo / replayOps`. Future packs can add API surface (e.g. `branch`, `merge`) without contradicting these.

❌ **NOT delivered: branching API.** No `branch()`, no `switchToBranch()`, no `mergeBranches()` in v0.1.0.

❌ **NOT delivered: tree visualisation.** No `<sg-history-tree>` component. Toolbar buttons only.

❌ **NOT delivered: persistent storage layer beyond `sg-project-storage`.** No sgit-vault integration. No real-time sync.

❌ **NOT delivered: CRDT-style ordering.** Single-source, no merge semantics.

❌ **NOT delivered: cryptographic attestation.** Op `id` is a UUID, not content-addressed.

The pattern: every "delivered" item is something the future pack inherits as a foundation. Every "not delivered" item is a future-pack scope item.

---

## §9 — When does a future pack become viable?

A future pack on tree-undo / vault-storage / collaborative-history becomes viable when:

1. **At least 2 tools are in production using `sg-history` v0.1.0.** Currently zero (this pack ships v0.1.0 and doesn't yet have post-pack production tools). After pack v0.22.17 lands and audio editor ships, we'd have 2 — sg-video-editor v0.1.55 and sg-audio-editor v0.1.0.

2. **Real users have used flat-stack undo in those tools long enough to ask for "is there a way to recover work I undid?"** Validates the product need.

3. **A UX prototype has been tested.** At least one of the visualisation options has been built and shown to users.

4. **A storage layer has been chosen.** Sgit-vault or other.

5. **An architect has the time to write the pack.** Tree-undo with proper UX is a multi-month effort, not a refactor.

Until those prerequisites are met, this stays parked.

---

## §10 — Notes for the future architect

Some advice from the architect of v0.22.17 to whoever picks this up later:

### §10.1 — Don't lead with the technology

The temptation when the data structure is a DAG is to make the DAG visible. **Resist.** Users don't care about DAGs. They care about "I made a mistake; can I get my work back?" Lead the design with the user story, not the data structure.

### §10.2 — Don't over-promise the git analogy

Git is not the model. Git is a **reference**. The user's tool-state is not source code, the user is not a developer, and the operations are not commits. Borrow what helps; reject what doesn't fit.

### §10.3 — Ship something small first

Don't ship the full git-clone-of-an-undo-system as v0.1.0 of the future pack. Start with: "preserve the redo tail when the user makes a new change after an undo." That's a 50% feature and it's already a meaningful UX improvement. Tag the preserved branch automatically; show it as a small badge in the toolbar; let users click through to recover. Iterate from there.

### §10.4 — Test with real projects

A tree of 5 ops looks fine in a unit test. A tree of 500 ops with 30 branches across an hour-long editing session is the real test. Get to that scale early.

### §10.5 — The sgit integration is the second pack, not the first

Do tree-undo first, in-memory. Validate the UX. Validate the data structure. Validate the user behaviour. Then add sgit-vault persistence as a separate pack. Combining them means the UX work and the sync work compete for attention; both come out worse.

### §10.6 — Talk to the SG/Send team

Sgit is the SG/Send team's product. They've thought hard about persistent encrypted state for similar problems. Their input on §7.3 storage questions is valuable. Don't reinvent.

---

## §11 — Status

**As of pack v0.22.17 ship:** 🚧 PARKED 🚧

This document does not have an owner. It does not have a target version. It does not have a planned start date. It exists as a record of a design conversation and as a starting point for whoever, in some future quarter or year, decides this is the right next investment.

The relevant signals for "we should start this":
- Users asking for it
- Multiple tools running on `sg-history` and asking for richer history
- Time and architect bandwidth available
- A UX prototype that worked

Until those land, the pack stays as written, this doc stays parked, and the architects who follow get to make a fresh call with fresh information.

---

**End of doc 09. Out of scope for v0.22.17. Future-pack architects: start here.**
