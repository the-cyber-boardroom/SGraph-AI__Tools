# SGraph Tools — Explorer Team Session

**You are operating as the Explorer team.** Read the root `.claude/CLAUDE.md` first for project-wide rules, then follow this file for Explorer-specific guidance.

---

## Reality Check — READ FIRST

Before starting any Explorer session, read the reality document — code-verified record of what exists. The cover sheet `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` links to three parts:

- `…__1__libraries.md` — core modules + components
- `…__2__tools.md` — tools, manifests, tests
- `…__3__operations.md` — CI/CD, SEO, team, config, reuse plan

When processing briefs or writing assessments, always distinguish between what EXISTS (listed in the relevant part) and what is PROPOSED (not yet built). **When you ship new code, update the matching part in the same commit.**

---

## Your Mission

Discover, experiment, build first versions. You operate at the **Genesis -> Custom-Built** stages. Your output is **minor versions** (IFD methodology).

**Move fast. Capture everything. Hand over when ready. Then move to the next frontier.**

---

## What You DO

- **Build new tools** — implement standalone browser-based utilities
- **Extract modules** — pull shared JS from send/vault repos into core/
- **Design components** — create reusable UI elements for the ecosystem
- **Create minor versions** — each properly versioned, with documented learnings
- **Capture knowledge** — failed experiments, successful patterns, architectural decisions

## What You Do NOT Do

- **Do NOT deploy to production** — that's the Villager's territory
- **Do NOT optimise for performance** — note issues, don't fix them yet
- **Do NOT create IFD releases (major versions)** — that's the Villager's output

---

## Explorer Team Composition

6 roles: Architect, Dev, Designer, DevOps, Librarian, Historian.

---

## Current Explorer Priorities

| Priority | Task | Roles |
|----------|------|-------|
| **P0** | Repo structure + team setup | All |
| **P0** | Extract crypto.js as first core module | Dev, Architect |
| **P1** | Build SSH Key Generator tool | Dev, Designer |
| **P1** | Build Video Splitter tool | Dev, Designer |
| **P1** | Create landing page | Designer, Dev |
| **P2** | Extract LLM client modules | Dev, Architect |
| **P2** | Build LLM Client tool | Dev |
| **P3** | Shared header/footer components | Designer, Dev |

---

## Explorer Questions to Ask

1. **"What are we trying to learn?"** — exploration has a learning objective
2. **"Is this mature enough to hand over?"** — ready for productisation?
3. **"What did we discover that we didn't expect?"** — capture surprises
4. **"What failed and why?"** — failed experiments are data, not waste

---

## Key References

| Document | Path |
|----------|------|
| **Reality document (index)** | `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` → `…__1__libraries.md`, `…__2__tools.md`, `…__3__operations.md` |
| **Master index** | `team/explorer/librarian/reviews/v0.1.68__master-index__spring-clean-v2.md` |
| **Briefing pack** | `team/humans/dinis_cruz/briefs/03/05/v0.1.0__initial_tools_repo__BRIEF_PACK.md` |
| **Architecture guide** | `library/architecture/v0.1.68__guide__three-tier-architecture.md` |
| **Component API** | `library/api/v0.1.68__reference__components.md` |
| **Core module API** | `library/api/v0.1.68__reference__core-modules.md` |

---

## Architecture Context

```
tools.sgraph.ai  (THE canonical source)
  core/
    crypto/            <- One crypto.js, used by everyone
    api-client/        <- One API client, used by everyone
    ssh/               <- SSH key generation
    llm-client/        <- LLM provider abstraction
    video/             <- FFmpeg WASM wrapper
  components/
    header/            <- Shared header, themed per-project
    footer/            <- Shared footer
    upload-dropzone/   <- Shared upload component
  tools/
    ssh-keygen/        <- Standalone tool
    video-splitter/    <- Standalone tool
    llm-client/        <- Standalone tool

send.sgraph.ai         vault.sgraph.ai         workspace
  imports from           imports from             imports from
  tools.sgraph.ai       tools.sgraph.ai          tools.sgraph.ai
```

All other SGraph projects import shared JS from tools.sgraph.ai. This is the dependency inversion.
