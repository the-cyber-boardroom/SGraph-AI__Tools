# SG Video Editor — JS API Spec

Tool name: `sg-video-editor`. Available as `window.__tool` after `tool:ready` (single-instance pages). For multi-instance lookup use `window.__tool_registry.find('sg-video-editor')` or `window.__tools[instanceId]`.

All eight methods are registered through `SgToolApi`; calls are logged in the ring buffer (`api.meta.getLog()`). No network, no `localStorage` — assets and project state live in memory.

## Discovery

```js
window.__tool;                              // SgToolApi instance
window.__tool_registry.list();              // [{ toolName, instanceId, api }, ...]
window.__tool.meta.getMethods();            // names of registered methods
window.__tool.meta.health();                // smoke snapshot
```

## Methods

### loadAsset

Probe a video file and register it in the asset registry.

| Param | Type | Required | Notes |
|---|---|---|---|
| `file` | `File` / `Blob` | yes | Must be a `Blob`; mime should be `video/*` |

Returns: `{ assetId: string, duration: number, width: number, height: number }`

Errors: `invalid-arg` if `file` is missing or not a Blob; rejects with `'failed to load video metadata'` if the file is not playable.

```js
const file = document.querySelector('input[type=file]').files[0];
const { assetId, duration } = await window.__tool.loadAsset({ file });
```

### addClip

Append a clip referencing an asset onto a track at a given start time.

| Param | Type | Required | Notes |
|---|---|---|---|
| `trackId` | string | yes | Phase 1: always `'t-video-1'` |
| `assetId` | string | yes | From a prior `loadAsset` |
| `timelineStart` | number | no | Defaults to end of track; snapped to fps |
| `inPoint` | number | no | Defaults to `0`; snapped to fps |
| `outPoint` | number | no | Defaults to asset duration; snapped to fps |
| `clipId` | string | no | Auto-generated if omitted |
| `snap` | boolean | no | When true, an overlapping placement is auto-resolved by flush-abutting the nearest neighbour edge (drag-drop UX) |

Returns: `{ clipId: string }`

Errors: `invalid-arg` for missing `trackId`/`assetId`, unknown ids, or `outPoint <= inPoint`. Throws `Error{code:'overlap'}` if the placement collides on the same track and `snap` couldn't clear it.

```js
const { clipId } = window.__tool.addClip({ trackId: 't-video-1', assetId });
```

### trimClip

Update in/out points of an existing clip. Values clamp to `[0, asset.duration]` and snap to fps.

| Param | Type | Required |
|---|---|---|
| `clipId` | string | yes |
| `inPoint` | number | no (keeps current if omitted) |
| `outPoint` | number | no (keeps current if omitted) |

Returns: `{ clipId }`. Errors: `invalid-arg` if clip unknown or `outPoint <= inPoint`.

### removeClip

Remove a clip from whichever track contains it.

| Param | Type | Required |
|---|---|---|
| `clipId` | string | yes |

Returns: `{ clipId }`. Errors: `invalid-arg` if unknown.

### moveClip

Set `timelineStart` of a clip. Snaps to fps; clamps to `>= 0`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `clipId` | string | yes | |
| `timelineStart` | number | yes | Must be finite |
| `snap` | boolean | no | When true, an overlapping placement is auto-resolved by flush-abutting the nearest neighbour edge |

Returns: `{ clipId, timelineStart }`. Errors: `invalid-arg` if unknown clip or non-finite time. Throws `Error{code:'overlap'}` if the position collides on the same track and `snap` couldn't clear it.

### addTrack

Insert a new video track. Default = appended to the top of the z-order; pass `insertAboveTrackId` to insert directly above an existing track.

| Param | Type | Required | Notes |
|---|---|---|---|
| `kind` | string | no | `'video'` only (default) |
| `name` | string | no | Optional human label |
| `insertAboveTrackId` | string | no | Insert at `index = pos + 1` of the named track. Unknown id falls back to append. |

Returns: `{ trackId }`.

### moveClipToTrack

Atomically move a clip to another track. When `timelineStart` is supplied, the destination overlap test runs against the user's chosen position rather than the clip's stale source start — used by cross-track drag-drop.

| Param | Type | Required | Notes |
|---|---|---|---|
| `clipId` | string | yes | |
| `toTrackId` | string | yes | |
| `timelineStart` | number | no | Defaults to the clip's current start; snapped to fps and clamped to ≥ 0 |
| `snap` | boolean | no | When true, an overlapping destination is auto-resolved by flush-abutting the nearest neighbour edge |

Returns: `{ clipId, fromTrackId, toTrackId, timelineStart }`. Throws `Error{code:'overlap'}` if the destination position collides and `snap` couldn't clear it. Throws `Error{code:'locked'}` if the source or destination track is locked.

### setTrackMuted

Set or clear a track's mute flag. Mute is preview-only and is NOT gated by the lock flag.

| Param | Type | Required |
|---|---|---|
| `trackId` | string | yes |
| `muted` | boolean | yes |

Returns: `{ trackId, muted }`.

### setTrackLocked

Set or clear a track's lock flag. Locked tracks reject `addClip` / `addShapeClip` / `addTextClip` / `moveClip` / `trimClip` / `removeClip` / `removeTrack` and any cross-track move INTO or FROM the locked lane (`Error{code:'locked'}`). The lock-toggle itself, mute, rename, and colour overrides are NOT gated.

| Param | Type | Required |
|---|---|---|
| `trackId` | string | yes |
| `locked` | boolean | yes |

Returns: `{ trackId, locked }`.

### renameTrack

Set or clear a track's display name. Empty / whitespace-only names clear the override; the UI then renders the default `Track N` label. Locked tracks may still be renamed (label is metadata, not content).

| Param | Type | Required |
|---|---|---|
| `trackId` | string | yes |
| `name` | string | yes (`null` / empty clears the override) |

Returns: `{ trackId, name }` (`name === null` when cleared).

### copyClip

Copy a clip's payload (kind / shape / text / transform / crop / asset reference / inPoint / outPoint / colour) to the in-memory clipboard (single slot). The clip's `id` and `timelineStart` are stripped — they are picked at paste time.

Fires a `'clipboard'` event on the internal state target (mirrored onto `<sg-timeline>` via `setClipboardFlags()`).

| Param | Type | Required |
|---|---|---|
| `clipId` | string | yes |

Returns: `{ hasClipboard: true }`. Errors: `invalid-arg` if unknown `clipId`.

### pasteClip

Paste the clipboard payload onto a target track at a chosen time.

| Param | Type | Required | Notes |
|---|---|---|---|
| `targetTrackId` | string | yes | |
| `timelineStart` | number | yes | Must be finite |
| `snap` | boolean | no | Honours `snapToClearSlot` like `addClip` |
| `maxSnapDistance` | number | no | Cap (seconds) for snap walk; default unlimited |

Returns: `{ clipId, trackId, timelineStart }` (or `null` if the clipboard is empty). Errors: `invalid-arg` for empty clipboard / missing target / non-finite time / payload referencing a removed asset; `locked` if the target track is locked.

### hasClipboard

Synchronous check.

Returns: `{ hasClipboard: boolean }`.

### getProject

Return a defensive deep clone of the wrapped project state. Synchronous.

Returns: `{ schemaVersion, project, assets, tracks, operations }` (see schema below).

```js
const json = window.__tool.getProject();
// safe to JSON.stringify — Blob refs are NOT included
```

### setProject

Replace the entire project state. Validates against `composer-schema.validateProject`.

| Param | Type | Required |
|---|---|---|
| `project` | object | yes — wrapped shape |

Returns: `{ ok: true }`. Errors: `invalid-arg` for missing or malformed input.

Note: `setProject` does **not** restore the asset registry. Blob refs must be re-supplied via `loadAsset` calls after the project shape is loaded.

### exportMp4

Render the project to an MP4 Blob via the composer. Plays end-to-end at ~1× realtime; resolves when `MediaRecorder` finalises.

| Param | Type | Required | Default |
|---|---|---|---|
| `preferMp4` | boolean | no | `true` |
| `bitsPerSecond` | number | no | (browser default) |
| `onProgress` | function | no | called with `{stage, ...}` updates |

Returns: `{ blob: Blob, mimeType: string, sizeBytes: number, durationMs: number }`.

Errors: `recorder-unsupported` if `MediaRecorder` or `canvas.captureStream` missing.

```js
const { blob, sizeBytes } = await window.__tool.exportMp4({
    onProgress: e => console.log(e.stage, e.percent),
});
const url = URL.createObjectURL(blob);
```

If the browser cannot capture MP4 directly, the composer records WebM and re-muxes via `core/video.convertToMp4` (FFmpeg WASM, ~30 MB lazy-loaded).

## Project schema

`getProject()` / `setProject({ project })` use the **wrapped** shape:

```json
{
    "schemaVersion": "0.1.0",
    "project": { "id": "p_abcd", "name": "Untitled", "fps": 30, "width": 1280, "height": 720, "createdAt": 1714000000000 },
    "assets": [{ "id": "a_xx", "name": "clip1.mp4", "mime": "video/mp4", "duration": 12.5, "width": 1920, "height": 1080 }],
    "tracks": [{ "id": "t-video-1", "kind": "video", "index": 0, "muted": false,
        "clips": [{ "id": "c_yy", "assetId": "a_xx", "timelineStart": 0, "inPoint": 0, "outPoint": 12.5 }] }],
    "operations": []
}
```

The composer engine consumes a flat projection of this (`state.toComposerProject()` internally):

```json
{ "width": 1280, "height": 720, "fps": 30, "tracks": [...], "assets": [...] }
```

`exportMp4` uses the flat projection automatically — callers always pass the wrapped shape.

## Events

Dispatched on `window` by `SgToolApi._emit`:

| Name | When | Detail |
|---|---|---|
| `tool:ready` | `activate()` | `{ instanceId, tool, version }` |
| `tool:error` | any pipeline error | `{ step, message }` |

Dispatched on the timeline element (and bubbling):

| Name | Detail |
|---|---|
| `sg-timeline:clip-added` | `{ trackId, assetId, timelineStart }` |
| `sg-timeline:clip-moved` | `{ clipId, timelineStart }` |
| `sg-timeline:clip-trimmed` | `{ clipId, inPoint, outPoint }` |
| `sg-timeline:clip-selected` | `{ clipId }` |
| `sg-timeline:playhead-changed` | `{ time }` |

Method invocations are recorded to the SgToolApi log buffer (`api.meta.getLog()`); they are not re-emitted as DOM events.

## Modules used

- `core/video-composer/v0/v0.1/v0.1.0/sg-video-composer.js` — `createComposer`, `exportComposerProject`, `validateProject`, `snapToFps`
- `core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js` — registration + lifecycle
- `core/manifest-loader/v0/v0.1/v0.1.0/manifest-loader.js` — phased loader
- `components/sg-timeline/v0/v0.1/v0.1.0/` — timeline UI
- `components/sg-preview-canvas/v0/v0.1/v0.1.0/` — preview canvas + transport
