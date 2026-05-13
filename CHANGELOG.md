# Changelog

All notable changes to `sgraph_ai_tools__static` are documented here.

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
