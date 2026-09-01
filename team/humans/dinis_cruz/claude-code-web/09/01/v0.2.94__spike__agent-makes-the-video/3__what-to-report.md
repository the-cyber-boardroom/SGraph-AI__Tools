# 3 · What to report

**Read this before you start, not after.** Half of it is numbers you can only
collect while the thing is running.

Copy the template below into `FINDINGS.md` and fill it in as you go.

---

## The numbers to collect while running

| Measurement | How | Why it decides something |
|---|---|---|
| **Intended vs actual render duration** | Sum the TTS durations; time `record()` with `performance.now()` | Decides whether the renderer needs a frame clock or WebCodecs. **The single most valuable number here.** |
| Drift per minute | The above, normalised | Tells us whether it is a rounding error or a real problem |
| TTS time for the whole reel | Time `generateAudio()` | Decides whether TTS needs caching and progress reporting |
| TTS time on a warm run | Run it twice | Separates model loading from generation |
| Wall clock, script → video | Time the whole thing | The proposal claims ten minutes end to end. Is that remotely plausible? |
| Screenshots captured vs used | Count both | If you shot 40 and used 12, capture is the wrong shape |
| Scenes that could not crop to 9:16 | Count, and name them | Tests the focus-rect idea directly |
| Output sizes | `ls -la` | Whether it is publishable as-is |

---

## FINDINGS.md template

```markdown
# Spike: agent makes the video — findings

**Date:** …   **Subject:** SGit vaults | narrated-review   **Time spent:** …

## Did it work?

One paragraph. Did a watchable video come out, and would you publish it as it is?

## The video

- landscape.webm — Xs, Y MB, N scenes
- shorts.webm — Xs, Y MB
- Watch it before writing anything below.

## Numbers

| Measurement | Value |
|---|---|
| Intended duration | |
| Actual duration | |
| **Drift** (and per minute) | |
| TTS, cold / warm | |
| Total wall clock, script → video | |
| Screenshots captured / used | |
| Scenes that would not crop to 9:16 | |

## What was hard

The three things that cost the most time, in order, with how long each took.

## What was easy that we expected to be hard

Equally useful. If annotation-by-DOM-injection took ten minutes, say so — the
proposal budgets two to three days for an annotation renderer.

## Is the proposed demo-reel design right?

Go through the neighbouring pack's nine decisions and mark each
**confirmed / wrong / unnecessary / missing**, with a sentence of evidence:

1. Annotations as data, never baked pixels —
2. One document, two aspect ratios via a focus rect —
3. Caption as a separate authored track —
4. Multi-shot scenes under one narration —
5. The reel document as the API —
6. Import from narrated-review as a transform —
7. Handoff via files/VFS, not localStorage —
8. Measure render pacing first —
9. Clips as a shot type —

**Be blunt.** "Decision 4 is unnecessary — one image per narration was fine and
multi-shot scenes would have added nothing" is exactly the kind of finding that
saves a week.

## What would you actually build?

If you had to make ten of these, what is the smallest thing that would make it
easy? Not the ideal tool — the smallest one. If that is different from the
proposal, describe it.

## What did NOT work

Everything you could not do, with the error. An honest "Kokoro would not load,
here is the message" beats a workaround that hides it.

## Artefacts

Where everything is, and what each file is.
```

---

## What makes this spike a success

Not the video. **The findings**, and specifically the render-drift number and the
verdict on the nine decisions.

A rough video plus a sharp findings document is a good day. A polished video plus
"it went fine" is a wasted one — because the next person still has to guess at
everything you now know.

## What makes it a failure

- Building the tool instead of the video.
- Reporting impressions where a number was available.
- Hiding a blocked path behind a workaround, so nobody learns the path is blocked.
- Producing something you would not actually publish, and saying it is fine.
