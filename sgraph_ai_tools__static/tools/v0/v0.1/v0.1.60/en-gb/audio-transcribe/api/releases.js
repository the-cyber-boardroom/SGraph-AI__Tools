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
