# 2 · The run

*A recipe, not a specification. Deviate wherever the ground turns out to be
different from the map — and record the deviation, because that is the finding.*

---

## Step 0 — Boot

```bash
cd <repo>
bash scripts/run-locally.sh          # serves the layered site on :10063, keep it running
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:10063/en-gb/video-creator/   # expect 200
```

`run-locally.sh` layers every IFD version into `.local-server/` and serves that.
**It builds a snapshot at start** — if you edit a file under `tools/`, restart it
or you will be testing the old copy. (That cost an hour once already.)

Playwright: `NODE_PATH=/opt/node22/lib/node_modules node yourscript.js`.
Chromium is at `/opt/pw-browsers/chromium`; never run `playwright install`.

**Check egress before you plan around it:**

```bash
curl -s -o /dev/null -w 'esm.sh: %{http_code}\n' https://esm.sh/kokoro-js
```

200 means the TTS lane is probably viable. It does not prove the model weights
download — that is a much bigger fetch. Find out early, because it decides
whether you have narration or silence.

---

## Step 1 — Write the script BEFORE capturing anything

Ten to fifteen scenes, each with three fields. Do this first: it tells you exactly
which screenshots you need, and stops you capturing forty and using six.

```jsonc
// reel.json — invent the shape you actually want; this is a starting point
{
  "title": "SGit vaults in 90 seconds",
  "scenes": [
    {
      "id": "s01",
      "narration": "A vault is a folder that encrypts itself before anything leaves your machine.",
      "caption": "Encrypted before it leaves",
      "shot": { "kind": "still", "capture": "vault-intro" }
    },
    {
      "id": "s02",
      "narration": "You commit and push like git — but the server only ever sees ciphertext.",
      "caption": "The server sees ciphertext",
      "shot": { "kind": "clip", "capture": "push-flow" }
    }
  ]
}
```

**Keep `narration` and `caption` separate and different.** Narration is a
sentence; the caption is four to eight words. Most people will watch this muted,
and a caption that is just the narration is a wall of text nobody reads.

Aim for **90 seconds landscape**: roughly 12–15 scenes at 6–8 seconds each.

---

## Step 2 — Capture the stills

Drive the real tools with Playwright and screenshot them. For the SGit subject,
the honest demo is to *actually create a vault*:

```bash
pip3 install sgit-ai --break-system-packages --ignore-installed cryptography
sgit remote add origin https://dev.send.sgraph.ai
sgit init --existing --token <token>     # ask for a token; NEVER commit it or the vault key
sgit commit "…" && sgit push
```

Screenshot the terminal output as text-rendered HTML if you want it to look
deliberate, or screenshot the vault tools at
`http://localhost:10063/en-gb/vault-peek/` and `…/vault/`.

**Element screenshots beat full-page screenshots** for this. A cropped panel is
legible in a vertical video; a whole 1920-wide page is not.

```js
await page.locator('.nr-cap').screenshot({ path: 'images/shot-01.png' });
```

---

## Step 3 — Annotate (the trick that saves you a day)

No annotation renderer exists. **Do not write one.** Instead, inject an overlay
into the live page and screenshot *that* — the browser is already an excellent
compositor:

```js
await page.evaluate(() => {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed; left:32%; top:41%; width:36%; height:8%;
    border:3px solid #14b8a6; border-radius:6px; box-shadow:0 0 0 9999px rgba(3,7,18,.55);
    z-index:2147483647; pointer-events:none;`;
  document.body.appendChild(box);

  const tag = document.createElement('div');
  tag.textContent = 'the vault key — the only way in';
  tag.style.cssText = `position:fixed; left:32%; top:50%; z-index:2147483647;
    font:600 20px system-ui; color:#e6edf7; background:#0f766e; padding:6px 12px;
    border-radius:6px; pointer-events:none;`;
  document.body.appendChild(tag);
});
await page.screenshot({ path: 'images/shot-02.png' });
```

That `box-shadow: 0 0 0 9999px rgba(...)` is a **spotlight** — everything outside
the box dims. It is one line and it looks deliberate. For blur, put
`backdrop-filter: blur(12px)` on a positioned div over the region.

**Record in `reel.json` which annotations you used and where.** That list is
evidence for whether the proposed annotation primitives are the right ones — and
if you found yourself wanting something not on the list (`box`, `circle`, `arrow`,
`highlight`, `blur`, `tagline`, `label`, `pointer`), that is a finding.

---

## Step 4 — Capture one or two clips

Some things are not stills: a panel docking, a graph settling, a progress bar
finishing.

```js
const ctx = await browser.newContext({
  recordVideo: { dir: 'clips/', size: { width: 1280, height: 720 } },
  viewport:    { width: 1280, height: 720 },
});
const page = await ctx.newPage();
await page.goto('http://localhost:10063/en-gb/narrated-review/');
await page.waitForFunction(() => !!window.__tool);
// …do the visible thing, with waits so it is watchable…
const clipPath = await page.video().path();
await ctx.close();                      // finalised only on close
```

**`video-creator` cannot take a clip.** So for this spike either (a) extract a few
frames from the clip and use them as stills, or (b) stitch the clip in afterwards
by another route, or (c) skip clips and *report that you skipped them and why*.
All three are legitimate; (c) with a clear reason is more useful than a heroic (b).

---

## Step 5 — Narrate and render

Drive `video-creator` through its JS API.

**The `loadSlides` gotcha:** it wants `File[]`, and a page cannot read your disk.
Build the Files inside the page from data you hand in:

```js
await page.evaluate(async (images) => {
  const files = await Promise.all(images.map(async ({ name, dataUrl }) => {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: 'image/png' });
  }));
  await window.__tool.loadSlides({ files });
}, imagesAsDataUrls);
```

Then:

```js
await page.evaluate(async (scenes) => {
  const t = window.__tool;
  scenes.forEach((s, i) => t.setNarration({ slideIndex: i, text: s.narration }));
  const { durations } = await t.generateAudio({ voice: 'af_bella', speed: 1.0 });
  console.log('durations', durations);          // ← record these
  const started = performance.now();
  const { webmBlob } = await t.record({ fps: 30, bitrateKbps: 2500 });
  console.log('intended', durations.reduce((a, b) => a + b, 0) * 1000,
              'actual', performance.now() - started);   // ← THE measurement
  window.__out = webmBlob;
}, scenes);
```

**Record intended vs actual.** That single pair of numbers is the most valuable
thing this spike can produce — it decides how the real renderer gets built.

Getting the blob out: `await page.evaluate(() => blobToDataUrl(window.__out))`
then write it in Node, or call `t.download({blob, filename})` with a Playwright
download listener.

**Headless and MediaRecorder may not get along.** If `record()` produces nothing
or a zero-byte blob, run headful under a virtual display — this works and is
already used elsewhere in this repo:

```bash
xvfb-run -a --server-args="-screen 0 1920x1080x24" \
  env NODE_PATH=/opt/node22/lib/node_modules node yourscript.js
```

**`record()` runs in real time.** A 90-second video takes 90 seconds. Do not add
a Playwright timeout shorter than the reel.

---

## Step 6 — The vertical cut

```js
await page.evaluate(() => window.__tool.setConfig({ width: 1080, height: 1920 }));
```

`_drawSlide` letterbox-fits, so a 16:9 screenshot will sit in a band with large
empty areas above and below. Two honest options:

1. **Pre-crop the stills** to 9:16 around the interesting region before loading
   them — the region you would have called a "focus rect". This is the one to try
   first, because it tells you whether the focus-rect idea in the proposal
   actually works.
2. Accept the bars and report that the vertical cut is not usable without
   cropping.

**Whichever you do, say which screenshots could not be cropped to 9:16 without
losing the point.** The proposal claims a focus rect solves this; you are the
first person in a position to know whether that is true.

---

## Step 7 — Watch it

Actually watch both videos, or at least export frames every two seconds and look
at them. Then answer, in FINDINGS:

- Is the audio still lined up with the picture at the end?
- Is the vertical one readable on a phone-sized view, muted?
- Would you publish it?

---

## Gotchas, collected

| Thing | What happens | Do this |
|---|---|---|
| Editing a tool file mid-run | You test the old copy | Restart `run-locally.sh` |
| `loadSlides({files})` | Cannot read your disk | Construct `File` objects in-page |
| `record()` | Real time, blocking | Budget the wall clock; no short timeouts |
| Headless MediaRecorder | May produce nothing | `xvfb-run` headful |
| `page.video().path()` | Empty until the context closes | `await ctx.close()` first |
| Kokoro first run | Downloads model weights, slow | Warm it before timing anything |
| `video-creator` manifest | Claims zero actions | Read `api/video-api.js` |
| Vault keys / tokens | Easy to leak | Never commit; keep them out of `reel.json` |
