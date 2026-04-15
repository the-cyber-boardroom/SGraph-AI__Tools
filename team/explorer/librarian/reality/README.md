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
| `v0.1.0__what-exists-today.md` | **ACTIVE** — updated to v0.1.91 | v0.1.91 |

> **Note:** The filename `v0.1.0__what-exists-today.md` reflects when this file was created. The content inside was last verified at v0.1.91 (14 Apr 2026). A future snapshot should be created at `v0.1.91__what-exists-today.md` to mark the current verified state.

---

## Maintained by

Librarian role — Explorer team. See `team/explorer/librarian/ROLE__librarian.md`.
