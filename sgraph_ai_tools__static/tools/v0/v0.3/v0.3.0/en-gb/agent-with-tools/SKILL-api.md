# Agent with Tools — API Reference

Machine-readable capability spec for agents and integrations.

**Global:** `window.__tool`
**Event:** `tool:ready` fires when `window.__tool` is available
**Tool name:** `agent-with-tools`
**Version:** `0.1.58`

---

## Methods

### connect()
- **Type:** async
- **Params:** none
- **Returns:** `Promise<{ ok: boolean, version: string, workspace: string, latency_ms: number }>`
- **Side-effects:** pings `sg-local-bridge`, registers `lb_*` tools on `sg-tool-runner`, fires `sg-local-bridge:status` or `sg-local-bridge:error` on the bus
- **Notes:** Called automatically on page load via `auto-connect` attribute. Call again to force a reconnect after the bridge restarts.

### chat(msg)
- **Type:** async
- **Params:** `msg: string` — user message text
- **Returns:** `Promise<string>` — final assistant text after all tool calls resolve
- **Throws:** if `msg` is empty or not a string
- **Side-effects:** dispatches `llm:chat-message` on bus; the agentic loop runs until the model returns prose (no tool calls) or `max-iterations` is reached; fires `llm:response-complete` on completion
- **Notes:** The returned string is the last assistant text turn. Intermediate tool-call turns are visible in `getTranscript()`.

### getTranscript()
- **Type:** sync
- **Returns:** `Array<turn>` — full turn array from `sg-agentic-loop.getTurns()`. Empty array if the loop element does not expose `getTurns`.

### getBridgeStatus()
- **Type:** sync
- **Returns:** `{ ok: boolean, latency_ms: number, workspace: string, version: string } | null`
- **Notes:** Returns the last cached ping result. `null` if the bridge has never responded successfully.

### setProvider(name)
- **Type:** sync
- **Params:** `name: string` — `'ollama'` or `'openrouter'`
- **Returns:** `void`
- **Side-effects:** sets `provider` attribute on `sg-llm-request`

### setModel(name)
- **Type:** sync
- **Params:** `name: string` — e.g. `'qwen2.5-coder:7b'`, `'llama3.1:8b'`
- **Returns:** `void`
- **Side-effects:** sets `model` attribute on `sg-llm-request`

### clearChat()
- **Type:** sync
- **Returns:** `void`
- **Side-effects:** dispatches `llm:clear-history` on the bus; `sg-agentic-loop` resets its turn array; `sg-llm-chat-history` clears the rendered messages

---

## Turn Shape

Each entry in `getTranscript()` is one of:

### User message
```json
{ "role": "user", "content": "Read README.md and add an emoji to the title." }
```

### Assistant tool-call
```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "lb_read_file",
        "arguments": "{\"path\":\"README.md\"}"
      }
    }
  ]
}
```

### Tool result
```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"path\":\"README.md\",\"content\":\"# SGraph Tools\\n…\",\"size\":412}"
}
```

### Assistant prose (final)
```json
{ "role": "assistant", "content": "Done. The title now reads '# 🛠️ SGraph Tools'." }
```

---

## Bus Events

Dispatched on `<main data-llm-bus>`. All events are non-bubbling (`bubbles: false`).

### sg-local-bridge:status
- **Detail:** `{ ok: boolean, version: string, workspace: string, latency_ms: number }`
- **Fired:** after a successful bridge ping

### sg-local-bridge:tool-call
- **Detail:** `{ name: string, args: object, result: object, ms: number }`
- **Fired:** after each `lb_*` tool call resolves (success or error)

### sg-local-bridge:error
- **Detail:** `{ message: string, detail: any }`
- **Fired:** when the bridge ping fails or a network error occurs

### llm:response-complete
- **Detail:** `{ content: string }`
- **Fired:** when the agentic loop finishes and the model returns a final prose turn

### agentic-loop:done
- **Detail:** `{ tool_calls: number, cost: number }`
- **Fired:** when the loop completes (naturally or after stop)

---

## Components

| Element | Module | Role |
|---|---|---|
| `<sg-llm-request>` | sg-llm-request v0.1.6 | Sends messages to Ollama / OpenRouter |
| `<sg-llm-chat-history>` | sg-llm-chat-history v0.1.10 | Renders turn bubbles + tool-call chips |
| `<sg-llm-chat-input>` | sg-llm-chat-input v0.1.5 | Text input + send button |
| `<sg-llm-connection>` | sg-llm-connection v0.1.4 | Provider/key switcher UI |
| `<sg-llm-stats>` | sg-llm-stats v0.1.1 | tok/s telemetry |
| `<sg-tool-runner>` | sg-tool-runner v0.1.1 | Executes registered `lb_*` tool calls |
| `<sg-tool-definition>` | sg-tool-definition v0.1.1 | Manages which tools are enabled |
| `<sg-agentic-loop>` | sg-agentic-loop v0.1.0 | Orchestrates multi-turn reasoning |
| `<sg-local-bridge>` | sg-local-bridge v0.1.0 | Proxies tool calls to the FastAPI bridge |

---

## Known Limitations

- `getTranscript()` returns an empty array if `sg-agentic-loop` does not expose `getTurns()` in this version. Inspect the turn array via the Explorer dev panel instead.
- `chat()` resolves on the next `llm:response-complete` event. Concurrent calls to `chat()` before the previous one resolves will race — call sequentially.
- Binary file reads return an error envelope as the tool result; the LLM sees the error and handles it conversationally.
