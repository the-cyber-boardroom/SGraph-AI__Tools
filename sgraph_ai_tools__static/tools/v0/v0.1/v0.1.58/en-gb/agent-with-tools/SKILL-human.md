# Agent with Tools — Human Guide

A browser-based chat agent that can read/write files, run bash commands, and fetch URLs on your local machine. The agent is powered by Ollama (offline) or OpenRouter (cloud) and talks to a local FastAPI bridge running in Docker.

---

## Prerequisites

| Requirement | Purpose |
|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine | Runs the FastAPI bridge |
| [Ollama](https://ollama.com/) | Runs the LLM locally (offline) |
| `qwen2.5-coder:7b` pulled in Ollama | Default model |

---

## Quick Start

### 1. Start the bridge

```bash
# From the repo root:
cd sgraph_bridge
docker compose up --build
```

The bridge starts on `http://localhost:8000`. The workspace folder `./_sgraph-workspace` is created automatically (relative to where you run the command).

Verify: `curl http://localhost:8000/ping` should return `{"ok":true,...}`.

### 2. Start Ollama

```bash
ollama serve
ollama pull qwen2.5-coder:7b   # first run only
```

Ollama listens on `http://localhost:11434` by default.

### 3. Open the tool

Navigate to `tools.sgraph.ai/.../agent-with-tools/` (or open `index.html` from a local server).

The bridge status dot in the top-right turns **green** when connected. The agent is ready.

---

## Example Prompts

| Task | Prompt |
|---|---|
| List workspace files | `List all files in the workspace root` |
| Read a file | `Read README.md and summarise it` |
| Edit a file | `Add an emoji to the title in README.md` |
| Create a file | `Create a file called hello.py that prints Hello World` |
| Run a command | `Run "python hello.py" and show me the output` |
| Fetch a URL | `Fetch https://api.github.com/repos/ollama/ollama and tell me the star count` |
| Multi-step task | `Read package.json, check the version field, increment the patch number, and write it back` |

---

## Bridge Status Dot

| Colour | Meaning |
|---|---|
| Grey | Not yet connected |
| Amber | Connecting (ping in-flight) |
| Green | Connected (shows workspace path + latency on hover) |
| Red | Bridge offline or unreachable |

Click the dot to force a reconnect.

---

## Changing the Model

Open the browser console and use the JS API:

```js
// Switch to a different Ollama model
window.__tool.setModel('llama3.1:8b')

// Switch to OpenRouter (requires API key in sg-llm-connection panel)
window.__tool.setProvider('openrouter')
window.__tool.setModel('anthropic/claude-3-haiku')
```

---

## Known Limitations

- **Binary files are not supported** — the bridge returns a 415 error for non-text files. The agent will report this and should not attempt to read them.
- **Bash safety** — the Docker container is the security boundary. There is no command deny-list in v0.1.0. Do not run destructive commands (e.g. `rm -rf /`) against important data.
- **Context window** — very long sessions (many tool calls + large file reads) may approach the model's context limit (~32k tokens for `qwen2.5-coder:7b`). Use `window.__tool.clearChat()` to start fresh.
- **Streaming** — responses stream token-by-token. Long bash commands or large file operations will take time; the loop status strip shows the current iteration.
- **JSON-in-content fallback** — models like `mistral:7b` and `codellama:7b` need the Phase 4 shim to parse tool calls embedded in content. Until Phase 4 ships, use `qwen2.5-coder:7b` or `llama3.1:8b`.
- **OpenRouter default (was a bug, now fixed)** — `sg-llm-request` does not read the `provider="ollama"` HTML attribute; it only uses the provider set by `llm:connected` events from `sg-llm-connection`. On first visit (no localStorage), a synthetic `llm:connected` for Ollama is injected at boot. If you previously saved an OpenRouter config, `sg-llm-connection` auto-connects with that instead. To reset: open DevTools → Application → Local Storage → clear the `sg-llm-config` key, then reload.
- **Tools panel shows VFS built-ins, not lb_* tools (TODO P7)** — `sg-tool-definition` is populated from `sg-tool-runner`'s `BUILTIN_TOOL_DEFS` (VFS tools: `list_folder`, `read_file`, etc.) rather than from `sg-local-bridge`'s runtime registrations. The actual `lb_*` tools still work — the LLM uses them correctly — but they are not visible in the Tools panel. This is a known limitation pending a future fix (see TODO P7 comment in `sg-local-bridge.js`).

---

## Tested Models

| Model | Native tool_calls | Notes |
|---|---|---|
| `qwen2.5-coder:7b` | Yes | Default. Fast and accurate for file/code tasks. |
| `llama3.1:8b` | Yes | Good general reasoning. Slightly slower. |
| `mistral:7b` | No | Needs Phase 4 shim (not yet shipped). |
| OpenRouter / Claude 3 Haiku | Yes | Fastest quality; requires API key + internet. |

---

## Workspace Location

Files are mounted at `./_sgraph-workspace` from the directory where you ran `docker compose up`. The agent sees this as `/workspace`. All relative paths used in prompts are resolved from there.
