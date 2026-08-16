# Narrated Review — Browser / Playwright Guide

Drive the tool through `window.__tool` (live after `tool:ready`). Every registered action returns a Promise.

## What CANNOT be driven headlessly

`startSession()` calls `getDisplayMedia` + `getUserMedia` — it **must run in a real user gesture**. In Playwright, click the button rather than calling the API:

```js
await page.goto('http://localhost:10063/en-gb/narrated-review/');
await page.waitForEvent('tool:ready');
// Fake the pickers:
//   --auto-select-desktop-capture-source="Entire screen"
//   --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
await page.click('#nr-share');
await page.waitForEvent('nr:session:started');
```

While capturing, `markMoment()` IS drivable from evaluate (the gesture was the session start):

```js
await page.evaluate(() => window.__tool.markMoment());
```

## The fully headless path (no gestures at all)

`addRecording → markAt → transcribeAll → cleanAll → buildDocument` — this is what the pipeline smoke uses, with OpenRouter mocked via `page.route('**/chat/completions', …)`:

```js
await page.evaluate(async () => {
  const t = window.__tool;
  t.setApiKey({ apiKey: 'sk-or-test' });
  // Build a 10s WAV in-page (silence + tone bursts) and import it:
  const file = makeTestWav();                    // any audio File/Blob
  await t.addRecording({ file });
  await t.markAt({ t: 1000 });
  await t.markAt({ t: 5000 });
  await t.transcribeAll();                       // parallel lane
  await t.cleanAll();                            // sequential lane (mock JSON)
  const { markdown } = await t.buildDocument();
  return markdown;
});
```

## Events to wait on

`nr:mark`, `nr:pair:added`, `nr:transcribe:complete`, `nr:session:ended`, `nr:clean:complete`, `nr:document:built`, `nr:bundle:created`. All fire on `window`; detail carries `instanceId`.

## Stable DOM ids

| Id | What |
|---|---|
| `#nr-share` | Share screen & start (gesture) |
| `#nr-finish` | Finish session |
| `#nr-mark` | The mark surface (click = mark) |
| `#nr-key` / `#nr-key-save` | BYOK key input |
| `#nr-cleanup-mode` | grounded / text-only / off |
| `#nr-doc-build` / `#nr-doc-copy` | Document tab |
| `#nr-ex-zip` / `#nr-ex-send` | Export tab |

## Console quickies

```js
(await __tool.getStatus())               // where things stand
(await __tool.getPairs()).map(p => [p.id, p.status, p.raw?.text?.slice(0,40)])
await __tool.getCostSummary()
await __tool.getSummary()                // the rolling summary
```
