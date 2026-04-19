# Video Recorder — JS API Reference

## Access
`window.__tool` after `tool:ready` fires.

## Methods

| Method | Params | Returns | Async |
|--------|--------|---------|-------|
| `connect` | `{}` | `{ ok: true }` | yes |
| `setMode` | `{ mode: string }` | `{ mode, supported: bool }` | no |
| `startPreview` | `{}` | `{}` | yes |
| `stopPreview` | `{}` | `{}` | no |
| `startRecording` | `{ format?: 'webm'\|'mp4' }` | `{}` | yes |
| `stopRecording` | `{}` | `{ durationMs, sizeBytes }` | yes |
| `newRecording` | `{}` | `{}` | no |
| `saveSendFile` | `{ filename?: string, accessToken?: string }` | `{ token, shareUrl }` | yes |
| `saveFolder` | `{ folderName?: string, screenshots?: bool }` | `{ folderId }` | yes |
| `getStatus` | `{}` | `RecordingStatus` | no |
| `getConfig` | `{}` | `RecordingConfig` | no |
| `setConfig` | `Partial<RecordingConfig>` | `void` | no |

## Types

```ts
type RecordingMode =
  'audio' | 'camera' | 'screen' |
  'camera+audio' | 'screen+audio' |
  'camera+screen' | 'camera+screen+audio';

interface RecordingConfig {
  mode:               RecordingMode;
  format:             'webm' | 'mp4';
  fps:                number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  pipOptions:         { position: 'tr'|'tl'|'br'|'bl'; scale: number };
}

interface RecordingStatus {
  status:     'idle'|'requesting-permissions'|'recording'|'stopped'|'saving'|'error';
  mode:       RecordingMode;
  durationMs: number;
  sizeBytes:  number;
  hasBlob:    boolean;
  lastError:  string | null;
}
```

## Events

All events fire on `window`.

| Event | Detail | Fired when |
|-------|--------|-----------|
| `tool:ready` | `{ instanceId, tool, version }` | `activate()` called |
| `tool:mode:set` | `{ mode }` | mode changed |
| `tool:preview:start` | `{ hasVideo, mode, stream }` | preview stream acquired |
| `tool:preview:stop` | `{}` | preview stopped |
| `tool:record:start` | `{ fps, width, height, format }` | MediaRecorder starts |
| `tool:record:stop` | `{ durationMs, sizeBytes }` | MediaRecorder stops |
| `tool:reset` | `{}` | newRecording() called |
| `tool:save:progress` | `{ target, percent, message }` | upload in progress |
| `tool:save:complete` | `{ target, token?, folderId?, url? }` | save done |
| `tool:error` | `{ step, message }` | any pipeline error |

## SG/Send token
`saveSendFile` reads `localStorage.getItem('sgraph-send-token')` as the platform access token.
Pass `accessToken` explicitly to override: `window.__tool.saveSendFile({ accessToken: 'mytoken' })`.

## Meta API
```js
window.__tool.meta.getMethods()  // ['connect','setMode','startPreview',…]
window.__tool.meta.getVersion()  // { api: '0.1.0', ui: '0.1.48', content: '0.1.0' }
window.__tool.meta.getEvents()   // ['tool:ready','tool:preview:start',…]
window.__tool.meta.health()      // { status: 'ready', methodCount: 12, … }
window.__tool.meta.getLog()      // last 500 API call log entries
```
