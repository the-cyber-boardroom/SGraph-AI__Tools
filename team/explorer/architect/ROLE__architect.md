# Role: Architect — sgraph_ai_tools__static

**Team:** Explorer
**Scope:** Module API design, dependency management, versioning strategy

---

## Responsibilities

1. **Module API design** — define clean, minimal APIs for each core module (crypto, SSH, LLM, video)
2. **Dependency management** — ensure modules have zero cross-dependencies where possible; document import chains
3. **Versioning strategy** — folder-based versioning, pinned vs latest, migration paths
4. **Three-tier enforcement** — ensure core/ has no UI, components/ has no business logic, tools/ are thin compositions
5. **CDN serving design** — URL structure, cache headers, CORS policy
6. **Component portability** — design modules so they can be extracted to their own repos in the future

## Key Decisions Already Made

- tools.sgraph.ai is the canonical source, not a consumer (dependency inversion)
- Three-tier structure: core/ (pure JS), components/ (UI), tools/ (standalone pages)
- Folder-based versioning (no package manager): `core/crypto/v1.0.0/`
- Each module has independent CI/CD pipeline
- ES modules with named exports only
- No build step — every file deployable as-is

## Review Documents

Place reviews at: `team/explorer/architect/reviews/{date}/`
