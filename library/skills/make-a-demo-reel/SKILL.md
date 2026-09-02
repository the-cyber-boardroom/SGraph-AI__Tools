---
name: make-a-demo-reel
description: Make a narrated demo video (landscape and portrait) of a website or tool, unattended, from a Claude Code session — write the reel script, shoot annotated screenshots with Playwright, narrate with Kokoro or OpenRouter, render with video-creator, and produce a storyboard page and PDF. Use when asked to "make a video", "demo reel", "walkthrough video", "shorts", or "storyboard" for a site, a tool, or a vault.
---

# Make a demo reel

This skill reproduces, step by step, what the agent-makes-the-video spike did. The
scripts it uses are in the repo and are the only tooling needed:

```
team/humans/dinis_cruz/claude-code-web/09/01/v0.2.94__spike-result__agent-makes-the-video/scripts/
```

Read `FINDINGS.md` and `TWO-MODES.md` in that folder once; they say why each step is
the way it is. This file says what to do.

## What you produce

| Output | Where | Committed? |
|---|---|---|
| `reel.json` | the reel folder | yes — the source of truth |
| `images/`, `images-shorts/`, `clips/` | the reel folder | yes (about 1–4 MB) |
| `landscape.webm`, `shorts.webm` | the reel folder | **no** — `.gitignore` them; hand them to the requester with the file-sending tool |
| `reel.html`, `reel.pdf` | the reel folder | yes; also publish `reel.inline.html` as an artifact page |
| `capture-log.json`, `render-log.*.json` | the reel folder | yes — the numbers |
| A findings note | the reel folder | yes — what was measured and what broke |

Make a new folder per reel: `team/humans/dinis_cruz/claude-code-web/<MM>/<DD>/vX.Y.Z__reel__<slug>/`,
copy `scripts/` into it (or reference the spike's scripts by path), and work there.
Never write into `team/humans/dinis_cruz/briefs/`. Never push to `dev` or `main`.

## Secrets

The OpenRouter key, if one is used, comes from the environment (`OPENROUTER_API_KEY`)
for the life of the run. It is never written to `reel.json`, a log, a commit, or this
file. A published vault read key is scraped at capture time and never written to disk.

## Step 0 — environment (10 minutes the first time, 1 minute after)

```bash
cd <repo>
bash scripts/run-locally.sh &                 # tools.sgraph.ai on :10063 — RESTART it after any change under tools/
cd <reel folder>/scripts
CACHE_DIR=<scratch>/cache node cache-server.mjs &      # serves cached large files (the Kokoro model) on :10064
pip3 install --target <scratch>/pyffmpeg imageio-ffmpeg   # a full static ffmpeg; Playwright's own is too stripped
export FFMPEG=<scratch>/pyffmpeg/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-*
export NODE_PATH=/opt/node22/lib/node_modules NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt CACHE_DIR=<scratch>/cache
```

Then check whether Chromium can reach `https://` at all:

```bash
node -e "const {createRequire}=require('module');const {chromium}=createRequire(process.cwd()+'/')('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();try{await p.goto('https://esm.sh/kokoro-js',{timeout:15000});console.log('direct https OK')}catch(e){console.log('direct https FAILS — the bridge in browser.mjs is doing the work')}await b.close()})()"
```

In the Claude Code container it fails (`ERR_CONNECTION_RESET` through the agent proxy).
`scripts/browser.mjs` handles that: every non-localhost request is fetched by Node
through the proxy and fulfilled into the page, and anything over 8 MB is cached to disk
and redirected to the cache server, because a large body through the DevTools protocol
kills the page. Use `launch()` and `context()` from `browser.mjs` for every browser you
open and none of this needs thinking about.

## Step 1 — write `reel.json` first

Read the pages you will show (curl the HTML, strip tags) and write the script before
shooting anything. The shape is in the spike's `reel.json`; the fields that matter:

```jsonc
{
  "title": "…", "subtitle": "…", "author": "a Claude Code agent, unattended", "date": "YYYY-MM-DD",
  "voice": "am_michael",
  "intro":  { "narration": "what the video will cover — not a restatement of scene one", "caption": "…" },
  "outro":  { "narration": "…", "caption": "How this video was made" },
  "scenes": [{
    "id": "s01",
    "narration": "one or two spoken sentences",
    "caption": "four to eight words, different from the narration",
    "shot": {
      "kind": "still" | "clip",
      "url": "https://…" | "vault:<Published vault name>",
      "scrollTo": "top" | "text:<visible text to scroll to>",
      "clickTabs": ["Work like git", …],          // clips: buttons to click in turn
      "click": ["text:Open Vault"],               // clips: one click, then hold
      "annotate": [ { "spot": "el:heading:<text>" | "el:table" | "el:code" | "el:badges" | "el:pip" | [x,y,w,h] },
                    { "label": "…", "at": "below" }, { "blur": "el:keys" } ]
      // or "annotate": { "landscape": […], "shorts": […] } when a target cannot be resolved by element
    }
  }],
  "shorts": ["s01", "s02", …]                     // the subset for the portrait cut, in order
}
```

Rules that were learned the expensive way:

- **About 2.1 words per second** at Kokoro speed 1.0; 190 words is a 90-second reel. OpenRouter's voice is about 10 % faster.
- **Element targets over rects.** `el:heading:<text>`, `el:table`, `el:code` re-resolve at the phone viewport; a fraction rect does not. Rects are the fallback for shadow DOM the resolver cannot reach and for content inside a sandboxed iframe (a vault app), which no page-side code can read.
- **Captions are not the narration.** The caption is on screen for the muted viewer; the narration is spoken and also printed in the caption band.
- **The intro previews; scene one starts.** Otherwise the viewer hears the same sentence twice.
- **Spell out pronunciation in the text** where the engine gets it wrong ("sgit dot ai").
- Add a `notes` array and write down every change you make to the shape and why.

## Step 2 — capture

```bash
FORMAT=landscape node 01-capture.mjs      # 1280×720, all scenes, clips recorded with recordVideo
FORMAT=shorts    node 01-capture.mjs      # 540×960 @2×, only reel.shorts, clips shot as stills
SCENES=s07 FORMAT=landscape node 01-capture.mjs   # re-shoot one scene
```

Look at every still (`Read` the PNG) before rendering. Things that go wrong silently:
the site uses `scroll-behavior: smooth` (handled: the scroll is forced instant); a
target text sits in a child element (`text:` matching is on `textContent`, so
"2 Work like git" with the number in a `<span>` still matches "Work like git"); a
target is in shadow DOM (the resolver walks open shadow roots) or in a sandboxed
iframe (it cannot; use a per-format rect). The capture log records what each
annotation resolved to; `"resolved": false` means fix the target and re-shoot.

## Step 3 — render

```bash
FORMAT=landscape POOL=2 VOICE=am_michael node 02-render.mjs          # Kokoro, free, ~2× the audio length to generate
FORMAT=shorts    POOL=2 VOICE=am_michael node 02-render.mjs
FORMAT=landscape TTS=openrouter VOICE=onyx SUFFIX=-openrouter node 02-render.mjs   # needs OPENROUTER_API_KEY in the environment
```

What the render script does, so you can tell when it has not: composes every slide
in-page (header with title, date, author and scene number; the screenshot cropped to
the picture area around the spotlight; a caption band with caption and narration),
adds a title slide and a closing "how this was made" slide, loads them into
`video-creator` v0.1.72 with `captionBar:false, paintEveryFrame:true`, narrates,
swaps the closing slide for one with the measured numbers, records in real time,
downloads through Chromium, remuxes with ffmpeg so the WebM has a duration, and
writes `render-log.<format>.json`.

Budget the wall clock: TTS with Kokoro takes about twice the audio length, the record
takes exactly the audio length, and neither can be sped up. Do not run two renders at
once or shoot while one is recording; CPU contention shows up as drift.

## Step 4 — check, then document

```bash
bash 03-frames.sh                                   # stills every few seconds into frames/
$FFMPEG -i landscape.webm -vf showinfo -f null - 2>&1 | grep -c pts_time   # frame count: expect ~30 × seconds
node 04-doc.mjs && INLINE=1 node 04-doc.mjs         # reel.html + reel.pdf, and the single-file copy for publishing
```

Read at least three frames: the title slide, a mid scene, the closing slide. A frame
count near the number of slides means the encoder got one frame per slide and the
text will be smeared; the tool's `paintEveryFrame` must be on.

Publish `reel.inline.html` as an artifact page (strip its `<html>/<head>/<body>`
wrapper first; keep `<title>`, `<link>`, `<style>` and `<main>`) and send the videos
and the PDF with the file-sending tool. The videos are not committed.

## Step 5 — record what you measured

Copy the numbers table from the spike's `FINDINGS.md` and fill it: length, size,
frames, intended vs actual record time and drift per minute, TTS time against audio
length, capture time and shots taken versus used, API cost (exact, from the OpenRouter
generation endpoint when that voice was used; $0.00 otherwise), wall clock. Say what
did not work and why, with the error. A rough video and a sharp findings note is a
good run; a polished video and "it went fine" is a wasted one.

## Gotchas, in the order they will bite

| Symptom | Cause | Do |
|---|---|---|
| `Cannot find package 'playwright'` from an `.mjs` | `NODE_PATH` is ignored by ESM `import` | `createRequire(import.meta.url)('playwright')`, as `browser.mjs` does |
| `ERR_CONNECTION_RESET` on every `https://` in Chromium | the agent proxy and Chromium's TLS handshake | use `browser.mjs`; never disable TLS verification |
| `Target page, context or browser has been closed` during model load | a >8 MB body fulfilled through CDP | the cache server; check it is running on :10064 |
| Every still shows the top of the page | smooth scrolling | already forced instant in `01-capture.mjs` |
| `t.getConfig().width` is `undefined` | every `window.__tool` method returns a Promise, sync ones included | `await` them |
| 13 frames in a 2-minute video, smeared text | canvas capture only emits a frame when the canvas is painted | `paintEveryFrame: true` (video-creator ≥ v0.1.72) |
| `Duration: N/A` on the WebM; Playwright's ffmpeg cannot remux | MediaRecorder writes no duration header | the full ffmpeg from `imageio-ffmpeg`; `-c copy` remux |
| Video is 128 s for a "90-second" script | 274 words | 2.1 words per second |
| The edited tool file is not what runs | `run-locally.sh` snapshots `tools/` at start | restart it |
| Portrait crop cuts sentences in half | 9:16 of a desktop still is 405 px wide | shoot the portrait scenes at a phone viewport (`FORMAT=shorts`) |
