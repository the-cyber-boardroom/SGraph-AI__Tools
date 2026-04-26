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

Set or clear a track's lock flag. Locked tracks reject `addClip` / `addShapeClip` / `addTextClip` / `moveClip` / `trimClip` / `removeClip` / `splitClip` / `removeTrack` / `pasteClip` and any cross-track move INTO or FROM the locked lane (`Error{code:'locked'}`). The lock-toggle itself, mute, rename, and colour overrides are NOT gated.

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

### setTrackColor

Set or clear a track's display colour (Round-9-I Task 3). Each track carries a `color` field (assigned automatically from a 6-shade contrast palette — indigo / teal / amber / rose / purple / sky — when the track is created). Clips render with priority:

```
clip.color   →   track.color   →   palette[trackIndex % 6]   (CSS auto-shade)
```

Pass `color: '#rrggbb'` to override; pass `color: null` (or `''`) to re-apply the palette pick for the track's current position so callers don't have to compute the auto colour themselves. Locked tracks may still be recoloured — colour is cosmetic, mirrors the existing rename / mute policy.

Implementation note: this is the only track API method that goes through `state.getProject() → state-track-ops.setTrackColorOp(project) → state.setProject(project)` rather than a dedicated state container method. Tradeoff is one full validate + project-level history snapshot per recolour instead of a focused op log entry — acceptable for an infrequent cosmetic action; lets the parallel persistence layer's state.js stay untouched.

| Param | Type | Required |
|---|---|---|
| `trackId` | string | yes |
| `color` | string \| null | yes (`null` re-applies the auto palette colour) |

Returns: `{ trackId, color }` (the resolved colour after auto-pick fallback).

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

### renameProject

Rename the project. The new name is stored in `project.project.name` and is used as the localStorage key root by the manual save / autosave layer.

| Param | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Whitespace is trimmed; empty result falls back to `'Untitled'` |

Returns: `{ name }` (the applied value, post-trim and post-fallback). Errors: `invalid-arg` if `name` is not a string.

```js
window.__tool.renameProject({ name: 'My Promo' }); // → { name: 'My Promo' }
window.__tool.renameProject({ name: '   '   });    // → { name: 'Untitled' }
```

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

### saveProject — async

**Async** since Round-9-J. Persists every asset blob to IndexedDB FIRST (database `sgve`, store `assets`, keyed by asset id), THEN saves the project JSON to `localStorage` under the slugified name. Strips Blob refs from `assets[]` in the JSON — only metadata is stored there; the heavy bytes live in IDB. Refuses with `Error{code:'too-large'}` if the resulting JSON exceeds ~1 MB (raised cap; blob-stripped JSON should never approach this). Clears the autosave slot on success and prunes orphan IDB blobs (any blob no longer referenced by ANY saved project + autosave + the live registry). Emits `tool:toast`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `name` | string | no | Defaults to `project.project.name`. Whitespace trimmed. |

Returns: `{ slug, name, savedAt, byteSize }`. Always `await` the result.

### loadProject — async

**Async** since Round-9-J. Loads a saved project by slug, replaces the in-memory project (history snapshot pushed; the load is undoable), then hydrates each asset's blob from IndexedDB into the in-memory `assetRegistry`. Assets whose blob is still missing in IDB after hydration keep `__missingBlob: true` so the asset panel renders the "missing — re-upload" placeholder. Emits `project:replaced` on the internal state target.

| Param | Type | Required |
|---|---|---|
| `slug` | string | yes |

Returns: `{ slug, ok: true, hydrated, missing }`. Errors: `invalid-arg` for missing / unknown slug.

### listSavedProjects

Return the saved-projects index, newest first.

Returns: `{ projects: Array<{ slug, name, savedAt, byteSize }> }`.

### deleteSavedProject — async

**Async** since Round-9-J. Remove a saved project + index entry, then prune any IndexedDB blob no longer referenced by ANY remaining saved project + autosave + the live in-memory project. Idempotent.

| Param | Type | Required |
|---|---|---|
| `slug` | string | yes |

Returns: `{ slug, ok: true }`.

### hasUnsavedChanges

Cheap dirty check based on a stored hash of the project JSON (length + first 256 chars).

Returns: `{ hasUnsavedChanges: boolean }`.

### autosave — async

**Async** since Round-9-J. Persist asset blobs to IndexedDB AND write the current project to `sgve:autosave:current` (separate from named saves so it never overwrites them). Marks the project as "saved" so subsequent `hasUnsavedChanges()` returns `false`.

Returns: `{ ok: true, savedAt }` or `{ ok: false, error }` if the write failed.

### getAutosave

Returns: `{ savedAt, project } | null`. Project asset entries arrive tagged `__missingBlob: true` until the caller calls `hydrateAssets()`.

### discardAutosave

Delete the autosave slot. Returns: `{ ok: true }`.

### isAutosaveNewer

Compare an autosave's `savedAt` against the most recent named save.

| Param | Type | Required |
|---|---|---|
| `savedAt` | number | yes — epoch ms |

Returns: `{ newer: boolean }`.

### hydrateAssets — async

**New in Round-9-J.** Pull each asset blob from IndexedDB into the in-memory asset registry for the CURRENT project. Used by the autosave-restore flow after `setProject({ project: slot.project })` (which doesn't go through `loadProject`'s built-in hydration). Clears the `__missingBlob` flag on every successfully-hydrated asset.

Returns: `{ hydrated, missing }`.

### getStorageUsage — async

**New in Round-9-J.** Report the size of persisted asset blobs in IndexedDB and the project-JSON byte total in localStorage. Drives the "Storage: …" line in the Properties pane.

Returns: `{ totalBytes, assetBytes, assetCount, projectJsonBytes }`.

## Autosave behaviour

Autosave fires `api.autosave()` ~750ms after the last non-transient mutation. Transient mutations (drag scrubs etc) are skipped — they would drown localStorage / IndexedDB with no useful checkpoint.

On editor init, if `sgve:autosave:current` exists AND its `savedAt` is newer than the most recent named save in the index, the user is prompted via `confirm()` whether to restore. Restore = `setProject(slot.project)` followed by `hydrateAssets()`; Discard = `discardAutosave()`.

After a successful manual `saveProject`, the autosave slot is cleared — it's no longer relevant.

The `beforeunload` guard considers BOTH `hasUnsavedChanges()` AND the autosave-pending window: if the most recent mutation hasn't yet been flushed by autosave, the browser still prompts.

## Storage layout

### localStorage (project metadata only — small)

| Key | Shape |
|---|---|
| `sgve:projects-index` | `Array<{ slug, name, savedAt, byteSize }>` |
| `sgve:project:<slug>` | JSON-stringified wrapped project (no Blob refs) |
| `sgve:autosave:current` | `{ savedAt: number, project: <wrapped project> }` |

Asset entries in localStorage are metadata only (`id`, `name`, `mime`, `assetType`, `duration`, `width`, `height`, `bytes`). Blob/File/objectUrl fields are stripped before serialisation.

### IndexedDB (asset blobs — heavy data, Round-9-J)

| Database | Object store | Key path | Entry shape |
|---|---|---|---|
| `sgve` | `assets` | `id` | `{ id, blob, name, kind, mimeType, width, height, duration, bytes, savedAt }` |

This split exists because localStorage caps at ~5–10 MB total per origin while videos are tens to hundreds of MB. The lossy localStorage round-trip preserves timeline geometry; the IndexedDB round-trip preserves pixels. Together they give a full-fidelity restore on reload.

### refreshPreview

Force the preview canvas to repaint at the current playhead. Escape hatch for the rare case where the canvas image gets out of sync with project state. Cheap — just calls the composer's `paintAt` (no decode, no rebuild).

Takes no params. Returns `{ ok: boolean }` where `ok` is `false` if no composer is currently attached (e.g. project is empty).

```js
window.__tool.refreshPreview(); // → { ok: true }
```

The transport-bar redraw button (↻ next to fast-forward) calls this same chokepoint via the composer's new `refresh()` method — clicking it programmatically equals calling `refreshPreview()`.

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
