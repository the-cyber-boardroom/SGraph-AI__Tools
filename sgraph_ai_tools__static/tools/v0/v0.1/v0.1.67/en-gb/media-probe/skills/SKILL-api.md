# Media Probe — API Spec

`window.__tool` after `tool:ready`. All actions return Promises. The manifest `api`
section is authoritative; this file adds semantics.

## The contract in one paragraph

No gestures, no key, **no model calls, ever**. The probe is pure signal processing,
so it costs nothing to run — which is the point: its value is being free to run
*before* spending money on the recording you are unsure about. Lanes are
independent and idempotent because their costs differ wildly. Every threshold is
derived from the recording's own distribution, never absolute. `getProbe()` is the
product and always carries `gaps_in_analysis`.

## Why it exists (and what that implies about its design)

`narrated-review` v0.1.4 cut a real 4m21s screencast into nine segments of exactly
30000 ms: a fixed `silenceThreshold: 0.01` RMS sat *below* that recording's noise
floor, so no frame counted as silence, the VAD never endpointed, and every segment
force-cut at `maxUtteranceMs`. Sentences were split mid-clause.

Two design consequences run through this whole module:

1. **Never compare an absolute number to an unknown distribution.** Thresholds are
   percentiles of the recording's own energy or a multiple of a metric's own p95.
2. **An unmeasured thing must never look like a measured thing.** Hence
   `gaps_in_analysis`, `mp:warning`, the `capped` count, and `strategy:'none'`.

## Lanes

| Action | Cost | Answers |
|---|---|---|
| `analyseAudio()` | seconds | will this segment at all? |
| `analyseFrames()` | a seek per sample | where does the picture change? |
| `alignSignals()` | instant | does the picture lead the words, and by how much? |
| `plan()` | instant | where should we cut and shoot? |
| `runFfmpegLane()` | a WASM load | do our numbers agree with FFmpeg's? |

`analyseAll()` runs them cheapest-first. Nothing depends on `analyseFrames` except
the video-led strategies — a picture-less file still gives a full audio verdict.

## `analyseAudio({ frameMs = 20 })`

`frameMs` defaults to 20 to match `narrated-review`'s PCM store exactly, so the
numbers here are directly comparable to what the pipeline sees.

Produces, on `state.audio` and in `getProbe()`:

- `levels` — `{ floor (p20), speech (p90), range, bimodal }`. **`bimodal` is the
  honest caveat**: if the modes are not separable, no threshold is meaningful and
  `mp:warning{code:'not-bimodal'}` fires.
- `calibration` — `{ silenceThreshold, speechThreshold, method }`, floor + 15%/40%
  of the range. Identical rule to `narrated-review` v0.1.5's `calibrateVad`, kept
  in one place so the probe and the pipeline cannot drift about what "calibrated"
  means.
- `histogram` — energy in dBFS bins (linear RMS bins crowd everything quiet into
  one bar).
- `flatness` — median spectral flatness at the floor vs during speech. Room tone
  and mains hum are narrow-band; speech is broadband. **A loud floor with low
  flatness is the signature of the failure case** — quiet-sounding noise that no
  absolute RMS threshold can see past.

## Gaps and the threshold table

`setThreshold({value})` re-derives the gaps and replays the VAD; it is cheap enough
for a slider drag. Gaps split into three populations, and the boundaries are not
arbitrary — ordinary word gaps in connected speech run ~100–150 ms, which is why
snapping to "the nearest quiet moment" lands mid-sentence:

| Population | Length | Boundary? |
|---|---|---|
| `word` | < 300 ms | never |
| `sentence` | 300–1000 ms | maybe |
| `topic` | > 1000 ms | yes |

`getProbe().thresholds[]` evaluates **every candidate at once** —
`{ value, db, gaps, topicGaps, sentenceGaps, segments, capped, cappedRatio }`. A row
reading `0.01 → topicGaps 0, capped 8` is the original failure in one line, which
is the whole reason the table exists.

## `replaySegmentation(...)` runs the real VAD

It imports `core/sg-live-capture` `createVad` and feeds it the recording's RMS log —
hysteresis, pre-roll, hangover, `maxUtteranceMs` and all. **The `capped` count is
only trustworthy if it comes from the same state machine the pipeline runs.** A
probe that *modelled* the pipeline would be free to be wrong in the same direction
as the bug it exists to expose.

Sample frames are passed as an empty `Float32Array`: the state machine only needs
the energy to decide where utterances are, and building a second copy of the
recording to throw away would be pure waste.

## `findScenes({ metric, factor })` and the four metrics

| Metric | Sees | Blind to |
|---|---|---|
| `meanAbs` | global change (what narrated-review ships) | a dialog over a static page — averaged away |
| `blockMax` | **localised** change, worst tile of an 8×8 grid | slow global drift |
| `edgeDiff` | layout/structure via gradient magnitude | recolouring, theme switch |
| `histDist` | palette/brightness | content moving without changing colour |

Defaults to `blockMax` at `1.5 ×` that metric's own p95, with a 0.004 floor so
encoder noise in a static recording does not become a scene list. Bursts within
`minSceneMs` collapse to their **last** sample — that is where the screen settled,
which is the frame worth keeping.

`perMetric` reports how many scenes each metric finds and how many it shares with
the reference. That is the empirical answer to "which metric should we use?" — a
question the single hardcoded metric never asked. Each scene also carries `agreed`:
which other metrics fired at the same moment. Disagreement is informative.

## `alignSignals()`

Measures `(nearest speech onset − scene change)` per scene. **Positive means the
words came after the picture** — the picture led. Negative means the speaker started
talking about something before switching to it, which is the case that defeats a
naive "grab the frame where the words start".

Returns `median`, `p10`, `p90`, `suggestedLeadMs`, `suggestedLagMs` (a window
containing ~80% of pairings, with margin) and `correlated` — `pairedRatio >= 0.5`.
**When `correlated` is false the pictures and words in this recording do not track
each other**, and any pairing will be somewhat arbitrary. That is worth knowing
before building a document from it.

## `plan({ strategy })`

```js
{ strategy: 'audio-led' | 'video-led' | 'hybrid' | 'none',
  reason:   'only 0 topic gaps in 261 s — not enough to cut on — but 14 scene changes…',
  cuts:  [{ tMs, source: 'silence'|'scene'|'scene+silence'|'start'|'length-limit', evidence: {…} }],
  shots: [{ tMs, forCutIndex, evidence: {…} }],
  estimate: { captures, transcribeUsd, cleanUsd, totalUsd, basis },
  window: { leadMs, lagMs, measured },
  warnings: [{ code, message }],
  basis }
```

Selection order: `hybrid` when both signals exist but are uncorrelated → `audio-led`
when topic gaps are plentiful and the histogram is bimodal → `video-led` when they
are not but scenes are plausible → `none`.

**`none` is a legitimate answer and returns no cuts.** A plausible set of arbitrary
boundaries is worse than an honest refusal — that is precisely what shipped the
first time. Similarly, a cut forced by `maxCaptureMs` is tagged
`source: 'length-limit'` with an evidence note saying it is arbitrary, and raises
`warning{code:'arbitrary-cut'}`.

**The insight the strategies encode:** `narrated-review` runs in one direction only
— pauses become boundaries, then a frame is found for each. When a recording has no
usable pauses that chain has no first link. But such a recording usually still has
clear *visual* boundaries, so the direction should be chosen per recording.

## Cost, and what "efficient" means

`COST_BASIS` in `plan.js` holds constants measured from the real session
`nr-video-n16w` (9 captures, 4m21s, google/gemini-3.5-flash): **$0.0130
transcription and $0.0343 cleanup per capture**, cleanup being **72% of spend**
because it sends a screenshot per capture and images dominate the token count.

So spend scales with the **number** of captures, almost independently of their
length. One capture per visual state instead of one per clock tick is cheaper *and*
better — quality and cost point the same way, which is rare. `estimateCost` and
`compare()` state it in dollars rather than adjectives, and `basis` always names the
session the constants came from.

## `getProbe()` — the machine-readable product

Includes `schema {name, version}`, `source`, `config`, `audio`, `thresholds`,
`gaps`, `frames` (the full trace, signatures stripped), `scenes`, `align`, `today`,
`plan`, `ffmpeg`, and:

**`gaps_in_analysis`** — always present, listing what was *not* measured
(`audio-not-run`, `frames-not-run`, `align-not-run`, `ffmpeg-not-run`, plus
anything that failed). A consumer must be able to tell "no scenes found" from
"scene detection never ran". Conflating those is the failure mode this whole tool
exists to prevent, so the shape makes it impossible to express by accident.

`getFindings()` returns the same conclusions as markdown, ending with the same list.

## Error codes

`bad-params` · `no-source` (a lane before `loadVideo`) · `not-video` (no decodable
picture — HEVC `.mov` without FFmpeg; audio-only analysis still works) ·
`not-audio` · `ffmpeg-parse` (FFmpeg ran but produced nothing readable —
deliberately **not** the same as "found nothing"; the raw log is on the error) ·
`cancelled`

## Known limitations (v0.1)

- Percentile choices (p20/p90, 15%/40%) and the scene factor (1.5× p95) are
  starting points, validated on synthetic clips and one real session — not tuned
  across a corpus.
- `spectralFlatness` is a decimated DFT on 1-in-5 frames: enough for a ratio, not a
  spectrum.
- `plan()` is **not** consumed by `narrated-review` yet. Deliberately: it should be
  validated against several real recordings of different character first.
- The FFmpeg lane has never been run in a browser here — its WASM build needs the
  unpkg CDN, unreachable from the build container. The log parsers are covered by
  unit tests against captured text.
- Frame sampling is a seek per sample. Two-pass sweeping and the pre-flight
  estimate keep it usable, but a very long recording is still minutes of work.
