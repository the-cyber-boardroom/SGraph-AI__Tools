# Changelog

All notable changes to `sgraph_ai_tools__static` are documented here.

## [0.1.66] — 2026-08-16

### Added (narrated-review — author a document, don't record a video)
- **`narrated-review` tool** (`tools/v0/v0.1/v0.1.66/en-gb/narrated-review/`, v0.1.0 alpha) — narrate a walk through a screen and press a key at each moment that matters. The keypress does three jobs: marks a **screenshot** (canvas grab at the press instant, full resolution), bounds an **audio segment** over a continuous recording, and creates the **alignment** between them. The unit is the *pair*, and everything downstream operates on the ordered list: parallel per-segment transcription (`core/sg-transcribe`), sequential **screenshot-grounded cleanup** (raw text + the pair's screenshot + a rolling summary → strict JSON, uncertain spans **marked** rather than silently resolved), then a single `review.md` of heading + image + words, with the raw transcripts preserved in an appendix. Exports as a zip (`review.md` + `images/` + `audio/` + `raw/` + `session.json`) or an SG/Send encrypted link. **No video is ever recorded.** 27 SgToolApi actions, `nr:*` events, 3 SKILL files. Spec: `team/humans/dinis_cruz/claude-code-web/08/16/v0.2.86__brief__tools-team__narrated-review__1-5`.
  - **Audio is continuous; the keypress is a marker, not a switch** — so a sentence begun *before* the press is not lost. Segment bounds snap back to the nearest sustained silence before the press (the thresholds shipped in v0.1.0 were corrected against live narration — see the v0.1.1 entry below). Bounds are data, not file edges, so they stay adjustable in review.
  - **Privacy** — nothing leaves the browser except audio segments and, in `grounded` cleanup mode only, the pair's screenshot, both direct to OpenRouter under the user's BYOK key. `setCleanupMode({mode:'text-only'|'off'})` stops screenshots leaving; session content is in-memory only.
  - **Headless path** — `addRecording → markAt → transcribeAll → cleanAll → buildDocument` needs no gestures, so agents and Playwright drive the same pipeline.
- **`core/sg-live-capture` v0.1.0** — continuous mic capture + energy VAD, promoted VERBATIM from audio-transcribe v0.1.60 (`live-capture.js` + `live-vad.js`). Closes the capture half of the "no standalone STT module" gap noted in the v0.1.93 integration guide. audio-transcribe/live-transcribe are NOT yet re-pinned onto it (additive extraction — nothing existing changed).
- **`core/sg-zip` v0.1.0** — `loadJSZip()` + `zipEntries([{path, blob?|text?}])`, filling the "no ZIP core module" gap the reality document flagged. JSZip injectable for headless tests.
- **Registry v0.1.66** adds `narrated-review` under Media (42 slugs).
- **Tests** — `tests/playwright/narrated-review-boot-smoke.js` (21/21) and `tests/playwright/narrated-review-pipeline-smoke.js` (33/33: the full headless run with OpenRouter mocked, asserting speak-before-press recovery, ordered image+words pairs, grounded correction + unsure marks, raw survival, rolling-summary accumulation, cost roll-up, bundle shape, spend cap).
- **Not yet verified in a browser:** the live gesture leg (real screen picker + mic + physical keypresses), live OpenRouter calls, and the SG/Send share leg.

### Changed (narrated-review v0.1.1 — live-verified, editing, chat, vault, PDF)
- **Boundary snap fixed against live narration.** The snap took the latest silence over a 4 s lookback with a 120 ms threshold; real speech has ~120 ms word gaps, so segments started mid-sentence and bled into the next utterance. The gap must now be SUSTAINED (`minSilenceMs` 700) with a generous `lookbackMs` (30 s) — taking the latest qualifying gap is self-correcting. Tunable via the new `setSnapConfig`. Found only because the pipeline was run against real models.
- **Extra comments per capture** — a `notes` field kept deliberately separate from the transcript (raw is the recogniser's words, clean is the speaker's corrected, notes are added afterwards) and rendered as a quoted note in the document.
- **Reordering and insert-in-the-middle** — `movePair`/`reorderPairs`, and `insertPair` which authors a capture anywhere from a screenshot and/or text with no audio at all. `seq` is re-derived from position; `id` is stable across moves.
- **Two chat surfaces** — `askPair` scoped to one capture (its screenshot, raw, analysis, notes + the rolling summary), and `askSession`, an agentic chat over the whole review **with tools** (`list_captures`, `get_capture`, `set_notes`, `set_analysis`, `move_capture`, `insert_capture`) that reports what it changed. Raw transcripts are never writable from chat. New `api/nr-llm.js` isolated transport carries `tools`/`toolCalls`.
- **Vault save** — `saveToVault` writes `reviews/<sessionId>/{review.md,images/,raw/,notes/,session.json}` via `core/vault-write` v1.1.1, with **raw audio an explicit opt-in**: it is the bulk of the size and only needed to re-transcribe later, re-cut a boundary, or build something else (a video) from the same materials. `previewVaultFiles` shows the layout without writing.
- **PDF export** — `downloadPdf` renders the artefact (images + words + notes + raw appendix) with captures kept whole across page breaks; jsPDF lazy-loaded from a pinned CDN.
- 37 actions, 27 events. Boot smoke 37/37, pipeline smoke 33/33. `saveToVault` has NOT been run against a live vault.

## [0.1.65] — 2026-08-13

### Added (whatsapp-desk — Bridge mode, same day)
- **Bridge mode** — a second way to connect the desk: link a number as a WhatsApp *companion device* (like an iPad — QR scan, E2E preserved, no 24h window) via a new local **`whatsapp_bridge/`** Node service (repo root). The same conversation list / chat tabs / voice-note transcription / draft-reply flow render the linked number's real chats; sends and media are mode-routed. **Unofficial (Baileys) — expendable-number use only; official iPhone/iPad apps are never at risk.** The bridge has a mock provider (Node tests 10/10, runs over real HTTP verified) and a real Baileys provider (written to the API, unverified here). New core `BridgeClient` (mirrors `RelayClient.pull`), `connectBridge`/`bridgeStatus` actions (24 total), Accounts Bridge panel with the safety framing. Boot smoke 22/22.

### Added (whatsapp-desk — Tier-1 slice, MOCK/DEMO-VERIFIED ONLY)
- **`whatsapp-desk` tool** (`tools/v0/v0.1/v0.1.65/en-gb/whatsapp-desk/`, v0.1.0 alpha) — inbox + composer for the Business WhatsApp number on the official Meta Cloud API: Conversations/Accounts left column, per-chat sg-layout tabs, first-class 24h-window handling (chip + composer mode-switch + client-side typed `window-expired`), 10s visible-tab relay poll, receipts, voice-note transcription via `core/sg-transcribe`, **draft-only** AI replies (default `anthropic/claude-sonnet-4-6`; `sendText`/`sendTemplate` are the only sending actions), media download, cost roll-up. 21 SgToolApi actions, `wa:*` events, 3 SKILL files, and a **credential-free demo mode** (`loadDemo` — sends recorded locally, network untouched). Boot smoke 20/20 incl. the full demo flow.
- **`core/sg-whatsapp` v0.1.0** — Cloud API engine: Graph client (injectable fetch, relay-proxy-ready `baseUrl`), webhook normalizer + `windowExpiry`, `RelayClient`, frozen `WA_EVENTS`, typed Graph errors. Node smoke 10/10 (mocked fetch).
- **`whatsapp_relay/`** (repo root) — ~150-LOC stateless Cloudflare Worker template: `hub.challenge` handshake, `X-Hub-Signature-256` verification, KV storage with 72h TTL, bearer-authed `GET /messages` with CORS; holds no Meta token. Node tests 8/8. Tier-2 responder seams documented.
- **Chat components v0.1.0** — `sg-chat-thread`, `sg-chat-composer` (template-only mode), `sg-conversation-list`: platform-neutral SgComponents (js/html/css sibling files) reusable beyond WhatsApp.
- **Registry v0.1.65** adds `whatsapp-desk` under Media.
- **Not yet done (needs Meta):** business verification, number migration decision, Phase-0 live probes (Graph CORS, relay round-trip, media CDN, multi-computer token), relay deployment. No live Graph call has been made.

## [0.1.64] — 2026-08-05

### Fixed
- **Recording tail truncation ("lost the last couple of seconds")** — `core/sg-recorder` (and therefore video-recorder + video-publisher): the pipeline stamped ONE shared `Date.now() − startedAt` duration into every blob's WebM EBML header, but the separate camera/screen/audio recorders start seconds *before* `startedAt` (the composite canvas build in between is awaited), so their headers understated the real media length and players/ingest cut the tail — the data was in the file, playback stopped early. Each blob is now stamped with its own recorder's measured start→flush lifetime (shared paused time subtracted). Long-standing bug inherited from video-recorder v0.1.48; the deployed tool picks the fix up via its v0.1.64 core shims.
- **video-publisher on the landing page** — added to the featured hero row (first card) with the tagline "Record → transcript → description → YouTube, in two clicks"; landing page overlay `v0.1.64/en-gb/index.html`.

### Added (video-publisher — one-page record→transcribe→describe→YouTube)
- **`video-publisher` tool** (`tools/v0/v0.1/v0.1.64/en-gb/video-publisher/`, v0.1.0 alpha) — consolidates the video-recorder → video-tools → audio-transcribe → youtube-editor publishing workflow into one page; the blob never leaves the page. Record in-tool (engine shared with video-recorder), or import / receive a handoff; three-route audio (native separate stream → FFmpeg remux → decode-to-WAV, 25 MB cap); OpenRouter transcription with per-generation cost; strict-JSON title/description/tags generation with guided regenerate; direct browser→YouTube upload with proactive silent token refresh (T-5 min + before upload). Auto-run always stops at ready-to-publish — `upload()` / `publish({confirm:true})` are the only paths to YouTube. SgToolApi 29 actions, `vp:*` events, 3 SKILL files. Spec: `team/humans/dinis_cruz/claude-code-web/08/05/v0.2.82__brief__tools-team__video-publisher__1-5`.
- **`core/sg-recorder` v0.1.0** — the video-recorder recording engine (6 files, moved verbatim from the v0.1.48–v0.1.63 overlays); `SGA_RECORDER` event contract frozen.
- **`core/sg-transcribe` v0.1.0** — the audio-transcribe transcription engine (7 files from the tool's `api/`); `AT_EVENTS` contract frozen.
- **`core/video` v1.0.2** — heals the v1.0.0/v1.0.1 fork: WORKERFS on-demand input mounting (multi-GB safe) + `convertToMp4`.
- **`handoff/sg-publish-handoff.js`** — shared consume-once handoff helper (sg-youtube-handoff protocol + separate `audioBlob`).
- **Boot smoke** (`tests/playwright/video-publisher-boot-smoke.js`) — 17 checks against the layered union via the run-locally server; all green in headless Chromium, alongside clean boot checks for the five touched tools.

### Added (quality pass, same day)
- **`sg-pipeline-steps` component** (`components/sg-pipeline-steps/v0/v0.1/v0.1.0/`) — generic pipeline-spine step rows (status icons, info slot, re-run intent), shadow DOM with js/html/css as sibling files via `SgComponent`. video-publisher's Steps panel is the first consumer (`ui-steps.js` shrinks to a ~65-line adapter).

### Changed (post-first-use feedback, same day)
- **video-publisher: big Download button on the Publish tab** — `⬇ Download video (x.x MB)` browser-native download of the loaded video for cross-posting (e.g. LinkedIn); `downloadVideo` API action (33 total).
- **video-publisher: layout picker promoted out of Advanced** — big always-visible segmented buttons (🖥 Landscape / 📱 Vertical Shorts / 📊 Infographic) with the active choice strongly highlighted and locked while recording, after wrong-layout takes in first use. The idle status line echoes the current layout.
- **video-publisher: metadata model picker, Sonnet default** — title/description generation now defaults to `anthropic/claude-sonnet-4-6` (noticeably better descriptions) with a picker next to Generate (Sonnet / Gemini 3.5 Flash / Haiku 4.5 / Gemini Flash Lite); transcription keeps its cheaper gemini-flash default.
- **video-publisher: two-click publish (auto-publish mode)** — opt-in Record-tab toggle (persisted `sg-video-publisher-autopublish`): a completed auto-run continues straight into the YouTube upload after a **5-second cancellable countdown**, using the remembered privacy default and the silent token path (pauses with `auth-required` if YouTube was never signed in). Start → Stop is the whole workflow.
- **video-publisher: big Cancel** — `✖ Cancel — stop the whole workflow` button in the Record tab, visible at every running stage; `cancelRun` API action stops recording (discards it), in-flight transcription (engine `cancelItem`), the countdown, or the upload itself (AbortController through the upload core). New events `vp:autopublish:countdown` / `vp:run:cancelled`; 32 actions total.
- **video-publisher: Preview tab** — the loaded video now plays in a dedicated 🎬 Preview tab (auto-focused when a recording/import/handoff lands) instead of rendering inside the Import tab; Import is back to just the dropzone + handoff notice.
- **video-publisher: remembered privacy default** — privacy still defaults to unlisted, but a Metadata-tab checkbox ("Remember this privacy as my default") persists the choice in `localStorage['sg-video-publisher-privacy']`; new `setDefaultPrivacy` API action (30 total).

### Changed
- **video-publisher api/ split (same-day quality pass)** — `publisher-pipeline.js` (298 lines, at the ceiling) split one-concern-per-file: step runners + auto-run + cost roll-up → `api/publisher-steps.js` (deps injected via `initSteps()`, one-directional imports); the transcribe item/version store → `api/transcribe-store.js`; the pipeline stays as the intake/record/publish façade re-exporting the step surface. Inline display toggles replaced with a `.vp-hidden` class. SKILL-api action count corrected 28→29; SKILL-browser Steps selectors updated to the component's shadow rows.
- **video-recorder v0.1.64** — `api/` engine files became re-export shims to `core/sg-recorder` (behaviour + events unchanged); recording tab gains a **Publish** button (hands the recording plus its separate audio stream to video-publisher); `sendToPublisher` / `sendToYouTubeEditor` registered as API actions (the YouTube handoff was previously UI-only); manifest's sg-video-recorder pin corrected v0.1.1→v0.1.2.
- **audio-transcribe v0.1.27** — the seven engine files became re-export shims to `core/sg-transcribe`; live-transcribe's cross-tool imports flow through the shims unchanged.

## [0.1.58-P6] — 2026-05-13

### Changed (agent-with-tools P6)
- **sg-layout migration** (`tools/…/agent-with-tools/`): `manifest.json` now loads `sg-layout` (phase 2) plus the three panel elements (`aw-chat-pane`, `aw-bridge-panel`, `aw-model-panel`). `agent-with-tools-api.js` imports and calls `initLayout()` so the panel tree is wired at boot.
- **Ollama default fix**: on first visit (no `sg-llm-config` in localStorage) a synthetic `llm:connected` event for Ollama/qwen2.5-coder:7b is dispatched before the first LLM send, preventing `sg-llm-request` falling back to its hardcoded `'openrouter'` default. Root cause: `sg-llm-request` never reads the `provider` HTML attribute — it only uses `this._config` set by `llm:connected`.
- **CSS cleanup** (`styles/agent-with-tools.css`): removed defunct `.aw-grid`, `.aw-chat`, `.aw-side` rules (pre-sg-layout). Added `.aw-main`, `.aw-layout-root`, `.aw-conn-wrapper` rules for the new layout.
- **TODO P7 comment** added to `sg-local-bridge._doRegister()` documenting why `sg-tool-definition` shows built-in VFS tools instead of `lb_*` tools (no listener for bridge registrations). Documented in `SKILL-human.md`.

## [0.1.58] — 2026-05-13

### Added
- **`agent-with-tools` tool** (`tools/v0/v0.1/v0.1.58/en-gb/agent-with-tools/`) — browser chat agent that lets an LLM autonomously read/write files, run bash commands, and fetch URLs on the user's machine via a lightweight Docker bridge. Works with Ollama (offline) or OpenRouter (cloud).
- **`sg-local-bridge` component** (`components/agentic/sg-local-bridge/v0/v0.1/v0.1.0/`) — headless Web Component registering six `lb_*` tools (`lb_read_file`, `lb_write_file`, `lb_delete_file`, `lb_list_folder`, `lb_run_bash`, `lb_fetch_url`) with `sg-tool-runner`.
- **`sg-local-bridge-shim`** — JSON-in-content tool-call normaliser for Ollama models (mistral, codellama) that don't emit native `tool_calls`.
- **`sgraph_bridge/` FastAPI service** — 6-endpoint Docker service (`/file/read`, `/file/write`, `/file/delete`, `/file/list`, `/bash/exec`, `/curl/fetch`, `/ping`) with workspace path-safety and CORS for `tools.sgraph.ai`. Run with `docker compose up` from `sgraph_bridge/`.
- **Landing-page registry v0.1.58** (`tools/v0/v0.1/v0.1.58/_common/js/sg-tool-registry.js`) — adds `agent-with-tools` to `TOOL_SLUGS` (37 total), visible in the Developer category.
- **Smoke test** (`tests/agent-with-tools-smoke.js`) — plain Node.js test (no external runner) exercising `sg-local-bridge-client` and `sg-local-bridge-shim` with a mocked `fetch`. 8 cases, all green.
