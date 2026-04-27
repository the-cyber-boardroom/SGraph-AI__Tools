# SGraph Tools — Agent Guidance

**Read this before starting any task.** This file is the single source of truth for all agents and roles working on sgraph_ai_tools__static (tools.sgraph.ai).

---

## MEMORY.md Policy

**Do NOT use MEMORY.md** (the auto-memory at `~/.claude/projects/.../memory/MEMORY.md`). All persistent project knowledge is maintained by the Librarian in the repo itself. If you need to record something, add it to the appropriate location in `team/explorer/librarian/` or request the Librarian to update the relevant docs.

---

## Reality Document — MANDATORY CHECK

**Before describing, assessing, or assuming what tools.sgraph.ai can do, READ:**

`team/explorer/librarian/reality/v0.1.0__what-exists-today.md` — cover sheet that links to the three parts:
- `…__1__libraries.md` — core modules + components
- `…__2__tools.md` — tools, manifests, tests
- `…__3__operations.md` — CI/CD, SEO, team, config, reuse plan

This is the **code-verified** record of every module, component, tool, and feature that actually exists.

### Rules (Non-Negotiable)

1. **If the reality document doesn't list it, it does not exist.** Do not describe proposed features as if they are shipped.
2. **Proposed features must be labelled.** If you describe something not in the reality document, you MUST write: "PROPOSED — does not exist yet."
3. **Briefs are aspirations, not facts.** Always cross-check against the reality document.
4. **Update the reality document when you change code.** If you add, remove, or change a module, component, or tool, update the reality document in the same commit.
5. **Update the reality document when processing briefs.** Check whether features exist and add any missing items to the "DOES NOT EXIST" section.

---

## Project

**sgraph_ai_tools__static** — the canonical component library and tool platform for the SGraph ecosystem at [tools.sgraph.ai](https://tools.sgraph.ai).

Three tiers:
- **core/** — Pure JS modules (crypto, API client, LLM, video, SSH). No UI. Used by all SGraph projects.
- **components/** — Reusable UI elements (header, footer, upload-dropzone). JS + CSS.
- **tools/** — Standalone browser-based tools (video splitter, SSH keygen, LLM client). Compose core + components.

**Dependency direction:** send.sgraph.ai, vault.sgraph.ai, workspace, and Chrome extension all import FROM tools.sgraph.ai. This project is the source, everything else is a consumer.

---

## Stack

| Layer | Technology | Rule |
|-------|-----------|------|
| Language | Vanilla JavaScript (ES modules) | **No frameworks. No React, Vue, Angular.** |
| Module system | ES modules (`import`/`export`) | **No CommonJS, no require()** |
| Build step | None | **Every file deployable as-is** |
| Hosting | S3 + CloudFront (static) | CDN-served with versioned URLs |
| Encryption | Web Crypto API (AES-256-GCM) | Client-side only |
| Components | Optional Web Components | `class X extends HTMLElement` |
| Testing | Browser-based manual + CI smoke tests | No Node.js test runners required |

---

## Repo Structure

```
sgraph_ai_tools__static/
  .claude/
    CLAUDE.md                     # This file
    explorer/CLAUDE.md            # Explorer team session instructions
  core/                           # CORE LIBRARIES (pure JS, no UI)
    crypto/v1.0.0/sg-crypto.js
    ssh/v1.0.0/sg-ssh.js
    api-client/v1.0.0/sg-api-client.js
    llm-client/v1.0.0/sg-llm.js
    video/v1.0.0/sg-video.js
  components/                     # COMPONENTS (JS + CSS, reusable UI)
    header/v1.0.0/sg-header.js
    footer/v1.0.0/sg-footer.js
    upload-dropzone/v1.0.0/upload-dropzone.js
  tools/                          # TOOLS (standalone pages)
    index.html                    # Landing page / tool directory
    ssh-keygen/index.html
    video-splitter/index.html
    llm-client/index.html
  team/                           # Team structure
    explorer/
      architect/
      dev/
      designer/
      devops/
      librarian/reality/          # Reality document
      historian/
    humans/dinis_cruz/
      briefs/                     # READ-ONLY for agents
      debriefs/
      claude-code-web/
  briefs/
    BRIEF_PACK.md                 # Session bootstrap document
  library/                        # Reference materials
```

---

## Key Rules

### Coding Conventions

1. **Vanilla JS only.** No React, no Vue, no frameworks. Pure HTML + CSS + ES modules.
2. **ES modules.** All JS uses `import`/`export`. No CommonJS, no require().
3. **No build step.** Every file is deployable as-is. No webpack, no bundler, no transpiler.
4. **Named exports only.** No default exports (harder to tree-shake and document).
5. **JSDoc comments.** Every exported function has a JSDoc comment with parameter types and return type.
6. **File naming.** Lowercase, hyphens: `sg-crypto.js`, `upload-dropzone.js`.
7. **No localStorage** in core modules. Browser storage APIs are not supported in some contexts. Use in-memory state. Exception: tools that explicitly need persistence.
8. **Web components optional.** Components MAY use Custom Elements but this is not required.

### File Size & Incremental Building

**Keep files small — target under ~300 lines, hard ceiling ~500.** This rule exists for three reasons, in order of importance:

1. **Maintainability + refactoring.** Small, single-responsibility files are easier to read, move, version independently, and replace. A 200-line file with one job can be refactored in an afternoon; an 800-line file with five jobs becomes load-bearing and rots.
2. **Reviewability.** Small files produce small diffs that humans actually read. Large rewrites get rubber-stamped.
3. **Stream stability.** Long single-`Write` calls from agents can hit "Stream idle timeout" mid-file and have to be retried, wasting the whole emission. Small files avoid this entirely.

**How to keep files small:**

- **Split by concern, not by size.** Mirror the youtube-editor pattern: `api/{tool}-state.js` (mutable state), `api/{tool}-events.js` (frozen event-name constants), `api/{tool}-pipeline.js` (state ↔ core glue), `api/{tool}-api.js` (SgToolApi registration), and one `ui/ui-*.js` per panel/tab.
- **Build incrementally.** Land a minimal working version first (e.g. just the constructor + one method), then add features via small `Edit` patches. Don't try to ship a final 800-line file in one `Write` call.
- **Prefer `Edit` over `Write`.** Once a file exists, every change should be a targeted `Edit`. `Write` is for new files only.
- **Extract on the third repetition.** If the same shape appears in three files, lift it into a sibling helper. Two repetitions is fine — three earns a refactor.

If a file crosses ~500 lines, stop and split it before continuing. It is always cheaper to split early than to refactor a monolith later.

### Versioning

9. **Folder-based versioning.** Each module independently versioned: `core/crypto/v1.0.0/`, `core/crypto/v1.1.0/`.
10. **Pinned vs latest.** Production consumers pin to specific versions. Tools on tools.sgraph.ai use `latest`.
11. **Immutable versions.** Content at a pinned version URL never changes.

### Security

12. **Client-side only.** No server calls for processing. All computation happens in the browser.
13. **No data exfiltration.** Tools must not send user data anywhere.
14. **Secure context required.** Crypto operations require HTTPS or localhost.

### File Naming

15. **Version prefix** on all review/doc files: `{version}__description.md`

### Human Folders — Read-Only for Agents

16. **`team/humans/dinis_cruz/briefs/` is HUMAN-ONLY.** Agents must NEVER create, modify, or move files into this folder.
17. **Agent session outputs** go to `team/humans/dinis_cruz/claude-code-web/` or role review directories.

### Git

18. **Default branch:** `dev`
19. **Feature branches** branch from `dev`
20. **Branch naming:** `claude/{description}-{session-id}`
21. **Always push with:** `git push -u origin {branch-name}`
22. **NEVER push directly to `dev` or `main`.** Agents must only push to their designated feature branch. Merging into `dev` is a human action.

---

## Team Structure: Explorer Only (for now)

This project starts with a single **Explorer team** of 6 roles:

| Role | Responsibility |
|------|---------------|
| **Architect** | Module API design, dependency management, versioning strategy |
| **Dev** | Build tools, extract modules, write tests |
| **Designer** | Consistent tool UX, shared styling, landing page design |
| **DevOps** | CI/CD pipelines per module, S3 deployment, CloudFront config |
| **Librarian** | Maintain BRIEF_PACK.md, document module APIs, track what exists |
| **Historian** | Decision tracking, session history |

---

## Key Documents

| Document | Location |
|---|---|
| **Reality document (index)** | `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` (links to `…__1__libraries.md`, `…__2__tools.md`, `…__3__operations.md`) |
| **Master index** | `team/explorer/librarian/reviews/v0.1.68__master-index__spring-clean-v2.md` |
| **Briefing pack** | `team/humans/dinis_cruz/briefs/03/05/v0.1.0__initial_tools_repo__BRIEF_PACK.md` |
| **Architecture guide** | `library/architecture/v0.1.68__guide__three-tier-architecture.md` |
| **Component API** | `library/api/v0.1.68__reference__components.md` |
| **Core module API** | `library/api/v0.1.68__reference__core-modules.md` |
| **Role definitions** | `team/explorer/{role}/ROLE__{role}.md` |
