# SG Page Recorder

A companion to [narrated-review](https://tools.sgraph.ai/en-gb/narrated-review/).
It records **what you did** on a page you are narrating — mouse path, clicks,
keystrokes, console output, network calls — and hands it to narrated-review, so
the session carries the actions alongside the screenshots and the words.

## Why it has to be an extension

A screen-capture stream is **pixels and audio and nothing else**. That is not a
gap in our implementation; it is the security boundary, and it is measured, not
assumed. In current Chrome the only constrainable display properties are
`displaySurface` and `restrictOwnAudio`, and `CaptureController` — the newest
surface-control API — offers `forwardWheel`, `setFocusBehavior` and zoom. Every
one of those points *outward*, into the captured tab. There is no inbound
channel, deliberately: sharing your bank tab in a call must not let the other
side read your keyboard.

So mouse, keys, console and network cannot come from the capture stream at any
quality setting. An extension with its own permission grant is the only honest
way to get them.

## Install (unpacked, while it is unsigned)

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → choose this folder
3. Open the page you want to narrate, click the **SG Page Recorder** icon **on
   that tab**, choose what to record, press **Start recording this tab**
4. In narrated-review, press **Attach recorded tab**

Step 3 has to happen on the target tab, by you. The extension asks for
`activeTab`, which the browser grants only in response to a click on the icon —
so a web page can never start recording another page, including ours.

## What it can see, and what it refuses to

| Feed | Recorded | Never recorded |
|---|---|---|
| Mouse | position (30 Hz), clicks, the element hit, scroll | — |
| Keyboard | *off by default.* Which key, modifiers, the field | **Password and payment fields — nothing, in any mode** |
| Console | `log/info/warn/error/debug`, uncaught errors, rejections | arguments are truncated, not deep-copied |
| Network | method, URL path, status, duration, size | **headers and bodies, at any setting**; query strings unless you opt in |
| Probes | JavaScript you write, and its result | — |

**Keyboard has three modes.** Off is the default. `keys` records *which* key but
replaces printable characters with `·` — you can see shortcuts, navigation,
rhythm and hesitation, which is what a UX question is actually about, without the
recording containing what was typed. `text` records the literal characters and
must be chosen deliberately.

Two rules hold in every mode:

- **A password field gives up nothing.** Not the characters, not the length —
  only that typing happened. Same for fields marked `autocomplete="cc-*"` or
  `one-time-code`, and for anything inside `[data-sg-no-capture]`, which any page
  can use to opt out.
- **A shortcut is not typed content.** `Ctrl-S` is recorded literally even in
  `keys` mode: masking it protects nothing (nobody types a password with Ctrl
  held) and destroys the most useful signal there is.

Every refusal is **counted** and reported as `redacted`, so a reader can tell "they
typed nothing here" from "we refused to record what they typed". An absent event
and a withheld one must never look the same.

## Network is metadata only

No headers, no bodies, ever — that is where session tokens, cookies and personal
data live, and a recording that quietly contains a bearer token is a liability,
not a feature. Query strings are stripped by default (`https://x/api/thing?…`)
because ids and tokens hide there too.

## Scripted probes

Run your own JavaScript in the page on a trigger, and the result lands on the
timeline beside the words:

```js
// in narrated-review, or from window.__tool
await __tool.runPageProbe({ js: 'document.querySelectorAll("[role=row]").length', on: 'click' });
await __tool.runPageProbe({ js: 'JSON.stringify(window.__APP_STATE__?.user ?? null)' });
```

Triggers: `manual`, `start`, `stop`, `click`, `keydown`, `scroll`, `interval`.
This captures what a screenshot cannot — a computed value, a store's state, the
length of a list after a filter. It is arbitrary code execution in the page,
authored by you: every probe and every result is logged, so a reader can always
see exactly what was run.

## Where the data goes

Page → extension → narrated-review, in your browser. **This extension contains no
network code at all** — that is the cheapest way to be able to say the data goes
nowhere else and mean it. Once narrated-review drains a batch, the extension
drops its copy: one place for the data is one place for it to leak from.

## Limits

- Chromium only (MV3, `chrome.scripting`).
- The main frame only; iframes are not instrumented.
- Times are wall-clock (`Date.now()`), aligned to the session start. Good to tens
  of milliseconds — fine for a mouse path, not for lip-sync.
- The buffer caps at 200,000 events and drops **oldest** first, reporting
  `dropped`. A recorder that dies of its own success mid-session is worse than
  one that admits it lost the first few minutes.
- The tool cannot arm a tab for you, by design. You click.
