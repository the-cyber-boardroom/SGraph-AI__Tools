# Spike: agent makes the video — findings

**Date:** 1 Sep 2026   **Subject:** SGit vaults (sgit.ai home, the SG/Vault docs page, the published-vaults page, and the "Field Notes" vault opened live in SG/App and SG/Vault)   **Time spent:** about 3 h 30 min of a one-session run, of which roughly 1 h 15 min went on getting a browser to reach the internet at all (see *What was hard*).

The OpenRouter key supplied for narration was **not used**. Kokoro ran locally in the browser, as the brief said it would; nothing in this folder or in the scripts calls OpenRouter.

## Did it work?

Yes, with one large caveat. Two videos came out, each from a `reel.json` written first, thirteen stills and two clips shot by Playwright, Kokoro narration and `video-creator`'s own recorder, with no human at a screen. The caveat: **as shipped, `video-creator` produced a 128-second video containing 13 video frames**, one per slide, and every frame was a single under-budgeted P-frame the encoder never refined, so every screenshot was an illegible smear. `canvas.captureStream(30)` only emits a frame when the canvas is painted, and the tool paints once per slide. A twelve-line repaint loop injected from outside the tool (`scripts/02-render.mjs`, "heartbeat") turns that into a real 30 fps stream and the text becomes readable. I would not publish either video as they are: the captions are 16 px, the vertical cut is a crop of a desktop page, and the voice pronounces "sgit" as "s-git". I would publish the *pipeline* after the fixes listed under *What would you actually build*.

## The video

__VIDEO__

Watch them, or look at `frames/`. Run 1 (no heartbeat) is kept in the numbers below for comparison but its file is not committed; `frames/run1-*.png` show what it looked like.

## Numbers

__NUMBERS__

**How to read the drift row.** The recorder advances slides with `setTimeout(duration*1000)` and the audio plays on an AudioContext started in the same tick. Frame timestamps in the container matched the intended scene starts to within 37 ms over 121 s (0.00/7.41/17.51/25.10/… against 0.00/7.40/17.50/25.07/…). So the clock is not the problem the demo-reel pack feared; **the frame source is**. Decision 8 asked the right question and got a different answer than expected.

**TTS is the cost.** Kokoro on WASM with two workers ran at roughly 0.8× real time for generation: 128 s of speech took 158 s, and a second identical call took 158 s again, because `sg-tts` caches nothing. Model load from the local disk cache was 7.2 s; the first download of the 92 MB model plus a 22 MB WASM runtime is a separate, larger cost. With a single worker (the probe) two short sentences took 17.9 s for 8 s of audio, so the pool size matters more than anything else here.

**"Ten minutes end to end" (the proposal's claim)** is plausible only if TTS is cached or off-loaded: script → video here was 7 min 34 s for a 2-minute reel with two TTS passes, and would be about 4 min 30 s with one pass, of which 2 min is the unavoidable real-time record.

## What was hard

1. **Getting Chromium onto the internet — ~75 min.** Every `https://` navigation from Playwright's Chromium fails with `ERR_CONNECTION_RESET` in this container, while `curl`, Node's `fetch` and `openssl s_client` through the same proxy succeed. The proxy status endpoint shows the tunnel opening, ~1.7 KB sent (a ClientHello), 39 bytes back (the `200 Connection established`) and the tunnel closing after 6 s. The likely cause is the size or content of Chromium's TLS 1.3 ClientHello; I could not confirm it because the two ways of testing it (a system policy file, a local sniffing proxy) were both outside what this session may do. The fix that worked is `scripts/browser.mjs`: `context.route()` every non-localhost request through Node's `fetch` (`NODE_USE_ENV_PROXY=1` plus the proxy CA) and fulfil it. That covered page loads, the SG/App vault (182 requests), `esm.sh` module imports *from inside a Web Worker*, and Hugging Face. Then a second wall: fulfilling the 92 MB ONNX model through the DevTools protocol killed the page ("Target closed", no crash event). `scripts/cache-server.mjs` (a 30-line static server with CORS and Range) plus a 302 from the bridge for anything over 8 MB fixed that, and made re-runs fast as a side effect.
2. **Finding out why the video was smeared — ~25 min.** Frames extracted at 9 s and 97 s showed the *next* scene, not the current one. `ffmpeg -vf showinfo` on the output explained everything at once: 13 frames, 2 keyframes, one frame per slide. Nothing in the tool, the brief, or the demo-reel pack anticipates this, and it is the single most important thing to know before building a renderer on `video-creator`.
3. **Element targeting on real pages — ~20 min.** sgit.ai sets `scroll-behavior: smooth`, so `scrollIntoView()` returns before the scroll happens and every screenshot showed the top of the page; the first capture run "resolved" only the targets that were visible without scrolling. Tab buttons carry their number in a child `<span>`, so text matching on "2 Work like git" fails. SG/App's header is shadow DOM, so `document.querySelectorAll` cannot see the "R1 W0" badge at all; that spotlight is a hand-measured rect.

Smaller ones, each ~5 min: `NODE_PATH` is ignored by ESM `import` (the recipe's `node script.mjs` line does not work as written; `createRequire` does); MediaRecorder's WebM has no duration header, and Playwright's bundled `ffmpeg` is too stripped to remux it (`imageio-ffmpeg` from PyPI brings a full static build); `ffmpeg -i` exits 1 by design.

## What was easy that we expected to be hard

- **Annotation by DOM injection: ~15 min for spotlight, label and blur**, including a resolver that turns "the table after this heading" into a rect. The `box-shadow: 0 0 0 9999px` spotlight looks deliberate on every page it was tried on. Blur (`backdrop-filter`) over 19 read-key cells on the published-vaults page worked first time. The proposal budgets two to three days for an annotation renderer; the renderer is the browser.
- **Shooting clips.** Two clips (10 s tab walk, 24 s "Open Vault" into the SG/Vault file browser) came from `recordVideo` with no extra code. Using a clip's last frame as the still for `video-creator` was one screenshot call.
- **Driving a live vault.** The SG/App page for a published vault rendered fully through the bridge, "Open Vault" opened the SG/Vault file browser in the same tab, and the screenshots are of the real product decrypting real content with a real published key.
- **Captions for free.** `_drawSlide` prints `${slide.name} • i/n` in a bottom bar, so naming each `File` after the scene's caption gives an on-screen caption track with no code. It is 16 px, so it is a proof, not a feature.
- **The vertical crop.** Cropping a 9:16 window around a focus rect is ten lines of canvas code, done in-page before `loadSlides`. Whether the *result* is good is a different question (below).
- **Headless MediaRecorder.** The brief warned it might produce nothing. It produced a valid VP9/Opus WebM headless, first time, no `xvfb`.

## Is the proposed demo-reel design right?

1. **Annotations as data, never baked pixels — confirmed, with a twist.** The data shape that worked is not `{type:'circle', at:[…]}` but *"the element after this heading"*: nine of thirteen scenes resolved their target by DOM query, and those survive a page redesign where a fraction rect does not. Both are needed (shadow DOM forced two rects). The list of primitives can shrink to **spot, label, blur**; nothing wanted an arrow, a circle or a pointer.
2. **One document, two aspect ratios via a focus rect — wrong as stated, right in spirit.** __D2__
3. **Caption as a separate authored track — confirmed, strongly.** Written before capture, the caption told me which screenshot I needed; the narration did not. Rendering is the gap: 16 px in a bottom bar is unreadable on a phone. This is the one primitive worth building.
4. **Multi-shot scenes under one narration — unnecessary here.** Thirteen scenes, one image each, and not once did I want a second image under the same sentence. The one place motion mattered (the tab walk) was a clip. Skip it until a script actually needs it.
5. **The reel document as the API — confirmed.** `reel.json` was written first and everything else read it. Its shape (`narration`, `caption`, `shot{url, scrollTo, annotate[], focus}`) is smaller than the pack's and was enough. The thing an agent needs that the pack does not name: **`scrollTo` and element-relative targets**, because the agent never sees the page.
6. **Import from narrated-review as a transform — not tested, and probably unnecessary.** Writing thirteen scenes from the page text took twenty minutes; I did not want captures from a recording session. Keep the mapping documented, do not build it first.
7. **Handoff via files/VFS, not localStorage — confirmed trivially.** The stills were 76 to 209 KB each, 1.4 MB for thirteen; the two clips 2.1 MB. Files on disk plus `File` objects built in-page were the whole handoff.
8. **Measure render pacing first — confirmed, and it found something else.** Drift was 66 ms in 128 s. The measurement worth having was frame count, and the pack does not list it. Add "frames written per second" to Phase 0 and it is the right phase.
9. **Clips as a shot type — confirmed cheap to shoot, unproven to play.** Shooting was free. Playing a clip inside the render is untested because `video-creator` takes images, and I did not stitch: the last frame as a still was good enough for both clips here, which is itself evidence that clips are a Phase 3.5 problem, not a Phase 1 one.

## What would you actually build?

If I had to make ten of these, the smallest thing that makes it easy is **not a new tool**. It is four fixes to what exists, in this order:

1. **Make `video-creator` paint every frame** (a `requestAnimationFrame` redraw, or `track.requestFrame()` at the configured fps) and emit a keyframe on each slide change. Without this every output is unpublishable. One afternoon.
2. **Cache TTS by (text, voice, speed) hash** in `sg-tts`, in memory and in `sg-vfs`. The second render of a reel then costs the record time and nothing else. One afternoon.
3. **A caption track in `_drawSlide`**: a large, wrapped, high-contrast caption instead of the filename bar, sized per aspect ratio. Half a day.
4. **A capture script, not a capture tool**: what `scripts/01-capture.mjs` and `annotate.mjs` already are, tidied, with `scrollTo`, element-relative spotlight/label/blur, and `recordVideo` clips. It lives next to the reel, runs under Playwright, and needs no UI. One day to make it reusable.

That is about three days and it leaves `demo-reel` as a JSON shape plus two scripts. The pack's Phases 1 to 3 (annotation renderer, scene model, import) can wait until a tenth video wants something these do not give.

Two things I would add to the pack before anyone builds it: **the frames-per-second measurement**, and **a rule that the agent that writes the reel also shoots it**, because the shot spec that works is "scroll to this text, spotlight the table after it", which only makes sense for someone driving the page.

## What did NOT work

- **Chromium HTTPS through the agent proxy.** `net::ERR_CONNECTION_RESET` on every external `https://` URL; details above. Worked around with the Node bridge; **not** fixed. Anyone repeating this in a container with the same proxy will hit it in the first minute.
- **`route.fulfill()` with a 92 MB body.** `page.evaluate: Target page, context or browser has been closed`, no `crash` event. Worked around with the local cache server.
- **`--disable-features=…` and a Local State preference to disable post-quantum key agreement.** No effect on the ClientHello size. The policy-file route (`/etc/chromium/policies/managed/`) and a ClientHello sniffer were both refused by the session's permission model, so the hypothesis stays unconfirmed.
- **`video-creator` as shipped for screenshots with text**: 13 frames per 128 s. Worked around with the heartbeat, which is a spike hack and not a fix.
- **Element targeting in shadow DOM** (SG/App header): a hand-measured rect instead.
- **The SGit "create a real vault" path.** Not attempted: `sgit` is not installed here, no Send token was given, and the published read-only vault gave the live shots the script needed. The video shows a published vault opened live, not one being created.
- **The 60 to 120 s budget on the first try.** 274 words of narration became 128.5 s of Kokoro. 218 words became __LANDSCAPE_S__ s. About 1.7 words per second is the planning number.
- **Pronunciation.** Kokoro says "sgit" as "ess-git" and reads "sgit.ai" oddly; I wrote "sgit dot ai" and "sgit dash ai" into the narration to steer it, which is the wrong place for that knowledge. A pronunciation map belongs in the reel document.

## Artefacts

| File | What |
|---|---|
| `landscape.webm` | The 16:9 video, 1280×720, VP9/Opus, heartbeat on |
| `shorts.webm` | The 9:16 cut, 1080×1920, six scenes cropped to their focus rects |
| `reel.json` | The script: 13 scenes, narration + caption + shot spec, invented for this spike |
| `capture-log.json` | What each shot resolved to, timings, captured/used counts |
| `render-log.landscape.json`, `render-log.shorts.json` | TTS, intended vs actual, file info, wall clock |
| `images/` | The thirteen annotated stills, as loaded into `video-creator` |
| `clips/` | The two Playwright clips (s04 tab walk, s11 Open Vault) |
| `frames/` | Stills from both videos every few seconds; `run1-*` from the no-heartbeat render |
| `scripts/browser.mjs` | Playwright launcher with the Node-fetch egress bridge and the big-file cache redirect |
| `scripts/cache-server.mjs` | The local CORS/Range server for cached large files |
| `scripts/00-probe.mjs` | The TTS + MediaRecorder probe |
| `scripts/01-capture.mjs`, `scripts/annotate.mjs` | Scene capture and DOM-injected annotation |
| `scripts/02-render.mjs` | Drives `video-creator`'s JS API; crop, TTS timing, heartbeat, download, remux |
| `scripts/03-frames.sh` | Frame extraction |

No key, token or vault key is in this folder. The published read key used for the live shots is scraped from https://sgit.ai/demos/vaults/ at capture time and never written to disk.
