# HEIC Converter — Human Guide

A browser-only batch converter that turns a messy iPhone / Google Photos pack — HEIC stills **and** videos — into clean web-friendly images. Drop the files (or a whole folder), pick an output format and quality, click Convert, download. Nothing is uploaded anywhere — the decode, frame extraction, and re-encode all happen in your browser.

## What it accepts

- **HEIC / HEIF stills** — decoded and re-encoded to your chosen format.
- **Videos** (`.mp4`, `.mov`, `.m4v`) — the **first frame** is extracted as a still image. iPhone `.MOV` (HEVC) is handled via FFmpeg in your browser (slower — a progress percentage shows on the row).
- **Whole folders** — drop a folder, or use **pick a folder**. The folder structure is mirrored in the output ZIP.

## The Google Photos use case

When you download a selection of iPhone media from Google Photos you get a folder mixing `.HEIC` stills, `.MP4`, and `.MOV`, often including **Live Photos** (a still + a short motion clip sharing the same name). Drop the whole folder here and you get back a ZIP where everything is a clean image with all metadata removed.

## Workflow

1. **Add files.** Drag `.heic` / `.heif` / `.mp4` / `.mov` files — or a whole folder — onto the dropzone, or click to open a file picker, or use **pick a folder**. Each accepted file appears as a row, tagged **HEIC** or **VIDEO → still**.
2. **Pick a format.** WebP is selected by default (best size/quality tradeoff). Switch to JPEG for maximum compatibility, PNG for lossless output, or AVIF for the smallest files (where supported).
3. **Adjust quality.** The slider controls the encode quality (1-100%). PNG ignores quality (it's lossless); the other three formats use it directly. 85% is a sensible default.
4. **Live Photos.** By default, the motion clip of a Live Photo is dropped and only the still is kept (rows show "Live Photo clip — skipped"). Tick **Extract frames from Live Photo motion clips too** if you also want a still from each motion clip. Standalone videos are always turned into a still regardless.
5. **Convert.** Click **Convert all**, or **Convert** on a single row. Conversion is sequential to keep memory usage modest.
6. **Download.** Click **Download** on a single row, or **Download all as ZIP** to pack every completed item into one archive. When you dropped a folder, the ZIP mirrors the folder structure and is named after it; skipped Live Photo clips are excluded.
7. **Clear queue.** Click **Clear queue** to drop every file and start fresh.

## Metadata / privacy guarantee

Every output is **re-encoded from raw pixels** (HEIC decode → canvas, or video frame → canvas/FFmpeg → canvas). That re-encode means **no original metadata survives** — EXIF, camera info, timestamps, and **GPS / location** are all removed. There is no separate "strip metadata" step to remember; it is inherent to how the tool works.

## Format quick guide

| Format | When to use | Notes |
|---|---|---|
| **WebP** | Default. Smaller than JPEG at the same visual quality. | Supported by every modern browser, including Safari 14+. |
| **JPEG** | Maximum compatibility — email, old viewers, social media. | No transparency support; alpha is flattened to white before encode. |
| **PNG** | Lossless — graphics, screenshots, anything you'll edit further. | Largest files. Quality slider ignored. |
| **AVIF** | Smallest output, modern web only. | Disabled if your browser can't encode AVIF (older Firefox, all Safari < 16). |

## Limitations

- **First frame only.** Videos yield only their first frame as a still. Picking a different frame, and outputting a compressed full video, are planned for the upcoming `photo-pack` tool.
- **HEVC `.mov` is slow.** iPhone `.MOV` can't be decoded by the browser's `<video>` element on most desktops, so it falls back to FFmpeg WASM (~30 MB, lazy-loaded once per session). The first such video pays the load cost and each frame extraction takes a few seconds.
- **In-memory only.** Reload = empty queue. There is no save/restore. Convert and download before closing the tab.
- **Single-image HEIC.** If a file contains multiple images (rare bursts/sequences), only the primary image is decoded.
- **First decode is slow.** The HEIC decoder library (~2.7 MB) lazy-loads from a CDN on the first conversion of the session; subsequent conversions reuse it.
- **Live Photo pairing is by filename.** A still and a video are treated as a pair when they share a basename (case-insensitive). Renamed files may not pair.

## Browser support

| Browser | Decode | WebP | JPEG | PNG | AVIF |
|---|---|---|---|---|---|
| Chrome / Edge / Opera 90+ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Safari 16+ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Firefox 120+ | ✓ | ✓ | ✓ | ✓ | partial |
| Older Safari (< 16) / Firefox (< 113) | ✓ | ✓ | ✓ | ✓ | disabled |

If the AVIF radio is greyed out, your browser can't encode it. The other three always work where HEIC decode works.

## What is stored

Nothing in `localStorage` or `IndexedDB`. The queue, the converted blobs, and the thumbnails all live in memory for the page's lifetime. Closing or reloading the tab discards everything.

## Where to go next

- Drive the same flow from JavaScript: see `SKILL__api.md`.
- Drive the DOM directly (Playwright, console): see `SKILL__browser.md`.
