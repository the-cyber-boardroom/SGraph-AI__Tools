# Audio Transcribe — JS API Guide

The tool exposes the mandatory `SgToolApi` surface. After `tool:ready`, all
actions are callable on `window.__tool`.

> **Full docs:** see `../README.md` for architecture, the complete action table,
> events, models, cost, testing, and dev guidance. Most-used additions since
> v0.1.0: `setApiKey({apiKey,model?})` (configure the key headlessly),
> `transcribeModels({id,models[]})` (parallel multi-model → one version each),
> `getCostSummary()` (per-file + per-session cost), `getExchanges()` (provenance
> log), `loadSample({id})`, `getReleases()`. Items now carry `versions[]`
> (re-transcribe keeps history; top-level fields mirror the selected version).

## Lifecycle

- `window.__tool` is published when `activate()` runs; the `tool:ready` window event fires `{ instanceId, tool:'audio-transcribe', version }`.
- Data model: a **queue of items**. Each item: `{ id, name, sizeBytes, mimeType, durationMs?, origin:'recording'|'file', model, status:'queued'|'transcribing'|'done'|'error', transcript?, error? }`.
- All `transcribe`/per-row events carry `detail.id`.

## Actions

| Action | async | params | returns |
|---|---|---|---|
| `startRecording` | yes | `{ deviceId?, mimeType? }` | `{ recording:true, mimeType }` |
| `stopRecording` | yes | `{}` | `{ id, name, sizeBytes, mimeType, durationMs }` |
| `addFiles` | yes | `{ files }` (File[]/FileList) | `{ added:[{id,name,sizeBytes,mimeType}], rejected:[{name,code}] }` |
| `getItems` | no | `{}` | `[{ ...item }]` (no Blob) |
| `getItem` | no | `{ id }` | `{ ...item } \| null` |
| `removeItem` | no | `{ id }` | `{ removed:true }` |
| `clearAll` | no | `{}` | `{}` |
| `listModels` | no | `{}` | `[{ id, label, cost, speed, available, default }]` |
| `setModel` | no | `{ model, id? }` | `{ model }` |
| `connect` | yes | `{ apiKey, model? }` | `{ provider:'openrouter', model }` (apiKey masked in the log) |
| `transcribeItem` | yes | `{ id, model?, language? }` | `{ id, text, model, latencyMs }` |
| `transcribeAll` | yes | `{ model?, language?, concurrency? }` | `{ total, done, errors:[{id,code}] }` |
| `transcribe` | yes | `{ model?, language? }` | alias of `transcribeAll` |
| `getTranscript` | no | `{ id? }` | `{ id, text, model }` or `[{...}]` |
| `downloadZip` | yes | `{ include:{audio?,transcripts?}, items?, name? }` | `{ ok:true, count, zipSize, name }` |
| `sendViaSgSend` | yes | `{ include?, items?, accessToken?, name? }` | `{ shareUrl, token }` |

### Errors (`err.code`)

- `not-audio` / `too-large` — per-file rejections from `addFiles`.
- `unknown-item` — bad `id`.
- `no-model` / `model-unavailable` — no model, or a gated STT model on the chat path.
- `empty` — nothing transcribed to bundle/send.
- `send-auth-required` — no SG/Send token; the component shows its auth prompt.
- `send-error` / `no-send-component` — send failures.

## Events (`AT_EVENTS`, all `at:*`, on `window`)

`at:recording:started`, `at:recording:stopped`, `at:item:added`, `at:item:removed`,
`at:model:changed`, `at:transcribe:started`, `at:transcribe:progress`,
`at:transcribe:complete`, `at:transcribe:error`, `at:batch:started`,
`at:batch:progress {done,total}`, `at:batch:complete {done,total,errors}`,
`at:bundle:created`, `at:send:started`, `at:send:complete {shareUrl,token}`,
`at:send:error`, `at:reset`. Plus the framework `tool:ready`.

## Dependencies

- LLM fetch: `<sg-llm-request>` v0.1.6 via the `llm:send` / `llm:request-complete` bus (chat `input_audio` path; no dedicated STT endpoint in v1).
- `.opus`/webm decode: `core/sg-audio-decode` (lazy WASM Opus decoder, Cache-API persisted via `core/sg-wasm-cache`).
- ZIP: JSZip lazy-loaded from CDN (only when `downloadZip`/`sendViaSgSend` is called).
- Send: `<sg-send-drop>` — **requires a live send.sgraph.ai API + an access token** (external runtime dependency; token not persisted in v1).

## End-to-end examples

```js
// (a) Batch many files → download transcripts zip.
await __tool.connect({ apiKey: 'sk-or-...' });
await __tool.addFiles({ files: fileListFromInput });        // .opus included
await __tool.transcribeAll();                               // concurrency cap 2
await __tool.downloadZip({ include: { audio: false, transcripts: true } });

// (b) Record → stop → transcribe one → read transcript.
await __tool.startRecording({});
// ... speak ...
const { id } = await __tool.stopRecording();
await __tool.transcribeItem({ id });
const { text } = __tool.getTranscript({ id });

// (c) Transcribe all → send an encrypted share (audio + transcripts).
await __tool.transcribeAll();
const { shareUrl } = await __tool.sendViaSgSend({ include: { audio: true, transcripts: true } });
```
