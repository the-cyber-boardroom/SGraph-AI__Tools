# HEIC Converter — Human Guide

A browser-only batch converter that turns iPhone HEIC/HEIF photos into web-friendly formats. Drop the files, pick an output format and quality, click Convert, download. Nothing is uploaded anywhere — the decode and re-encode both happen in your browser.

## Workflow

1. **Drop files.** Drag one or more `.heic` / `.heif` files onto the dropzone at the top, or click the dropzone to open a file picker (multi-select supported). Each accepted file appears as a row in the queue below.
2. **Pick a format.** WebP is selected by default (best size/quality tradeoff). Switch to JPEG for maximum compatibility, PNG for lossless output, or AVIF for the smallest files (where supported).
3. **Adjust quality.** The slider controls the encode quality (1-100%). PNG ignores quality (it's lossless); the other three formats use it directly. 85% is a sensible default.
4. **Convert.** Click **Convert all**, or **Convert** on a single row. Conversion is sequential to keep memory usage modest. Each row shows the file size before and after, plus a thumbnail of the converted output.
5. **Download.** Click **Download** on a single row, or **Download all as ZIP** to pack every completed item into one archive.
6. **Clear queue.** Click **Clear queue** to drop every file and start fresh.

## Format quick guide

| Format | When to use | Notes |
|---|---|---|
| **WebP** | Default. Smaller than JPEG at the same visual quality. | Supported by every modern browser, including Safari 14+. |
| **JPEG** | Maximum compatibility — email, old viewers, social media. | No transparency support; alpha is flattened to white before encode. |
| **PNG** | Lossless — graphics, screenshots, anything you'll edit further. | Largest files. Quality slider ignored. |
| **AVIF** | Smallest output, modern web only. | Disabled if your browser can't encode AVIF (older Firefox, all Safari < 16). |

## Limitations

- **HEIC only.** The dropzone rejects anything that isn't `.heic` / `.heif`. For mixed photo/video packs from Google Photos, the upcoming `photo-pack` tool will handle Live Photos and MOV files as well.
- **In-memory only.** Reload = empty queue. There is no save/restore. Convert and download before closing the tab.
- **Single-image HEIC.** If a file contains multiple images (rare bursts/sequences), only the primary image is decoded.
- **First decode is slow.** The decoder library (~2.7 MB) lazy-loads from a CDN on the first conversion of the session; subsequent conversions reuse it.

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
