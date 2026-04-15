# Voice Memo — Browser Skill

Access the Voice Memo tool API via `window.__tool` in the browser console.

## Setup & State

```js
// Check current state
window.__tool.getState()
// → { sessionId, sessionFolder, recording, segmentCount, tinyModelReady, baseModelReady, transcriptLength }

// Download and initialise Whisper WASM models
await window.__tool.runSetup()
// → { tinyModelReady: true, baseModelReady: true }
```

## Recording

```js
// Start recording (requires runSetup first)
const session = await window.__tool.startRecording({ segmentDurationSeconds: 30 })
// → { sessionId: '2026-04-15-abc12345', sessionFolder: '/voice-memos/...' }

// Stop recording
const result = await window.__tool.stopRecording()
// → { sessionId, segmentCount: 3 }
```

## Transcript

```js
// Get current transcript text
const tx = window.__tool.getTranscript()
// → { text: '...', sessionId, sessionFolder }
```

## Notes

- All audio stays in the browser. Nothing is uploaded.
- Models are cached by the browser via OPFS/Cache API — no re-download on reload within the same session.
- VFS paths: `/voice-memos/{sessionId}/segment-001.webm`, `/voice-memos/{sessionId}/transcript-live.md`
