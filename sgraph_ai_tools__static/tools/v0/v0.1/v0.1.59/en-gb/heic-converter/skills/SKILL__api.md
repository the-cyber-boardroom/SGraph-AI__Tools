# HEIC Converter — API Capability Spec

**Tool:** heic-converter
**Version:** ui=0.2.0, api=0.2.0, content=0.2.0
**Instance ID:** `heic-converter:root`
**Environment:** browser only (HTTPS or localhost required — HEIC + FFmpeg libraries are lazy-loaded from CDN)
**Registry key:** `window.__tool` / `window.__tools['heic-converter:root']`

---

## Identity

```
name:        heic-converter
slug:        heic-converter
category:    media
status:      alpha
url-pattern: /en-gb/heic-converter/
```

---

## Lifecycle

```
1. Page loads -> manifest-loader runs phases 1..3
2. Phase 3 entry runs api/heic-converter-api.js -> init(manifest)
3. init() creates SgToolApi, registers methods, calls api.activate()
4. activate() registers under window.__tools and fires `tool:ready` on window
5. window.__tool also points at the most recently activated tool (single-tool pages)

Wait pattern:
  await new Promise(r => window.addEventListener('tool:ready', r, { once: true }));
  // or: await new Promise(r => { const t = setInterval(() => {
  //         if (window.__tool) { clearInterval(t); r(); } }, 50); });
```

---

## Methods

### addFiles

Add HEIC/HEIF stills OR videos (mp4/mov/m4v) to the queue. Unsupported files are dropped and reported in `skipped`. Duplicates are also skipped. After adding, Live Photo dedup is re-evaluated over the whole queue.

```
signature:   addFiles({ files }) | addFiles({ entries }) -> Promise<{ added: string[], skipped: Array<{name, reason}> }>
async:       true
params (one of):
  files     File[] | FileList    HEIC/HEIF/video files to add (flat). Each file's
                                  `webkitRelativePath` is honoured if present.
  entries   Array<{file, relativePath}>   folder form — `relativePath` is the
                                  folder-relative path mirrored into the ZIP.
returns:
  added     string[]              IDs of newly-queued items, e.g. ['hc-1', 'hc-2']
  skipped   Array<{name,reason}>  reason: 'not-supported' or 'duplicate'
events:
  hc:items:added                  { addedIds, skipped }
  hc:item:skipped                 { id, reason: 'live-photo-duplicate' }  (per deduped video)
errors:
  none — bad files end up in `skipped`, not thrown.
notes:
  - A file is accepted if sgHeic.isHeic(file) OR isVideoFile(file) (mp4/mov/m4v).
  - Videos are tagged kind:'video'; HEIC kind:'heic'.
```

### setLivePhotoDedup

Toggle Live Photo dedup. A "Live Photo pair" is a still (HEIC/JPG) and a video sharing a basename (case-insensitive).

```
signature:   setLivePhotoDedup({ enabled }) -> { enabled }
async:       false
params:
  enabled   boolean   true (default): the motion clip of each pair is marked
                       status:'skipped' (skippedReason:'live-photo-duplicate')
                       and excluded from the ZIP. false: those clips are also
                       frame-extracted. Standalone videos are ALWAYS converted.
events:
  hc:livephoto:dedup   { enabled }
  hc:item:skipped      { id, reason } (when enabling re-marks paired videos)
```

### getItems

Return a serialisable snapshot of the queue (no Files, no Blobs).

```
signature:   getItems() -> Array<itemSummary>
async:       false
returns: Array of:
  id            string   'hc-N'
  name          string   original filename
  kind          string   'heic' | 'video'
  relativePath  string   folder-relative path, null when added flat
  sizeBytes     number   source file size
  status        string   'queued' | 'running' | 'done' | 'error' | 'skipped'
  skippedReason string   'live-photo-duplicate' when skipped, else null
  error         string   null when no error
  outputType    string   MIME of converted output, null until 'done'
  outputSize    number   bytes of converted blob, null until 'done'
  outputName    string   suggested download filename, null until 'done'
  width         number   decoded pixel width, null until 'done'
  height        number   decoded pixel height, null until 'done'
  decodeLib     string   'heic-to' | 'libheif-js' (HEIC) | 'video' (frame), null until 'done'
```

### setFormat

Set the output MIME type used by `convertOne` and `convertAll`.

```
signature:   setFormat({ format }) -> { format }
async:       false
params:
  format    string    one of: 'image/webp' | 'image/jpeg' | 'image/png' | 'image/avif'
errors:
  Error{ code: 'invalid-arg' } if format is outside the allowed set
events:
  hc:format:changed   { format }
```

### setQuality

Set the encode quality (0..1). PNG ignores it; JPEG/WebP/AVIF use it directly.

```
signature:   setQuality({ quality }) -> { quality }
async:       false
params:
  quality   number    in [0, 1]. UI maps the 1-100% slider to 0.01-1.0.
errors:
  Error{ code: 'invalid-arg' } if quality is not a finite number in [0, 1]
events:
  hc:quality:changed  { quality }
```

### convertOne

Convert a single queued item using the current format/quality. HEIC items are decoded + re-encoded; video items have their first frame extracted (and re-encoded). Both paths re-encode from pixels, so the output carries no source metadata.

```
signature:   convertOne({ id }) -> Promise<{ id, outputType, outputSize }>
async:       true
params:
  id        string    item id from addFiles / getItems
errors:
  Error{ code: 'unknown-item' } if id not in queue
  Error{ code: 'busy' }          if item is already running
  Error{ code: 'heic-decode-failed' } if both heic-to AND libheif-js fail (HEIC)
  Error (generic) if video frame extraction fails on both the <video> and FFmpeg paths
events:
  hc:item:started     { id }
  hc:item:progress    { id, stage: 'decode'|'encode'|'done', pct }
  hc:item:complete    { id, outputSize, outputType }
  hc:item:error       { id, error }   (also rejects the Promise)
notes:
  - JPEG output: alpha is flattened to a white background before encode (HEIC path).
  - First HEIC call of the session lazy-loads heic-to (~2.7MB) from CDN.
  - Video items: web-friendly .mp4 uses a native <video> element; HEVC .mov falls
    back to FFmpeg WASM (~30MB lazy-loaded once). The FFmpeg load ratio is surfaced
    via hc:item:progress (stage:'decode', pct). Frame extracted at t=0.
```

### convertAll

Convert every queued (or previously-errored) item sequentially. Errors on individual items do not abort the batch.

```
signature:   convertAll({}) -> Promise<{ ok, failed }>
async:       true
returns:
  ok        number    count of items that converted successfully
  failed    number    count of items that errored
events:
  hc:batch:started    { count }
  hc:batch:complete   { ok, failed }
  + per-item events from convertOne for each item
```

### downloadOne

Trigger a browser download of one completed item.

```
signature:   downloadOne({ id }) -> Promise<{ ok: true, name, size }>
async:       true
params:
  id        string    item id; must have status 'done'
errors:
  Error{ code: 'unknown-item' } if id missing
  Error{ code: 'not-ready' }    if the item has no outputBlob yet
side-effects:
  Creates a temporary <a download> element, clicks it, removes it.
  The object URL is revoked ~2 s later.
```

### downloadAllZip

Pack every completed item into a single ZIP via JSZip (lazy-loaded from CDN on first call) and trigger a download.

```
signature:   downloadAllZip({}) -> Promise<{ ok: true, count, zipSize }>
async:       true
errors:
  Error{ code: 'empty' } if there are no completed items to pack
  Error if JSZip fails to load (network / CDN problem)
notes:
  - When a folder was dropped/picked, the ZIP mirrors the folder structure
    (each file's relativePath, with the extension swapped to the chosen format)
    and the ZIP is named after the top-level folder. Otherwise it falls back to
    a flat layout named `heic-converter-YYYY-MM-DD.zip`.
  - Skipped (Live Photo duplicate) items are excluded.
  - Duplicate output paths are de-duplicated by appending -2, -3, ...
```

### reset

Clear the queue, revoking all in-memory object URLs.

```
signature:   reset({}) -> { ok: true }
async:       false
events:
  hc:reset    {}
```

---

## Window Events

All events dispatch on `window`. Every detail object includes `instanceId` ("heic-converter:root").

```
tool:ready              page load, after activate()        { instanceId, tool, version }
hc:items:added          addFiles resolves                  { instanceId, addedIds, skipped }
hc:item:started         convertOne begins                  { instanceId, id }
hc:item:progress        decode / encode / done             { instanceId, id, stage, pct }
hc:item:complete        convertOne resolves                { instanceId, id, outputSize, outputType }
hc:item:error           convertOne rejects                 { instanceId, id, error }
hc:item:skipped         an item is deduped                 { instanceId, id, reason }
hc:batch:started        convertAll begins                  { instanceId, count }
hc:batch:complete       convertAll resolves                { instanceId, ok, failed }
hc:format:changed       setFormat                          { instanceId, format }
hc:quality:changed      setQuality                         { instanceId, quality }
hc:livephoto:dedup      setLivePhotoDedup                  { instanceId, enabled }
hc:reset                reset                              { instanceId }
```

---

## Example: end-to-end conversion

```js
// 1. wait for ready
await new Promise(r => window.addEventListener('tool:ready', r, { once: true }));

// 2. fetch a HEIC file from somewhere (cross-origin fetch must be CORS-enabled)
const blob = await (await fetch('/fixtures/iphone.heic')).blob();
const file = new File([blob], 'iphone.heic', { type: 'image/heic' });

// 3. add it, configure output, convert
await window.__tool.addFiles({ files: [file] });
window.__tool.setFormat({ format: 'image/webp' });
window.__tool.setQuality({ quality: 0.85 });

const items = window.__tool.getItems();
console.log('queued:', items);

await window.__tool.convertOne({ id: items[0].id });

// 4. trigger a download (or grab the blob directly)
await window.__tool.downloadOne({ id: items[0].id });
```

## Example: batch + ZIP

```js
await window.__tool.addFiles({ files: heicFileList });
window.__tool.setFormat({ format: 'image/jpeg' });
window.__tool.setQuality({ quality: 0.9 });
const { ok, failed } = await window.__tool.convertAll({});
console.log(`converted ${ok}, failed ${failed}`);
await window.__tool.downloadAllZip({});
```

## Example: progress listener

```js
window.addEventListener('hc:item:progress', (e) => {
    const { id, stage, pct } = e.detail;
    console.log(`[${id}] ${stage} ${pct}%`);
});
window.addEventListener('hc:batch:complete', (e) => {
    console.log('batch done', e.detail);
});
```

---

## Dependencies

```
core:
  sg-tool-api      /core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js
  manifest-loader  /core/manifest-loader/v0/v0.1/v0.1.0/manifest-loader.js
  sg-heic          /core/sg-heic/v0/v0.1/v0.1.0/sg-heic.js
  sg-image         /core/image/v1/v1.0/v1.0.0/sg-image.js
  sg-video-frames  /core/sg-video-frames/v0/v0.1/v0.1.0/sg-video-frames.js
  sg-video         /core/video/v1/v1.0/v1.0.1/sg-video.js   (FFmpeg loader, used by sg-video-frames)

tool-local helper:
  live-photo       ./api/live-photo.js   (groupLivePhotos — basename pairing)

components:
  sg-tool-api-explorer    /components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/
  sg-tool-api-console     /components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/
  sg-tool-api-manifest    /components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/

lazy-loaded from CDN (on demand):
  heic-to       https://cdn.jsdelivr.net/npm/heic-to@1.4.2/dist/heic-to.min.js
  libheif-js    https://cdn.jsdelivr.net/npm/libheif-js@1.18.2/libheif-wasm/libheif-bundle.mjs   (HEIC fallback only)
  FFmpeg core   https://unpkg.com/@ffmpeg/core@0.12.6/...   (only for HEVC .mov frame extraction)
  JSZip         https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js   (only when downloadAllZip is called)
```

## Known limitations

```
supported-inputs:
  addFiles accepts HEIC/HEIF stills + videos (mp4/mov/m4v). Anything else is
  returned in `skipped` (reason 'not-supported').

first-frame-only:
  Videos yield only their first frame (t=0). Choosing a different frame and
  outputting a compressed full video are planned for the `photo-pack` tool.

hevc-mov-slow:
  iPhone .MOV (HEVC) cannot be decoded by the browser's <video> element on most
  desktops, so it uses FFmpeg WASM — a ~30MB one-time lazy load plus a few
  seconds per frame.

live-photo-pairing-by-name:
  Pairing is by case-insensitive basename. Renamed files may not pair.

primary-image-only:
  Multi-image HEIC files (rare iOS bursts) yield only the primary image.

memory:
  Decoded canvases and output blobs are held in memory until reset(). Very
  large batches on memory-constrained devices may OOM — call reset() between
  batches if processing dozens of large files.

network-required-first:
  The HEIC decoder lazy-loads from a CDN on the first conversion of the
  session. If CDN is unreachable, decodeHeicToCanvas throws
  Error{ code: 'heic-decode-failed' }.

panel-detection:
  panelId is hard-coded to 'root' (single-panel tool). Multi-panel embedders
  must instantiate their own SgToolApi if hosting the converter alongside
  other tools in one sg-layout.
```
