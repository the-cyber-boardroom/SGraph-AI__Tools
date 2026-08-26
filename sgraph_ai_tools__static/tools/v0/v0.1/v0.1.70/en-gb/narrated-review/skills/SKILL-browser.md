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

## Video import (headless, no gestures)

`importVideo({ file })` is the third ingest path and needs no gesture at all — it
resets the session and builds the captures from the recording:

```js
const r = await page.evaluate(async () => {
  const file = new File([window.__clip], 'clip.webm', { type: 'video/webm' });
  return window.__tool.importVideo({ file });     // { pairs, segments, durationMs, via }
});
// then the ordinary lanes: transcribeAll → cleanAll → buildDocument
```

`via` tells you which audio extractor ran: `'web-audio'` (free, in-browser) or
`'ffmpeg'` (the WASM fallback — a CDN load, so it fails on an offline runner).

The video smoke builds its own screencast in-page (a canvas of coloured slides
plus a gated oscillator) rather than shipping a fixture — see
`tests/playwright/narrated-review-video-smoke.js`. Note that a `MediaRecorder`
webm has no duration in its header; the tool recovers it by seeking past the end,
so a stream-recorded file imports like any other.

Overriding a picked frame:

```js
const { candidates, chosenAt } = await page.evaluate(id => window.__tool.getFrameCandidates({ id }), id);
await page.evaluate(([id, at]) => window.__tool.setFrame({ id, at }), [id, candidates[0].at]);
```

## Billing (mock the generation endpoint too)

Every paid call is recorded at the transport, so a mocked run still builds a full
ledger. To exercise the receipts, mock `GET /api/v1/generation` alongside
`/chat/completions` and echo the id back:

```js
if (u.includes('/api/v1/generation')) {
  const id = (u.split('id=')[1] || '').split('&')[0];
  return new Response(JSON.stringify({ data: {
    id, total_cost: 0.0005, provider_name: 'MockProvider',
    native_tokens_prompt: 111, native_tokens_completion: 22,
  }}), { status: 200, headers: { 'content-type': 'application/json' } });
}
```

```js
const b = await page.evaluate(() => window.__tool.getBilling());   // ledger, ids present
await page.evaluate(() => window.__tool.fetchBilling({ delayMs: 0 }));  // delayMs 0 in tests
```

`fetchBilling` with nothing to fetch is a no-op, not a `no-key` refusal — so a
keyless boot smoke can call it safely.

## Reading a bundle programmatically

`getSession().moments` (and `session.json` in an export) is the machine-readable
view: `index`, `id`, `image`, `audio`, `rawFile`, `text` + `textSource`, `rawText`,
`notes`, `marks`. Do not parse `review.md` to rebuild the image↔words join.

## Events to wait on

`nr:mark`, `nr:pair:added`, `nr:transcribe:complete`, `nr:session:ended`, `nr:clean:complete`, `nr:document:built`, `nr:bundle:created`, and for imports `nr:video:started` / `nr:video:progress` / `nr:video:complete`. All fire on `window`; detail carries `instanceId`.

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

## Autosave, undo and the handover bundle (v0.1.6)

Every mutation is checkpointed, logged and autosaved by a wrapper at the
registration boundary, so driving the tool from Playwright exercises all three
without doing anything special.

```js
await page.evaluate(async () => {
  const t = window.__tool;
  await t.insertPair({ text: 'a', raw: 'a' });
  await t.insertPair({ text: 'b', raw: 'b' });
  const ids = (await t.getPairs()).map(p => p.id);
  await t.movePair({ id: ids[1], toIndex: 0 });
  t.undo();                                   // sync; back to a,b
  await t.flushAutosave();                    // force a write, ignoring the debounce
});
```

**Testing the case that matters** — survival across a real reload, recovered
through the real button rather than the API:

```js
await page.reload();
await page.waitForFunction(() => !!window.__tool);
const found = await page.evaluate(() => window.__tool.findUnsaved());
// found.recoverable === false means it never reached disk — do NOT offer a restore
await page.click('#nr-restore-yes');
```

`beforeunload` is armed when there are unsaved changes or a recording is live.
Playwright dismisses the dialog automatically; if you need to assert on it, listen
for `page.on('dialog')` before navigating away.

**DOM contract (added):** `#nr-save` · `#nr-save-state` · `#nr-save-now` ·
`#nr-save-toggle` · `#nr-undo` · `#nr-redo` · `#nr-hist-state` · `#nr-restore` ·
`#nr-restore__what` · `#nr-restore-yes` · `#nr-restore-no` · `#nr-clean-timing` ·
`#nr-ex-handover`

**Events:** `nr:autosave:status`, `nr:autosave:saved`, `nr:autosave:error`,
`nr:unsaved:found`, `nr:history:changed`, `nr:action:recorded`,
`nr:stream:cleaning`, `nr:stream:progress`, `nr:cleanup:timing`.

Waiting on `nr:stream:progress` is how you observe cleanup running *during* a
recording rather than after it.
