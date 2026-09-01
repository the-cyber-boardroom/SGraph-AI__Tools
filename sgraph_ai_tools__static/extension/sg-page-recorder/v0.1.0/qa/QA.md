# SG Page Recorder — QA script

Two parts: what a machine already checks, and what only a person can.

The automated suite is `tests/playwright/sg-page-recorder-smoke.js` (27
assertions). It loads the two recorder scripts into a real page with a stubbed
`chrome.runtime` and drives real mouse, keyboard, console, `fetch` and XHR at
them. **It cannot cover the arming handshake**: `activeTab` is granted only in
response to a real click on the extension icon, and Playwright cannot synthesise
that. Everything below the automated line is manual for that reason.

```bash
bash scripts/run-locally.sh
node tests/playwright/sg-page-recorder-smoke.js      # expect 27 passed
```

## Setup

1. `chrome://extensions` → Developer mode → **Load unpacked** →
   `sgraph_ai_tools__static/extension/sg-page-recorder/v0.1.0/`
2. Open the QA target: `http://localhost:10063/extension/sg-page-recorder/v0.1.0/qa/`
   (or open `qa/index.html` from disk)
3. Click the extension icon **on that tab** → **Open side panel**
4. Tick the feeds for the case you are testing → **Start recording this tab**

> Everything is **off by default**. If you tick nothing and press start, the
> correct result is that nothing is recorded. Check that first — it is the
> cheapest way to catch a feed that ignores its own switch.

## M1 · Nothing is on until you say so

| Step | Expect |
|---|---|
| Arm with **no boxes ticked**, move the mouse, type, click | All counters stay **0** |
| Tick *mouse* only, re-arm, then type | `move`/`click` climb, `key` stays 0 |

**Fails if** any counter moves for a feed you did not tick.

## M2 · Mouse

Move slowly across the dashed box, then click the moving button.

- `move` climbs at roughly **30/second**, not 60 — it is throttled on purpose.
- Exactly one `click`, and the feed shows **`click me last`** — the button's
  *text*, not `click 812,140`. A replay that cannot say what was clicked is
  nearly useless.

## M3 · Keyboard — the block that matters most

Set keyboard to **which keys (characters hidden)**.

| Do | Expect |
|---|---|
| Type `hello` in *Ordinary text* | Five `·` entries. **`hello` must not appear anywhere** |
| Press **Ctrl-S** | `ctrl+s`, recorded **literally** |
| Type `hunter2` in *Password* | **Nothing.** Redaction counter +7 |
| Type in *Card number* (`autocomplete="cc-number"`) | Nothing; counter rises |
| Type in the `[data-sg-no-capture]` box | Nothing; counter rises |

Now switch to **literal text** and repeat.

- `hello` **does** appear. That is the point of the mode.
- `hunter2` **still does not.** Password and payment fields are refused in every
  mode, with no setting that changes it.

**The subtle one:** Ctrl-S must survive masking. A modifier makes a keystroke a
*shortcut*, not typed content — nobody types a password with Ctrl held — and the
shortcut is exactly what a UX question is about. An earlier build masked it to
`·`; the smoke test now guards against that.

**Verify by search, not by eye.** Export the bundle and grep it:

```bash
unzip -p sg-page-recording-*.zip events.json | grep -c hunter2   # must be 0
```

## M4 · Console

Press each button. Expect the level to match, errors in red, the uncaught throw
and the unhandled rejection both captured.

**The huge-object button is the real test.** It logs 5,000 keys plus a DOM node.
Expect a **truncated** value and a page that still responds. A recorder that
deep-copies console arguments takes the tab down with it.

## M5 · Network

| Button | Expect |
|---|---|
| fetch 200 / XHR | method, status `200`, a duration |
| fetch 404 | status `404`, marked failed (red) |
| **fetch with `?token=SECRET`** | URL shown as `…?…` — **`SECRET` must not appear** |
| load an image | captured via `resource`, with a size |

```bash
unzip -p sg-page-recording-*.zip events.json | grep -c SECRET    # must be 0
```

No entry may carry `headers` or `body` at any setting. That is where session
tokens live, and a recording containing one is a liability, not a feature.

## M6 · Probes

In the side panel, enter `document.getElementById('rows').textContent`:

- **Run once** → the current value appears as a `probe` event.
- **Run on every click** → add rows and click; the value is recorded each time,
  changing as you go.
- Enter `window.__nope.boom` and run → an **error** is recorded and recording
  **continues**. A probe must never be able to take the recorder down.

Check `actions.json` in narrated-review (or `events.json` standalone): every
probe *and* its result is logged, so a reader can always see what was run.

## M7 · Volume and stopping

- **Fire 500 console lines** — counts rise, the feed stays responsive, and it
  keeps only the last few hundred lines on screen (it is a monitor, not a store).
- Press **Stop** in the popup. Counts must **freeze**. Move the mouse and type:
  still frozen. A recorder that keeps going after stop is the worst bug this
  thing could have.

## M8 · The bundle

Take a 📸 screenshot, then **Export bundle**. Expect a zip with:

```
report.md  session.json  events.json  images/shot-01.png
```

- `report.md` leads with **What went wrong** (console errors, failed requests),
  then the actions **by name**.
- `session.json` carries `schema.privacy` stating the redaction rules, and
  `summary` with the counts.
- Open the PNG. It should be the page as it looked.

## M9 · With narrated-review

1. Start a narrated-review session in another tab
2. Press **Attach recorded tab**
3. Narrate a few captures while working in the recorded page
4. Finish, then export

Expect `input.json` in both zips, with `moments[]` slicing the events into the
capture whose bounds contain them, and `outsideSession` counting anything from
before the recording began.

**Check the clock claim:** click something exactly as you press the capture key.
The click should land in that capture. Times are wall-clock, so tens of
milliseconds of drift are expected and fine — this is not lip-sync.

## What to report

If something fails, the bundle *is* the bug report — it already contains the
console errors, the failed requests and the actions in order. Attach the zip and
say which step above you were on.
