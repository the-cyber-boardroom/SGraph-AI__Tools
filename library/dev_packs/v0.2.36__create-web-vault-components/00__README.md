# Pack — Public-Vault Embed Components

**Pack ID:** `v0.22.17__pack__vault-embed-components`
**Date:** 26 April 2026
**For:** Sonnet implementer working in the `SGraph-AI__Tools` repo
**Outcome:** Eight new Web Components, three new generic content renderers, one new demo tool — all in the Tools repo, all extending `SgComponent`, all following IFD discipline.

---

## What this pack is

A complete handoff for one Sonnet session to build the public-vault embed component suite described in `04__brief__vault-embed-components.md`. Everything needed to start the work — the architectural rules, the design decisions already made, the brief itself, and the sibling brief that motivates one section of it — is in this folder.

Documents you do not need to bring in from outside (because they live in the repo already): the IFD discipline guides (`library/development/ifd/v1.2.1__ifd__intro-and-how-to-use.md` and `library/development/ifd/v1.3.0__ifd__surgical-overrides-version-stamped-filenames.md`), the repo's `.claude/CLAUDE.md`, and the librarian's reality document at `team/explorer/librarian/reality/v0.1.0__what-exists-today.md`. You will be referred to them at specific points by the brief.

---

## Reading order (this is mandatory — do not skip)

The brief in this pack uses cross-references like "per A.3", "per K.6", "per H.1". Those references resolve into the rule-book (`02__guidelines__sg-component-and-ifd.md`). If you read the brief before the rule-book, you will encounter dozens of dangling references and have to backtrack. Read in order:

```
1. 00__README.md                                 (this file — 5 min scan)

2. 01__brief__vault-backed-workflows.md          (10 min scan)
   The anchor doc. Establishes the architecture,
   the three vault patterns, the trust model.
   You're implementing Pattern 1.

3. 02__guidelines__sg-component-and-ifd.md       (read in full — ~1180 lines)
   The rule-book. Section A is anti-patterns
   (read carefully — Sonnet implementers have
   historically failed in specific ways listed
   there). Sections B through K are the rules.
   Sections L and M are op-driven architecture
   you can skim — they apply to the toolkit
   extraction work, not directly to this pack.

4. 03__architecture__sg-toolkit.md               (selectively — see below)
   The toolkit pack's spine. Read §1, §2.1, §2.2
   for context on how the codebase thinks about
   reusable components. You can skip the sg-timeline
   refactor sections (§3, §5, §6, §8) — those are
   not your work.

5. 04__brief__vault-embed-components.md          (this is your brief)
   Your spec. By the time you read this you should
   already know the names of every section it
   cross-references.

6. 05__brief__cli-surgical-write-commands.md     (only when you reach Task 8)
   Sibling brief. You will need it for §7.5 of
   your brief — the demo vault setup script uses
   sgit commands defined there.
```

---

## Before you write any code

After reading the docs above, **clone and explore the repo before starting Task 0.1**. The brief tells you to use existing infrastructure heavily — you cannot follow that instruction without seeing what's there.

Specifically, read these three files in full before starting:

```
core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js
   The crypto layer. Your Task 0.1 patch (v1.2.2) adds one
   function to it. Understand what's already there.

core/markdown/v1/v1.0/v1.0.0/sg-markdown.js
   The renderer your <sg-content-markdown> component will use.

components/key-input/v1/v1.0/v1.0.0/sg-key-input.js
   The smallest, cleanest example of a SgComponent in the
   codebase. Pattern reference for every component you write.
```

And browse (don't read in full, just scan):

```
components/base/v1/v1.0/v1.0.0/sg-component.js
   The base class. You'll extend it.

components/vault/sg-vault-connect/v0/v0.1/v0.1.3/sg-vault-connect.js
   An example of the existing editor stack. Useful for
   understanding what your embed stack is NOT. (Notice the
   data-vault-bus, the localStorage, the session — you don't
   want any of that.)

tools/v0/v0.1/v0.1.55/en-gb/linkedin-publisher/
   The closest existing tool to what your demo tool will
   look like. Pattern reference for §7 of your brief.
```

---

## The shape of the work

Eight components in the embed namespace, three renderers in the content namespace, one demo tool, plus one ten-line patch on the existing crypto module. The build order is in §8 of the brief — follow it strictly. Building components out of order will cause repeated rework when the trace component reveals events you forgot to emit.

Total expected scope: about 25–35 tasks of 30–60 minutes each. One commit per task. Branch name: `claude/vault-embed-components-{your-session-id}` per `.claude/CLAUDE.md`.

---

## When you get stuck

**Per K.2: stop and ask.** The brief is detailed but not complete. When something is ambiguous:

- Names ambiguous → §6 of the brief is the vocabulary. Don't paraphrase, don't translate. If a name isn't pinned, that's a gap — surface it as a question, don't guess.
- Behaviour ambiguous → check the rule-book first (sections A–K). If the rule-book doesn't resolve it, surface as a question.
- Existing-code ambiguous (something in the repo doesn't match what the brief assumes) → stop. The brief was written from a specific clone state. If reality has drifted, you cannot proceed safely. Surface immediately.

The cost of stopping to ask is one round-trip. The cost of guessing wrong and discovering it three tasks later is a rollback.

---

## Open questions you may hit

The brief lists eight open questions in §11. Three of them may block you:

- **OQ-1** — where `importReadKey()` lives (the brief assumes `core/vault-client v1.2.2`). Confirm with the architect before Task 0.1.
- **OQ-3** — demo vault credentials custody. You can't complete Task 8 without these. If unresolved, stop after Task 7 and surface.
- **OQ-8** — whether the existing markdown sanitization is sufficient for vault-sourced content. You'll evaluate this in Task 4.x. If you find gaps, file as a separate bug — DO NOT add a parallel sanitizer.

The other five (OQ-2, OQ-4, OQ-5, OQ-6, OQ-7) defer features to v0.1.1+. They don't block your work.

---

## When you're done

Per K.1: one task = one acceptance check = one commit. Per A.8: a task is "done" only when its referenced acceptance criterion in §10 of the brief is verifiable.

Final deliverables (the things that make the pack landed):
- All components ship with a passing test page at `tests/{namespace}/{component-name}/v0.1.0.test.html`
- The demo tool at `tools/v0/v0.1/v0.1.X/en-gb/vault-embed-demo/` loads on `https://tools.sgraph.ai/en-gb/vault-embed-demo/` and AC-D1 through AC-D6 all pass
- A debrief document at `team/humans/dinis_cruz/debriefs/{MM}/{DD}/v0.22.17__debrief__vault-embed-components.md` summarising what was built, what was open, what you'd recommend next.

Good luck.

---

*Pack assembled by Architect — 26 April 2026*
*For SGraph-AI__Tools — public-vault embed components*
