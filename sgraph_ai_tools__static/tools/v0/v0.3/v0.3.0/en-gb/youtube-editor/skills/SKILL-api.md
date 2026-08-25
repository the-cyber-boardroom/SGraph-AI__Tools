# YouTube Editor — JS API Spec

Tool name: `youtube-editor`. Available as `window.__tool['youtube-editor']` after `tool:ready`.

OAuth scope: `https://www.googleapis.com/auth/youtube` (full read + edit + delete + thumbnails). Token cached in `localStorage['sg-auth-token-youtube-editor']`.

## Methods

### Auth

| Method | Returns | Notes |
|---|---|---|
| `setClientId({ clientId })` | `{ clientId }` | Persists OAuth client ID to localStorage. |
| `connect({ clientId?, silent? })` | `Promise<{ ok }>` | Cache → silent grant → interactive popup. |
| `disconnect()` | `{}` | Clears the cached token (does NOT revoke at Google). |

### Channel + listing

| Method | Returns | Notes |
|---|---|---|
| `getMyChannel()` | `Promise<Channel>` | 1 unit. Sets `state.channel`. |
| `listMyUploads({ pageToken?, pageSize? })` | `Promise<{ items, nextPageToken, totalResults, uploadsPlaylistId }>` | 1 unit/page. Up to 50 per page. |

### Read + edit one video

| Method | Returns | Notes |
|---|---|---|
| `loadVideo({ id })` | `Promise<Video>` | 1 unit. snippet + status + statistics. |
| `updateVideo({ id, patch })` | `Promise<Video>` | 50 units. `patch = { snippet?, status? }`. |
| `setThumbnail({ id, blob })` | `Promise<Thumbnails>` | 50 units. ≤ 2 MB JPG/PNG. |
| `deleteVideo({ id })` | `Promise<{ id }>` | 50 units. **Irreversible.** |

### Upload

| Method | Returns | Notes |
|---|---|---|
| `uploadVideo({ file, metadata })` | `Promise<{ id, url, snippet, status }>` | 1,600 units. Resumable single-PUT. |

### Status / health

| Method | Returns | Notes |
|---|---|---|
| `getStatus()` | snapshot object | sync |
| `health()` | snapshot object | sync, smoke-friendly |
| `meta.*` | (inherited from SgToolApi) | manifest, methods, skills, version, events, log |

## Events (CustomEvent on `window`)

| Name | When | Detail |
|---|---|---|
| `tool:ready` | `activate()` | `{ instanceId, tool, version }` |
| `tool:youtube:connected` | OAuth grant or cache hit | `{ expiresAt, fromCache?, scope }` |
| `tool:youtube:disconnected` | `disconnect()` | `{}` |
| `tool:youtube:channel-loaded` | `getMyChannel()` | `{ channel }` |
| `tool:youtube:videos-loaded` | list page returned | `{ items, totalResults, page }` |
| `tool:youtube:video-selected` | grid row clicked (UI only) | `{ id, video }` |
| `tool:youtube:video-loaded` | `loadVideo()` | `{ video }` |
| `tool:youtube:video-saved` | `updateVideo()` succeeded | `{ video, patch }` |
| `tool:youtube:video-deleted` | `deleteVideo()` succeeded | `{ id }` |
| `tool:youtube:thumbnail-set` | `setThumbnail()` succeeded | `{ id, thumbnails }` |
| `tool:youtube:upload:start` | `uploadVideo()` started | `{ fileName, fileSize, metadata }` |
| `tool:youtube:upload:progress` | XHR progress event | `{ loaded, total, percent }` |
| `tool:youtube:upload:complete` | upload finished | `{ id, url, snippet, status }` |
| `tool:error` | any pipeline error | `{ step, message }` |

## Storage

| Key | Contents |
|---|---|
| `localStorage['sg-youtube-client-id']` | OAuth client ID |
| `localStorage['sg-auth-token-youtube-editor']` | `{ accessToken, expiresAt, scope, ... }` |

Both move to the SGraph vault in a future minor version. The token-cache helpers all live in `youtube-editor-pipeline.js` so the swap is one file.

## Modules used

- `core/youtube-upload/v0/v0.1/v0.1.0/sg-youtube-upload.js` — `requestAccess`, `YouTubeUpload` (resumable insert)
- `core/youtube-api/v0/v0.1/v0.1.0/sg-youtube-api.js` — `YouTubeApi` (read/edit/delete/thumbnail)
- `components/video/manage/sg-youtube-videos/v0/v0.1/v0.1.0/` — list grid
- `components/video/manage/sg-youtube-video-editor/v0/v0.1/v0.1.0/` — edit form
- `components/upload-dropzone/v1/v1.0/v1.0.0/` — file dropzone for the upload tab
