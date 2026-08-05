# Video Publisher — JS API Spec

Tool name `video-publisher` · API 0.1.0 · `window.__tool` live after
`tool:ready`. All calls return Promises (SgToolApi). The manifest's `api`
section is authoritative for the event catalogue.

## Actions (28)

**Record** — thin delegations to `core/sg-recorder` v0.1.0; `tool:record:*`
events fire unchanged.

| Action | Params | Returns |
|---|---|---|
| `setRecordConfig` | `{ mode?, quality?, layout?, recordingMode?, recordingName? }` | config |
| `getRecordConfig` | — | config |
| `startPreview` / `stopPreview` | — | `{ ok }` (camera modes only) |
| `startRecording` | — | `{ ok }` (needs user gesture for screen modes) |
| `pauseRecording` / `resumeRecording` | — | `{ ok }` |
| `stopRecording` | — | `{ filename, byteSize, hasAudioBlob }` — resolves after blobs land in the job |

**Source**

| Action | Params | Returns |
|---|---|---|
| `importFile` | `{ file: File }` | `{ filename, byteSize }` — auto-run starts unless disabled |
| `getJob` / `getStatus` | — | full job snapshot (phase, steps, route, metadata, youtube, costs) |
| `reset` | — | `{ ok }` |
| `setAutoRun` | `{ enabled }` | `{ autoRun }` |

**Pipeline**

| Action | Params | Returns |
|---|---|---|
| `extractAudio` | — | `{ route: 'native'\|'remux'\|'decode', bytes, mime }` |
| `transcribe` | `{ model? }` | `{ text, model, costUsd, generationId }` |
| `getTranscript` | — | `{ text }` |
| `listModels` | — | curated model list (audio-transcribe's) |
| `setApiKey` | `{ apiKey, model? }` | `{ ok }` (persists `sg-openrouter-mgmt-key`) |
| `generateMetadata` | `{ guidance?, model? }` | `{ title, description, tags, costUsd }` |
| `setMetadata` | `{ title?, description?, tags?, privacy? }` | metadata |
| `getMetadata` | — | metadata |
| `getCostSummary` | — | `{ transcriptionUsd, metadataUsd, totalUsd }` |

**Publish**

| Action | Params | Returns |
|---|---|---|
| `setClientId` | `{ clientId }` | `{ clientId }` (shared `sg-youtube-client-id`) |
| `connectYouTube` | `{ silent? }` | `{ ok }` — cache → silent → popup; proactive refresh armed |
| `disconnectYouTube` | — | `{ ok }` |
| `getMyChannel` | — | channel |
| `upload` | — | `{ id, url }` — the ONLY action that sends to YouTube |
| `publish` | `{ file?, model?, guidance?, privacy?, confirm }` | end-to-end; without `confirm:true` stops at ready-to-publish |
| `health` | — | `{ ok, phase, keySet, youtubeConnected, clientIdSet }` |

## Error codes

`no-audio-stream`, `too-large` (25 MB audio cap), `key-missing`,
`key-invalid` / `key-exhausted` / `budget-exceeded` / `rate-limited`
(OpenRouter, typed from HTTP status), `model-unavailable`,
`bad-metadata-json`, `no-transcript`, `no-title`, plus upload failures with
the YouTube API message. Shape: `Error & { code, status? }`; step failures
also fire `vp:step:error { step, code, message }`.

## Storage keys

`sg-openrouter-mgmt-key` · `sg-youtube-client-id` ·
`sg-auth-token-video-publisher` (via sg-auth-tokens, provider
`video-publisher`).

## End-to-end run

```js
await new Promise(r => addEventListener('tool:ready', r, { once: true }));
const t = window.__tool;
await t.setApiKey({ apiKey: OPENROUTER_KEY });

// Either: record in-page…
await t.startRecording();          // …talk…
await t.stopRecording();           // auto-run: audio(native) → transcript → metadata
// …or: await t.importFile({ file: myMp4 });

await new Promise(r => addEventListener('vp:metadata:complete', r, { once: true }));
await t.setMetadata({ privacy: 'public' });
await t.connectYouTube();          // popup unless cached
const { url } = await t.upload();
console.log('published:', url);
```

One-shot equivalent: `await t.publish({ file, privacy: 'public', confirm: true })`.
