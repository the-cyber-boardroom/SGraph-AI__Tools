# HEIC Converter — Browser (DOM) Driving Guide

How to drive the tool from Playwright, a console script, or any agent that talks to the DOM directly. For the JS API (preferred for headless tests), see `SKILL__api.md`.

## Selectors

```
#heic-converter-root           the tool root
#hc-drop                       the dropzone — click to open the file picker
#hc-file                       the hidden <input type=file multiple>; set .files to inject
#hc-folder                     the hidden <input type=file webkitdirectory>; folder pick
#hc-pick-folder                "pick a folder" link button inside the dropzone
input[name="hc-format"]        4 radios; value="image/webp" | "image/jpeg" | "image/png" | "image/avif"
#hc-quality                    range input, value 1-100 (= quality * 100)
#hc-quality-value              live percentage display
#hc-livephoto                  checkbox — CHECKED = also extract Live Photo motion clips (dedup OFF)
#hc-convert-all                primary action button
#hc-download-zip               "Download all as ZIP" button
#hc-reset                      "Clear queue" button
#hc-count                      count of items in the queue
#hc-empty                      "no files yet" placeholder (hidden when queue is non-empty)
.hc-row[data-id="<id>"]        one row per queued item
.hc-badge--heic / .hc-badge--video   per-row kind badge (HEIC / VIDEO → still)
.hc-row__path                  per-row folder-relative path (when a folder was dropped)
button[data-action="convert"][data-id="<id>"]   per-row convert/retry button
button[data-action="download"][data-id="<id>"]  per-row download button (after conversion)
button[data-action="remove"][data-id="<id>"]    per-row remove (×) button
.hc-dropzone__notice           transient warning/info ("Added 8; skipped 1: foo (not-supported)" etc.)
.hc-meta-note                  always-on metadata-removal reassurance banner
```

## Adding files

The dropzone supports several modes:

1. **Click + file picker.** Click `#hc-drop` (or focus + Enter / Space) — fires the hidden `<input type=file multiple>` click (accepts HEIC + video). From Playwright, prefer setting input.files directly:
   ```js
   await page.setInputFiles('#hc-file', ['/path/to/photo1.heic', '/path/to/clip.mp4'])
   ```
2. **Folder pick.** Click `#hc-pick-folder`, which fires `#hc-folder` (a `webkitdirectory` input). Each file's `webkitRelativePath` is preserved and mirrored into the output ZIP.
3. **Drag + drop (files or a folder).** Dispatch `dragover` / `drop` events with a `DataTransfer`. Dropping a folder uses `DataTransferItem.webkitGetAsEntry()` to recurse the directory tree. Most automation frameworks expose helpers (`page.dispatchEvent`).
4. **JS API.** `await window.__tool.addFiles({ files: [file1, file2] })` or `addFiles({ entries: [{file, relativePath}] })` — easiest from a console script. See `SKILL__api.md`.

After files are added the queue rows appear; verify with:
```js
document.querySelectorAll('.hc-row').length
```

## Settings

Format radios: click one or set `.checked = true` then dispatch a `change` event.
```js
const r = document.querySelector('input[name="hc-format"][value="image/jpeg"]');
r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
```

Quality slider:
```js
const s = document.querySelector('#hc-quality');
s.value = 70; s.dispatchEvent(new Event('input', { bubbles: true }));
```

Live Photo dedup (checkbox is the INVERSE of dedup — checked = extract motion clips too):
```js
const c = document.querySelector('#hc-livephoto');
c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
// equivalently: window.__tool.setLivePhotoDedup({ enabled: false });
```

## Live Photos and videos

- Rows carry a kind badge: `.hc-badge--heic` or `.hc-badge--video`.
- When dedup is on (default), the motion clip of a Live Photo pair gets `status: 'skipped'` and class `hc-row--skipped`; it is excluded from the ZIP.
- HEVC `.mov` extraction falls back to FFmpeg WASM and reports load progress via `hc:item:progress` (`stage: 'decode'`, `pct`).

## Conversions

Per-row:
```js
document.querySelector('button[data-action="convert"][data-id="hc-1"]').click();
```

All:
```js
document.querySelector('#hc-convert-all').click();
```

Wait for completion by listening for the window event:
```js
await new Promise(res => window.addEventListener('hc:batch:complete', res, { once: true }));
```

## Downloads

Per-row:
```js
document.querySelector('button[data-action="download"][data-id="hc-1"]').click();
```

ZIP:
```js
document.querySelector('#hc-download-zip').click();
```

Both trigger a real `<a download>` click. In Playwright, use `page.waitForEvent('download')`.

## Observability

- **Queue state.** Inspect `.hc-row` elements — class names `hc-row--queued | hc-row--running | hc-row--done | hc-row--error` mirror the state.
- **Decode library used.** Each completed row shows a small "via heic-to" or "via libheif-js" hint in `.hc-row__lib`.
- **Errors.** A failed conversion adds `.hc-row__error` text and a Retry button. The full error message is in the title attribute of the status badge.
- **Developer panel.** A `<details>` block at the bottom of the page hosts the SgToolApi explorer, console, and manifest viewer. Open it to inspect registered methods and the recent execution log.

## Headless test sketch (Playwright)

```js
await page.goto('http://localhost:3000/en-gb/heic-converter/');
await page.waitForFunction(() => !!window.__tool);
await page.setInputFiles('#hc-file', 'fixtures/iphone.heic');
await page.click('input[name="hc-format"][value="image/webp"]');
await page.click('#hc-convert-all');
await page.waitForSelector('.hc-row--done');
const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button[data-action="download"]'),
]);
expect(download.suggestedFilename()).toMatch(/\.webp$/);
```
