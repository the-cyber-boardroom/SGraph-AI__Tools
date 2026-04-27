# Vault-Backed Workflows — Website Content, Agent Comms, Human Handoff

**Version:** v0.22.17 | **Date:** 26 April 2026
**Audience:** All teams — CLI, API, Tools/Components, Website, Claude Code
**Status:** ARCHITECTURE BRIEF — anchor document for vault-based workflows
**Related:** `team/roles/architect/reviews/04/26/v0.22.17__architect-review__structure-key-encryption-split.md`

---

## 1. The Core Principle

Everything that appears on `sgraph.ai` is either:

1. **A static file in the repo** — deployed by CI, versioned in git, traceable, audited via git history.
2. **An encrypted vault blob** — fetched at runtime by the browser from `send.sgraph.ai`, decrypted client-side.

There is no server-side rendering. There is no agent running at request time. All runtime intelligence is the browser executing static JavaScript that loads and decrypts vault blobs.

**All website content changes require a git commit.** This is the design, not a limitation. It provides traceability, rollback, and the CI pipeline as the sole path to production.

The website is the *first* and most concrete application of the vault pattern, but it is not the only one. The same machinery — encrypted blobs, content-addressed IDs, sparse clones, surgical writes — also serves agent-to-agent communication and human-to-agent handoff. This document is the anchor for all three.

---

## 2. Why Vaults Are the Universal Substrate

A vault is an encrypted, content-addressed, versioned, sparse-cloneable store. Four properties, each load-bearing:

- **Encrypted at rest.** Server holds ciphertext only. The `read_key` and `write_key` never leave the client. Server stores `SHA-256(write_key)` in `manifest.json` purely for comparison.
- **Content-addressed.** Every blob's ID (`obj-cas-imm-*`) is `SHA-256` of its ciphertext. Same content → same ID. Different content → different ID. Immutable by construction.
- **Versioned.** Every change creates a new commit. Old blobs are kept forever. `sgit log` shows the full history. Rollback is "point at an older blob ID."
- **Sparse-cloneable.** Clone the structure (refs, commits, trees) without downloading any blobs. Cost is proportional to history size, not blob size. An 8GB vault has the same sparse clone cost as an 8KB one.

These four properties combine into a substrate that's useful for any "things that need to be encrypted, versioned, and shared between parties" use case — whether the parties are humans, agents, or browsers.

---

## 3. The Three Audiences

```
                       ┌───────────────┐
                       │     Vault     │
                       │  (encrypted,  │
                       │   versioned)  │
                       └───┬───┬───┬───┘
                read       │   │   │       read+write
            ┌──────────────┘   │   └──────────────┐
            │                  │                  │
        ┌───▼────┐         ┌───▼────┐         ┌───▼────┐
        │ Browser│         │ Human  │         │ Agent  │
        └────────┘         └────────┘         └────────┘
        renders content    sets up vaults     runs sgit
        on sgraph.ai       reads debriefs     reads/writes
        (read_key only,    shares keys with   blobs, updates
         in page source)   agents             instructions
```

Each audience has different access patterns, different security needs, and different tooling, but they all share the same vault primitives.

| Audience | Access mode | Tooling | Key handling |
|----------|-------------|---------|--------------|
| **Browser** | Read-only, public content only | Web Crypto API + Web Components | `read_key` embedded in static manifest |
| **Agent** | Read + write, any vault | `sgit` CLI | `vault_key` from env var or credential store |
| **Human** | Read + write, any vault | `sgit` CLI or web vault browser | `vault_key` from password manager |

---

## 4. Vault Types

Vaults are mechanically identical but used for two distinct purposes. The two are never mixed in the same vault.

```
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│  TYPE A: Content Vault           │  │  TYPE B: Comms Vault             │
│  (tied to sgraph.ai)             │  │  (agent-to-agent / human-agent)  │
├──────────────────────────────────┤  ├──────────────────────────────────┤
│                                  │  │                                  │
│  Purpose:                        │  │  Purpose:                        │
│    Public website content        │  │    Briefs, debriefs, SKILL.md,   │
│                                  │  │    handoffs, review outputs      │
│                                  │  │                                  │
│  read_key:                       │  │  read_key:                       │
│    Public — in static manifest   │  │    Private — never in repo,      │
│    (content IS public)           │  │    never in page source          │
│                                  │  │                                  │
│  write_key:                      │  │  write_key:                      │
│    Agent's env var only          │  │    Shared between collaborators  │
│    Never in repo                 │  │    out-of-band                   │
│                                  │  │                                  │
│  Structure:                      │  │  Structure:                      │
│    instructions/  (control)      │  │    briefs/                       │
│    content/       (data)         │  │    debriefs/                     │
│                                  │  │    skills/                       │
│  May be:                         │  │                                  │
│    GBs of images and videos      │  │  Typically:                      │
│    — never fully cloned          │  │    Small text/markdown files     │
│                                  │  │                                  │
│  Cardinality:                    │  │  Cardinality:                    │
│    One per website / domain      │  │    Many — one per collaboration  │
│                                  │  │                                  │
└──────────────────────────────────┘  └──────────────────────────────────┘
```

**The boundary is enforced by key handling, not code.** A vault becomes "Type A" when its `read_key` is published in a static manifest. A vault becomes "Type B" by never having that done to it. The CLI doesn't know or care which type a vault is.

---

## 5. Vault Key Security Rules

Apply to all patterns. Non-negotiable.

```
  ✗ NEVER commit vault keys to git
  ✗ NEVER put any write_key anywhere it can be read by the public
    (page source, static manifests, public CDN, public repos)
  ✗ NEVER paste vault keys into Claude conversations as user messages
    (they are retained in conversation logs)

  ✓ Pass vault keys via environment variables
    (SGIT_VAULT_KEY, SG_SEND_PASSPHRASE) set by the session orchestrator
  ✓ Use the sgit credential store with a passphrase
    (sgit vault add <alias>)
  ✓ Share vault keys out-of-band — direct chat, password manager,
    voice, encrypted email
  ✓ read_key in a static repo manifest is acceptable ONLY for Type A
    vaults where the content IS intentionally public

  Server-side reality:
    The server stores SHA-256(write_key) only. Raw keys never persist.
    Read endpoints require no auth — ciphertext is safe to serve openly.
    CORS is "*" on read endpoints by design.
```

---

## 6. Pattern 1 — Website Content Updates

The primary application. Drives most of the surface area discussed in this document.

### 6.1 The Data Model: `instructions/` vs `content/`

A content vault has exactly two top-level folders, with opposite caching properties:

```
content-vault/
├── instructions/                        ← CONTROL PLANE
│   ├── home.json                          tiny JSON (~1KB)
│   ├── pricing.json                       changes often
│   └── security.json                      updated on every content swap
│
└── content/                             ← DATA PLANE
    ├── hero/                              any size (KB to GB)
    │   ├── hero-v1.md                     immutable per blob
    │   └── hero-v2.md                     old versions kept forever
    ├── use-cases/
    │   ├── use-cases.json
    │   └── screenshots/
    │       ├── uc-01.png
    │       └── uc-02.png
    └── photos/                            (may be GBs — never fully cloned)
```

**The opposite-caching property is load-bearing**, not incidental:

| | `instructions/` | `content/` |
|---|---|---|
| Size | Tiny (KB) | Any (KB → GB) |
| Churn | High | Zero (immutable per blob) |
| Caching | Short TTL | `Cache-Control: immutable, max-age=31536000` |
| Read by | Agents (frequent) and the static manifest builder | Browsers (on demand, via blob ID) |

Because content blobs are content-addressed and immutable, CloudFront can cache them forever — no invalidation ever needed for the content layer. Because `instructions/` files change frequently, they're served with short TTLs. The two caches never conflict.

### 6.2 The Full Update Workflow

```
╔════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║  CLAUDE CODE AGENT  ┃  CONTENT VAULT  ┃    REPO + CI    ┃    BROWSER    ║
║                     ┃                  ┃                 ┃                ║
║  ┌───────────────┐  ┃                  ┃                 ┃                ║
║  │ 1. Sparse     │──┃─► clone struct.  ┃                 ┃                ║
║  │    clone      │  ┃   (~200KB,       ┃                 ┃                ║
║  │               │  ┃    no blobs)     ┃                 ┃                ║
║  └───────┬───────┘  ┃                  ┃                 ┃                ║
║          │          ┃                  ┃                 ┃                ║
║  ┌───────▼───────┐  ┃                  ┃                 ┃                ║
║  │ 2. Read       │◄─┃── instructions/  ┃                 ┃                ║
║  │    current    │  ┃   home.json      ┃                 ┃                ║
║  │    state      │  ┃                  ┃                 ┃                ║
║  └───────┬───────┘  ┃                  ┃                 ┃                ║
║          │          ┃                  ┃                 ┃                ║
║  ┌───────▼───────┐  ┃                  ┃                 ┃                ║
║  │ 3. Write new  │──┃─► content/       ┃                 ┃                ║
║  │    content    │  ┃   hero-v2.md     ┃                 ┃                ║
║  │               │◄─┃── obj-cas-imm-X  ┃                 ┃                ║
║  └───────┬───────┘  ┃                  ┃                 ┃                ║
║          │          ┃                  ┃                 ┃                ║
║  ┌───────▼───────┐  ┃                  ┃                 ┃                ║
║  │ 4. Update     │──┃─► instructions/  ┃                 ┃                ║
║  │    instr. +   │  ┃   home.json      ┃                 ┃                ║
║  │    push       │  ┃   (now points    ┃                 ┃                ║
║  │               │  ┃    at obj-X)     ┃                 ┃                ║
║  └───────┬───────┘  ┃                  ┃                 ┃                ║
║          │          ┃                  ┃                 ┃                ║
║  ┌───────▼───────┐  ┃                  ┃                 ┃                ║
║  │ 5. Edit repo  │──┃──────────────────┃─► PR branch     ┃                ║
║  │    manifest,  │  ┃                  ┃   with one-     ┃                ║
║  │    open PR    │  ┃                  ┃   line diff:    ┃                ║
║  │               │  ┃                  ┃   .object_id    ┃                ║
║  └───────────────┘  ┃                  ┃   = obj-X       ┃                ║
║                     ┃                  ┃                 ┃                ║
║                     ┃                  ┃   PR review →   ┃                ║
║                     ┃                  ┃   merge to dev  ┃                ║
║                     ┃                  ┃                 ┃                ║
║                     ┃                  ┃   ▼             ┃                ║
║                     ┃                  ┃   CI: deploy    ┃                ║
║                     ┃                  ┃   to S3 +       ┃                ║
║                     ┃                  ┃   CloudFront    ┃                ║
║                     ┃                  ┃                 ┃                ║
║                     ┃                  ┃                 ┃   loads HTML   ║
║                     ┃                  ┃                 ┃   loads        ║
║                     ┃                  ┃                 ┃   home.json    ║
║                     ┃                  ┃                 ┃        │       ║
║                     ┃                  ┃                 ┃        ▼       ║
║                     ┃                  ┃                 ┃   GET obj-X    ║
║                     ┃                  ┃                 ┃   (CloudFront  ║
║                     ┃◄─────────────────┃─────────────────┃    cached)    ║
║                     ┃                  ┃                 ┃        │       ║
║                     ┃                  ┃                 ┃        ▼       ║
║                     ┃                  ┃                 ┃   AES-GCM      ║
║                     ┃                  ┃                 ┃   decrypt      ║
║                     ┃                  ┃                 ┃   render md    ║
║                                                                          ║
╚════════════════════════════════════════════════════════════════════════╝
```

The agent's commands, end to end:

```bash
# 1. Sparse clone — structure only, no blobs
sgit clone --sparse "$SGIT_VAULT_KEY" ./content-vault

# 2. Read current instructions
sgit read instructions/home.json ./content-vault
# → { "slots": { "hero": { "object_id": "obj-cas-imm-old" } } }

# 3. Write new content, capture the new blob ID
NEW_ID=$(echo "# New hero copy" | \
  sgit write content/hero/hero-v2.md ./content-vault)
# → NEW_ID = obj-cas-imm-xyz999

# 4. Update vault instructions, push
sgit read instructions/home.json ./content-vault | \
  jq ".slots.hero.object_id = \"$NEW_ID\"" | \
  sgit write instructions/home.json ./content-vault
sgit push ./content-vault

# 5. Update repo manifest, open PR
cd /repo
jq ".slots.hero.object_id = \"$NEW_ID\"" \
   sgraph_ai__website/_common/manifests/home.json > /tmp/m.json
mv /tmp/m.json sgraph_ai__website/_common/manifests/home.json

git checkout -b content/hero-update-$(date +%s)
git commit -am "content: update hero copy [$NEW_ID]"
git push -u origin "$(git branch --show-current)"
gh pr create --base dev --fill
```

### 6.3 Why Both Vault and Repo?

This is the key design decision. Two questions answered:

**Why does the vault change AND the repo change?**

```
  The vault change (sgit write + push):
  ✓ Creates the immutable content blob (obj-cas-imm-*)
  ✓ Updates instructions so agents reading the vault see current state
  ✓ Provides vault-level version history (sgit log)
  ✓ Enables agent-to-agent coordination via the vault
  ✗ Does NOT make content live on sgraph.ai

  The repo change (git commit + CI):
  ✓ Makes content live on sgraph.ai (CI is the production gate)
  ✓ Provides git-level traceability with author and review trail
  ✓ Enables PR review before content goes live
  ✓ Enables rollback via git revert
  ✗ Does NOT store content (only the object ID)
```

**Why update instructions in the vault AND the manifest in the repo?**

```
  Vault instructions/home.json:
  → For agents reading from the vault
  → Answers: "What is the current state of the content vault?"
  → Decoupled from website deploys

  Repo sgraph_ai__website/_common/manifests/home.json:
  → For the browser loading the website
  → Answers: "What should sgraph.ai display right now?"
  → Gated by CI — deliberately controlled
```

The two are intentionally separate. The vault is the source of truth for *what content exists*. The repo manifest is the source of truth for *what is live*. They can be the same in steady state and different during a content update in flight.

### 6.4 Trust Model: How Agents Commit to the Repo

**Decision: feature branch + PR, never direct push to `dev`.**

Even when the agent is the only actor and there is no human reviewer, the PR mechanism is preserved because:

- Every content change has a PR record with a diff, reviewable later.
- Branch protection rules can require CI green before merge.
- A second agent (or human) can be added as required reviewer if the team chooses.
- The audit trail is uniform: every content change looks like every other code change.

The PR may be auto-merged after CI passes — that is a workflow choice, not an architectural one. The architectural commitment is that the agent never writes directly to `dev`.

**Consequence:** The agent's role at step 5 of the workflow is the role of any contributor. Branch protection, CODEOWNERS, required reviews — whatever rules apply to humans apply to agents identically. There is no special "agent path" that bypasses repo controls.

### 6.5 Rollback

Two independent rollback mechanisms:

```
  Content rollback (what sgraph.ai shows):
  ─────────────────────────────────────────────
  git revert <merge-commit>     reverts the manifest change
  git push origin dev            CI redeploys old home.json
  → hero slot points back at previous obj-cas-imm-* ID
  → old blob is still on send.sgraph.ai (never deleted)
  → live within the manifest cache TTL (1 day) or immediately
    after a CloudFront invalidation
  → no new content needs to be created — pointer flip only

  Vault rollback (agent-readable state):
  ─────────────────────────────────────────────
  sgit revert ./vault            reverts vault to previous commit
  sgit push ./vault              server state updated
  → instructions/home.json points back at previous blob
  → useful when an agent needs the vault to reflect what is
    currently live on the website
```

**Property worth naming:** Rollback is free, atomic, and requires no new content. This falls out of immutability + indirection. It is a real product property.

### 6.6 Network Cost

The single most persuasive characteristic of this architecture. Worked example:

```
  Vault: 500 files, 8GB total (mostly images and videos)
  Task:  update one markdown file and the instructions JSON

  ┌────────────────────────────────────────────┬───────────────┐
  │  Operation                                 │  Network cost │
  ├────────────────────────────────────────────┼───────────────┤
  │  sgit clone --sparse  (structure only)     │       ~200 KB │
  │  sgit read instructions/home.json          │         ~2 KB │
  │  sgit write content/hero-v2.md  (local)    │             0 │
  │  sgit write instructions/home.json (local) │             0 │
  │  sgit push  (2 blobs + commit + ref)       │         ~5 KB │
  │  git commit + push  (1-line manifest diff) │         ~1 KB │
  │  CI S3 sync  (one file changed)            │         ~1 KB │
  ├────────────────────────────────────────────┼───────────────┤
  │  TOTAL                                     │       ~209 KB │
  ├────────────────────────────────────────────┼───────────────┤
  │  vs. full clone of the same vault          │           8 GB│
  └────────────────────────────────────────────┴───────────────┘
```

The 8GB of existing photos and videos are never touched. They stay encrypted on the server, content-addressed, immutably cached.

---

## 7. Pattern 2 — Agent-to-Agent Comms

Comms vaults carry briefs, debriefs, SKILL files, handoff documents, and review outputs between collaborating agents. They are mechanically identical to content vaults but used differently.

```
  ┌─────────────┐                                  ┌─────────────┐
  │  Agent A    │                                  │  Agent B    │
  │  (writer)   │                                  │  (reader)   │
  └──────┬──────┘                                  └──────┬──────┘
         │                                                │
         │ sgit clone --sparse                            │ sgit pull
         │ sgit write briefs/...                          │ sgit cat briefs/...
         │ sgit push                                      │ sgit write responses/...
         │                                                │ sgit push
         │            ┌───────────────────────┐           │
         └───────────►│   Comms Vault         │◄──────────┘
                      │                       │
                      │   briefs/             │
                      │   ├── 2026-04-26/     │
                      │   │   └── brief-01.md │
                      │   └── ...             │
                      │   responses/          │
                      │   ├── 2026-04-26/     │
                      │   │   └── resp-01.md  │
                      │   └── ...             │
                      └───────────────────────┘

           Vault key shared out-of-band between A and B.
           NEVER in any repo. NEVER in any page source.
```

### Worked Example: Brief and Response

```bash
# Agent A — writes a brief for Agent B
sgit clone --sparse "$COMMS_VAULT_KEY" ./comms-vault
echo "Please review the structure key encryption split design..." | \
  sgit write briefs/2026-04-26/structure-key-review.md ./comms-vault
sgit push ./comms-vault

# (Out-of-band: Agent A tells Agent B "vault is ready")

# Agent B — reads, processes, responds
sgit clone --sparse "$COMMS_VAULT_KEY" ./comms-vault
sgit ls briefs/2026-04-26/ ./comms-vault --ids
sgit read briefs/2026-04-26/structure-key-review.md ./comms-vault
# (Agent B does the work)
echo "Review complete. Three issues found..." | \
  sgit write responses/2026-04-26/structure-key-review.md ./comms-vault
sgit push ./comms-vault
```

### Why Comms Vaults Are Not the Website

The same mechanism, but a different security profile:

- The `read_key` is private. Never goes in any repo.
- The `write_key` is shared between collaborators only. Never embedded anywhere.
- The vault is not referenced by sgraph.ai or any other website.
- Vault keys travel out-of-band: direct chat, env var injection, password manager.

A content vault and a comms vault running on the same `send.sgraph.ai` server are indistinguishable to the server. The server sees opaque vault IDs and ciphertext blobs. The distinction lives entirely in how the keys are handled.

---

## 8. Pattern 3 — Human-to-Agent Handoff

The bootstrap pattern. A human prepares context for an agent, hands it over via a vault, and the agent reads its own instructions before starting work.

```
                                   ┌──────────────────┐
                                   │  Handoff Vault   │
   ┌────────┐    sgit push         │                  │   sgit clone   ┌────────┐
   │        ├─────────────────────►│  briefs/         │◄───────────────┤        │
   │ Human  │                      │  ├── overview.md │                │ Agent  │
   │        │                      │  └── tasks/      │                │        │
   │        │◄─────────────────────┤  skills/         ├───────────────►│        │
   │        │       sgit pull      │  ├── ROLE.md     │  sgit write    │        │
   └────────┘                      │  └── playbook.md │                └────────┘
                                   │  debriefs/       │
                                   │  └── (agent      │
                                   │       writes     │
                                   │       here)      │
                                   └──────────────────┘
```

### The Bootstrap Flow

```
  1. Human creates a handoff vault.
       sgit init ./handoff
       sgit write skills/ROLE.md ./handoff < role-definition.md
       sgit write briefs/overview.md ./handoff < what-to-do.md
       sgit push ./handoff

  2. Human shares the vault key out-of-band with the agent.
       (Pasted into Claude Code session env, or into a credential store.)

  3. Agent's first action in any session:
       sgit clone --sparse "$HANDOFF_VAULT_KEY" ./context
       sgit read skills/ROLE.md ./context
       sgit read briefs/overview.md ./context
       (Agent now operates with zero ambiguity about its task.)

  4. Agent writes deliverables back to the same vault.
       sgit write debriefs/2026-04-26/session-output.md ./context
       sgit push ./context

  5. Human pulls the vault to read the agent's output.
       sgit pull ./handoff
       sgit cat debriefs/2026-04-26/session-output.md ./handoff
```

This is the same pattern as Pattern 2 (agent-to-agent), but with one of the participants being human. The vault becomes a long-running, version-controlled, encrypted message bus.

### Why This Matters Architecturally

Three properties fall out:

- **Session continuity.** An agent in session N+1 can read every debrief from sessions 1..N and know what was done. Memory without server-side state.
- **Skill distribution.** A `SKILL.md` in a vault is loadable by any agent that has the key. Skills can evolve without redeploying agent infrastructure.
- **Auditability.** Every byte the human gave the agent and every byte the agent gave back is in `sgit log`. The full collaboration history is encrypted, versioned, and reviewable.

---

## 9. The CLI Primitives All Three Patterns Share

All three patterns use the same five `sgit` operations. Full specification in the CLI brief.

| Command | Purpose | Network cost |
|---------|---------|--------------|
| `sgit clone --sparse <key> <dir>` | Pull structure only (refs, commits, trees) | ~KB regardless of vault size |
| `sgit read <path> <dir>` | Decrypt and print one blob | One blob fetch |
| `sgit read <path> <dir> --id` | Print the blob ID without fetching content | Zero |
| `sgit write <path> <dir>` | Encrypt stdin, store, commit, print blob ID | Zero (local) |
| `sgit ls <dir> --ids` | List files with their blob IDs | Zero |
| `sgit push <dir>` | Upload new commits, blobs, refs | Only what's new |

**Reference brief:** `team/comms/briefs/04/26/v0.22.17__dev-brief__cli-surgical-write-commands.md`

---

## 10. The Web Component Primitives Pattern 1 Needs

Only Pattern 1 (website content) uses Web Components. Patterns 2 and 3 are CLI-only.

| Component | Purpose |
|-----------|---------|
| `sg-vault-manifest` | Loads `home.json`, emits `manifest-slot-ready` events for each slot |
| `sg-vault-key` | Holds vault credentials, derives `CryptoKey` once, emits `vault-key-ready` |
| `sg-vault-fetch` | Fetches one blob by ID, decrypts, emits `vault-content-ready` |
| `sg-vault-content` | One-line wrapper combining the three above plus a renderer |
| `sg-vault-trace` | Inspects all of the above — for documentation pages and demos |
| `sg-content-markdown` | Renders decrypted markdown |
| `sg-content-image` | Renders decrypted image bytes |
| `sg-content-video` | Renders decrypted video bytes |
| `sg-content-json` | Parses or renders decrypted JSON |
| `sg-content-html` | Renders decrypted HTML in a sandboxed shadow root |

**Renderer independence is a contract-level requirement.** Renderers receive only `{ bytes, contentType, text }` events. They have zero knowledge of vaults. Any renderer must work without `sg-vault-fetch` ever existing — content can come from any source.

**Reference brief:** *Forthcoming — Tools team, vault content components.*

---

## 11. Full Architecture Diagram

```
╔════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║                          send.sgraph.ai                                  ║
║              (encrypted blob store — opaque to server)                   ║
║                                                                          ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        ║
║   │ Content Vault   │  │  Comms Vault    │  │  Handoff Vault  │        ║
║   │   (Type A)      │  │    (Type B)     │  │    (Type B)     │        ║
║   │  abc123         │  │  def456         │  │  ghi789         │        ║
║   └────────┬────────┘  └────────┬────────┘  └────────┬────────┘        ║
║            │                    │                    │                  ║
╚════════════│════════════════════│════════════════════│══════════════════╝
             │                    │                    │
             │ read+write         │ read+write         │ read+write
             │ (write_key in      │ (key shared        │ (key shared
             │  agent's env)      │  out-of-band)      │  out-of-band)
             │                    │                    │
   ┌─────────▼────────────────────▼────────────────────▼─────────┐
   │                   Claude Code Agent                          │
   │                   (sgit CLI via bash_tool)                   │
   │                                                              │
   │   sgit clone --sparse / read / write / ls --ids / push       │
   └─────────┬────────────────────────────────────────────────────┘
             │
             │ git commit + push  (Type A only — Pattern 1)
             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                 github.com/SGraph-AI__App__Send              │
   │                                                              │
   │   sgraph_ai__website/                                        │
   │   ├── _common/manifests/home.json   ← static, in git        │
   │   ├── en-gb/index.html              ← static, in git        │
   │   └── ...                                                    │
   │                                                              │
   │   PR → review → merge to dev → CI                            │
   └─────────┬────────────────────────────────────────────────────┘
             │
             │ deploy_static_site.py
             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            S3 + CloudFront  (static files)                   │
   │                                                              │
   │   home.json:    Cache-Control: max-age=86400  (1 day)        │
   │   index.html:   Cache-Control: max-age=300    (5 min)        │
   └─────────┬────────────────────────────────────────────────────┘
             │
             │ fetch on page load
             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                    Browser (visitor)                         │
   │                                                              │
   │   index.html                                                 │
   │     <sg-vault-manifest src="/_common/manifests/home.json">  │
   │       fetches home.json  →  reads slot.object_id             │
   │                                                              │
   │     <sg-vault-fetch object-id="obj-cas-imm-xyz">             │
   │       GET send.sgraph.ai/api/vault/read/abc123/obj-cas-...  │
   │       (no auth, CORS *, immutable cache)                     │
   │                              │                               │
   │                              ▼                               │
   │       AES-256-GCM decrypt(read_key, ciphertext)              │
   │       (read_key from manifest — public for Type A vaults)    │
   │                              │                               │
   │                              ▼                               │
   │     <sg-content-markdown>                                    │
   │       renders plaintext into the page                        │
   └──────────────────────────────────────────────────────────────┘
```

The diagram is one diagram on purpose. It replaces the two overlapping system views in the previous version of this brief, and it makes the symmetry across the three vault types visible: the storage layer is identical, the access layer is identical, the divergence happens only at the trust-and-deployment boundary.

---

## 12. Derived Briefs

| Brief | Target team | Path |
|-------|-------------|------|
| CLI surgical write commands | CLI Team | `team/comms/briefs/04/26/v0.22.17__dev-brief__cli-surgical-write-commands.md` |
| Vault content components | Tools Team | *(forthcoming)* |
| Website integration (`manifest-slot` on existing components) | Website Team | *(forthcoming)* |
| Structure key encryption split | CLI + Vault Web | `team/roles/architect/reviews/04/26/v0.22.17__architect-review__structure-key-encryption-split.md` |

---

*Explorer Team — Architect*
*Anchor document for vault-backed workflows*
*Version: v0.22.17 | Date: 26 April 2026*
