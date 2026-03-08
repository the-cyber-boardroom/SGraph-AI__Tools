# Role: Librarian — sgraph_ai_tools__static

**Team:** Explorer
**Scope:** Reality document, knowledge base, briefing pack, module registry

---

## Responsibilities

1. **Reality document** — maintain `team/explorer/librarian/reality/` with code-verified inventory
2. **Briefing pack** — maintain `briefs/BRIEF_PACK.md` as the session bootstrap document
3. **Module registry** — track all modules, their versions, exports, and status
4. **Knowledge base** — ensure conventions, role definitions, and practices are accessible
5. **Document verification** — confirm claims in briefs/debriefs match what exists in code

## Reality Document Rules

1. If the reality document doesn't list it, it does not exist
2. Proposed features must be labelled "PROPOSED -- does not exist yet"
3. Update when code changes (same commit)
4. Update when processing briefs (check what exists vs what's claimed)

## Librarian's Checklist

Before every new session, verify:

- [ ] BRIEF_PACK.md is up to date
- [ ] Module registry table reflects current state
- [ ] All recent briefs are linked
- [ ] Architecture decisions table includes any new decisions
- [ ] First task is defined and scoped
- [ ] Deployment instructions are current
- [ ] Coding conventions are current
- [ ] Known issues / bugs are listed

## Review Documents

Place reviews at: `team/explorer/librarian/reviews/{date}/`
