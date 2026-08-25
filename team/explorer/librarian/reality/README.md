# Reality — What Actually Exists

This folder is the **canonical, code-verified record** of what `sgraph_ai_tools__static` actually implements.

---

## Purpose

Agents repeatedly conflate proposed ideas with shipped functionality. This folder exists to eliminate that gap. Every claim in the reality document was verified by reading source code, not briefs or reviews.

Three states exist:

| State | Meaning |
|-------|---------|
| **EXISTS** | Code is written, file is at the stated path, exports are correct |
| **PROPOSED** | Described in briefs but not yet implemented |
| **DOES NOT EXIST** | No code implements it, regardless of what any document says |

Any feature not listed in the reality document is presumed not to exist.

---

## Rules (Non-Negotiable)

1. **If the reality document doesn't list it, it does not exist.** Do not describe proposed features as if they are shipped.
2. **Proposed features must be labelled.** Write: `PROPOSED — does not exist yet.`
3. **Update when code changes.** If you add, remove, or change a module, component, or tool — update the reality document in the same commit.
4. **Update when processing briefs.** Check whether features exist and add unverified items to the PROPOSED section.
5. **Read source code, not briefs.** The reality document is verified against actual files on disk, not against what a brief says should be there.

---

## Versioning

The active reality document follows the naming pattern `{version}__what-exists-today.md`.

At significant project milestones, create a new versioned snapshot rather than only editing in place. This creates a historical record of what existed at each version. Older snapshots remain in this folder as read-only history.

| File | Status | Project version |
|------|--------|-----------------|
| `v0.1.0__what-exists-today.md` | **ACTIVE — index** (cover sheet + cumulative change paragraph) | v0.1.55+ |
| `v0.1.0__what-exists-today__1__libraries.md` | **ACTIVE — Part 1** (deployment, core, skills, components) | v0.1.55+ |
| `v0.1.0__what-exists-today__2__tools.md` | **ACTIVE — Part 2** (tools, shared assets, i18n, manifests, scripts, tests) | v0.1.55+ |
| `v0.1.0__what-exists-today__3__operations.md` | **ACTIVE — Part 3** (CI/CD, SEO, team structure, configuration, sgraph.ai reuse plan) | v0.1.55+ |

> **Note:** The filename `v0.1.0__what-exists-today.md` reflects when this document was first created. On 26 Apr 2026 it was split into three parts because the single file had grown to ~568 lines / ~220 KB; the index file retains the original name + the cumulative "Verified by" change paragraph, while the body now lives in the three sibling parts. A future snapshot at `v0.1.X__what-exists-today.md` (with matching parts) is the right shape for a major-milestone freeze.

---

## Per-tool history files

When a tool's row in `__2__tools.md` grows beyond ~5 KB, spin it out into its own history file under `tools/{tool-slug}/`:

```
team/explorer/librarian/reality/
  tools/
    sg-video-editor/
      v0.1.54__rounds.md    ← one ## heading per round, all text verbatim
```

**Naming convention:** `{latest-tool-version}__rounds.md`  
**File lifecycle:** one file per tool (not per version) — append new rounds to the same file as the tool moves through patch versions.  
**Spin-out threshold:** once a tool row in `__2__tools.md` exceeds ~5 KB; leave smaller rows inline.

When a row is spun out the inline cell in `__2__tools.md` becomes a 2-3 sentence headline + a relative link:

```markdown
| Tool Name | path | version | **STATUS** — One-line summary. See [full round history](./tools/tool-slug/v{ver}__rounds.md). |
```

---

## Maintained by

Librarian role — Explorer team. See `team/explorer/librarian/ROLE__librarian.md`.
