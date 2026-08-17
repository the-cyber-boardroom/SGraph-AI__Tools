# Media Probe — Browser / Playwright Guide

Drive the tool through `window.__tool` (live after `tool:ready`). Every registered
action returns a Promise.

## Everything is drivable headlessly

There are no gestures anywhere and no network calls at all (except the optional
FFmpeg lane). That is the point: an agent handed a recording can answer "will this
segment cleanly?" before anything is spent.

```js
await page.goto('http://localhost:10063/en-gb/media-probe/');
await page.waitForFunction(() => !!window.__tool);

const probe = await page.evaluate(async () => {
  const t = window.__tool;
  await t.loadVideo({ file });          // a File/Blob — video or audio
  await t.analyseAudio({});             // seconds; the important lane
  await t.analyseFrames({});            // the slow one — seek per sample
  t.alignSignals({});
  t.plan({});
  return t.getProbe();
});
```

## Building a test clip in-page

No fixture is needed — record a synthetic screencast with a canvas and an
oscillator, exactly as the video smoke does:

```js
const canvas = document.createElement('canvas');
const actx = new AudioContext();
const dest = actx.createMediaStreamDestination();
const gain = actx.createGain(); gain.gain.value = 0;
const osc = actx.createOscillator(); osc.connect(gain); gain.connect(dest); osc.start();
const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(),
                                ...dest.stream.getAudioTracks()]);
const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
```

**Add a room-tone floor when testing thresholds.** A second oscillator at low gain
(~0.05) under everything reproduces the condition that broke the original
segmenter: synthetic digital silence is *precisely* what hid the defect, so a test
over true silence proves nothing about real recordings.

```js
const nz = actx.createOscillator(); nz.frequency.value = 60;
const ng = actx.createGain(); ng.gain.value = 0.05;   // above the old fixed 0.01
nz.connect(ng); ng.connect(dest); nz.start();
```

A MediaRecorder WebM has no duration in its header, so `video.duration` is
`Infinity`. `sampler.openSource` recovers it by seeking past the end — you do not
need to work around it.

## Asserting the thing that matters

```js
const cal = await page.evaluate(() => window.__tool.analyseAudio({}));
// The threshold must come from the recording, not from a constant.
expect(cal.method).toBe('calibrated from this recording');
expect(cal.threshold).toBeGreaterThan(0.01);      // over a room-tone floor

// A force-cut boundary is arbitrary. Zero is the goal; non-zero must be reported.
const r = await page.evaluate(() => window.__tool.replaySegmentation({ maxUtteranceMs: 8000 }));
expect(r.capped).toBe(0);
expect(r.segments.some(s => s.tEnd - s.tStart === 8000)).toBe(false);   // the tell-tale
```

## Speed

`analyseFrames` is the slow lane. In a test, cut it down rather than skipping it:

```js
await page.evaluate(() => window.__tool.analyseFrames({ coarseFps: 2, fineFps: 4, twoPass: true }));
```

`estimateSweep()` returns `{ samples, estimatedMs }` before committing, and
`cancelSweep()` aborts a running sweep (the promise rejects with `{code:'cancelled'}`).

## The filmstrip

`analyseFrames` ends by capturing a screenshot track for the timeline. It is a
FIXED COUNT (default 48), not a fixed interval — one per second would be thousands
of images on a long recording — and it always includes a frame at every detected
scene change, flagged `mark: true`.

```js
const { frames } = await page.evaluate(() => window.__tool.getFilmstrip());
// frames[i] = { at, mark, thumb }   thumb is a JPEG data URL
await page.evaluate(() => window.__tool.captureFilmstrip({ count: 120 }));  // denser
```

`getProbe()` carries only the COUNT — dozens of base64 images would dwarf the
measurements the probe exists to carry. Use `getFilmstrip()` in-page for the
images themselves.

## DOM contract (stable ids)

`#mp-drop` · `#mp-file` · `#mp-run-audio` · `#mp-run-frames` · `#mp-cancel` ·
`#mp-run-all` · `#mp-plan` · `#mp-thr` (the threshold slider) · `#mp-canvas` ·
`#mp-hist-energy` · `#mp-hist-gaps` · `#mp-thr-table` · `#mp-shots` ·
`#mp-metric` · `#mp-align-plot` · `#mp-compare-table` · `#mp-findings-body` ·
`#mp-scrub` (the hover frame preview, `hidden` until the pointer is over the canvas) ·
`#mp-dl-json` · `#mp-dl-csv` · `#mp-dl-zip` · `#mp-warnings`

Dragging `#mp-thr` re-runs the real VAD; `#mp-thr-table` rows carry `data-thr` and
are clickable.

## Events to wait on

`mp:source:loaded`, `mp:analyse:started`, `mp:analyse:progress`,
`mp:analyse:complete`, `mp:threshold:changed`, `mp:plan:ready`, `mp:warning`,
`mp:ffmpeg:ready`, `mp:reset`. All fire on `window`; detail carries `instanceId`.

Waiting on `mp:warning` is often the real assertion — the codes are
`not-bimodal`, `no-topic-gaps`, `no-scenes`, `uncorrelated`, `arbitrary-cut`.

## The FFmpeg lane in tests

Skip it on an offline runner: `runFfmpegLane` needs the unpkg CDN and will reject.
Its parsers are pure and testable directly against captured stderr text:

```js
const m = await import('/core/sg-media-analysis/v0/v0.1/v0.1.0/ffmpeg-lane.js');
m.parseSilence('[silencedetect @ x] silence_start: 41.9\n[silencedetect @ x] silence_end: 43.1 | silence_duration: 1.2');
// → [{ startMs: 41900, endMs: 43100, durationMs: 1200 }]
```

A run that produces no parsable rows throws `{code:'ffmpeg-parse'}` and keeps the
raw log on the error — deliberately distinct from an empty result.
