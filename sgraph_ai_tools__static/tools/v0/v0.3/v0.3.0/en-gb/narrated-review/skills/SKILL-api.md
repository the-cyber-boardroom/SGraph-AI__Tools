# Narrated Review — API Spec

`window.__tool` after `tool:ready`. All actions return Promises. The manifest `api` section is authoritative; this file adds semantics.

## What changed in v0.1.5

Three things, two of them found by running a real screencast through v0.1.4.

1. **A billing ledger.** Every paid call is recorded at the transport with its
   OpenRouter generation id, and `fetchBilling()` retrieves the provider's own
   receipt. Ships as `billing.json` in the zip and the vault.
2. **Segmentation thresholds are now calibrated per recording.** The fixed
   `silenceThreshold: 0.01` failed completely on a real video — see below.
3. **`moments[]` in `session.json`** plus a bundle `README.md`, so a consumer
   never has to parse `review.md` to join an image to its words.

### The real-screencast failure (fixed here)

A 4m21s recording produced nine captures of *exactly* 30000 ms. The VAD never
saw a silent frame, never endpointed, and force-cut at `maxUtteranceMs` every
time; sentences were chopped mid-clause and the frame search was matching
pictures to boundaries that meant nothing. Cause: **0.01 RMS is an absolute
level**, and a real recording's noise floor (room tone, mic gain, AAC
compression) sits above it. Synthetic test audio has true digital silence, which
is exactly why 54 passing assertions never caught it.

`calibrateVad` now takes the 20th and 90th percentiles of the recording's own RMS
log as the floor and speech level and places both thresholds inside that range.
On the regression clip the calibrated silence threshold is **0.056 — 5.6× the old
fixed value**. An explicitly passed threshold still wins. And `capped` (segments
cut at the length limit rather than at a pause) is now reported in the
`importVideo` result, with `nr:video:warning` when it is most of them: a
force-cut boundary is arbitrary, and saying so beats shipping a plausible-looking
document built on nothing.

## What changed in v0.1.4

A third way to fill the capture list: **`importVideo({file})`**. Video review is
not a separate tool — once the captures exist, the workflow is identical, so it
is an INGEST MODE. The recording's audio is cut at its own silences (the pauses
do what your keypresses do live) and each spoken segment is matched to the frame
it is about. Plus `getFrameCandidates` / `setFrame`. 44 actions.

## What changed in v0.1.3

`startSession()` now opens **capture 1** with the screen as shared, and a press
means **NEXT**: a capture's screenshot is taken when it OPENS, and the words
until the next press belong to it. Before this, the first press created capture 1
holding a frame from after you had moved on, so every capture carried the next
screen's picture. Also: `saveSession`/`listSessions`/`loadSession`/`deleteSession`
(local, survives a reload), and captures open as their own dockable panels.

## What changed in v0.1.1

Structural editing, two chat surfaces, vault save and PDF export. 37 actions.
Boundary snapping was also corrected against live narration — see `setSnapConfig`.

## Data model

The unit is the **pair** — an ordered list drives everything:

```js
pair = {
  id: 'p01', seq: 0,
  tPress: 12400,              // ms on the session (audio) clock
  tStart: 10200, tEnd: 31800, // VAD-snapped, adjustable; may overlap neighbours
  hasScreenshot: true,        // blob served via getPairImage({id})
  videoAt: 41200 | null,      // video-import only: which frame this took (ms)
  raw:   { text, model, costUsd },              // IMMUTABLE once set
  clean: { text, marks:[{span,note}], model, costUsd },
  notes: '',                  // extra comments — commentary, NOT a transcript
  source: 'capture'|'inserted'|'video',
  status: 'marked'|'transcribing'|'raw'|'cleaning'|'clean'|'error',
  error: { code, step } | null,
}
```

`seq` is the DOCUMENT ORDER and is re-derived from array position after every
move or insert. `id` never changes, so chat threads, events and API callers keep
pointing at the same capture across reordering.

### Three kinds of text, deliberately separate
| Field | Whose words | Editable |
|---|---|---|
| `raw` | the recogniser's | never |
| `clean` | the speaker's, corrected | yes (`setText`, or the session chat) |
| `notes` | yours or an agent's, added after | yes (`setNotes`) |

## Structural editing

- `insertPair({ text?, notes?, image?, raw?, afterId?, atIndex? })` — a capture is
  only ever a screenshot, some words and (usually) audio, so one can be authored
  directly. No audio means it never goes through transcription.
- `movePair({ id, toIndex })` or `({ id, by: -1 })` ; `reorderPairs({ order: [id,…] })`
- `setNotes({ id, notes })` ; `removePair({ id })`

## Ingest paths

Three ways to fill the list; everything after it is shared.

| Path | Entry | Gesture? |
|---|---|---|
| live | `startSession()` → `markMoment()` × n → `endSession()` | yes (screen picker) |
| audio | `addRecording({file})` → `markAt({t})` × n | no |
| **video** | `importVideo({file})` | no |

### `importVideo({ file, …tuning })` → `{ pairs, segments, durationMs, via }`

Resets the session, then:

1. **Audio out.** `decodeAudioData` on the video itself when the browser will
   take it (`via:'web-audio'`, free); otherwise `core/video` `loadFFmpeg` +
   `extractAudio` (`via:'ffmpeg'`, a multi-MB CDN load and a slow decode).
2. **Segments.** `core/sg-live-capture` `createVad` over the stored energy log.
   The bounds are **structural** — they come from cutting the audio at real
   silences, not from asking a model where the sentences are. Same discipline as
   the live path's boundary snap. Defaults are deliberately longer than a live
   VAD's (`endpointMs: 900`) to get topic-sized rather than sentence-sized
   segments; over-cutting is recovered by step 4.
3. **Frames.** For each segment, sample a window spanning `leadMs` (2500) before
   speech and `lagMs` (1200) after at `stepMs` (400), reduce each sample to a
   32×18 greyscale signature, find the **last** transition above
   `changeThreshold` (0.02), and walk forward off anything still animating. This
   is because **the picture leads the words** — a naive "frame where the words
   start" hands a capture the *previous* screen whenever the speaker switches
   late.
4. **Grouping.** Adjacent segments whose chosen frames differ by less than
   `mergeThreshold` (0.01) become one capture spanning both.

Errors: `bad-params` · `not-video` (no decodable picture — HEVC `.mov` is the
usual cause) · `not-audio` (no audio track, or FFmpeg failed) · `no-speech`.

Progress: `nr:video:started`, then `nr:video:progress` with
`step: 'audio'|'segments'|'frames'|'captures'` (the frame search is the slow
part and reports `done/total` per segment), then `nr:video:complete`.

- `getFrameCandidates({id})` → `{ id, chosenAt, candidates:[{at,thumb}] }` — every
  frame that was considered, with a JPEG thumbnail.
- `setFrame({id, at})` — re-grab at any point in the video (not just a candidate).
  Requires the source video still loaded: it is held in memory, not persisted, so
  this is unavailable after a reload or `loadSession`.

**The thresholds are honest guesses.** They are calibrated on synthetic slides
that change instantly and completely; a real screencast fades, scrolls and
animates. Every one is a parameter for that reason, and the candidate strip
exists so a wrong pick costs one click.

## Chat

- `askPair({ id, text })` — scoped to ONE capture: its screenshot, raw, analysis,
  notes, plus the rolling summary. Flat cost, answers about that moment.
- `askSession({ text, maxSteps })` — the whole review **with tools**:
  `list_captures`, `get_capture`, `set_notes`, `set_analysis`, `move_capture`,
  `insert_capture`. Returns `{ text, steps, changes }` where `changes` lists what
  it actually did. Raw transcripts are not exposed as writable.

## Billing — the provider's own receipts

Two numbers exist per generation and both are kept. A completion response carries
a cost immediately, but it is provisional; the charged amount lands a couple of
seconds later at `GET /api/v1/generation?id=…` together with the token counts, the
provider that actually served the request, cache discounts and latency.

**The id is the receipt.** It is recorded the instant a request returns — before
any cost lookup, and whether or not the lookup ever succeeds. A lookup fails for
a dozen ordinary reasons; if the id were only kept on success the spend would be
unauditable afterwards. With the id, a receipt missed today can be fetched
tomorrow, from a script, or from the vault copy months on.

Recording happens in a wrapper around **both** transports (`billed()`), not at
call sites — the one place that cannot be forgotten in a later release.

- `fetchBilling({ delayMs = 2500, retries = 2, force, ids })` →
  `{ resolved, unresolved, failed, totals }`. Idempotent; resolved entries are
  skipped. Runs automatically once the two lanes settle, and best-effort before
  an export — but it can never block or fail one.
- `getBilling()` → the ledger, identical to `billing.json`:

```js
{ totals: { generations, receipts, missing, chargedUsd, localClaimUsd, deltaUsd, byScope, byModel },
  generations: [{ id, at, scope, pairId, step, model,
                  localCostUsd,      // what the completion claimed
                  chargedUsd,        // what was charged
                  fetchedAt, attempts, lastError,
                  data }] }           // the provider record, VERBATIM
```

`scope` is `transcribe` · `clean` · `chat-pair` · `chat-session` (one entry per
step of the agentic tool loop). `data` is stored unreshaped: it is the provider's
document, and reshaping it would silently drop whatever OpenRouter adds next.
`deltaUsd` is only reported once every receipt is in — otherwise the gap is just
"not fetched yet" and would read as drift.

## Machine-readable exports

`session.json` carries **`moments[]`**, the consumer-facing view. It exists
because the first agent handed one of these bundles had to parse `review.md`
headings to work out which image went with which words: `pairs[]` held the text
but no image filename, and images are named `pair-01.png` by document *position*
while pairs are keyed `p01` by *identity*. Everything needed was in the bundle and
none of it was addressable — an export defect, not a consumer problem.

```js
moments[i] = { index,        // 1-based; matches the "## N." headings and "Moment N" in the PDF
               id,           // stable across reordering
               tMs, at, tStart, tEnd, durationMs,
               image,        // "images/pair-NN.png"
               audio,        // "audio/pXX.wav"   (a location, not a guarantee — exports may omit audio/)
               rawFile,      // "raw/pXX.txt"
               text,         // best available words
               textSource,   // 'clean' | 'raw' | 'none'  — which claim these words are
               rawText, notes, marks, source, videoAt, models, costUsd }
```

`marks` are spans the cleanup model flagged rather than resolved; they are
structured here, not only rendered as `[unsure]` inside prose, so a consumer can
treat them as uncertain without parsing. `session.json` also declares `schema`
(name + version) and `files` (the bundle layout), and every bundle now opens with
a `README.md` naming `moments[]` as the surface to read.

## Saving and exporting

- `downloadZip({ include })` · `downloadPdf({ includeRaw })` · `sendViaSgSend()`
- `saveToVault({ vaultId, passphrase | token, includeAudio })` → writes
  `reviews/<sessionId>/review.md`, `images/`, `raw/`, `notes/`, `session.json`,
  and `audio/` only when `includeAudio` is true. Audio is off by default: it is
  the bulk of the size, and only needed to re-transcribe later with a better
  model, re-cut a boundary, or build something else (a video, say) from the same
  materials. `previewVaultFiles()` shows the exact file list without writing.

- `raw` is never overwritten: `retranscribePair` pushes the old raw into an internal version history; `setText` edits `clean` only.
- Bounds are markers over ONE continuous recording — `setBoundary` re-slices; segments may overlap (duplicated words beat lost ones).

## Lanes

- **Transcribe (parallel):** a pair transcribes as soon as its bounds close (next mark, or session end). `transcribeAll({concurrency=4})` sweeps stragglers; idempotent.
- **Clean (sequential, seq order):** each call sends raw text + (grounded mode) the pair's screenshot + the rolling summary; returns strict JSON `{cleanText, marks, summary}` — the `summary` field advances the session's rolling summary, which is why order matters. `cleanAll()` is idempotent.

## Error codes

`no-session` · `screen-unavailable` · `mic-unavailable` · `bad-params` · `unknown-pair` · `not-audio` · `not-video` · `no-video` · `no-speech` · `no-key` · `budget-cap` · `key-invalid`(401) · `budget-exceeded`(402) · `key-exhausted`(403) · `rate-limited`(429) · `clean-parse` (cleanup JSON invalid — raw stands) · `cancelled` · `llm-error`

Typed provider errors come from the HTTP status via `core/sg-transcribe` — no string matching.

## Costs & caps

`getCostSummary()` → `{ sessionUsd, transcribeUsd, cleanUsd, pending, perPair }`. Exact charged costs resolve a couple of seconds late per generation id (`pending` counts them). `setSpendCap({usd})` is a SOFT cap across both lanes: calls halt with `{code:'budget-cap'}` once known spend ≥ cap; it can overshoot slightly while costs resolve.

## Privacy contract

Nothing leaves the browser except: audio segments (transcription) and — **grounded mode only** — the pair's screenshot (cleanup), both direct to OpenRouter under the user's key. `setCleanupMode({mode:'text-only'})` keeps screenshots local; `'off'` sends nothing after transcription. No analytics, no server.

## The canonical headless run

```js
await new Promise(r => addEventListener('tool:ready', r, { once: true }));
const t = window.__tool;
t.setApiKey({ apiKey: 'sk-or-…' });
await t.addRecording({ file: narrationWav });     // or live: startSession()+markMoment()
for (const ms of [3200, 41000, 96500]) await t.markAt({ t: ms });
await t.transcribeAll();
await t.cleanAll();
const { markdown, images } = await t.buildDocument();
await t.downloadZip();                            // review.md + images/ + audio/ + raw/ + session.json
```

## Known limitations (v0.1)

- Session state is in-memory — a reload loses an unexported session.
- `startSession` requires a real gesture; the marker key requires tool-window focus (browser limits — see the pack's Decision 3).
- Boundary editing is numeric ms in the UI (draggable timeline queued).
- `setSnapConfig({ minSilenceMs })` matters: the snap looks for a SUSTAINED gap,
  because ordinary word gaps are ~120 ms. Default 700 ms. Too low and a segment
  starts mid-sentence; too high and it falls back to a fixed 2 s lead.
- `saveToVault` is implemented but has NOT been run against a live vault.
- Video import: segmentation is now calibrated per recording and covered by a
  regression test that reproduces the real-screencast failure over a room-tone
  floor. The FRAME-choice thresholds (`changeThreshold`, `mergeThreshold`, the
  lead/lag window) are still only exercised against synthetic slides that change
  instantly — a fade, a scroll or a build-in can still fool them, which is what
  the candidate strip is for.
- The source video is held in memory only, so `setFrame` stops working after a
  reload, and `frameCandidates` are not persisted by `saveSession`.
- The LIVE path's boundary snap still uses an absolute `config.silenceThreshold`
  (0.01) and so carries the same risk the video path just hit; it has worked
  against real mic input, but `setSnapConfig` is the only mitigation today.
- The FFmpeg audio-extraction fallback needs the unpkg CDN, so it cannot run on an
  offline runner; the free Web Audio path covers ordinary `.mp4`/`.webm`.
- `loadSession` restores the document (captures, images, text, notes, order) but
  NOT the audio samples, so `retranscribePair` and boundary edits are unavailable
  on a restored session (`canRetranscribe:false`). Save with `includeAudio:true`
  to keep the take itself; note `core/sg-vfs` is text-only, so binary is stored
  base64 (~33% larger).
- The take is webm/opus (or ogg) — the per-pair WAVs are the model-ready audio.
- Vault-as-home, annotation, and screenshot-only mode are the ranked v0.2 queue.
