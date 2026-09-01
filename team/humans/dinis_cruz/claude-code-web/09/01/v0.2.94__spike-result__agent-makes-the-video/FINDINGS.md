# Spike: agent makes the video — findings

**Date:** 1 Sep 2026   **Subject:** SGit vaults: sgit.ai home, the SG/Vault docs page, the published-vaults page, and the "Field Notes" vault opened live in SG/App and SG/Vault   **Time spent:** about 65 minutes of wall clock from first reading the brief (≈21:05 UTC) to the last render (22:08), all of it one agent session with no human at a screen. Three render passes were made; the first two are kept in the numbers as evidence.

The OpenRouter key supplied for narration was **not used**. Kokoro ran locally in the browser, as the brief said it would; nothing in this folder calls OpenRouter. It can be revoked.

## Did it work?

Yes, with one large caveat that is the main result. Two videos came out from a `reel.json` written first, thirteen stills and two clips shot by Playwright, Kokoro narration and `video-creator`'s own recorder. The caveat: **as shipped, `video-creator` wrote 13 video frames into a 128-second video**, one per slide. `canvas.captureStream(30)` only emits a frame when the canvas is painted, the tool paints once per slide, and each slide became a single under-budgeted P-frame the encoder never refined, so every screenshot was an illegible smear (`frames/run1-*.png`). A twelve-line repaint loop injected from outside the tool (`scripts/02-render.mjs`, "heartbeat") gives MediaRecorder a real 30 fps stream and the text is sharp (`frames/landscape-*.png`).

Would I publish them as they are? The landscape one, nearly: the voice says "ess-git", and the caption bar is 16 px. The shorts one shot at a phone viewport, yes, with the same two fixes. The shorts one *cropped* from desktop stills, no, and that answers the focus-rect question below.

## The video

| File | Length | Size | Scenes | Frames | Notes |
|---|---|---|---|---|---|
| `landscape.webm` | 99.1 s | 9.8 MB | 13 | 2,973 (30 fps) | 1280×720 VP9/Opus, heartbeat on |
| `shorts.webm` | 46.0 s | 5.4 MB | 6 | 1,380 (30 fps) | 1080×1920, stills re-shot at a 540×960 @2× viewport |
| `shorts-crop.webm` | 46.0 s | 3.5 MB | 6 | 1,380 (30 fps) | Same six scenes, desktop stills cropped to a 9:16 window around the focus rect. Kept for comparison; every crop was lossy |

Watch them, or look at `frames/`. Run 1 (274 words, no heartbeat) is not committed; `frames/run1-*.png` show what it looked like.

## Numbers

| Measurement | Value |
|---|---|
| Intended duration (sum of TTS durations) | landscape 99,100 ms · shorts 45,975 ms |
| Actual `record()` duration (`performance.now`) | landscape 99,196 ms · shorts 46,059 ms |
| **Drift** | landscape **+96 ms (58 ms/min)** · shorts +84 ms (110 ms/min). Without the heartbeat: +66 ms in 128.5 s (31 ms/min) and +55 ms in 99.1 s. Frame timestamps in the run-1 file matched the intended scene starts to within 37 ms at the last slide |
| Frames written, as shipped | **13 in 128.5 s** (2 keyframes). With heartbeat: 2,973 in 99.1 s |
| TTS, model load from local disk cache | 5.4 to 7.2 s (2 workers) |
| TTS, generation | 122 to 158 s for 99 to 128 s of speech: **1.24× the audio length** with 2 WASM workers. One worker (probe): 17.9 s for 8 s |
| TTS, warm second call | 158.1 s after 157.9 s: **identical, nothing is cached** |
| TTS, first-ever download | 92 MB model + 22 MB WASM runtime, once; not timed separately because it crashed the page the first time (below) |
| Wall clock, script → video (one TTS pass) | landscape 229 s (3 min 49 s); shorts 118 s. With the second TTS pass: 454 s |
| Capture, 13 scenes landscape | 79 s (2.4 s per still; 10 to 24 s per scene on the live vault or with a clip) |
| Capture, 6 scenes at phone viewport | 35 s |
| Screenshots captured / used | 15 / 13 landscape (two clips also yield a still), 6 / 6 shorts, plus 7 reconnaissance shots and 13 from a first capture run with a scrolling bug: **41 shot, 19 used** |
| Scenes that would not crop to 9:16 | **6 of 6.** A full-height 9:16 window of a 1280×720 still is 405 px wide, 32 % of the page; every focus rect was wider |
| Narration pace | 274 words → 128.5 s; 218 words → 99.1 s: **about 2.1 to 2.2 words per second at speed 1.0** |
| Output bit rate | 2,500 kbps requested; 9.8 MB / 99 s ≈ 790 kbps actual for static slides |

**How to read the drift row.** The recorder advances slides with `setTimeout(duration*1000)` and starts each slide's audio in the same tick. Drift is tens of milliseconds per minute, so audio stays on picture for any reel we would make. The clock the demo-reel pack worried about is fine; **the frame source is the problem**, and the number that exposes it is frames per second, which the pack does not list.

**TTS is the cost.** 1.24× the audio length per pass, no cache, and the pool size decides everything: one worker was 2.2× the audio length. "Ten minutes end to end" is plausible for a 90-second reel only with a cached second run; the first run here was under four minutes for 99 s of video, of which 99 s is the unavoidable real-time record and 122 s is TTS.

## What was hard

1. **Getting Chromium onto the internet — ~15 min, plus ~6 min for the second wall.** Every `https://` navigation from Playwright's Chromium fails with `ERR_CONNECTION_RESET` in this container, while `curl`, Node's `fetch` and `openssl s_client` through the same proxy succeed. The proxy status endpoint shows the tunnel opening, ~1.7 KB sent (a ClientHello), 39 bytes back (the `200 Connection established`) and the tunnel closing after 6 s; the likely cause is the size or content of Chromium's TLS 1.3 ClientHello, unconfirmed because the two ways to test it were outside what this session may do. The fix is `scripts/browser.mjs`: `context.route()` every non-localhost request through Node's `fetch` (`NODE_USE_ENV_PROXY=1` plus the proxy CA) and fulfil it. It covered page loads, the SG/App vault (182 requests), `esm.sh` module imports *from inside a Web Worker*, and Hugging Face. The second wall: fulfilling the 92 MB ONNX model through the DevTools protocol killed the page ("Target closed", no crash event). `scripts/cache-server.mjs` (30 lines, CORS and Range) plus a 302 from the bridge for anything over 8 MB fixed that and made re-runs fast.
2. **Finding out why the video was smeared — ~10 min.** Frames extracted at 9 s and 97 s showed the *next* scene. `ffmpeg -vf showinfo` explained it at once: 13 frames, 2 keyframes, one per slide. Nothing in the tool, the brief or the demo-reel pack anticipates this, and it is the one thing to know before building a renderer on `video-creator`.
3. **Element targeting on real pages — ~10 min.** sgit.ai sets `scroll-behavior: smooth`, so `scrollIntoView()` returns before the scroll happens and every screenshot showed the top of the page; the first capture run "resolved" only targets that were visible without scrolling. Tab buttons carry their number in a child `<span>`, so text matching on "2 Work like git" fails. SG/App's header is shadow DOM, so `document.querySelectorAll` cannot see the "R1 W0" badge; that spotlight is a hand-measured rect, and at the phone viewport it lands on the wrong button (`images-shorts/s12.png`), which is the argument for element targets in one picture.
4. **A heartbeat that did nothing — ~5 min.** The first heartbeat run recorded 0 repaints because **every `window.__tool` method returns a Promise, the sync ones included** (`SgToolApi._invoke` is `async`), so `t.getConfig().width` is `undefined`. The same thing made `getStatus().audioDurations` come back null in the probe. Worth a line in the tool-API docs.

Smaller, ~5 min each: `NODE_PATH` is ignored by ESM `import` (the recipe's `node script.mjs` line fails as written; `createRequire` works); MediaRecorder's WebM has no duration header and Playwright's bundled `ffmpeg` is too stripped to remux it (`imageio-ffmpeg` from PyPI brings a full static build); `ffmpeg -i` exits 1 by design; `ffmpeg -ss` on a 13-frame file returns the *next* frame, which is what made the smear look like drift.

## What was easy that we expected to be hard

- **Annotation by DOM injection: ~15 min for spotlight, label and blur**, including a resolver that turns "the table after this heading" into a rect. The `box-shadow: 0 0 0 9999px` spotlight looks deliberate on every page it was tried on. Blur over 19 read-key cells on the published-vaults page worked first time. Labels placed by absolute fractions landed away from their targets; anchoring them "below the spotlight" fixed that in one edit. The proposal budgets two to three days for an annotation renderer; the renderer is the browser.
- **Two aspect ratios.** Re-shooting six scenes at a 540×960 @2× viewport took 35 s and no new code beyond a viewport option: the site's responsive layout did the framing, the same `scrollTo` and element targets resolved, and the result reads on a phone. Cropping desktop stills, the pack's plan, took ten lines and produced cut-off sentences in every scene.
- **Shooting clips.** Two clips (10 s tab walk, 24 s "Open Vault" into the SG/Vault file browser) came from `recordVideo` with no extra code; the last frame served as the still.
- **Driving a live vault.** The SG/App page for a published vault rendered through the bridge, "Open Vault" opened the SG/Vault file browser in the same tab, and the screenshots show the real product decrypting real content with a real published read key.
- **Captions for free.** `_drawSlide` prints `${slide.name} • i/n` in a bottom bar, so naming each `File` after the scene's caption gives a caption track with no code. 16 px, so a proof, not a feature.
- **Headless MediaRecorder.** Valid VP9/Opus WebM headless, first time, no `xvfb`.

## Is the proposed demo-reel design right?

1. **Annotations as data, never baked pixels — confirmed, with a twist.** The data that survived a viewport change was not `{type:'circle', at:[…]}` but *"the element after this heading"*: nine of thirteen scenes targeted by DOM query and all nine re-resolved at phone size; the two fraction rects did not. The primitive list can shrink to **spot, label, blur**; nothing wanted an arrow, circle or pointer.
2. **One document, two aspect ratios via a focus rect — wrong as stated.** Six of six scenes could not crop to 9:16 without loss, because a full-height 9:16 window of a desktop still is 405 px of 1280. The right reading of "one document" is one *script* shot at two *viewports*: the shots are cheap to take twice (35 s) and the page does the layout. Keep the focus rect only as a fallback for sources that are not web pages.
3. **Caption as a separate authored track — confirmed, strongly.** Written before capture, the caption told me which screenshot I needed; the narration did not. Rendering is the gap: 16 px is unreadable on a phone. This is the one primitive worth building.
4. **Multi-shot scenes under one narration — unnecessary here.** Thirteen scenes, one image each; not once did I want a second image under the same sentence. The one place motion mattered was a clip. Skip it until a script needs it.
5. **The reel document as the API — confirmed.** `reel.json` was written first and everything else read it. Its shape (`narration`, `caption`, `shot{url, scrollTo, annotate[], focus}`, `shorts[]`) is smaller than the pack's and was enough. What an agent needs that the pack does not name: **`scrollTo` and element-relative targets**, because the agent never sees the page, and **a pronunciation map** (I wrote "sgit dot ai" into the narration to steer Kokoro, which is the wrong place).
6. **Import from narrated-review as a transform — not tested, probably unnecessary.** Writing thirteen scenes from the page text took about fifteen minutes. Keep the mapping documented; do not build it first.
7. **Handoff via files/VFS, not localStorage — confirmed trivially.** Stills were 76 to 209 KB, 1.4 MB for thirteen; clips 2.1 MB. Files on disk plus `File` objects built in-page were the whole handoff.
8. **Measure render pacing first — confirmed, and it found something else.** Drift was under 100 ms in every run. The measurement worth having was frame count. Add "frames per second written" to Phase 0.
9. **Clips as a shot type — cheap to shoot, unproven to play.** Shooting was free; playing a clip inside the render is untested because `video-creator` takes images, and the last frame as a still was good enough for both clips here. Phase 3.5 is the right place for it.

## What would you actually build?

If I had to make ten of these, the smallest thing is **not a new tool**. It is four fixes, in this order:

1. **Make `video-creator` paint every frame** (a `requestAnimationFrame` redraw, or `track.requestFrame()` at the configured fps) and emit a keyframe on each slide change. Without this every output is unpublishable. One afternoon.
2. **Cache TTS by (text, voice, speed) hash** in `sg-tts`, in memory and in `sg-vfs`. The second render of a reel then costs the record time and nothing else. One afternoon.
3. **A caption track in `_drawSlide`**: a large, wrapped, high-contrast caption instead of the filename bar, sized per aspect ratio. Half a day.
4. **A capture script, not a capture tool**: what `01-capture.mjs` and `annotate.mjs` already are, tidied, with `scrollTo`, element-relative spot/label/blur, a viewport per format, and `recordVideo` clips. It lives next to the reel, runs under Playwright, needs no UI. One day to make it reusable.

About three days, leaving `demo-reel` as a JSON shape plus two scripts. The pack's Phases 1 to 3 (annotation renderer, scene model, import) can wait until a tenth video wants something these do not give. Two things to add to the pack before anyone builds it: **the frames-per-second measurement**, and **the rule that the agent that writes the reel also shoots it**, because the shot spec that works is "scroll to this text, spotlight the table after it".

## What did NOT work

- **Chromium HTTPS through the agent proxy.** `net::ERR_CONNECTION_RESET` on every external `https://` URL. Worked around with the Node bridge, **not** fixed; anyone repeating this in a container with the same proxy hits it in the first minute.
- **`route.fulfill()` with a 92 MB body.** `Target page, context or browser has been closed`, no `crash` event. Worked around with the local cache server.
- **`--disable-features=…`, `--ssl-version-max=tls1.2` and a Local State preference for post-quantum key agreement.** No effect on the ClientHello size. The policy-file route and a ClientHello sniffer were both refused by the session's permission model, so the hypothesis stays unconfirmed.
- **`video-creator` as shipped for screenshots with text**: 13 frames per 128 s. Worked around with the heartbeat, which is a spike hack, not a fix.
- **`window.__tool.getConfig()` / `getStatus()` as sync calls**: they return Promises.
- **Element targeting in shadow DOM** (SG/App header): a hand-measured rect, which then missed at the phone viewport.
- **The 9:16 crop of desktop stills**: cut-off sentences in all six scenes (`frames/shorts-crop-*.png`).
- **The SGit "create a real vault" path.** Not attempted: `sgit` is not installed here, no Send token was given, and the published read-only vault gave the live shots the script needed. The video shows a published vault opened live, not one being created.
- **The 60 to 120 s budget on the first try.** 274 words became 128.5 s. Plan on about 2.1 words per second.
- **Pronunciation.** Kokoro says "ess-git"; "sgit dot ai" and "sgit dash ai" in the narration steer it, at the cost of putting engine knowledge into the script.

## Artefacts

| File | What |
|---|---|
| `landscape.webm` | The 16:9 video, 1280×720, 99 s, heartbeat on |
| `shorts.webm` | The 9:16 cut, 1080×1920, 46 s, six scenes re-shot at a phone viewport |
| `shorts-crop.webm` | The same six scenes from cropped desktop stills, for comparison |
| `reel.json` | The script: 13 scenes, narration + caption + shot spec, invented for this spike, with notes on what changed and why |
| `capture-log.json`, `capture-log.shorts.json` | What each shot resolved to, timings, captured/used counts |
| `render-log.landscape.json`, `render-log.shorts.json`, `render-log.shorts-crop.json` | TTS, intended vs actual, heartbeats, file info, wall clock |
| `images/` | The thirteen annotated desktop stills as loaded into `video-creator` |
| `images-shorts/` | The six phone-viewport stills |
| `clips/` | The two Playwright clips (s04 tab walk, s11 Open Vault) |
| `frames/` | Stills every 8 s (landscape) / 6 s (shorts) from the final videos; `run1-*` from the no-heartbeat render; `shorts-crop-*` from the crop variant |
| `scripts/browser.mjs` | Playwright launcher with the Node-fetch egress bridge and the big-file cache redirect |
| `scripts/cache-server.mjs` | Local CORS/Range server for cached large files |
| `scripts/00-probe.mjs` | The TTS + MediaRecorder probe |
| `scripts/01-capture.mjs`, `scripts/annotate.mjs` | Scene capture, per-format viewport, DOM-injected annotation |
| `scripts/02-render.mjs` | Drives `video-creator`'s JS API: slides, TTS timing, heartbeat, download, remux; `CROP=1` for the crop variant |
| `scripts/03-frames.sh` | Frame extraction |

Run order: `scripts/run-locally.sh` (repo root) → `cache-server.mjs` → `01-capture.mjs` (`FORMAT=landscape`, then `FORMAT=shorts`) → `02-render.mjs` (same two formats) → `03-frames.sh`. Environment for the Node scripts: `NODE_PATH=/opt/node22/lib/node_modules NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt CACHE_DIR=<dir> FFMPEG=<full ffmpeg>`.

No key, token or vault key is in this folder. The published read key used for the live shots is scraped from https://sgit.ai/demos/vaults/ at capture time and never written to disk.
