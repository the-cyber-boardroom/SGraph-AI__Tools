# Audio Transcribe — JS API Guide

The tool exposes the mandatory `SgToolApi` surface. After `tool:ready`, all
actions are callable on `window.__tool`. Every action returns a **Promise**
(even `async:false` ones).

> **Integration brief** (for wiring into a vault / the main website):
> `library/api/v0.1.93__audio-transcribe__integration-and-capabilities.md`.
> **Full docs:** `../README.md`. **Authoritative API:** `../manifest.json` (`api`).
> The minimal **`live-transcribe`** variation implements the Live + read + cost
> subset of this surface.

## Lifecycle & data model

- `window.__tool` is published when `activate()` runs; `tool:ready` fires `{ instanceId, tool:'audio-transcribe', version }`.
- A **queue of items**. `item = { id, name, sizeBytes, mimeType, durationMs?, origin:'recording'|'file', model, status:'queued'|'transcribing'|'done'|'error', transcript?, error?, errorCode?, generationId?, costUsd?, costPending?, versions:[…] }`. Re-transcribe **appends a version**; top-level fields mirror the selected version.
- `getItems()` is authoritatively an **array** (no Blob).

## Actions

| Action | async | params | returns |
|---|---|---|---|
| `startRecording` | yes | `{deviceId?,mimeType?}` | `{recording:true,mimeType}` |
| `stopRecording` | yes | `{}` | `{id,name,sizeBytes,mimeType,durationMs}` |
| `addFiles` | yes | `{files}` (File[]/FileList) | `{added:[{id,name,sizeBytes,mimeType}],rejected:[{name,code}]}` |
| `loadSample` | yes | `{id}` (`tone-a`/`tone-b`) | `{added,rejected}` |
| `getItems` | no | `{}` | `[item]` |
| `getItem` | no | `{id}` | `item\|null` |
| `removeItem` | no | `{id}` | `{removed:true}` |
| `clearAll` | no | `{}` | `{}` |
| `listModels` | no | `{}` | `[{id,label,cost,speed,available,default}]` |
| `setModel` | no | `{model,id?}` | `{model}` |
| `connect` | yes | `{apiKey,model?}` | `{provider:'openrouter',model}` (key masked) |
| `setApiKey` | yes | `{apiKey,model?}` | `{ok,present,model}` (persists + connects) |
| `transcribeItem` | yes | `{id,model?}` | `{id,text,model,latencyMs,vid,generationId,usage:{promptTokens,completionTokens,costUsd}}` |
| `transcribeModels` | yes | `{id,models:[]}` | `{id,results:[{vid,model,ok}]}` (parallel, one version each) |
| `cancelItem` | no | `{id}` | `{cancelled:N}` (aborts in-flight upstream requests) |
| `transcribeAll` | yes | `{concurrency?}` | `{total,done,errors:[{id,code}]}` |
| `transcribe` | yes | `{}` | alias of `transcribeAll` |
| `getTranscript` | no | `{id?}` | `{id,text,model}` or `[{…}]` |
| `startLive` | yes | `{vad?:{speechThreshold,silenceThreshold,endpointMs,preRollMs,minSpeechMs,maxUtteranceMs,frameMs}}` | `{live:true,mimeType,sampleRate,vad}` |
| `stopLive` | yes | `{finalPass?}` | `{id,text,durationMs}` |
| `synthesize` | yes | `{text,mode,voice?,model?,apiKey?,returnAudio?}` | `{mode,durationMs,sizeBytes,mimeType,generationId?,audioDataUrl?}` |
| `addSynthesized` | yes | `{text,mode,voice?,name?}` | `{added,rejected}` |
| `ask` | yes | `{text,model?,context?}` | `{text,model,generationId,usage}` |
| `getCostSummary` | no | `{}` | `{sessionUsd,sessionPending,perItem:[{id,name,usd,pending,versions}],auxUsd,auxPending}` |
| `setSpendCap` | no | `{usd}` (null clears) | `{cap}` |
| `getExchanges` | no | `{}` | `[exchange]` (last 50; no audio bytes) |
| `getReleases` | no | `{}` | `[{version,date,summary,changes[]}]` |
| `downloadZip` | yes | `{include:{audio?,transcripts?},items?,name?}` | `{ok,count,zipSize,name}` |
| `sendViaSgSend` | yes | `{include?,items?,accessToken?,name?}` | `{shareUrl,token}` |

### Errors (`err.code`)

- Ingest: `not-audio` / `too-large` / `empty`.
- `unknown-item` · `no-model` / `model-unavailable` · `cancelled` · `empty-recording`.
- **Key/quota (from HTTP status):** `key-invalid` (401) · `budget-exceeded` (402) · `key-exhausted` (403) · `rate-limited` (429). Rejections carry `{code,status}`.
- **`budget-cap`** — the `setSpendCap` limit was reached.
- **`mic-unavailable`** — Live in a sandboxed/embedded frame (no `navigator.mediaDevices`).
- TTS: `no-text` / `no-key` / `tts-http`. Send: `send-auth-required` / `send-error`. Generic: `llm-error`.

## Events (`AT_EVENTS`, all `at:*`, on `window`)

`recording:started/stopped`, `item:added/removed`, `model:changed`,
`transcribe:started/progress/complete/error{code}`, **`llm:exchange`** (provenance),
**`live:started{mimeType,sampleRate,vad}`**, **`live:update{text,elapsedMs,final}`**,
**`live:segment{seq,sizeBytes,blob,elapsedMs,latencyMs,text,final,ok,generationId?,costUsd?,costPending?,delta?}`**,
**`live:stopped{id,text}`**, **`live:error{error,code?}`**, `batch:started/progress/complete`,
`bundle:created`, `send:started/complete/error`, `reset`. Plus framework `tool:ready`.

## Live mode (VAD)

Audio is split by **energy Voice Activity Detection**: each **complete utterance**
(a phrase cut at a pause) is sent as a clean WAV — so clips transcribe cleanly and
play back. Tune via `startLive({vad:{speechThreshold, endpointMs, …}})`. Live text
is reassembled **by sequence number** (out-of-order responses are handled). On
stop, `finalPass` (default true) does one clean full-quality pass over the
continuous take for the saved transcript. Live spend is recorded in `state.aux`
→ counts toward `getCostSummary().auxUsd`, the session total, and the spend cap.
`at:live:segment` carries the sent WAV `blob`.

## Dependencies

- LLM fetch: `<sg-llm-request>` v0.1.6 (`llm:send`/`llm:request-complete`; chat `input_audio` path) — forwards HTTP `status` (→ typed errors).
- `.opus`/webm decode: `core/sg-audio-decode` (+ `core/sg-wasm-cache`, vault-safe).
- Cloud TTS: **`core/sg-tts-openrouter`** (versioned). Local TTS: `core/sg-tts` (Kokoro).
- ZIP: JSZip lazy CDN. Send: `<sg-send-drop>` (needs a live send.sgraph.ai + token).

## End-to-end examples

```js
// Headless: inject key → batch → read cost.
await __tool.setApiKey({ apiKey: 'sk-or-…' });
await __tool.addFiles({ files });                  // .opus ok
await __tool.transcribeAll();                      // parallel pool
const cost = await __tool.getCostSummary();        // {sessionUsd, …, auxUsd}

// Live with a chosen chunk interval + cheap (no final pass).
await __tool.startLive({ vad: { speechThreshold: 0.02, endpointMs: 600 } });
// … speak …
const { id, text } = await __tool.stopLive({ finalPass: false });

// Sponsored-key guard + scriptable chat.
await __tool.setSpendCap({ usd: 0.25 });
const a = await __tool.ask({ text: 'What was decided?' });  // {text,generationId,usage}
```
