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
   that tab**, tick the feeds you want (they all start **off**), press **Start
   recording this tab**, and **Open side panel** to watch it
4. Either export a bundle from the side panel, or — to pair it with narration —
   press **Attach recorded tab** in narrated-review

Step 3 has to happen on the target tab, by you. The extension asks for
`activeTab`, which the browser grants only in response to a click on the icon —
so a web page can never start recording another page, including ours.

## Testing it

`qa/index.html` is a target page built to make every rule above visible: a moving
click target, a password field, a `[data-sg-no-capture]` region, console and
network buttons including one with `?token=SECRET`, and a probe fixture.
`qa/QA.md` is the script to work through, with the expected result for each step
and two `grep` checks that prove the redaction actually held. Served locally at
`http://localhost:10063/extension/sg-page-recorder/v0.1.0/qa/`.


## Everything is off until you turn it on

**Every feed starts disabled**, including mouse. Arm a tab with nothing ticked and
the correct result is that nothing is recorded — that is the first thing the QA
script checks. A recorder that records because nobody changed a setting will one
day capture something it should not have.

## The side panel is where you watch it

A popup closes the moment you click into the page, which is always the moment
worth seeing. **Open side panel** (from the popup) gives you a panel that stays
put beside the page: live counts per feed, a rolling feed of clicks, console
errors and failed requests as they happen, a box to run probes, and the export.

## It also works on its own

The extension was built to feed narrated-review, but everything needed for a
useful artefact is already here. Press **📸 Screenshot** when something looks
wrong, then **⬇ Export bundle**, and you get a zip:

```
report.md      leads with what BROKE, then the actions by name
session.json   summary + events, with the privacy rules stated in the schema
events.json    the raw stream, for replay
images/        the screenshots you took
```

No tool, no account, no upload. Point it at a broken page, do the broken thing,
export, hand it over. The zip *is* the bug report.

(The zip is built by `zip-store.js`, eighty lines of the ZIP format written out
longhand, because the extension has no bundler and no network access to fetch a
library — and staying a folder of plain files anyone can read end to end is worth
more than compression on already-compressed PNGs.)

## What it can see, and what it refuses to

| Feed | Recorded | Never recorded |
|---|---|---|
| Mouse | position (30 Hz), clicks, the element hit, scroll | *off by default* |
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

- Chromium only (MV3, `chrome.scripting`, `chrome.sidePanel`).
- The main frame only; iframes are not instrumented.
- Times are wall-clock (`Date.now()`), aligned to the session start. Good to tens
  of milliseconds — fine for a mouse path, not for lip-sync.
- The buffer caps at 200,000 events and drops **oldest** first, reporting
  `dropped`. A recorder that dies of its own success mid-session is worse than
  one that admits it lost the first few minutes.
- The tool cannot arm a tab for you, by design. You click.

## A copy lives in an encrypted vault

The whole extension is also published as an SG/Send vault — a versioned,
client-side-encrypted folder the server can never read. It is a neat fit for
shipping an unsigned extension: the recipient needs one key, gets the exact
bytes, and can pull later versions with `sgit pull`.

```bash
pip3 install sgit-ai --break-system-packages
sgit remote add origin https://dev.send.sgraph.ai
sgit --token <access-token> clone <vault-key> sg-page-recorder
# then: chrome://extensions → Load unpacked → sg-page-recorder/
```

Ask Dinis for the vault key — it is deliberately not in this repository, because
a key committed to git is a key that has left the vault.
