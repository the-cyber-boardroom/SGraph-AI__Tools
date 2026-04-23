# Video Creator — JS API Reference

## Access
`window.__tool` after `tool:ready` fires.

## Methods

| Method | Params | Returns | Async |
|--------|--------|---------|-------|
| `connect` | `{}` | `{ ok: true }` | yes |
| `loadSlides` | `{ files: File[] }` | `{ count, slides: SlideInfo[] }` | yes |
| `setNarration` | `{ slideIndex: number, text: string }` | `void` | no |
| `generateAudio` | `{ voice?, speed? }` | `{ durations: number[] }` | yes |
| `record` | `{ fps?, bitrateKbps? }` | `{ webmBlob: Blob }` | yes |
| `stopRecording` | `{}` | `{ webmBlob: Blob\|null }` | no |
| `download` | `{ blob: Blob, filename: string }` | `void` | no |
| `getStatus` | `{}` | `PipelineStatus` | no |
| `getConfig` | `{}` | `VideoConfig` | no |
| `setConfig` | `Partial<VideoConfig>` | `void` | no |

## Types

```ts
interface SlideInfo {
  index:   number;
  name:    string;   // original filename
  dataUrl: string;   // base64 data URL
}

interface VideoConfig {
  voice:       string;  // Kokoro voice ID
  speed:       number;  // 0.5–2.0
  fps:         number;  // 24 | 30 | 60
  bitrateKbps: number;  // default 2500
  width:       number;  // canvas px, default 1280
  height:      number;  // canvas px, default 720
}

type PipelineStatus = 'idle' | 'loading-model' | 'ready' | 'generating-audio' | 'recording' | 'converting' | 'done' | 'error';
```

## Events

All events fire on `window` with `instanceId` in detail.

| Event | Detail | When |
|-------|--------|------|
| `tool:ready` | `{ instanceId, tool, version }` | activate() called |
| `tool:slides:loaded` | `{ count, slides }` | loadSlides() done |
| `tool:audio:progress` | `{ slideIndex, total }` | each TTS chunk |
| `tool:audio:complete` | `{ durations: number[] }` | all audio done |
| `tool:record:start` | `{ fps }` | recording begins |
| `tool:record:stop` | `{ durationMs }` | recording ends |
| `tool:convert:start` | `{}` | FFmpeg starts |
| `tool:convert:progress` | `{ ratio }` | FFmpeg progress |
| `tool:convert:complete` | `{ mp4Blob }` | MP4 ready |
| `tool:error` | `{ step, message }` | any error |

## Meta API
```js
window.__tool.meta.getMethods()   // ['connect','loadSlides','setNarration',…]
window.__tool.meta.getVersion()   // { api: '0.1.0', ui: '0.1.47', content: '0.1.0' }
window.__tool.meta.getEvents()    // ['tool:slides:loaded', 'tool:audio:progress',…]
window.__tool.meta.health()       // { status: 'ready', methodCount: 10, … }
window.__tool.meta.getLog()       // last 500 API call log entries
```
