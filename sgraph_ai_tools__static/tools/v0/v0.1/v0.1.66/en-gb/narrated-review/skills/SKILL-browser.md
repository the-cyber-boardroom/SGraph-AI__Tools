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

## Authoring and editing without any audio or model

```js
await page.evaluate(async () => {
  const t = window.__tool;
  const a = await t.insertPair({ text: 'first point', notes: 'follow up on this' });
  const b = await t.insertPair({ text: 'second point', afterId: a.id });
  await t.movePair({ id: b.id, toIndex: 0 });        // reorder
  return (await t.getPairs()).map(p => [p.id, p.seq]);
});
```

## Chat (needs a key)

```js
await t.askPair({ id: 'p02', text: 'What is on this screen?' });   // one capture
const r = await t.askSession({ text: 'Add a note to capture 2 and summarise at the end.' });
r.changes;   // [{ tool: 'set_notes', args }, { tool: 'insert_capture', args }]
```

## Sessions (no key needed)

```js
const meta = await t.saveSession({ name: 'my session' });   // → IndexedDB via core/sg-vfs
await t.listSessions();                                     // newest first
await t.loadSession({ sessionId: meta.sessionId });          // survives a full page reload
```

## Stable DOM ids

| Id | What |
|---|---|
| `#nr-share` | Share screen & start (gesture) |
| `#nr-finish` | Finish session |
| `#nr-mark` | The mark surface (click = mark) |
| `#nr-key` / `#nr-key-save` | BYOK key input |
| `#nr-cleanup-mode` | grounded / text-only / off |
| `#nr-doc-build` / `#nr-doc-copy` | Document tab |
| `#nr-ex-zip` / `#nr-ex-pdf` / `#nr-ex-send` | Export tab |
| `#nr-vault-id` / `#nr-vault-secret` / `#nr-vault-audio` / `#nr-vault-save` | Vault save |
| `#nr-chat-input` / `#nr-chat-send` | Chat tab (scope radio: `input[name=nr-scope]`) |
| `#nr-insert-end` | Add a capture at the end |
| `#nr-sess-save` / `#nr-sess-list` / `#nr-sess-name` | Saved sessions |
| `nr:ui:open-capture` (window event) | Opens a capture as its own dockable panel |

## Console quickies

```js
(await __tool.getStatus())               // where things stand
(await __tool.getPairs()).map(p => [p.id, p.status, p.raw?.text?.slice(0,40)])
await __tool.getCostSummary()
await __tool.getSummary()                // the rolling summary
```
