# YouTube Probe — Browser / Playwright Guide

Drive through `window.__tool` (live after `tool:ready`). Every action returns a
Promise.

## The offline battery is CI-safe

A1–A7 need no token, no network and no gesture. They are a real regression suite
for the caption parsers and the region-mask hypothesis:

```js
await page.goto('http://localhost:10063/en-gb/youtube-probe/');
await page.waitForFunction(() => !!window.__tool);
const summary = await page.evaluate(() => window.__tool.runAuto());
// { total: 7, pass, fail, info, blocked, results: [...] }
```

A3–A6 record a synthetic talk with MediaRecorder, so allow ~60 s and launch with
`--autoplay-policy=no-user-gesture-required`.

## Asserting the hypotheses, not the harness

```js
const r = await page.evaluate(() => window.__tool.getResults());
const byId = Object.fromEntries(r.results.map(x => [x.id, x]));

// A1/A2 are ordinary correctness — these SHOULD be green.
expect(byId.A1.status).toBe('pass');
expect(byId.A2.status).toBe('pass');

// A3/A4 are a QUESTION. Do not assert a direction; assert that the comparison
// was actually made, then read the numbers.
expect(byId.A4.evidence.masked).toBeDefined();
expect(byId.A4.evidence.unmasked).toBeDefined();
console.log('masked', byId.A4.evidence.masked, 'unmasked', byId.A4.evidence.unmasked);
```

That distinction is the point of the tool. Asserting `A3.status === 'fail'` would
bake today's guess into the suite and hide the day it stops being true.

## Driving the manual tests

```js
await page.evaluate(() => window.__tool.setToken({ token: process.env.YT_TOKEN }));
await page.evaluate(() => window.__tool.setContext({
  videoId: 'https://youtu.be/xxxxxxxxxxx',        // one of yours
  otherVideoId: 'https://youtu.be/yyyyyyyyyyy',   // one you do not own
}));
for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M9', 'M6', 'M7']) {
  console.log(await page.evaluate(i => window.__tool.runTest({ id: i }), id));
}
```

`runTest` **never throws** — a thrown error is captured as the result, because
losing a diagnostic to an unhandled rejection is the worst possible outcome.

M8 needs a real gesture and a tab to share; Playwright cannot pick one for you.

`getStatus()` is **async** and, when a token is present, names the signed-in
channel: `{ token: { scopes, expiresInS, hasForceSsl }, channel: { id, title,
videoCount } }`. Still never the token itself. Assert on `channel.videoCount` to
prove a sign-in reached an account that actually has uploads — the acknowledgement
the sign-in card was missing entirely on the first live run.

To test the harness-error path without waiting for a flaky recorder, break the
canvas rather than the recorder — it fails fast, before the 18-second timing loop:

```js
HTMLCanvasElement.prototype.captureStream = () => { throw new Error('nope'); };
const r = await window.__tool.runTest({ id: 'A6' });
// r.status === 'error'  (NOT 'fail'), r.evidence.attempts.length === 2
```

## Mocking the YouTube API

The probes call `www.googleapis.com/youtube/v3` through plain `fetch`, so a route
override drives them without credentials:

```js
await page.route('**/youtube/v3/captions**', route => route.fulfill({
  status: 403,
  contentType: 'application/json',
  body: JSON.stringify({ error: { message: 'The permissions associated with the request are not sufficient…',
                                  errors: [{ reason: 'forbidden' }] } }),
}));
```

Useful for asserting that a refusal is reported as `asr-download-refused` with its
status and reason intact, rather than flattened into "no captions" — those are
different facts and they lead to different tools.

## DOM contract (stable ids)

`#yp-token` · `#yp-token-save` · `#yp-client` · `#yp-signin` · `#yp-mine` ·
`#yp-other` · `#yp-talks` · `#yp-caps` · `#yp-secs` · `#yp-run-auto` ·
`#yp-run-all` · `#yp-reset` · `#yp-list` · `#yp-progress` · `#yp-report-body` ·
`#yp-copy` · `#yp-dl-md` · `#yp-dl-json`

Test rows carry `data-id`; their Run buttons carry `data-run`.

## Events to wait on

`yp:test:started`, `yp:test:progress`, `yp:test:complete`, `yp:suite:complete`,
`yp:auth:changed`, `yp:reset`. All fire on `window`; detail carries `instanceId`.

## Reusing the modules directly

Every probe module is importable on its own — handy for node-side or unit tests:

```js
const { parseCaptions } = await import('/en-gb/youtube-probe/api/yp-captions.js');
const { suggestMask }   = await import('/en-gb/youtube-probe/api/yp-mask.js');
const { recordTalk }    = await import('/en-gb/youtube-probe/api/yp-synth.js');
```
