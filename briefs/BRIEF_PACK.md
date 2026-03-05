# BRIEF_PACK.md — sgraph_ai__tools Session Bootstrap

**Version:** v0.1.0
**Last updated:** 5 Mar 2026
**Maintained by:** Librarian

Read this document to bootstrap a new Claude Code session from zero to fully productive.

---

## 1. Project Overview

**tools.sgraph.ai** is the canonical component library for the entire SGraph ecosystem. It provides shared JavaScript modules, reusable UI components, and standalone browser-based tools.

The project is organised into three tiers:
- **`core/`** — Pure JavaScript modules with zero UI. Crypto, API client, LLM, video, SSH. These are the foundation that everything else builds on.
- **`components/`** — Reusable UI elements that combine core logic with visual representation. Header, footer, upload dropzone, file preview.
- **`tools/`** — Standalone single-page apps that compose core libraries and components into complete tools. Video splitter, SSH keygen, LLM client.

**Dependency direction:** All other SGraph projects (send.sgraph.ai, vault.sgraph.ai, workspace, Chrome extension) import shared JS FROM tools.sgraph.ai. This is a dependency inversion — tools is the source, everything else is a consumer.

```
tools.sgraph.ai  (THE canonical source)
  core/              <- Shared by everyone
  components/        <- Shared UI elements
  tools/             <- Standalone utilities

send.sgraph.ai     vault.sgraph.ai     workspace     chrome-extension
  imports from       imports from        imports from   imports from
  tools.sgraph.ai   tools.sgraph.ai     tools.sgraph.ai  tools.sgraph.ai
```

---

## 2. Architecture Decisions

| Decision | Rationale | Source | Date |
|---|---|---|---|
| tools.sgraph.ai is the canonical source, not a consumer | Eliminates duplication across projects | Canonical Component Library (v0.11.08) | 5 Mar |
| Three-tier structure: core, components, tools | Clean separation: pure logic, UI, standalone apps | Canonical Component Library (v0.11.08) | 5 Mar |
| Folder-based versioning with pinned and latest | No package manager; proven SGraph pattern | Canonical Component Library (v0.11.08) | 5 Mar |
| Each module has independent CI/CD pipeline | Changes to crypto don't rebuild video | Canonical Component Library (v0.11.08) | 5 Mar |
| Tools are compositions of core + components | Thin pages that wire modules together | Video Splitter brief (v0.11.08) | 5 Mar |
| Vanilla JS only, no frameworks | No lock-in; works everywhere; no build step | Video Splitter brief (v0.11.08) | 5 Mar |
| ES modules with named exports | Tree-shakeable, documented, standard | Briefing Pack brief (v0.11.08) | 5 Mar |
| Client-side only tools | Zero-knowledge principle; SEO traffic | Video Splitter brief (v0.11.08) | 5 Mar |
| CDN-served imports via CloudFront | Immutable pinned versions, fast global delivery | Canonical Component Library (v0.11.08) | 5 Mar |

---

## 3. Team Roles

| Role | Responsibility in this repo |
|---|---|
| **Architect** | Module API design, dependency management, versioning strategy |
| **Dev** | Build tools, extract modules, write tests, implement CI/CD |
| **Designer** | Consistent tool UX, shared styling, landing page design |
| **DevOps** | CI/CD pipelines per module, S3 deployment, CloudFront config |
| **Librarian** | Maintain BRIEF_PACK.md, document module APIs, track what exists |
| **Historian** | Decision tracking, session history |

Role definitions at: `team/explorer/{role}/ROLE__{role}.md`

---

## 4. Coding Conventions

- **Vanilla JS only.** No React, no Vue, no frameworks. Pure HTML + CSS + ES modules.
- **ES modules.** All JS uses `import`/`export`. No CommonJS, no require().
- **Web components optional.** Components MAY use Custom Elements (`class MyComponent extends HTMLElement`) but not required.
- **No build step.** Every file is deployable as-is. No webpack, no bundler, no transpiler.
- **File naming.** Lowercase, hyphens: `sg-crypto.js`, `upload-dropzone.js`.
- **Module exports.** Named functions/classes only. No default exports.
- **JSDoc comments.** Every exported function has a JSDoc comment with parameter types and return type.
- **No localStorage in core modules.** Use in-memory state. Exception: tools that explicitly need persistence (and document it).

---

## 5. Repo Structure

```
sgraph_ai__tools/
  .claude/
    CLAUDE.md                     # Main project guidance
    explorer/CLAUDE.md            # Explorer team session instructions
  core/                           # CORE LIBRARIES (pure JS, no UI)
    crypto/v1.0.0/sg-crypto.js      AES-256-GCM via Web Crypto API
    ssh/v1.0.0/sg-ssh.js            Ed25519/RSA SSH key generation
  components/                     # COMPONENTS (JS + CSS, reusable UI)
    header/v1.0.0/sg-header.js      Shared header
    footer/v1.0.0/sg-footer.js      Shared footer
  tools/                          # TOOLS (standalone pages)
    index.html                      Landing page / tool directory
    ssh-keygen/index.html           SSH Key Generator
    video-splitter/index.html       Video Splitter (PROPOSED)
  team/explorer/                  # Team structure (6 roles)
  briefs/BRIEF_PACK.md            # This file
```

---

## 6. Existing Modules and Tools

| Module | Location | Version | Key Exports | Status |
|---|---|---|---|---|
| `sg-crypto.js` | `core/crypto/v1.0.0/` | v1.0.0 | `generateKey()`, `exportKey()`, `importKey()`, `encryptFile()`, `decryptFile()`, `bufferToBase64Url()`, `base64UrlToBuffer()` | Extracted from send repo |
| `sg-ssh.js` | `core/ssh/v1.0.0/` | v1.0.0 | `generateSSHKeyPair()` | Built |
| `sg-header.js` | `components/header/v1.0.0/` | v1.0.0 | `SgHeader` (Web Component) | Built |
| `sg-footer.js` | `components/footer/v1.0.0/` | v1.0.0 | `SgFooter` (Web Component) | Built |

| Tool | Location | Status |
|---|---|---|
| Landing page | `tools/index.html` | Built |
| SSH Key Generator | `tools/ssh-keygen/index.html` | Built |
| Video Splitter | `tools/video-splitter/index.html` | PROPOSED |
| LLM Client | `tools/llm-client/index.html` | PROPOSED |

---

## 7. Current Briefs

**5 March (v0.11.08):**
- **Canonical Component Library** — dependency inversion architecture, three-tier structure, versioning, migration path, CDN serving
- **Video Splitter** — FFmpeg WASM browser tool specification, user flow, technical architecture
- **Briefing Pack** — session bootstrapping, knowledge transfer, BRIEF_PACK.md spec

**4 March (v0.11.1):**
- **HTML Workbench** — workspace where sg-llm.js was first used
- **JS Transformation Pipeline** — the code-behind pattern, plugin model
- **Chrome Extension** — will import modules from tools.sgraph.ai

---

## 8. First Task

**Task:** Set up the repo, deploy the infrastructure, and build the first tools.

**Steps:**
1. Create `sgraph_ai__tools` repo with the three-tier folder structure
2. Create `.claude/CLAUDE.md` and `.claude/explorer/CLAUDE.md`
3. Create `team/explorer/{role}/` directories with README.md + ROLE files
4. Create `briefs/BRIEF_PACK.md` with all 10 sections
5. Create initial reality document
6. Extract `crypto.js` from send repo as `core/crypto/v1.0.0/sg-crypto.js`
7. Create landing page at `tools/index.html`
8. Build SSH Key Generator tool at `tools/ssh-keygen/index.html`
9. Verify CDN import pattern works

**Definition of done:** Repo has the three-tier structure, team roles are set up, at least one core module extracted, at least one tool working, landing page live.

---

## 9. Deployment Instructions

### Local Development

```bash
# No dependencies to install -- vanilla JS and static files
cd sgraph_ai__tools

# Start a local server
python3 -m http.server 8080
# or
npx serve .

# Open in browser
open http://localhost:8080/tools/
```

### Adding a New Module

1. Create folder: `core/{module}/v1.0.0/sg-{module}.js`
2. Write ES module with named exports and JSDoc
3. Update `briefs/BRIEF_PACK.md` module registry table
4. Update reality document
5. Commit and push

### Adding a New Tool

1. Create folder: `tools/{tool-name}/`
2. Create `index.html` that imports from `core/` and `components/`
3. Add to the landing page (`tools/index.html`)
4. Update `briefs/BRIEF_PACK.md` tools table
5. Update reality document
6. Commit and push

### Deploying a New Module Version

1. Create new version folder: `core/{module}/v{new}/sg-{module}.js`
2. Update `core/{module}/latest/` to copy/redirect to new version
3. Old versions remain untouched (immutable)

### Cache Headers (S3/CloudFront)

- Pinned versions (`/core/crypto/v1.0.0/`): `Cache-Control: public, max-age=31536000, immutable`
- Latest (`/core/crypto/latest/`): `Cache-Control: public, max-age=300`

---

## 10. Bootstrap Script

```bash
# Clone the repo
git clone https://github.com/the-cyber-boardroom/SGraph-AI__Tools.git sgraph_ai__tools
cd sgraph_ai__tools

# No dependencies to install -- it's all vanilla JS and static files

# Start a local server for testing
python3 -m http.server 8080
# or
npx serve .

# Open in browser
open http://localhost:8080/tools/

# Verify a module imports correctly
# In browser console:
# import { generateKey } from '/core/crypto/v1.0.0/sg-crypto.js';
# const key = await generateKey();
# console.log(key);
```

---

## Session Bootstrap Flow

```
1. Create new Claude Code session
2. Point it at the sgraph_ai__tools repo
3. First message: "Read briefs/BRIEF_PACK.md and set up the team"
4. Session reads the briefing pack
5. Session understands: roles, conventions, architecture, what exists, what to build
6. Session begins working on the defined first task
7. At end of session: session updates BRIEF_PACK.md with new decisions, new modules, new learnings
```

Step 7 is critical. Every session must contribute back to the briefing pack.
