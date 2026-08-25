# YouTube Upload — JS API Spec

Tool name: `youtube-upload`. Available via `window.__tool['youtube-upload']` after the `tool:ready` event.

## Methods

### `setClientId({ clientId }) → { clientId }`
Persist the Google OAuth client ID into `localStorage['sg-youtube-client-id']`. Idempotent.

### `connect({ clientId?, silent? }) → Promise<{ ok: true }>`
Acquire a `youtube.upload` access token.
- If a non-expired token is already cached → resolves immediately, emits `tool:youtube:connected`.
- Else if `silent: true` → calls GIS with `prompt: ''` (no popup); fails if consent not previously granted.
- Else → opens the Google consent popup. Stores the resulting token in `localStorage['sg-auth-token-youtube-upload']`.

### `disconnect() → {}`
Clears the cached token. Does NOT revoke at Google. Emits `tool:youtube:disconnected`.

### `setFile({ file }) → { fileName, fileSize }`
Set the in-memory file to upload. Pass a `File` or `Blob`. Resets any prior result. Emits `tool:youtube:file-set`.

### `uploadVideo(metadata) → Promise<{ id, url, snippet, status }>`
Upload the file currently set. Requires `connect()` first.

`metadata`:
| Key | Type | Default |
|-----|------|---------|
| `title`         | string (required, ≤ 100 chars) | — |
| `description`   | string (≤ 5000 chars) | `''` |
| `tags`          | string[] | `[]` |
| `categoryId`    | number | `22` (People & Blogs) |
| `privacyStatus` | `'private' \| 'unlisted' \| 'public'` | `'unlisted'` |
| `selfDeclaredMadeForKids` | boolean | `false` |

Resolves with the YouTube video resource subset. The full `url` is `https://www.youtube.com/watch?v=<id>`.

If the API returns 401, the cached token is cleared so the next call re-auths.

### `getStatus() → { connected, hasFile, fileName, fileSize, status, progress, lastVideoId, lastVideoUrl, lastError, expiresInMs }`
Synchronous snapshot.

### `health() → { ok, connected, hasFile, status, progress, clientIdSet, expiresInMs, lastVideoUrl }`
Smoke-test friendly. `ok` is `true` when the tool is in a usable or just-finished state, `false` only when the last operation errored.

### `meta.*` (inherited from SgToolApi)
- `meta.getManifest()` — full manifest.json
- `meta.getMethods()` — registered method names
- `meta.getSkills()` — `{ human, browser, api }` SKILL contents
- `meta.getEvents()` — event names this tool may emit
- `meta.health()` — base health snapshot
- `meta.getLog()` — last 500 method invocations

## Events (CustomEvent on `window`)

| Name | When | Detail |
|------|------|--------|
| `tool:ready` | activate() called | `{ instanceId, tool, version }` |
| `tool:youtube:connected` | OAuth grant succeeded or cache hit | `{ expiresAt, fromCache? }` |
| `tool:youtube:disconnected` | `disconnect()` | `{}` |
| `tool:youtube:file-set` | `setFile()` (any source) | `{ fileName, fileSize, type }` |
| `tool:youtube:upload:start` | `uploadVideo()` started | `{ fileName, fileSize, metadata }` |
| `tool:youtube:upload:progress` | XHR progress event | `{ loaded, total, percent }` |
| `tool:youtube:upload:complete` | Upload finished 2xx | `{ id, url, snippet, status }` |
| `tool:error` | Any pipeline error | `{ step, message }` |

The `<sg-youtube-upload>` component also dispatches a composed
`youtube-file-set` DOM event (`{fileName, fileSize, type}`) when its
internal picker is used — the tool listens for that and forwards to
`api.setFile()` so `state.file` and `tool:youtube:file-set` stay in sync
regardless of which UI path supplied the file (outer `<sg-upload-dropzone>`
or the component's own click/drop area).

## Storage

- `localStorage['sg-youtube-client-id']` — OAuth client ID
- `localStorage['sg-auth-token-youtube-upload']` — `{ accessToken, expiresAt, scope, ... }`

Both will be migrated to the SGraph vault in a future minor version. Keep the read/write surface in `youtube-token-cache.js` stable to make that swap a one-file change.

## Modules

- `core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js` — `requestAccess`, `class YouTubeUpload`
- `components/video/upload/sg-youtube-upload/v0/v0.1/v0.1.0/` — `<sg-youtube-upload>` Web Component
