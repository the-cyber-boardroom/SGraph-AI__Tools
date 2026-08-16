# Narrated Review — API Spec

`window.__tool` after `tool:ready`. All actions return Promises. The manifest `api` section is authoritative; this file adds semantics.

## Data model

The unit is the **pair** — an ordered list drives everything:

```js
pair = {
  id: 'p01', seq: 0,
  tPress: 12400,              // ms on the session (audio) clock
  tStart: 10200, tEnd: 31800, // VAD-snapped, adjustable; may overlap neighbours
  hasScreenshot: true,        // blob served via getPairImage({id})
  raw:   { text, model, costUsd },              // IMMUTABLE once set
  clean: { text, marks:[{span,note}], model, costUsd },
  status: 'marked'|'transcribing'|'raw'|'cleaning'|'clean'|'error',
  error: { code, step } | null,
}
```

- `raw` is never overwritten: `retranscribePair` pushes the old raw into an internal version history; `setText` edits `clean` only.
- Bounds are markers over ONE continuous recording — `setBoundary` re-slices; segments may overlap (duplicated words beat lost ones).

## Lanes

- **Transcribe (parallel):** a pair transcribes as soon as its bounds close (next mark, or session end). `transcribeAll({concurrency=4})` sweeps stragglers; idempotent.
- **Clean (sequential, seq order):** each call sends raw text + (grounded mode) the pair's screenshot + the rolling summary; returns strict JSON `{cleanText, marks, summary}` — the `summary` field advances the session's rolling summary, which is why order matters. `cleanAll()` is idempotent.

## Error codes

`no-session` · `screen-unavailable` · `mic-unavailable` · `bad-params` · `unknown-pair` · `not-audio` · `no-key` · `budget-cap` · `key-invalid`(401) · `budget-exceeded`(402) · `key-exhausted`(403) · `rate-limited`(429) · `clean-parse` (cleanup JSON invalid — raw stands) · `cancelled` · `llm-error`

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
- The take is webm/opus (or ogg) — the per-pair WAVs are the model-ready audio.
- Vault-as-home, annotation, and screenshot-only mode are the ranked v0.2 queue.
