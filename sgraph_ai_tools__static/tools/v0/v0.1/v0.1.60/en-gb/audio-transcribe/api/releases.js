/**
 * releases — the tool's changelog (newest first).
 *
 * Single source of truth for "what changed and when". Surfaced two ways:
 *   - the JS API action `getReleases()` (window.__tool.getReleases())
 *   - the "Releases" tab in the bottom JS-API dev panel
 *
 * RULE: bump `version` in manifest.json + the SgToolApi version on every release
 * and add an entry here in the SAME commit.
 *
 * @module audio-transcribe/releases
 */

/** @typedef {{ version: string, date: string, summary: string, changes: string[] }} Release */

/** @type {ReadonlyArray<Release>} */
export const RELEASES = Object.freeze([
    {
        version: '0.1.26',
        date: '2026-06-17',
        summary: 'Live now splits on speech (VAD), not a clock — much better transcripts.',
        changes: [
            'Rebuilt Live mode around Voice Activity Detection: instead of cutting on a fixed timer (which split words mid-syllable → garbled, hallucinated text), it now captures PCM, detects speech vs silence, and sends each COMPLETE utterance (a phrase cut at a natural pause) as a clean WAV. Each clip transcribes well and gluing the clips ≈ what you said.',
            'New controls: "Mic sensitivity" (speech threshold) and "Pause to split" (how long a pause ends a clip). The old "Chunk every" / "Skip silence" are gone (VAD subsumes them).',
            'New: a VAD timeline under the button — a live loudness trace with the speech-threshold line, speech shaded, and a red marker each time a clip is cut. Watch your speech get bracketed into clips (and tune the threshold).',
            'Fixed: segment playback now works — clips are clean WAVs (the old webm fragments were why ▶ failed).',
            'Engine is energy VAD (no download). A neural (Silero) option may come later for noisy rooms (see the v0.2.73 plan).',
        ],
    },
    {
        version: '0.1.25',
        date: '2026-06-16',
        summary: 'Live: fixed the repeated opening words; "skip silence"; play each segment.',
        changes: [
            'Fixed: live segments kept starting with the recording\'s opening words (the "Let\'s Let\'s…" bug). Each delta prepended the recorder\'s FIRST chunk to stay decodable — but that chunk is the webm header PLUS the first ~1s of audio, so the opening got re-sent every time. We now extract only the init segment (the bytes before the first webm Cluster) and prepend that — no stale audio.',
            'New: "Skip silence" toggle — a delta whose window stayed near-silent is not sent (saves $ and stops the model hallucinating filler on silence). An AnalyserNode tracks loudness; startLive({skipSilence,silenceThreshold}) controls it.',
            'New: a ▶ play button on every segment in "Segments sent" — hear exactly what was sent to the model (decoded, so webm timecode offsets don\'t matter). Great for verifying chunk boundaries.',
        ],
    },
    {
        version: '0.1.24',
        date: '2026-06-16',
        summary: 'Live: choose the chunk interval; out-of-order-safe reassembly.',
        changes: [
            'New: a "Chunk every" control in the Live panel (1s … 6s) — shorter = more responsive but sends more, smaller requests (more $); longer = cheaper. startLive({intervalMs}) sets it.',
            'Changed: shorter intervals now genuinely fire overlapping requests (bounded concurrency), and the live transcript is reassembled BY SEQUENCE NUMBER (contiguous prefix) — so if OpenRouter answers deltas out of order, the text still appears in the right order (a later/faster delta never jumps ahead of an earlier one). The clean full-quality pass on stop is unchanged, so the saved transcript is unaffected by any live-preview roughness.',
            'Note: chunking is time-based (the interval), not silence/VAD-aware — a smart silence-split mode is a future option.',
        ],
    },
    {
        version: '0.1.23',
        date: '2026-06-16',
        summary: 'Dropped 3 broken/hanging models; "Stop all" on the parallel run.',
        changes: [
            'Removed three models that did not work: GPT-4o Audio (openai/gpt-4o-audio-preview — "not a valid model ID"; use GPT Audio / GPT Audio Mini instead), MiMo v2 Omni (OpenRouter deprecated it → xiaomi/mimo-v2.5, not yet confirmed audio-capable here, so left out rather than re-add a possibly-broken id), and Nemotron Nano Omni (free) (hung mid-transcription). The curated list is now 7 working chat-path models + 2 gated STT.',
            'New: a "■ Stop all" button on the Advanced parallel run (per-recording panel) — aborts every in-flight request for that recording (kills the upstream fetches via the isolated transport); the aborted runs become "cancelled" versions. API: cancelItem({id}).',
        ],
    },
    {
        version: '0.1.22',
        date: '2026-06-16',
        summary: 'Final-pass toggle, versioned TTS component, audio over the API, spend cap.',
        changes: [
            'New: a "Clean up on stop" toggle in the Live panel — on (default) does the full-quality re-transcription for a clean saved transcript; off keeps the cheaper live text (no extra full-length charge). stopLive({finalPass}) controls it.',
            'New: synthesize({returnAudio:true}) returns the WAV as {audioDataUrl} (base64) so an embedder can read the audio over the JS API; synthesize now also honours an {apiKey} override.',
            'New: setSpendCap({usd}) — a session spend cap (for a sponsored/shared key); transcribe/Live halt with a typed {code:\'budget-cap\'} once reached. Meant to be driven by the vault/key-budget layer.',
            'Refactor: the OpenRouter TTS engine moved to a VERSIONED core module (core/sg-tts-openrouter) so vault pages import it by a stable /core/ URL (like sg-audio-decode); the tool delegates to it.',
        ],
    },
    {
        version: '0.1.21',
        date: '2026-06-15',
        summary: 'Live now sends DELTAS, not the whole growing take (much cheaper).',
        changes: [
            'Changed: Live mode used to re-send the ENTIRE recording on every poll, so cost grew roughly quadratically with how long you spoke. It now transcribes only the NEW audio since the last poll (a delta), so live cost is roughly linear with duration. Each delta prepends the recorder header so the new audio is decodable on its own; the continuous recording is kept intact.',
            'On stop, one full-quality pass over the whole take produces the clean saved transcript (the live view is the deltas appended, a fast preview). Net: ~2× the audio length is sent instead of ~12–60×.',
        ],
    },
    {
        version: '0.1.20',
        date: '2026-06-15',
        summary: 'Voice cost in the session total; graceful mic-in-vault error (dev-brief Finding 8).',
        changes: [
            'Changed: the "This session" total in Model & Cost now includes Create Voice (TTS) spend, not just transcriptions (e.g. "💰 $x over 2 transcriptions + 1 voice"). Voice cost is tracked the moment it resolves. getCostSummary() now also returns auxUsd/auxPending.',
            'Fixed (embedded/vault): starting Live in a sandboxed null-origin frame (where navigator.mediaDevices is undefined) now fails with a clear typed error { code: mic-unavailable } and an at:live:error event ("the host must allow=\\"microphone\\"…"), instead of a bare throw. The standalone tool is unaffected.',
            'Tests: served-page contract assertions added to the live Playwright smoke (getItems() is a non-empty array; OpenRouter TTS returns audio bytes) to catch deploy-drift, not just source correctness.',
        ],
    },
    {
        version: '0.1.19',
        date: '2026-06-15',
        summary: 'Cost for Create Voice (TTS) + friendly key/quota error messages.',
        changes: [
            'New: the "🗣 Voice" panel now shows the cost of each synthesis — OpenRouter voice shows 💰 $x (resolved by generation id a couple of seconds after it finishes), local (Kokoro) shows 💰 free (on-device).',
            'Improved: when a key/quota error happens (key-invalid / no credit / key-exhausted / rate-limited), the Queue rows and Live panel now show a short, actionable message ("Your OpenRouter key has no credit — top it up…") instead of a raw provider error. The Debug panel still shows the exact code + provider text.',
        ],
    },
    {
        version: '0.1.18',
        date: '2026-06-15',
        summary: 'Typed key/quota errors (vault dev-brief Finding 7).',
        changes: [
            'New: a failed request now carries a typed error code from the HTTP status — key-invalid (401), budget-exceeded (402), key-exhausted (403) or rate-limited (429) — so an embedder (or a distributed SG-API secret that has hit its TTL/usage cap) gets a clear, machine-readable failure instead of a generic one. transcribeItem/ask reject with { code, status }; the provider message is preferred for display. Classification is by status code (api/llm-errors.js), not brittle string-matching.',
            'The 🔎 Debug panel shows the typed code on errored requests; failed transcription versions record errorCode.',
        ],
    },
    {
        version: '0.1.17',
        date: '2026-06-15',
        summary: 'Vault dev-brief hardening: headless chat (ask), cost in results, vault-safe cache.',
        changes: [
            'New: ask({ text, model?, context? }) — chat about your transcripts headlessly (no UI), for scripting/embedding. Returns { text, model, generationId, usage } so the cost is readable. The default context is your done transcripts.',
            'Changed: transcribeItem() now returns generationId + usage:{promptTokens,completionTokens,costUsd} so embedders (e.g. a vault app) can show real per-transcript cost via GET /api/v1/generation. getItems/getItem are documented as the authoritative ARRAY/object live-state shape and guarded by a CI contract test.',
            'Fixed (core/sg-wasm-cache): isCacheApiAvailable() no longer throws in a sandboxed srcdoc frame (a vault-powered-website host) where touching `caches` raises SecurityError — it now degrades to false, so the Safari tier-3 WASM .opus decode path runs inside a vault. Storage is treated as best-effort, never required.',
        ],
    },
    {
        version: '0.1.16',
        date: '2026-06-15',
        summary: 'Live segments shown (with per-segment cost) + mobile-friendly layout.',
        changes: [
            'New: the "🔴 Live" tab now lists every segment it sends — each poll re-sends the GROWING audio as a real, separately-billed request, so you can see #seq · elapsed · size · latency · cost per segment, plus a running total (live mode can add up). Same records also appear in the 🔎 Debug · provenance panel (with a "🔴 live" badge).',
            'New: per-segment cost — the exact charged figure resolves a couple of seconds later by generation id (same lookup as a normal transcription). API: the at:live:segment event carries { seq, sizeBytes, elapsedMs, latencyMs, text, final, ok, generationId, costUsd }.',
            'Mobile: on narrow screens (≤760px) the two-column layout collapses to a single full-width tab stack (all tabs in one scrollable bar), with bigger tap targets, a full-width Live button, a smaller header, and 16px inputs (no iOS zoom-on-focus).',
        ],
    },
    {
        version: '0.1.15',
        date: '2026-06-15',
        summary: 'Live (near-realtime) transcribe — the "🔴 Live" tab; cloud-TTS streaming-format fix.',
        changes: [
            'New: a "🔴 Live" tab — one big button to start talking. It captures the mic and transcribes the growing take every couple of seconds, so the transcript appears and refines as you speak (a live waveform + elapsed timer show alongside). On stop it does one final pass and saves the take (with its transcript) to the Queue.',
            'Client-side, no backend: this is pseudo-streaming (growing-window, refine-in-place) reusing the existing isolated OpenRouter transport and your saved key + active model. True chunk+merge streaming is a later phase (see the architect plan).',
            'API: startLive() and stopLive() (stopLive resolves { id, text, durationMs } — the id is the new Queue item). Events: at:live:started / at:live:update / at:live:stopped / at:live:error.',
            "Fixed: cloud (OpenRouter) text-to-speech still failed with HTTP 400 — when stream=true the audio.format 'wav' is unsupported. It now requests 'pcm16' (the streamable format) and wraps the streamed PCM chunks in a WAV header in-browser (24 kHz mono).",
        ],
    },
    {
        version: '0.1.14',
        date: '2026-06-15',
        summary: 'Chat inside each recording + chat costs.',
        changes: [
            'New: "💬 Chat about this recording" inside each recording\'s panel — the chat context is automatically that recording\'s transcript (no manual setup). The session-wide "💬 Chat" tab (all transcripts) stays too.',
            'New: chat cost — each chat shows its running spend: total $ + number of turns + last-turn cost, looked up by generation id (per turn and overall for that chat session).',
        ],
    },
    {
        version: '0.1.13',
        date: '2026-06-15',
        summary: 'Fix: cloud (OpenRouter) text-to-speech.',
        changes: [
            'Fixed: OpenRouter TTS failed with "Audio output requires stream: true" (HTTP 400). It now sends a streaming request and accumulates the incremental delta.audio chunks into the WAV — cloud voice works.',
        ],
    },
    {
        version: '0.1.12',
        date: '2026-06-15',
        summary: 'Chat with your transcripts + TTS single-download fix.',
        changes: [
            'New: a "💬 Chat" tab — ask questions of your transcripts (summarise, extract, translate, reformat). The system prompt is built from your transcript(s) + an editable context; reuses the sg-llm chat components with a text model (default google/gemini-3.5-flash) and your saved OpenRouter key. "↻ Context" reloads the latest transcripts into the prompt.',
            'Fixed: local TTS downloaded the ~90 MB voice model 4× (one per pooled worker). Now uses a single worker (poolSize:1) so the model downloads once.',
        ],
    },
    {
        version: '0.1.11',
        date: '2026-06-15',
        summary: 'Text-to-speech ("🗣 Voice" tab) — local + OpenRouter.',
        changes: [
            'New: a "🗣 Voice" tab — type text and synthesise speech in two engines: Local (free, Kokoro / sg-tts, runs in the browser; first run downloads the ~160 MB voice model) or OpenRouter (an audio-output model like openai/gpt-audio; uses your key). Play it, download a .wav, or "Add to queue" to round-trip (synth → transcribe → compare).',
            'API: synthesize({ text, mode, voice, model? }) and addSynthesized({ text, mode, voice }) (synth straight into the queue).',
        ],
    },
    {
        version: '0.1.10',
        date: '2026-06-15',
        summary: 'Stop button, live seconds counter, live debug entries.',
        changes: [
            'New: a Stop button on any in-flight transcription (Queue row + per-recording panel) — aborts the request (handy when a model hangs on OpenRouter\'s side). The result is recorded as a "cancelled" version. API: cancelItem({id}).',
            'New: a live seconds counter while transcribing, so you can see it\'s moving.',
            'Debug panel: an entry now appears the moment a request is made ("pending", with a live timer) and is updated in place with the response or the cancellation.',
        ],
    },
    {
        version: '0.1.9',
        date: '2026-06-15',
        summary: 'Live recording waveform.',
        changes: [
            'New: a live waveform/spectrum (reusing sg-audio-viz — the same component the video-recorder uses) shows while you record from the mic, so you can see audio is being captured. It hides when you stop. Best-effort: recording still works if the viz can\'t start.',
        ],
    },
    {
        version: '0.1.8',
        date: '2026-06-15',
        summary: 'More models, setApiKey API, debug/provenance panel.',
        changes: [
            'Added more audio models to try: Gemini 3 Flash (preview), Gemini 3.1 Flash Lite (preview), GPT Audio Mini, GPT-4o Audio, Voxtral Small 24B, MiMo v2 Omni. (Some ids may not be live — those show as a graceful error version so you can see which work.)',
            'API: setApiKey({ apiKey, model }) configures the OpenRouter key programmatically (persists + connects) — for agentic / headless callers.',
            'New: "🔎 Debug · provenance" tab (right side) + getExchanges() API — every LLM request/response this session: model, prompt, audio file, transcript, tokens, cost, generation id, and the raw OpenRouter response. Audio bytes are never shown.',
        ],
    },
    {
        version: '0.1.7',
        date: '2026-06-15',
        summary: 'Parallel "Transcribe all" + model list cleanup.',
        changes: [
            '"Transcribe all" now runs in PARALLEL (a 4-wide worker pool) — safe with the isolated transport, and much faster for many files.',
            'Removed google/gemini-3-pro-preview — OpenRouter has no active endpoints for it (it 404\'d).',
            'Added nvidia/nemotron-3-nano-omni (free) — a free audio-input model, handy for testing without spend.',
        ],
    },
    {
        version: '0.1.6',
        date: '2026-06-15',
        summary: 'Confirm + guard the concurrent-transcription cross-talk fix.',
        changes: [
            'Confirmed the deeper root cause of the "same transcript / only one /chat/completions request" bug: the shared <sg-llm-request> dropped a second concurrent send (its _busy guard) while both promises resolved on the one response. The v0.1.5 isolated transport fixes it.',
            'Added a browser regression test (tests/playwright/audio-transcribe-parallel-smoke.js): two concurrent transcriptions must make two completions requests and return distinct transcripts. Verified passing.',
        ],
    },
    {
        version: '0.1.5',
        date: '2026-06-15',
        summary: 'Advanced mode — version history, parallel multi-model, cost roll-ups.',
        changes: [
            'New: re-transcribing now KEEPS previous transcriptions — each run is a version you can compare and switch between ("use this") in the per-recording panel\'s Advanced section.',
            'New: transcribe one file with several models IN PARALLEL (tick models → "Transcribe selected"). Made safe by giving each request its own isolated LLM bus — the shared bus was what caused the identical-transcript cross-talk, so this also hardens normal transcription (no more serial-only limit).',
            'New: costs at three levels — per transcription (each version), per audio file (file total), and per browser session (Model & Cost tab).',
            'API: added transcribeModels({id, models}) and getCostSummary().',
        ],
    },
    {
        version: '0.1.4',
        date: '2026-06-15',
        summary: 'One-click sample audio for testing.',
        changes: [
            'New: "Load sample" in the Source panel + the loadSample() API action — drops a synthesised test tone into the queue (no network) to exercise the player / queue / panel / cost flow. Real-speech samples can be added to api/samples.js as CORS-enabled URLs are confirmed.',
        ],
    },
    {
        version: '0.1.3',
        date: '2026-06-15',
        summary: 'Releases changelog (this tab) + getReleases API.',
        changes: [
            'New: this Releases tab in the JS-API dev panel, and the getReleases() API action — both surface this changelog.',
            'Process: the version badge now bumps on every release (it had been lagging behind shipped changes).',
        ],
    },
    {
        version: '0.1.2',
        date: '2026-06-15',
        summary: 'Per-item cost, identical-transcript fix, per-recording panel.',
        changes: [
            'Fixed: two different audio files could return the same transcript — the shared LLM bus resolved on the next response with no correlation id, so concurrent transcriptions crossed over. Transcription is now strictly serial.',
            'New: per-recording detail panel — "Open ▸" a Queue row to get a dedicated tab with an audio player, a per-item model selector + Re-transcribe (debug a bad transcription against another model), the transcript, and copy/download.',
            'New: per-transcription cost — shows the cost from the OpenRouter response, then the exact charged cost looked up by generation id a couple seconds later, plus token counts + latency (in the panel and the Queue row).',
            'Changed: sg-layout tabs unlocked — drag/re-dock them.',
        ],
    },
    {
        version: '0.1.1',
        date: '2026-06-14',
        summary: 'sg-layout shell, cost view, dev panel, banner; model + crash + recording fixes.',
        changes: [
            'Fixed: blank/crashing boot (ui-model consumed an async SgToolApi action as a synchronous array; sg-layout was awaited incorrectly).',
            'Fixed: 0-byte mic recordings on mobile (records in short chunks now, with a clear error if nothing is captured).',
            'Fixed: curated model list verified live on OpenRouter — default is now google/gemini-3.5-flash; dropped dead ids.',
            'New: 2-column sg-layout, OpenRouter usage/cost view, bottom JS-API dev panel (Skills/Explorer/Console/Manifest), SG site-header banner, visible version badge, full-width layout.',
        ],
    },
    {
        version: '0.1.0',
        date: '2026-06-13',
        summary: 'Initial release.',
        changes: [
            'Record from the mic or drag/drop many local audio files (including WhatsApp .opus voice notes).',
            'Batch-transcribe each to text via curated OpenRouter audio models, entirely in the browser.',
            'Three-tier never-fail .opus/webm decode (pass-through → decodeAudioData → WASM Opus), bundle to .zip, optional encrypted share via SG/Send.',
        ],
    },
]);

/** @returns {string} the current (latest) version. */
export function currentVersion() { return RELEASES.length ? RELEASES[0].version : '0.0.0'; }
