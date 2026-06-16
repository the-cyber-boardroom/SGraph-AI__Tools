# Audio Transcribe

Record from the mic or drag/drop many local audio files (including WhatsApp
`.opus` voice notes) and transcribe each to text using curated **OpenRouter**
audio models — entirely in the browser. Batch queue with per-row status, a
per-recording detail panel with **version history** and **parallel multi-model**
transcription (+ **Stop all**), **per-item/file/session cost**, a **request/response
provenance panel**, a **live recording waveform**, and a full **JS API**.

Also: **🔴 Live** near-realtime transcription (delta-based, configurable chunk
interval, out-of-order-safe, optional clean-up pass), **🗣 Voice** (text→speech,
local Kokoro or cloud OpenRouter, with cost), **💬 Chat** over your transcripts
(UI + headless `ask()`), a **spend cap**, typed **key/quota errors**, and a
mobile-friendly layout. A minimal **`live-transcribe`** "big button" variation
reuses this engine.

- **Live:** `https://tools.sgraph.ai/en-gb/audio-transcribe/` ·
  `…/en-gb/live-transcribe/` (dev: `https://dev.tools.sgraph.ai/…`)
- **Source:** `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.60/en-gb/audio-transcribe/`
- **Stack:** vanilla ES modules, no build step, client-side only. Every file is
  deployable as-is.

> **Audience:** agents and devs *using* the tool (manually or via the JS API)
> and *changing* it (e.g. in a new Claude Code session). Read this first.
>
> **Wiring this into a vault or the main sgraph.ai website?** Read the
> **integration brief**: `library/api/v0.1.93__audio-transcribe__integration-and-capabilities.md`
> (the embedding/key-injection/cost/cap/CORS contract). Current API contract:
> `skills/SKILL__api.md` + `manifest.json` (authoritative).

---

## 1. Background

The tool exists so "somebody else" can paste/record audio and get text without
understanding OpenRouter, base64 keys, or codecs. The #1 use case is **WhatsApp
`.opus` voice notes**, which most browsers can't decode natively — so there's a
three-tier never-fail decode path (see §4).

It was built on the **90/10 reuse thesis**: ~90% is existing SGraph building
blocks (recording, LLM fetch, upload-dropzone, send, the SgToolApi + dev-panel,
sg-layout, sg-audio-viz); the genuinely-new ~10% is the curated audio-model
list, the transcription pipeline, the WASM `.opus` decoder, the batch/version
orchestration, and the cost/provenance plumbing.

---

## 2. Quick start

### From the UI
1. Open the tool. Drop audio files on **Source**, or click **Record** (a live
   waveform shows while recording). Or **Load sample** to drop a synth tone.
2. Go to **Model & Cost**, paste an OpenRouter key (`sk-or-…`), **Connect**.
   Usage/credit shows live; this-session spend accrues below it.
3. In **Queue**, click **Transcribe all** (runs in parallel) or per-row
   **Transcribe**. Each row shows status + cost.
4. Click **Open ▸** on a row for the per-recording panel: audio player,
   per-item model + **Re-transcribe**, transcript, and an **Advanced** section
   (multi-model parallel runs + version history + per-file cost).
5. **🔎 Debug** tab (right) shows every request/response. **Bundle & Send** zips
   transcripts (± audio) or sends an encrypted share via SG/Send.

### From the JS API
```js
await window.__tool /* ready after the `tool:ready` event */;
await window.__tool.setApiKey({ apiKey: 'sk-or-...' });        // configure key
await window.__tool.addFiles({ files: fileList });             // ingest
const [{ id }] = await window.__tool.getItems();
await window.__tool.transcribeItem({ id });                    // transcribe one
await window.__tool.transcribeModels({ id, models: ['google/gemini-3.5-flash','openai/gpt-audio'] }); // parallel
console.log(await window.__tool.getTranscript({ id }));
console.log(await window.__tool.getCostSummary());             // per-file + session
console.log(await window.__tool.getExchanges());               // provenance log
```

---

## 3. Architecture

Three tiers (per the repo's three-tier model): **core/** (pure JS), **components/**
(reusable UI elements), **tools/** (this, composing the others). This tool is a
*consumer* — it imports core + components, never the reverse.

### Boot
`index.html` is a 3-line manifest-loader bootstrap. `manifest.json` loads CSS +
component JS in phases, then the phase-3 **entry** `api/audio-transcribe-api.js`
`init()`, which: builds state → wires the method groups → registers all
`SgToolApi` actions → `activate()` (publishes `window.__tool`, fires
`tool:ready`) → `mountShell()`.

### File map
```
index.html               # manifest-loader bootstrap + <sg-site-header> banner
manifest.json            # deps + phased loader + api: section + skills
api/
  audio-transcribe-api.js  # ENTRY: SgToolApi registration, the LLM transport, init()
  audio-transcribe-events.js # frozen AT_EVENTS constants
  audio-models.js          # curated model id list + metadata (single point of curation)
  audio-format.js          # 3-tier blob -> OpenRouter-supported data URL
  api-source.js            # addFiles / mic record / getRecordingStream / queue ops
  api-transcribe.js        # runVersion + transcribeItem + transcribeModels + cost summary
  api-batch.js             # transcribeAll (parallel worker pool)
  audio-zip.js             # session bundle -> .zip (JSZip CDN lazy-load)
  api-send.js              # downloadZip + sendViaSgSend (<sg-send-drop>)
  openrouter-cost.js       # fetch exact charged cost by generation id
  releases.js              # changelog (getReleases + Releases dev tab)
  samples.js               # built-in sample audio (synth tone) for testing
ui/
  state.js                 # EventTarget queue store + version history
  ui-shell.js              # sg-layout assembly + per-recording tab orchestration
  ui-source.js             # record + dropzone + sample + live viz
  ui-model.js              # model picker + key + connect
  ui-queue.js              # batch queue rows
  ui-item-panel.js         # per-recording detail (player, re-transcribe, advanced/versions)
  ui-bundle.js             # bundle/send
  ui-debug.js              # provenance panel (requests/responses)
dev-panel.js + markdown.js # bottom JS-API dev panel (Skills/Releases/Explorer/Console/Manifest)
styles/audio-transcribe.css
skills/SKILL__{human,browser,api}.md
README.md                # this file
```

### Data flow (one transcription)
`item.blob` → `audio-format.toSupportedDataUrl` (decode if needed) →
`api-transcribe.buildMessages` (OpenRouter `binary_file` message) → the
**isolated transport** (`makeIsolatedTransport`) → `<sg-llm-request>` →
`fetch(/chat/completions)` → response (`content`, `usage`, generation `id`) →
appended as a **version** on the item → deferred exact-cost lookup by generation
id → state `change` event → UI patches.

### The isolated transport (important)
Each LLM request runs on its **own** throwaway `[data-llm-bus]` cell + a fresh
`<sg-llm-request>`. This is what makes **parallel** transcription safe. Earlier a
single shared `<sg-llm-request>` would drop a 2nd concurrent send (its `_busy`
guard) while **both** waiting promises resolved on the one response — so two
files came back with the same transcript and only one `/chat/completions` request
fired. The isolated transport fixed that root cause and removed the serial-only
limit. (Regression test: `tests/playwright/audio-transcribe-parallel-smoke.js`.)

### Version model
An item holds `versions: [{ vid, model, status, text, costUsd, costPending,
promptTokens, completionTokens, latencyMs, generationId, ts, error? }]` plus a
`selectedVid`. Re-transcribing **appends** a version (history is kept). The
item's top-level fields (`transcript`, `model`, `status`, `costUsd`, …) **mirror**
the selected version, so the Queue row / `downloadZip` / `getTranscript` are
unchanged.

---

## 4. The `.opus` / format strategy

`audio-format.js` is a three-tier never-fail path to an OpenRouter-acceptable
data URL:
1. **Pass-through** — `mp3/m4a/wav/ogg/flac/aac` go as-is.
2. **Native decode** — `AudioContext.decodeAudioData` → WAV.
3. **WASM Opus decode** → WAV via `core/sg-audio-decode` (lazy-loads
   `ogg-opus-decoder`; `.opus` prefers this outright). Works on every browser
   incl. Safari/iOS; the WASM is cached via `core/sg-wasm-cache`.

---

## 5. JS API reference

`window.__tool` (the `SgToolApi`) after `tool:ready`. **Every registered action
returns a Promise** (even "sync" ones — don't use a result without `await`).

| Action | params | returns / notes |
|---|---|---|
| `setApiKey` | `{ apiKey, model? }` | persists + connects. **Use this for headless/agentic key config.** |
| `connect` | `{ apiKey, model? }` | fires `llm:connected` (cost view + transport). |
| `addFiles` | `{ files }` File[]/FileList | `{ added[], rejected[] }`; rejects non-audio/empty/oversize. |
| `loadSample` | `{ id }` | drop a built-in sample (see `samples.js`). |
| `startRecording` / `stopRecording` | `{}` | mic record; stop adds one item (guards 0-byte). |
| `getItems` / `getItem` | `{ id? }` | serialisable snapshot (no Blob); items include `versions[]`. |
| `removeItem` / `clearAll` | `{ id }` / `{}` | mutate the queue. |
| `listModels` | `{}` | curated `[{ id,label,cost,speed,available,default }]`. |
| `setModel` | `{ model, id? }` | active model, or one item's model. |
| `transcribeItem` | `{ id, model? }` | transcribe one (appends a version); throws on failure. |
| `transcribeModels` | `{ id, models[] }` | **parallel** multi-model; each a version; never throws. |
| `transcribeAll` / `transcribe` | `{ concurrency? }` | batch (parallel pool, default 4). |
| `getTranscript` | `{ id? }` | one or all transcripts. |
| `getCostSummary` | `{}` | `{ sessionUsd, sessionPending, perItem[] }`. |
| `getExchanges` | `{}` | provenance log (newest first, ≤50). |
| `getReleases` | `{}` | changelog `[{ version,date,summary,changes[] }]`. |
| `downloadZip` | `{ include:{audio?,transcripts?} }` | build + download a `.zip`. |
| `sendViaSgSend` | `{ include? }` | encrypted share via `<sg-send-drop>`; needs a send token. |

**Events** (on `window`, names in `AT_EVENTS`): `at:recording:started/stopped`,
`at:item:added/removed`, `at:model:changed`, `at:transcribe:started/progress/complete/error`,
`at:batch:started/progress/complete`, `at:llm:exchange` (provenance),
`at:bundle:created`, `at:send:started/complete/error`, `at:reset`. Plus the
SgToolApi `tool:ready`.

---

## 6. Models & cost

- Curated in **`api/audio-models.js`** (the single point of curation): an id
  array + a metadata map (`label`, `cost`, `speed`, `available`). Available
  models use the chat `input_audio` path; gated STT entries (`available:false`)
  await a Phase-2 `/audio/transcriptions` module.
- **Adding a model:** add the id to `AUDIO_MODEL_IDS` + a `MODEL_METADATA` row.
  Verify it has live endpoints first (`https://openrouter.ai/api/v1/models/<id>/endpoints`)
  — ids without endpoints 404 and show as a graceful **error version**.
- **Cost:** the OpenRouter response carries token counts and a generation `id`;
  the inline cost (if any) shows immediately, then `openrouter-cost.js` looks up
  the **exact** charged cost a couple seconds later. Surfaced **per transcription**
  (each version), **per file** (panel), and **per session** (Model & Cost tab).

---

## 7. Development

### Run locally
```bash
./scripts/run-locally.sh          # serves the IFD-layered tree on :10063
# http://localhost:10063/en-gb/audio-transcribe/
```

### Test
```bash
node sgraph_ai_tools__static/tests/audio-transcribe-smoke.js     # Node unit/integration (no browser)
# Playwright (needs the dev server + `npm i playwright`):
node sgraph_ai_tools__static/tests/playwright/audio-transcribe-boot-smoke.js
node sgraph_ai_tools__static/tests/playwright/audio-transcribe-parallel-smoke.js
```
The Node smoke test imports the **real** modules and drives the **real**
`SgToolApi` + a fake DOM (it caught the original boot crash). The Playwright
tests verify the served page boots clean and that concurrent transcriptions
don't cross-talk.

### Conventions (match the surrounding code)
- Vanilla ES modules, named exports, JSDoc on exports, files small
  (split by concern: `api/*` state/logic, `ui/ui-*` one per panel).
- No frameworks, no build step, no localStorage in core (the tool persists only
  the OpenRouter key + send token, by exception).
- Core imports from a tool file use the **deep-relative** path (e.g.
  `../../../../../../../core/…`) so they resolve under Node tests too (see
  `ui/ui-shell.js`, `api/audio-format.js`). Component element JS is loaded via the
  manifest (absolute `/components/…`).

### Adding a feature (checklist)
1. Logic in `api/*` (testable), UI in a `ui/ui-*.js`. Register any new action in
   the entry + document it in `manifest.json`'s `api.actions`.
2. Add a Node smoke test (and a Playwright check if it's DOM/LLM-dependent).
3. **Bump the version** (`manifest.json` + the `SgToolApi` version in the entry)
   and add a `RELEASES` entry in `api/releases.js` — **same commit**. The badge +
   Releases tab + `getReleases()` all read this.
4. Run locally + Playwright-screenshot the change before pushing.
5. Update this README + the reality document if the surface changed.

---

## 8. Reuse (what this tool imports)

**core:** `sg-tool-api`, `manifest-loader`, `sg-layout`, `sg-audio` (record),
`sg-audio-decode` + `sg-wasm-cache` (WASM opus). **components:** `sg-llm-request`
(OpenRouter fetch + audio wire-format), `sg-send-drop` (encrypted send),
`sg-site-header` (banner), `sg-openrouter-key-stats` (usage/cost view),
`sg-audio-viz` (recording waveform), `sg-tool-api-{console,explorer,manifest}`
(dev panel). All are version-pinned in `manifest.json` and importable from
`*.tools.sgraph.ai`.

---

## 9. Gotchas & limitations

- **Concurrency is correctness-sensitive.** Only parallelise through the isolated
  transport; never reintroduce a single shared `<sg-llm-request>` for concurrent
  requests.
- **STT models are gated** (`available:false`) until a dedicated
  `/audio/transcriptions` module exists; chat `input_audio` is the v1 path.
- **Send requires a live `send.sgraph.ai` + access token** (out of repo).
- **Mobile recording** uses a short MediaRecorder timeslice (chunks accumulate)
  to avoid 0-byte takes; a truly empty recording surfaces a clear error.
- The tool **resells nothing** — it's BYOK (the user's OpenRouter key). A managed
  credit/proxy model is a separate proposal (see the architect docs).
