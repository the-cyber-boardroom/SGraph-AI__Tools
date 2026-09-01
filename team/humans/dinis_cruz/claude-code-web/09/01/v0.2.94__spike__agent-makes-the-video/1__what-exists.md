# 1 · What already exists

*Every line below was checked against the source on 1 Sep 2026. Where something
is unverified it says so — do not treat a "should" as a "does".*

## The rule this repository runs on

`.claude/CLAUDE.md` is emphatic: **if the reality document does not list it, it
does not exist.** Read
`team/explorer/librarian/reality/v0.1.0__what-exists-today__2__tools.md` before
believing any claim about a feature, including the ones below.

---

## video-creator — the back half of the pipeline, already built

`sgraph_ai_tools__static/tools/v0/v0.1/v0.1.47/en-gb/video-creator/`
Served at `http://localhost:10063/en-gb/video-creator/`

It takes slide images plus per-slide narration, generates speech with Kokoro,
paints each slide to a canvas, and records canvas + audio with MediaRecorder.
**That is most of what you need.**

**⚠ Its `manifest.json` lists `actions: []`. The manifest is stale.** The code in
`api/video-api.js` registers ten actions. Read the code, not the manifest.

```js
// window.__tool after 'tool:ready'
await t.connect({});                                    // no-op, no key needed
await t.loadSlides({ files });                          // File[] → data URLs. See the gotcha in 2__the-run.md
   t.setNarration({ slideIndex: 0, text: '…' });        // sync
await t.generateAudio({ voice: 'af_bella', speed: 1.0 });  // → { durations: number[] }
await t.record({ fps: 30, bitrateKbps: 2500 });         // → { webmBlob } — REAL TIME
   t.download({ blob, filename });
   t.getStatus(); t.getConfig(); t.setConfig({ width, height, fps, bitrateKbps, voice, speed });
```

**`setConfig({ width: 1080, height: 1920 })` is how you get a vertical render.**
Default config is `1280×720`, `fps 30`, `bitrateKbps 2500`, `voice 'af_bella'`,
`speed 1.0`. One slide ↔ one narration ↔ one audio duration; there is no concept
of several images under one narration block.

Events: `tool:slides:loaded`, `tool:audio:progress`, `tool:audio:complete`,
`tool:record:start`, `tool:record:stop`.

**How it draws and times** (`api/video-pipeline.js`, worth reading before you
trust the output):

```js
await _drawSlide(recCtx, slide, …);      // letterbox-fit onto a #0a0a18 background
source.start();                          // audio plays in real time
await new Promise(r => setTimeout(r, duration * 1000));   // ← the clock
```

That `setTimeout` is the thing to measure. See `3__what-to-report.md`.

---

## core/sg-tts — speech, locally

`sgraph_ai_tools__static/core/sg-tts/v0/v0.1/v0.1.0/sg-tts.js`

`SgTts` class, `createPool(size)`, `getPool()`, `generateAudio(text, voice, speed)`,
`streamAudio(text, voice, speed)`. Eight workers, each with its own ONNX heap;
`generateAudio` splits at sentence boundaries and runs chunks in parallel.

**The worker loads `kokoro-js` from `esm.sh` at runtime.** `https://esm.sh/kokoro-js`
answered **200** from this container on 1 Sep 2026 — but the model weights are a
separate, much larger fetch that was **not** verified. If your environment has no
egress, this lane is dead and you should say so rather than working around it.

You can use it directly, or let `video-creator` drive it. Prefer the latter for
the spike: fewer moving parts.

---

## narrated-review — where scenes come from

`tools/v0/v0.1/v0.1.71/en-gb/narrated-review/` (v0.1.7), served at
`http://localhost:10063/en-gb/narrated-review/`

A capture is *a screenshot, the words about it, and the alignment between them* —
which is a scene missing only its annotations. ~67 actions. The ones you care
about:

```js
await t.insertPair({ image: blobOrFile, text: '…', raw: '…', notes: '…' });  // author a capture directly, no recording
await t.getSession();          // → session.json shape, including moments[]
await t.downloadZip({});       // review.md + images/ + session.json + …
await t.downloadHandover({});  // the agent bundle: no audio, no PDF
await t.getUncertain();        // flagged spans
```

`moments[i]` = `{ index, id, tMs, image, text, textSource, rawText, notes, marks }`.
`textSource` is `'clean' | 'raw' | 'none'` — **`'raw'` means the transcript was
never corrected against its screenshot**, so do not put it in a video unedited.

**You do not need to record anything to use it.** `insertPair` authors captures
directly, which is the fastest way to build a scene list from an agent.

---

## Playwright — screenshots AND video, headless, no gesture

Installed at `/opt/node22/lib/node_modules`. Run tests with
`NODE_PATH=/opt/node22/lib/node_modules node <script>`.

**Verified working in this container on 1 Sep 2026** — a ~4-second clip came out
as a 264 KB WebM:

```js
const ctx = await browser.newContext({
  recordVideo: { dir: 'clips/', size: { width: 1280, height: 720 } },
  viewport:    { width: 1280, height: 720 },
});
const page = await ctx.newPage();
// …drive the tool…
const path = await page.video().path();
await ctx.close();          // ← the .webm is only finalised HERE
```

This is the fact that makes the whole spike possible: **the agent can shoot the
footage as well as write the script.** No `getDisplayMedia`, no user gesture, no
extension.

Screenshots: `page.screenshot({ path })`, `element.screenshot()`, and
`clip: {x,y,width,height}` for a region.

---

## Everything else you might reach for

| Need | Where | Notes |
|---|---|---|
| Canvas + audio → file | `core/sg-video-recorder/v0/v0.1/v0.1.1/` | `startRecording(canvas, audioStream, opts)`, `startRecordingStream(stream, opts)`, `getBestMimeType()` |
| Zip | `core/sg-zip/v0/v0.1/v0.1.0/sg-zip.js` | `zipEntries(entries, {JSZip})` |
| A dependency-free zip writer | `extension/sg-page-recorder/v0.1.0/zip-store.js` | ~80 lines, STORE-only, no imports — copyable |
| Session storage | `core/sg-vfs/v0/v0.1/v0.1.0/` | IndexedDB provider; **text only**, base64 your binaries |
| Panels | `core/sg-layout/v0.1.0/` | |
| Tool API | `core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js` | `register()`, `activate()`, `window.__tool` |
| AI images (title cards) | `tools/…/en-gb/infographic-gen/` | Needs an OpenRouter key |
| Publish | `tools/…/en-gb/youtube-upload/`, `video-publisher` | OAuth |
| Page recorder extension | `extension/sg-page-recorder/v0.1.0/` | Mouse/clicks/console/network + its own screenshot and zip export. **Cannot be armed from Playwright** — needs a real click on the extension icon |

---

## What does NOT exist — do not go looking

- **Any annotation primitive.** No callout, arrow, circle, box, highlight, blur or
  tagline renderer, anywhere. You will have to fake these (see `2__the-run.md` for
  the trick that costs ten minutes rather than a day).
- **Any multi-image scene.** `video-creator` is strictly one image per narration.
- **Any vertical layout logic.** `setConfig` will give you a 1080×1920 canvas, but
  `_drawSlide` will letterbox a 16:9 screenshot into it, leaving big empty bars.
  Cropping to a focus region is on you.
- **Any on-screen caption rendering.** Nothing draws text onto a frame.
- **Any import from narrated-review into video-creator.**
- **Any clip-as-a-shot support.** `video-creator` takes images only.

Each of these is a hole the proposed tool intends to fill. **Your job is to find
out which of them actually hurt** — some will turn out not to matter, and that is
exactly the sort of finding that saves a week.
