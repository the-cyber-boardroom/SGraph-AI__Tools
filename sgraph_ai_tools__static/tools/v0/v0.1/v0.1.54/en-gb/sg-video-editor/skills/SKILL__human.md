# SG Video Editor — Human Guide

A multi-clip video editor that runs entirely in the browser. Load video files, sequence them on a single video track, trim each clip's edges, preview the result, and export an MP4. No upload, no server — bytes never leave the page.

## Workflow

1. **Load files.** Drop video files into the asset panel on the left (or click to pick). Each file is probed for duration and dimensions, then registered as an asset.
2. **Drag onto Video track.** Drag any asset row onto the timeline lane at the bottom. A clip is appended to the end of the track.
3. **Trim edges.** Hover a clip and drag its left/right edges inwards to set the in/out points. Drag the clip body to reposition it on the timeline.
4. **Play preview.** Use the transport bar under the canvas (◀ / ▶ / ▶) or click the timeline ruler to scrub. The preview rebuilds automatically whenever you edit the project.
5. **Export MP4.** Click **Export MP4** in the top-right. The composer plays the project front-to-back into a `MediaRecorder`, returning a downloadable Blob.

## Phase 1 scope

| Supported | Not yet |
|---|---|
| Single video track (`t-video-1`) | Multiple video tracks, audio tracks |
| Trim, move, remove clips | Titles, text overlays |
| Multi-file sequence | Crop, masks, transitions, effects |
| MP4 output (Chromium/Safari native) | WebM as primary output |
| Audio passes through unchanged | Per-clip volume, audio mixing |

Titles, crop, masks, and transitions arrive in Phases 2-4.

## Tips

- **Drag clip body** to move on the timeline. **Drag clip edges** to trim in/out points.
- **Click the ruler** to scrub the playhead to that time.
- **Preview rebuilds** automatically ~100ms after every edit. You may see a brief black flash while the composer recreates.
- **Export runs at ~1× realtime** — a 60s project takes about 60s to record. Progress is reported through the Export button while running.
- **WebM fallback to MP4.** On browsers without native MP4 capture, the composer records WebM then re-muxes to MP4 via `core/video` (FFmpeg WASM). The output is still `.mp4`.
- **Empty project** = no preview. Drop at least one clip on the timeline before pressing Play.

## Browser support

| Browser | Behaviour |
|---|---|
| Chrome / Edge / Opera (Chromium) | Native MP4 capture via `MediaRecorder` (`video/mp4;codecs=avc1`). |
| Safari 14.1+ | Native MP4 capture. |
| Firefox | Records WebM, then re-muxes to MP4 via FFmpeg WASM. First export pulls ~30 MB FFmpeg from CDN. |
| Mobile Safari / Chrome | Should work but untested. Long exports may be backgrounded. |

`MediaRecorder` and `canvas.captureStream` are required. The tool checks `isSupported()` at export time and throws `recorder-unsupported` if either is missing.

## What is stored

Nothing in `localStorage`. Project state and asset Blobs live entirely in memory for the lifetime of the page. Reload = empty project. Use **Export MP4** to capture work before closing the tab.

## Where to go next

- Drive the same flow from JavaScript: see `SKILL__api.md`.
- Drive the DOM directly (Playwright, console): see `SKILL__browser.md`.
