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

## Three ways in, one review

A capture is a screenshot, the words about it, and the alignment between them.
There are three ways to make one, and **only the first step differs** — after
that it is the same list, the same editing, the same document:

| | How the captures appear |
|---|---|
| **Live** | Share a screen, talk, press a key at each moment |
| **Video** | Drop a recording — its pauses do the pressing (see below) |
| **Authored** | Add one by hand: a picture, some words, a note |

## Setup

1. Open `/en-gb/narrated-review/`. Best used as a **narrow window parked beside the thing you're reviewing** — the whole Capture panel is the MARK button, so any key or click in this window marks a moment.
2. Paste your OpenRouter key once (shared with the other media tools). Capture works without a key; transcription and cleanup need it.
3. Privacy: in **grounded** cleanup mode each pair's screenshot is sent to your model to fix words that are written on screen. Switch to **text-only** or **off** in the Capture panel if your screen shows things that must not leave the browser.

## A session

1. **Share screen & start** — pick the window/screen to review; mic goes live.
2. **Narrate.** Capture 1 already holds the screen as you shared it. Talk about
   what is on screen, and **press any key** (or click NEXT) when you move to the
   next thing — the press closes the current capture and opens one for the new
   screen. Keep talking; segments transcribe in the background while you go.
3. **Finish.** The continuous take is saved; remaining transcription runs, then cleanup (screenshot + rolling summary → corrected text; uncertain spans are flagged `[unsure]`, never silently resolved).
4. **Review (optional).** Pairs tab → click a pair → fix a boundary (ms nudge), edit clean text, re-transcribe or re-clean. Raw text is never overwritten.
5. **Document** → Build → preview `review.md`. **Export** → download the session zip (review.md + images/ + audio/ + raw/ + session.json) or share via SG/Send encrypted link, or copy the markdown.

**The bar this tool is measured against:** press send with no cleanup afterwards. If a session needs editing before it can be shared, that's a bug worth reporting.

## Importing a video instead

Already have the recording? Drop it on **…or drop a video recording here** in the
Capture panel (or click to browse). No screen share, no key presses:

1. The audio comes out of the video (free in the browser for ordinary `.mp4` /
   `.webm`; other containers fall back to FFmpeg, which is a slow multi-megabyte
   load the first time).
2. The audio is **cut at its own silences** — the pauses become the boundaries,
   the same job your keypresses do live.
3. For each spoken stretch the tool looks for the frame it is *about*. In a
   screencast **the picture leads the words**: you switch, pause half a beat,
   then start talking. So it searches a window that starts 2.5 s before the words
   and ends 1.2 s after them, finds the last time the screen changed, and takes
   the first frame that has settled.
4. Two stretches that landed on the same picture become **one capture** — a
   breath mid-explanation is not a new topic.

Then it is an ordinary review: edit, reorder, add notes, chat, export.

**If the panel turns amber after an import, read it.** It means the recording had
no pauses the segmenter could find, so the captures were cut at a fixed length
instead — arbitrary boundaries that will chop sentences in half. That happened on
the first real screencast (nine captures of exactly 30 seconds each). The
thresholds are now derived from each recording's own loudness, but a video with
constant background music or a very quiet speaker can still defeat it.

**The frame pick is a first draft, not a verdict.** Open a capture and the strip
under the screenshot shows every frame that was considered — click any of them to
swap. A fade, a scrolling page or a build-in animation can all fool the heuristic,
and the thresholds have not yet been tuned against a real screencast.

## What every call cost

Export → **Billing** → *Fetch receipts*. Every request this session made is
listed with its OpenRouter generation id, and the receipts are fetched from
OpenRouter itself: what was actually charged, by which provider, for how many
tokens, attributed to the capture that caused it. Two numbers are shown per call
— what the response claimed and what was charged — because they differ.

The ids are captured whether or not the lookup works, and they ship in
`billing.json` with the zip and the vault, so the spend stays auditable from the
export alone months later.

## Handing the output to an AI assistant

Both the zip and the vault folder open with a `README.md` that tells an assistant
where to look, and `session.json` carries a `moments[]` array joining each
capture's picture, words, audio and raw transcript. An assistant reading the
bundle should use that rather than parsing `review.md` — an agent given an earlier
export had to reconstruct the image↔words pairing from the document headings,
which was our fault, not its.

## Saving and coming back later

Export → **Saved sessions** → *Save session*. Sessions live in this browser
(IndexedDB) and survive a reload or closing the tab, so you can stop, come back
and carry on — which matters because reordering, notes and edits are not in the
transcript and cannot be re-derived. *open* restores one. **Keep audio** is
optional: without it a restored session is fully editable as a document, but
re-transcribing a capture needs the original take.

## Editing the review

- **Extra comments.** Each capture has a **notes** box, separate from the transcript.
  The transcript is what you said; notes are what you want to add now. They appear
  as quoted notes in the document, so nobody mistakes one for the other.
- **Reorder.** ↑ ↓ on any row in Captures, or in a capture's own panel. Numbering follows.
- **Open a capture in its own panel.** ⧉ on a row (or double-click it). Panels can be
  dragged and docked side by side, so several captures can be open at once, each with
  its own chat — while the Captures list stays where it is.
- **Add a capture anywhere.** "+ Add capture", or "+" on a row to insert straight
  after it. A capture is only ever an image, some words, or both — so an added one
  needs no audio.

## Chat about the review

The Chat tab has two scopes:
- **This capture** — the model gets that screenshot, the raw transcript, the
  cleaned text and your notes. Good for "what is this showing?" or "is this a bug?".
- **Whole review (can edit)** — the model can also *change* things: attach notes,
  correct the analysis, reorder, insert a capture. It tells you what it changed.
  It cannot touch raw transcripts.

## Saving to a vault

Export → **Save to a vault**: vault id + write passphrase (or a Simple Token).
Writes the document, images, raw transcripts, notes and session.json.
**Include raw audio** is off by default — tick it if you may want to re-transcribe
with a better model later, re-cut a boundary, or build something else (a video,
for instance) out of the same materials. It is much the largest part.

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

---

## Your work is saved as you go (v0.1.6)

**Autosave is on by default.** The chip under the cleanup selector always says
where you stand: `✓ Autosave on · saved just now`, or `unsaved changes`, or —
loudly, in red — `Autosave OFF` or `⚠ Autosave failed`. There is no silent
state, because silent autosave and broken autosave look exactly the same from
the outside, and the person who finds out is always the one who has just
finished something long.

It writes into the session you loaded, or mints a new one on the first save.
**Save now** forces a write; the toggle turns it off if you would rather.

**If you reload by accident, you get it back.** The tab now asks before
unloading whenever there are unsaved changes or a recording is live, and if the
page does go away, the next visit shows a banner — *"An unfinished session was
found — 8 captures, ~1,400 words, from 2 minutes ago"* — with **Restore it** and
**Discard**.

**One honest gap: the audio take is not written until recording stops.** It
grows for the whole session and would have to be re-encoded on every pass, so a
crash *during* a recording keeps your captures, screenshots and transcripts and
loses the audio. Everything after Finish is fully covered.

## Undo and redo

**↶ Undo / ↷ Redo** in the capture panel, or ⌘/Ctrl-Z and ⌘/Ctrl-⇧-Z — but only
outside a live recording, where every keystroke is a capture mark and stealing
⌘Z from that would be worse than having no shortcut.

Reorders, notes, text edits, inserts, removals and boundary changes are all
undoable. **The action log is separate and is never rewound**: undoing an edit
appends an "undo" entry rather than erasing the edit, because what you *did* to
a document and what it *says* now are different questions. That log ships as
`actions.json`.

## Cleanup now runs while you record

The **Clean** selector chooses when:

| Setting | What happens |
|---|---|
| **while recording** (default) | Each capture is cleaned as its transcript lands. **Identical output** — cleanup only ever looks backwards — so by the time you press Finish, most of it is already done. |
| after I press Finish | The old behaviour. Same result, all at the end. |
| all at once | Fastest, and **a real quality change**: each capture is corrected without knowing what came before it, so a term established early will not inform a later capture. |

The wait after Finish used to be one model call per capture, in series. It is
now usually one or two calls total.

## The agent handover zip

**🤖 Agent handover zip** in Export. Same content, minus the audio and the PDF —
an agent reads neither, and they are most of the bytes. It adds two files:

- **`uncertain.json`** — every span the cleanup model flagged, gathered into one
  list with the sentence around it and the unedited transcript to compare
  against. This turned out to be the most-used part of the export, so it is now
  in the full zip as well, not just this one.
- **`actions.json`** — what was done to the document, in order.
