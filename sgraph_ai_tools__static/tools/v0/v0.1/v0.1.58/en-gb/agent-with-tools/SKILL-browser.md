# Agent with Tools — Browser / Agent Guide

Automate this tool via `window.__tool` from Playwright, the browser console, or any agentic driver.

---

## Prerequisites

```js
// Wait for the tool to be ready
await page.waitForFunction(() => !!window.__tool)

// Or listen for the event
window.addEventListener('tool:ready', () => { /* tool is available */ })
```

---

## Common Patterns

### Connect to the bridge

```js
// Normally the bridge auto-connects on page load.
// To force a reconnect:
const status = await window.__tool.connect()
console.log(status)
// { ok: true, version: '0.1.0', workspace: '/workspace', latency_ms: 12 }
```

### Send a chat message and await the response

```js
const reply = await window.__tool.chat('List all files in the workspace')
console.log(reply)
// "The workspace contains: README.md, src/, package.json"
```

### Multi-step demo: README emoji

```js
// This may take several seconds as the agent reads + writes the file.
const result = await window.__tool.chat(
  'Read README.md, add an emoji to the title line, and write it back.'
)
console.log(result)
// "Done. The title now reads '# 🛠️ SGraph Bridge'."
```

### Get the full conversation transcript

```js
const turns = window.__tool.getTranscript()
// Array of turn objects: user / assistant / tool
turns.forEach(t => console.log(t.role, t.content?.slice(0, 60)))
```

### Check bridge status

```js
const status = window.__tool.getBridgeStatus()
// { ok: true, latency_ms: 8, workspace: '/workspace', version: '0.1.0' }
// null if bridge has not been pinged yet
```

### Switch provider or model

```js
window.__tool.setProvider('openrouter')
window.__tool.setModel('anthropic/claude-3-haiku')

// Switch back to Ollama
window.__tool.setProvider('ollama')
window.__tool.setModel('qwen2.5-coder:7b')
```

### Clear conversation history

```js
window.__tool.clearChat()
// Dispatches llm:clear-history; turns reset to empty
```

---

## Full Playwright Example

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page    = await browser.newPage()
await page.goto('http://localhost:8080/agent-with-tools/')

// Wait for JS API + bridge
await page.waitForFunction(() => !!window.__tool)
await page.waitForFunction(() => window.__tool.getBridgeStatus()?.ok === true, { timeout: 10000 })

// Send a task
const reply = await page.evaluate(async () => {
    return window.__tool.chat('Create a file called test.txt with the content "hello from playwright"')
})
console.log('Agent replied:', reply)

// Verify the transcript
const turns = await page.evaluate(() => window.__tool.getTranscript())
console.log('Turn count:', turns.length)

await browser.close()
```

---

## Bus Event Names

These events fire on the `[data-llm-bus]` element (`<main data-llm-bus>`):

| Event | Direction | Detail |
|---|---|---|
| `llm:chat-message` | In → loop | `{ role: 'user', content: string }` |
| `llm:clear-history` | In → loop | (none) |
| `llm:system-prompt` | In → loop | `{ content: string }` |
| `llm:response-complete` | Out ← loop | `{ content: string }` |
| `llm:tool-defs-changed` | Out ← tool-def | (none) |
| `llm:stats` | Out ← request | `{ tokens_per_second: number }` |
| `sg-local-bridge:status` | Out ← bridge | `{ ok, version, workspace, latency_ms }` |
| `sg-local-bridge:tool-call` | Out ← bridge | `{ name, args, result, ms }` |
| `sg-local-bridge:error` | Out ← bridge | `{ message, detail }` |
| `agentic-loop:start` | Out ← loop | — |
| `agentic-loop:iteration` | Out ← loop | `{ iteration, max_iterations, cost }` |
| `agentic-loop:paused` | Out ← loop | — |
| `agentic-loop:done` | Out ← loop | `{ tool_calls, cost }` |
| `agentic-loop:error` | Out ← loop | `{ message }` |
| `agentic-loop:approve` | In → loop | (none) — resume from paused |
| `agentic-loop:stop` | In → loop | (none) — abort running loop |

---

## Meta API

```js
// All registered method names
window.__tool.meta.getMethods()

// Manifest JSON
await window.__tool.meta.getManifest()

// SKILL file contents
const skills = await window.__tool.meta.getSkills()
console.log(skills.human)

// Tool version
window.__tool.meta.getVersion()   // '0.1.58'

// Recent call log
window.__tool.meta.getLog()
```
