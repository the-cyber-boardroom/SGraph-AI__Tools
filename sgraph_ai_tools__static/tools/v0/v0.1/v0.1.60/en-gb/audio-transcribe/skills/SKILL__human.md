# Audio Transcribe — Human Guide

Transcribe audio to text with OpenRouter models, entirely in your browser.

## What it does

- **Record** from your microphone (one continuous take), **or**
- **Drag/drop or multi-select many audio files at once** — including **WhatsApp `.opus` voice notes** (the headline use case).
- Each file becomes a **queue row** you can transcribe, retry, copy, and download.
- Bundle the session's **audio and/or transcripts** into a single **`.zip`**, or **send an encrypted share via SG/Send**.

## WhatsApp `.opus` voice notes — fully supported, every browser

`.opus` is the **#1 use case** and works on **every browser including Safari/iOS**. There is **no app to install and no pre-conversion** needed: the tool decodes Opus **in your browser** using a small WebAssembly Opus decoder, converts it to WAV, and sends that for transcription. The decoder downloads **once** (cached for later sessions). Just drop the `.opus` file in.

## How to use

1. **Connect a model.** In *Model & OpenRouter key*, pick a model and paste your **OpenRouter API key** (`sk-or-…`), then **Connect**. The key is stored **only in this browser** (`localStorage`) so you do not retype it.
2. **Add audio.** Record, or drop/select files. Everything accumulates in the **Queue**.
3. **Transcribe.** Click **Transcribe all** (or per-row Transcribe/Retry). Each row shows a status chip: `queued → transcribing → done → error`. Batch runs sequentially with a small concurrency cap (2).
4. **Use the text.** Per row: **Copy** or **Download .txt**.
5. **Bundle / Send** (appears once something is done). Tick **Transcripts** and/or **Audio**, then **Download .zip** (includes a `manifest.json` + `index.txt`), or **Send via SG/Send** for an encrypted share.

## Models

Default: **Gemini 2.5 Flash** (fast, cheap, audio-in chat model). Also: GPT-4o Audio, GPT-4o Mini Audio. Two dedicated speech-to-text models (Whisper Large v3, GPT-4o Transcribe) are listed as **"coming soon"** and are gated until a future dedicated-STT path ships — do not rely on them yet. Pricing shown is **approximate** and drifts.

## Privacy

Audio is **sent to OpenRouter** for transcription (this is **not** a local-only tool — unlike `voice-memo`, which transcribes locally with Whisper). Decoding of `.opus`/webm happens **in your browser**; only the (possibly re-encoded WAV) audio and your prompt go to OpenRouter. The decoder WASM is fetched from a CDN but **no audio is ever sent to the CDN**.

## Supported formats & limits

- Accepts: `.opus`, `.ogg`, `.wav`, `.mp3`, `.m4a`, `.aac`, `.flac`, `.webm`, `.mp4` audio, plus anything reporting `audio/*`.
- Formats OpenRouter accepts directly (mp3/m4a/wav/ogg/flac/aac) pass through unchanged; everything else (incl. `.opus`, webm/opus) is **converted to WAV in-browser** before sending.
- **Soft size cap ~25 MB per file** (base64 inflates the request ~33%). Larger files are rejected with a clear message.
- **Long-audio chunking is out of scope** in this version — very long recordings may exceed a model's limits. Language hinting is best-effort.

## SG/Send requirement

Sending an encrypted share needs a **live send.sgraph.ai service and an access token**. The embedded send component prompts you for the token (it is **not** persisted in this version). The send environment (`send.sgraph.ai` / `dev.` / `main.`) is auto-detected from the page hostname.
