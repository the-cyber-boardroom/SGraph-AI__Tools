# Changelog

All notable changes to `sgraph_ai_tools__static` are documented here.

## [0.1.64] — 2026-08-05

### Added (video-publisher — one-page record→transcribe→describe→YouTube)
- **`video-publisher` tool** (`tools/v0/v0.1/v0.1.64/en-gb/video-publisher/`, v0.1.0 alpha) — consolidates the video-recorder → video-tools → audio-transcribe → youtube-editor publishing workflow into one page; the blob never leaves the page. Record in-tool (engine shared with video-recorder), or import / receive a handoff; three-route audio (native separate stream → FFmpeg remux → decode-to-WAV, 25 MB cap); OpenRouter transcription with per-generation cost; strict-JSON title/description/tags generation with guided regenerate; direct browser→YouTube upload with proactive silent token refresh (T-5 min + before upload). Auto-run always stops at ready-to-publish — `upload()` / `publish({confirm:true})` are the only paths to YouTube. SgToolApi 29 actions, `vp:*` events, 3 SKILL files. Spec: `team/humans/dinis_cruz/claude-code-web/08/05/v0.2.82__brief__tools-team__video-publisher__1-5`.
- **`core/sg-recorder` v0.1.0** — the video-recorder recording engine (6 files, moved verbatim from the v0.1.48–v0.1.63 overlays); `SGA_RECORDER` event contract frozen.
- **`core/sg-transcribe` v0.1.0** — the audio-transcribe transcription engine (7 files from the tool's `api/`); `AT_EVENTS` contract frozen.
- **`core/video` v1.0.2** — heals the v1.0.0/v1.0.1 fork: WORKERFS on-demand input mounting (multi-GB safe) + `convertToMp4`.
- **`handoff/sg-publish-handoff.js`** — shared consume-once handoff helper (sg-youtube-handoff protocol + separate `audioBlob`).
- **Boot smoke** (`tests/playwright/video-publisher-boot-smoke.js`) — 17 checks against the layered union via the run-locally server; all green in headless Chromium, alongside clean boot checks for the five touched tools.

### Changed
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
