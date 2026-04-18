# Voice Memo — API Skill

The Voice Memo tool exposes `window.__tool` (a `SgToolApi` instance) with the following methods.

## Methods

### `getState()` → `object` (sync)

Returns the current tool state snapshot.

```ts
{
  sessionId:        string | null,  // active session ID
  sessionFolder:    string | null,  // VFS path: /voice-memos/{id}
  recording:        boolean,        // is recorder active?
  segmentCount:     number,         // segments captured this session
  tinyModelReady:   boolean,        // whisper-tiny.en loaded?
  baseModelReady:   boolean,        // whisper-base.en loaded?
  transcriptLength: number,         // char count of current transcript
}
```

### `runSetup()` → `Promise<{ tinyModelReady, baseModelReady }>` (async)

Downloads and caches Whisper WASM models via HuggingFace CDN. Results cached in sessionStorage for 4 hours.

### `startRecording(params?)` → `Promise<{ sessionId, sessionFolder }>` (async)

Params: `{ segmentDurationSeconds?: number }` (default: 30)

Requires `runSetup()` to complete first. Creates a new session, starts MediaRecorder in segment mode, begins real-time tiny.en transcription.

### `stopRecording()` → `Promise<{ sessionId, segmentCount }>` (async)

Stops the active recording session. Final segment is delivered and transcribed before resolving.

### `getTranscript()` → `{ text, sessionId, sessionFolder }` (sync)

Returns the full merged transcript text from the editable Transcript panel.

## Events

| Event | When |
|-------|------|
| `tool:ready` | `api.activate()` called |

## Architecture

- **sg-audio** core: segment-based MediaRecorder (`startRecording`, `stopRecording`)
- **sg-whisper** core: HuggingFace transformers.js WASM wrapper (`loadWhisperModel`, `transcribeBuffer`)
- **sg-vfs-bus** + IndexedDB: zero-loss segment persistence
- All processing is local — no network requests for audio
