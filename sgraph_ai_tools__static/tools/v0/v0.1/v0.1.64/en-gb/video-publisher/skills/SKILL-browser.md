# Video Publisher — Browser / Playwright Guide

Stable selectors and wait strategies for driving the tool through the DOM.
Prefer the JS API (`SKILL-api.md`) for headless automation — the DOM route
exists for UI testing.

## Readiness

Wait for `tool:ready` on `window`, then `window.__tool` is live:

```js
await page.waitForFunction(() => !!window.__tool);
```

Panels are sg-layout tabs; all content is in light DOM.

## Stable ids

| Area | Selector | Notes |
|---|---|---|
| Record | `#vp-rec-name` `#vp-rec-start` `#vp-rec-pause` `#vp-rec-stop` | Start requires a user gesture (getDisplayMedia) |
| Record status | `#vp-rec-status` | `REC m:ss · x.x MB` while live |
| Record advanced | `#vp-rec-mode` `#vp-rec-quality` `#vp-rec-layout` | inside `<details>` |
| Import | `#vp-drop` (`<sg-upload-dropzone>`) | dispatch `files-selected` or use its hidden input |
| Import info | `#vp-src-info` `#vp-src-notice` `#vp-src-player` | |
| Steps | `sg-pipeline-steps .sgps-step[data-step="audio|transcript|metadata|publish"]` | shadow DOM (Playwright CSS pierces open roots); `data-status` attr = idle/running/done/error |
| Step re-run | `sg-pipeline-steps .sgps-step [data-rerun]` | visible on done/error (not on publish) |
| Transcript | `#vp-tr-model` `#vp-tr-run` `#vp-tr-text` | |
| Metadata | `#vp-md-generate` `#vp-md-guidance` `#vp-md-regen` `#vp-md-title` `#vp-md-desc` `#vp-md-tags` `#vp-md-privacy` | |
| Publish | `#vp-pub-connect` `#vp-pub-upload` `#vp-pub-progress` `#vp-pub-link` `#vp-pub-copy` | connect opens a Google popup |
| Accounts | `#vp-acc-or-key` `#vp-acc-or-save` `#vp-acc-yt-cid` `#vp-acc-yt-save` | chips: `#vp-acc-or-chip` `#vp-acc-yt-chip` (`.vp-chip--on` when set) |
| Dev pane | `.vp-footer-bar__inner` toggles Explorer/Console/Manifest/Skills | |

## Waits by event (preferred over polling the DOM)

```js
await page.evaluate(() => new Promise(r =>
    addEventListener('vp:metadata:complete', r, { once: true })));
```

Key events: `vp:job:loaded`, `vp:audio:complete` ({route}),
`vp:transcribe:complete`, `vp:metadata:complete`, `vp:upload:complete`
({url}), `vp:step:error`. The recorder engine's `tool:record:*` events also
fire during in-tool recording.

## Recording headlessly

Chromium flags `--use-fake-ui-for-media-capture
--use-fake-device-for-media-capture --auto-select-desktop-capture-source=Entire`
let `startRecording` run without prompts. Simpler: skip capture and inject a
file through the API — `__tool.importFile({ file })` — the rest of the
pipeline is identical.
