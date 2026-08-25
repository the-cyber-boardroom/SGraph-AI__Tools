# Media Probe — Human Guide

Drop in a recording and see its structure — **before** you pay a model to guess at
it. No key, no uploads, no model calls, no cost.

## Why this exists

`narrated-review` imported a real 4m21s screencast and produced nine captures of
**exactly 30 seconds each**. Its transcripts were cut mid-sentence. The cause was
one line: a fixed silence threshold of 0.01 RMS, which sat *below* that
recording's noise floor — so no moment ever counted as silence, and every segment
was force-cut at the length limit.

The bug was not the number. It was that **nobody could see the number in context**.
This tool is that missing view.

## The one thing to look at first

Load a recording, press **Analyse audio** (seconds), and open **Histograms**.

- **Energy distribution** — two humps: the quiet one is the room, the loud one is
  the speaking. A threshold has to sit *between* them. If there is only one hump,
  no threshold can work on this recording, and the panel says so.
- **Gap lengths** — three populations. Word gaps (~120 ms) are never boundaries.
  Sentence gaps (~400–700 ms) sometimes are. **Topic gaps (over 1 s) are the ones
  worth cutting on.** If that bar is empty, audio-led segmentation cannot work
  here — and you know it for free, in one glance.
- **The threshold table** — every candidate evaluated at once: gaps, topic gaps,
  segments, and **force-cuts**. A row reading `0.01 → topic 0, force-cut 8` is the
  original failure, stated in one line. Click a row to adopt it.

## The timeline

The **Timeline** tab puts everything on one time axis: a **filmstrip of what was
on screen**, energy with the threshold lines drawn *on* it, the gaps that
threshold produces, the four frame-difference metrics, and two boundary lanes —
what `narrated-review` does today, and what the plan proposes.

**The screen track** works like the screenshot strip in a browser profiler.
Thumbnails sit at their real position in time rather than in even slots, so the
spacing itself tells you where things happened; any that would collide with the
one before it is skipped. A **teal bar along the top of a thumbnail marks a
detected change**, so you can see at a glance whether the detections line up with
the moments the picture actually changed.

**Hover anywhere on the timeline** and a playhead runs down every lane with a
larger frame preview below — the "what was on screen *here*?" question, answered
without leaving the plot. The preview comes from the strip already in memory, so
it is instant.

**Drag the threshold slider.** The gap lane and both boundary lanes re-run the real
VAD live. This is the point of the whole tool: it turns an invisible constant into
something you can feel. Watch for whether the dashed `0.01` line sits *under* the
energy band or *inside* it.

## Frames — the slow lane

**Sweep frames** samples the picture and measures how much it changed, four
different ways:

| Metric | Catches | Misses |
|---|---|---|
| `meanAbs` | overall change (this is what narrated-review uses today) | a dialog opening over a static page |
| `blockMax` | **localised** change — a menu, a modal, a sidebar | slow global drift |
| `edgeDiff` | layout and structure change | recolouring, a theme switch |
| `histDist` | palette and brightness change | content moving without changing colour |

Four rather than one because the single hardcoded metric was never examined. Where
they *disagree* is informative — a scroll, a fade and a cursor each disagree
differently.

A sweep is one seek per sample, so it is the expensive part. The estimate is shown
before you start, it reports progress, and **Cancel** works. Two-pass (on by
default) samples coarsely everywhere then finely only where something moved — a
screencast is static most of the time.

**Scenes** shows every detected change as a before/after thumbnail pair with the
values that fired. That is where you find out whether a detection was a real
change or a moving cursor.

## Alignment

`narrated-review` assumes the picture leads the words by 2500 ms, and trails by up
to 1200 ms. **Alignment** measures the truth for this speaker: the distribution of
(speech onset − scene change), with the assumed window drawn over it.

It also tells you when the two signals are *uncorrelated* — if scene changes and
speech onsets do not track each other, then any pairing of pictures to words in
this recording will be somewhat arbitrary, whatever tool does it.

## The plan, and the money

**Make a plan** picks a strategy and proposes boundaries:

| Strategy | When |
|---|---|
| **audio-led** | there are usable topic gaps — cut at the pauses, then find each frame |
| **video-led** | no usable pauses, but clear scene changes — cut at the changes, take the words between |
| **hybrid** | both exist but disagree — scenes lead, snapped to nearby pauses |
| **none** | neither signal is usable. **It refuses, with a reason.** |

That last row matters. A plausible set of arbitrary cuts is worse than an honest
refusal — that is exactly what shipped the first time.

**Compare** states the difference in money. Spend scales with the *number* of
captures, because cleanup sends a screenshot each time and images dominate the
cost (72% of the real session's $0.43). Six well-placed captures instead of nine
arbitrary ones is about a third cheaper *and* better — quality and cost point the
same way here.

## Findings, and what was NOT measured

**Findings** is the verdict in words — copyable, and written so an AI assistant can
act on it. It always ends with what has *not* been measured, because a confident
summary that quietly omits an unrun lane is the failure this tool exists to end.
"No scenes found" and "scene detection never ran" are different claims.

## Cross-checking with FFmpeg

Optional, and it loads several megabytes of WASM. FFmpeg's own `silencedetect` and
`scene` filters compute what this tool hand-rolls, at the recording's native frame
rate. Having got a hand-rolled threshold badly wrong once, a second independent
implementation is worth one load. It is also the only path for codecs the browser
refuses (HEVC `.mov`).

## Honest limits

- The percentile choices and the scene factor are starting points, validated on
  synthetic clips and one real session — not tuned across a corpus.
- `plan()` has not been validated against many real recordings, and
  `narrated-review` does **not** consume it yet. Deliberately.
- The FFmpeg lane has never been run in a browser here (its CDN is unreachable
  from the build container). Its log parsers are unit-tested against captured text.
