# Video Publisher — Human Guide

**URL:** `/en-gb/video-publisher/` · **Version:** 0.1.0 (alpha)

One page from recording to YouTube URL. The tool consolidates the old
four-tool workflow (video-recorder → video-tools → audio-transcribe →
youtube-editor) — the video never leaves the page between steps.

## The 5-interaction walkthrough

1. **Record** — pick the layout with the big buttons (🖥 Landscape /
   📱 Vertical Shorts / 📊 Infographic — the active one is highlighted and
   locked once recording starts), then click *● Start recording*
   (defaults: screen + camera PiP + mic, 2.5 Mbps). Pick the screen/tab to
   share. Talk.
2. **Stop** — click *■ Stop*. The recording opens in the *Preview* tab so
   you can watch it back, while the pipeline runs on its own: audio is taken
   from the separate audio stream (free), transcribed via OpenRouter, and a
   title/description/tags are generated. Watch the Steps panel.
3. **Review** — tweak the title/description in the *Metadata* tab if needed
   (or click *↺ Regenerate* with guidance like "shorter, more emojis").
   Descriptions are written by **Claude Sonnet 4.6** by default — the model
   picker next to Generate offers cheaper/faster options.
   Privacy defaults to *Unlisted*; if you always publish public, pick
   *Public* and tick **Remember this privacy as my default** — the choice is
   saved in this browser and pre-selected from then on.
4. **Upload** — in the *Publish* tab, click *⬆ Upload to YouTube*
   (sign in with Google the first time).
5. **Copy** the YouTube URL. Done. The Publish tab also has a big
   **⬇ Download video** button — grab the file to post it elsewhere too
   (e.g. LinkedIn).

Alternative entries: drag-drop an existing MP4/WebM into the *Import* tab,
or click **🚀 Publish** on a recording in the standalone Video Recorder.

## Two-click publish (auto-publish mode)

Tick **🚀 Auto-publish after recording** in the Record tab and the whole
workflow becomes *Start → Stop*: after the pipeline finishes, the upload
starts on its own — using your remembered privacy default — after a
**5-second countdown** during which the big **✖ Cancel** button stops
everything. The setting is remembered in this browser.

Requirements and safety rails:
- You must have signed in to YouTube **once** before (the auto flow uses the
  silent token path — no popups without a click). If sign-in is needed, the
  run pauses at the Publish step instead of uploading.
- The countdown message shows exactly what will happen ("Auto-publishing
  (public) in 5s"), and Cancel works at any stage: while recording (discards
  the recording), during transcription, during the countdown, or mid-upload
  (aborts the transfer — the video and transcript are kept, nothing is
  published).

## Accounts (one panel, nothing re-entered)

| Credential | Where it lives | Shared with |
|---|---|---|
| OpenRouter API key | `localStorage['sg-openrouter-mgmt-key']` | Audio Transcribe |
| Google OAuth client ID | `localStorage['sg-youtube-client-id']` (default bundled) | YouTube Editor |

If you've used those tools before, both are already set.

## Costs

Transcription and metadata generation are billable OpenRouter calls
(default model Gemini 3.5 Flash — a 5-minute video is typically well under
$0.10 total). Costs show per step and roll up in `getCostSummary`.
No key set? The pipeline stops after audio extraction; you can still fill
metadata by hand and upload.

## Caveats

- **Nothing uploads automatically.** Auto-run always stops at
  ready-to-publish; the Upload click (or `publish({confirm:true})`) is the
  only path to YouTube.
- Google access tokens last ~1 h; the tool silently refreshes at T-5 min
  and before every upload, so you'll normally sign in once per browser
  session. Safari's tracking prevention may force the popup more often.
- Extracted audio over 25 MB (roughly > 1.5 h of speech) is rejected —
  segmented transcription is not in v0.1.
- Imported files may trigger a one-off ~30 MB FFmpeg WASM download (CDN);
  fresh recordings skip FFmpeg entirely.
- Handoffs from Video Recorder need popups allowed for tools.sgraph.ai.
