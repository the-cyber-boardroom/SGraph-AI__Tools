# WhatsApp Desk — Browser / Playwright Guide

Wait for readiness, then drive via DOM or (preferred) the JS API:

```js
await page.waitForFunction(() => !!window.__tool);
await page.evaluate(() => window.__tool.loadDemo());   // credential-free surface
```

Playwright's CSS engine pierces the components' open shadow roots.

## Stable selectors

| Area | Selector | Notes |
|---|---|---|
| Start tab | `#wa-demo-btn` | loads demo conversations |
| Conversations | `sg-conversation-list .sgcl-row[data-cid="<number>"]` | click → opens chat tab; chip `.sgcl-chip--ok/--warn` = window state |
| Sync | `#wa-sync` `#wa-sync-status` | manual relay pull |
| Chat tab head | `#wa-chat-window` (`.wa-chip--on` = window open) `#wa-chat-draft` `#wa-chat-guidance` `#wa-chat-status` | per-conversation |
| Thread | `sg-chat-thread .sgct-row[data-mid]` | `data-type`; voice notes have `[data-transcribe]` button; `.sgct-transcript` appears after transcription |
| Composer | `sg-chat-composer .sgcc-text` `.sgcc-send` `.sgcc-template` `.sgcc-reason` | `mode` attribute on the element: `free` / `template-only` |
| Accounts | `#wa-acc-token` `#wa-acc-phone` `#wa-acc-waba` `#wa-acc-save` `#wa-acc-connect` `#wa-acc-relay-url` `#wa-acc-relay-token` `#wa-acc-relay-save` `#wa-acc-or-key` `#wa-acc-or-save` | chips: `#wa-acc-meta-chip` `#wa-acc-relay-chip` `#wa-acc-or-chip` |
| Dev pane | `.wa-footer-bar__inner` | Explorer / Console / Manifest / Skills |

## Waits by event

`wa:sync { newMessages }` · `wa:message:in` · `wa:message:out` ·
`wa:transcript:complete` · `wa:draft:ready` · `wa:window:changed` — e.g.

```js
await page.evaluate(() => new Promise(r =>
    addEventListener('wa:transcript:complete', r, { once: true })));
```

## Demo-mode notes

`loadDemo()` marks `getStatus().demo === true`; `sendText`/`sendTemplate`
record locally and never touch the network — safe for CI. Transcribing the
demo voice note is a REAL OpenRouter call (synthetic tone → expect a
trivial/empty transcript; it proves the pipeline, not the content).
