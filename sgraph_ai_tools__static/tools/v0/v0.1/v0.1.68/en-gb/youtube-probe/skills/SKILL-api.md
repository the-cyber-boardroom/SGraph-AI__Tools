# YouTube Probe — API Spec

`window.__tool` after `tool:ready`. All actions return Promises. The manifest `api`
section is authoritative; this file adds semantics.

## A probe suite, not a pass/fail suite

A normal test asserts known-correct behaviour. Most of these ask a question nobody
has answered — *will* the API return an ASR track, *does* talk footage need a
mask. So a result carries a `status` **and** its `evidence`, and `info` is a
first-class outcome.

| Status | Means |
|---|---|
| `pass` | The hypothesis held, with numbers |
| `fail` | It did not — often the more useful result |
| `info` | A fact was recorded; there was no right answer to have |
| `blocked` | Could not run (no token, no gesture, no browser support) |

Every test carries a `meaning` map keyed by status, so a result says what it
changes about the plan. `runTest` never throws.

## The three routes this page exists to test

| Route | Works for | Probed by |
|---|---|---|
| **A** Studio download → `importVideo()` | your own videos | already shipped — nothing to probe |
| **B** captions over the API | **your own only** — owner-scoped | M1–M4 |
| **C** tab capture | **anything you can watch** | M8 |

M5–M7 establish the boundary: what the API refuses for a video you do not own, and
whether the unofficial `timedtext` endpoint is reachable from a page. For
third-party videos **route C is the only path**, which is why M8 carries a star.

## The offline battery (A1–A7)

No token, no network, no gesture. Safe in CI.

- **A1/A2** — caption parsing and cue grouping. Ordinary correctness; these should
  be green. `parseCaptions` reports `dropped`, because a parser that silently
  returns fewer cues than the file contains is the same defect class as a
  measurement that looks like a measurement and is not.
- **A3/A4** — the pair Decision 3 stands on. The **same recorded clip**, analysed
  once whole-frame and once cropped to the slide region, sampled at identical
  instants (one seek serves both traces — otherwise the comparison measures the
  sampler rather than the mask). Read `evidence.masked` against
  `evidence.unmasked`: `matched`, `missed`, `spurious` against known ground truth.
  **An A3 pass falsifies Decision 3**, and that is a good outcome.
- **A5** — can the region be found automatically? Scored as IoU against the
  rectangle the fixture actually drew.
- **A6** — intercut footage, where no fixed rectangle can work. A pass means the
  condition is *detectable*, so the tool can refuse rather than emit a scene list
  built on camera cuts.
- **A7** — corpus cost from the measured `COST_BASIS`. Always `info`.

### The fixture

`yp-synth.js` records a talk-shaped clip in-page, carrying the traps this project
has already been caught by:

| Trap | What hid it | Fixture answer |
|---|---|---|
| Absolute silence threshold | digital silence | room tone at 0.05, above the old 0.01 |
| Greyscale-only signature | equal-luma palette | slides differ in hue, not just brightness |
| **A still speaker** | *would hide the need for a mask* | the speaker moves **every frame** |

That third row is the whole reason the fixture exists. A "talk" whose only motion
is the slide changing is a screencast with a picture of a person on it, and
masking would test as unnecessary for the wrong reason.

Layouts: `side` (speaker beside slides), `pip` (slides full, speaker inset), `cut`
(camera alternates — the case a fixed mask cannot save, by construction).

## Masking needs no core change

`signatureFrom()` takes pixels and `drawImage` already accepts a source rectangle,
so masking is cropping before the draw. `diff`, `otsuSplit`, `findScenes` and
`plan` are untouched because none of them ever sees pixels. **If the measurement
says masking helps, then it earns a place in core** — not before.

## The manual battery (M1–M8)

`setToken({token})` for a pasted token, or `signIn({clientId})` for the GIS flow
via `core/youtube-upload`'s `requestAccess` — the same helper `youtube-editor`
ships. **No action ever returns a token**, only `{ present }`.

`captions.download` needs `youtube.force-ssl`, wider than `youtube.readonly`, so
**M1 comes first**: half of "captions.download does not work" is a token that was
never granted the scope, and knowing the scopes beforehand turns an ambiguous 403
into a clear one.

**M4 is the question the pack hinges on.** A refusal is reported as
`asr-download-refused` with its HTTP status and the API's own reason — deliberately
distinct from `no-captions`, because a track that exists and will not be handed
over is a different fact from no track at all, and they lead to different tools.

**M7 probes `timedtext` head-on** even though it is expected to fail. "We assumed
it was blocked" and "we watched it be blocked" are different standards of
evidence, and this pack has been wrong by reasoning before. A CORS refusal appears
as a TypeError with no status; that is recorded as-is rather than dressed up.

**M8** checks the track count *and* real audio energy. A stream carrying an audio
track of pure digital silence would pass a naive check and fail in practice —
precisely the class of mistake this project keeps paying for. Verdicts:
`ok`, `no-video`, `no-audio-track`, `audio-track-but-silent`,
`audio-ok-picture-static`.

## Context is a chain

`ctx` is passed to every test and tests **write** to it: M2 leaves the video list,
M3 the caption tracks, M4 the cues. Deliberate — the manual tests form a chain, and
re-fetching in each would triple the API calls and make a mid-chain failure harder
to read. Only the operator's own inputs persist; fetched data never does.

## The report

`getReport()` leads with the M4 verdict and ends with **what did not run**. A suite
where half the tests were blocked on a missing token, read as "3 passed", would be
a lie of omission of exactly the kind this project keeps building guards against.

## Error codes

`bad-params` · `no-token` · `no-client-id` · `bad-token` · `forbidden` ·
`not-found` · `api-error` · `asr-download-refused` · `share-refused` · `unsupported`

## Known limitations (v0.1)

- A diagnostic page. It builds nothing and keeps nothing.
- The caption parsers live here, not in `core/youtube-api` — promoting a parser
  before knowing whether it has a source is the extract-before-validating mistake
  the video-review pack already made once. Promote after M4 answers.
- A3–A6 measure a synthetic talk. It carries the known traps but is **not** a real
  conference recording and cannot stand in for one.
- Tab-audio support is a Chromium strength and weaker elsewhere.
