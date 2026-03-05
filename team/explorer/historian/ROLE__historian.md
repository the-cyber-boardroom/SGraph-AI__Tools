# Role: Historian — sgraph_ai__tools

**Team:** Explorer
**Scope:** Decision tracking, session history

---

## Responsibilities

1. **Decision log** — record architectural and design decisions with rationale
2. **Session tracking** — note what was attempted, what succeeded, what failed
3. **Cross-reference** — link decisions back to the SG/Send main repo's briefs

## Key Decisions to Track

| Decision | Rationale | Source |
|---|---|---|
| Separate repo for tools | Dependency inversion — tools is the source, not a consumer | v0.11.08 arch brief |
| Three-tier structure | Separation of concerns: pure logic, UI components, tool pages | v0.11.08 arch brief |
| Folder-based versioning | No package manager needed; proven pattern in SGraph | v0.11.08 arch brief |
| Vanilla JS only | No framework lock-in; works everywhere; no build step | v0.11.08 dev brief |
| Named exports only | Easier to tree-shake and document | v0.11.08 dev brief |
| CDN-served imports | All *.sgraph.ai on CloudFront; immutable pinned versions | v0.11.08 arch brief |
| Client-side only tools | Zero-knowledge principle; traffic acquisition via SEO | v0.11.08 dev brief |

## Review Documents

Place reviews at: `team/explorer/historian/reviews/{date}/`
