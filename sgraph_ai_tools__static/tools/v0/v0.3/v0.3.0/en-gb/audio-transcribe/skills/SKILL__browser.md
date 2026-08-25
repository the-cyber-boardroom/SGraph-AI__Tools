# Audio Transcribe — Browser / DOM Guide

How to drive the tool from the DOM (Playwright, console scripting). Prefer the
JS API (`window.__tool`, see `SKILL__api.md`) for headless batch driving; this
file documents the DOM surface for clicking and asserting.

## Page bootstrap

- Root element: `<main id="audio-transcribe-root">` (also the LLM event bus — has `data-llm-bus`).
- The tool is ready when `window.__tool` exists and the `tool:ready` window event has fired.

## Selectors

| Purpose | Selector |
|---|---|
| Source dropzone | `#at-drop` |
| File input (multiple) | `#at-file` (`accept` includes `.opus`) |
| Record / Stop button | `#at-rec-btn` |
| Record timer | `#at-rec-timer` |
| Model select | `#at-model-select` |
| OpenRouter key field | `#at-key` (type=password) |
| Connect button | `#at-connect` |
| "Transcribe all" button | `#at-transcribe-all` |
| Overall progress bar | `#at-progress-bar` |
| Queue rows container | `#at-rows` |
| One queue row | `.at-row[data-id="<id>"]` |
| Per-row status chip | `.at-row .at-chip` (classes `at-chip--queued|transcribing|done|error`) |
| Per-row transcript | `.at-row__transcript` (`#tx-<id>` when done) |
| Per-row buttons | `button[data-act="copy|dl|retry|remove"][data-id="<id>"]` |
| Include checkboxes | `#at-inc-transcripts`, `#at-inc-audio` |
| Download .zip | `#at-download-zip` |
| Send toggle | `#at-send-toggle` |
| Embedded send component | `sg-send-drop#at-send-drop` |
| Share URL output | `#at-share a` |

## Injecting files (Playwright)

```js
await page.setInputFiles('#at-file', [
  'fixtures/note1.opus',
  'fixtures/clip.mp3',
  'fixtures/memo.wav',
]); // → adds three queue rows via api.addFiles
```

To drop files instead, dispatch a `drop` event on `#at-drop` with a `DataTransfer`
carrying the files.

## Driving a batch headless from the DOM

1. `#at-model-select` → choose a model; type the key into `#at-key`; click `#at-connect`.
2. `setInputFiles('#at-file', [...])` to enqueue.
3. Click `#at-transcribe-all`.
4. Wait for every `.at-row .at-chip` to read `done` (class `at-chip--done`), or watch the `at:batch:complete` window event.
5. Tick `#at-inc-transcripts` (and optionally `#at-inc-audio`), click `#at-download-zip`.

## Status classes to observe per row

- `at-chip--queued` → not yet started
- `at-chip--transcribing` → in flight
- `at-chip--done` → transcript present in `.at-row__transcript`
- `at-chip--error` → `.at-row__transcript` shows the error; a Retry button is present
