# Changelog

All notable changes to `sgraph_ai_tools__static` are documented here.

## [0.1.58] — 2026-05-13

### Added
- **`agent-with-tools` tool** (`tools/v0/v0.1/v0.1.58/en-gb/agent-with-tools/`) — browser chat agent that lets an LLM autonomously read/write files, run bash commands, and fetch URLs on the user's machine via a lightweight Docker bridge. Works with Ollama (offline) or OpenRouter (cloud).
- **`sg-local-bridge` component** (`components/agentic/sg-local-bridge/v0/v0.1/v0.1.0/`) — headless Web Component registering six `lb_*` tools (`lb_read_file`, `lb_write_file`, `lb_delete_file`, `lb_list_folder`, `lb_run_bash`, `lb_fetch_url`) with `sg-tool-runner`.
- **`sg-local-bridge-shim`** — JSON-in-content tool-call normaliser for Ollama models (mistral, codellama) that don't emit native `tool_calls`.
- **`sgraph_bridge/` FastAPI service** — 6-endpoint Docker service (`/file/read`, `/file/write`, `/file/delete`, `/file/list`, `/bash/exec`, `/curl/fetch`, `/ping`) with workspace path-safety and CORS for `tools.sgraph.ai`. Run with `docker compose up` from `sgraph_bridge/`.
- **Landing-page registry v0.1.58** (`tools/v0/v0.1/v0.1.58/_common/js/sg-tool-registry.js`) — adds `agent-with-tools` to `TOOL_SLUGS` (37 total), visible in the Developer category.
- **Smoke test** (`tests/agent-with-tools-smoke.js`) — plain Node.js test (no external runner) exercising `sg-local-bridge-client` and `sg-local-bridge-shim` with a mocked `fetch`. 8 cases, all green.
