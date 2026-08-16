# Narrated Review — Human Guide

Turn a narrated walk through your screen into a document an AI assistant can read directly. **No video is recorded.** You talk, you press a key at each moment that matters, and out comes an ordered markdown document of screenshot + words pairs.

## The idea

The keypress does three jobs at once:

| Job | What it gives |
|---|---|
| Marks a screenshot | The frame worth keeping, chosen by you |
| Bounds an audio segment | Short clips transcribe fast, in parallel |
| **Creates the alignment** | **This image, and these words about it** |

Audio is captured **continuously** — the keypress is a marker, not a start/stop switch, so the sentence you began *before* pressing is never lost (the boundary snaps back to the nearest pause).

## Setup

1. Open `/en-gb/narrated-review/`. Best used as a **narrow window parked beside the thing you're reviewing** — the whole Capture panel is the MARK button, so any key or click in this window marks a moment.
2. Paste your OpenRouter key once (shared with the other media tools). Capture works without a key; transcription and cleanup need it.
3. Privacy: in **grounded** cleanup mode each pair's screenshot is sent to your model to fix words that are written on screen. Switch to **text-only** or **off** in the Capture panel if your screen shows things that must not leave the browser.

## A session

1. **Share screen & start** — pick the window/screen to review; mic goes live.
2. **Narrate.** Each time the thing on screen matters, **press any key** (in this window) or click the MARK area. Keep talking — segments transcribe in the background while you go.
3. **Finish.** The continuous take is saved; remaining transcription runs, then cleanup (screenshot + rolling summary → corrected text; uncertain spans are flagged `[unsure]`, never silently resolved).
4. **Review (optional).** Pairs tab → click a pair → fix a boundary (ms nudge), edit clean text, re-transcribe or re-clean. Raw text is never overwritten.
5. **Document** → Build → preview `review.md`. **Export** → download the session zip (review.md + images/ + audio/ + raw/ + session.json) or share via SG/Send encrypted link, or copy the markdown.

**The bar this tool is measured against:** press send with no cleanup afterwards. If a session needs editing before it can be shared, that's a bug worth reporting.

## Tips

- The tool window must have **focus** for keys to register — that's a browser limit, and why the narrow side-window layout matters. A click on the MARK area works too.
- Faint "suggestion" moments are logged at long pauses you didn't mark (they carry no screenshot — only your press picks a frame).
- Sessions live in memory: **export before closing the tab**. Practical ceiling ≈ sub-hour sessions (~2 MB/min of audio state).
- A spend cap (`setSpendCap`) halts both transcription and cleanup lanes once known cost reaches it.

## Browser support

| Browser | Notes |
|---|---|
| Chrome/Edge | Full support |
| Firefox | Works; screen picker UI differs |
| Safari | Screen capture support varies by version; audio path uses the same never-fail WAV encode as audio-transcribe |
