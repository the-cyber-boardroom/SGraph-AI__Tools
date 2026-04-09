# Infographic Generator — API Capability Spec

**Tool:** infographic-generator
**Version:** ui=0.1.29, api=0.1.0, content=0.1.0
**Instance ID pattern:** `infographic-generator:{panelId}` (panelId='root' for standalone pages)
**Environment:** browser only (HTTPS or localhost required)
**Registry key:** `window.__tool` / `window.__tools['infographic-generator:root']`

---

## Identity

```
name:        infographic-generator
slug:        infographic-gen
category:    ai
status:      live
url-pattern: /en-gb/infographic-gen/
```

---

## Methods

### connect

Validates an OpenRouter API key and establishes the model connection.

```
signature:   connect({ apiKey?, model? }) → Promise<{ model, provider }>
async:       true
timeout:     15 seconds
side-effects:
  - sets apiKeyEl.value if apiKey provided
  - calls modelPicker.setModel() if model provided
  - fires tool:connected window event on success
  - fires llm:connected bus event (consumed by sg-llm-request)
errors:
  - Error('Connection timeout') if OpenRouter does not respond in 15s
  - Error('HTTP {status}') if OpenRouter returns non-200
params:
  apiKey  string  optional  OpenRouter API key (sk-or-v1-...)  secret=true
  model   string  optional  Model ID (e.g. 'google/gemini-2.0-flash-exp:free')
returns:
  model    string  Active model ID
  provider string  Always 'openrouter'
```

### generate

Fires a generation and returns a Promise that resolves when complete.

```
signature:   generate({ prompt?, model? }) → Promise<detail>
async:       true
queue:       FIFO — concurrent calls resolve in order of completion
side-effects:
  - sets textarea.value if prompt provided
  - sets modelPicker model if model provided
  - creates a new result tab in the right panel
  - fires tool:generation:started, tool:generation:complete (or error/cancelled)
errors:
  - Error('No prompt — set a prompt first') if textarea is empty
  - Error('Not connected — call connect() first') if no API key
  - Error('Generation failed') on REQUEST_ERROR
  - Error('Generation cancelled') on REQUEST_CANCEL
params:
  prompt  string  optional  Text prompt (sets textarea value)
  model   string  optional  Model ID override
returns:
  instanceId    string        'infographic-generator:root'
  generationId  string|null   OpenRouter generation ID (null if unavailable)
  model         string        Model used
  duration      number        Wall-clock seconds from send to complete
  imageSrc      string|null   data: or https: image URL; null for SVG/text models
```

### getState

Returns a snapshot of all current UI state.

```
signature:   getState() → object
async:       false
params:      none
returns:
  mode               'text'|'document'   Current input mode
  prompt             string              Current textarea value
  model              string              Current model ID
  connected          boolean             True if API key is set
  activeGenerations  number              Count of in-flight requests
  systemPrompt       string              Current system prompt (default or override)
  document           object|null         { name, type } if document loaded, else null
```

### setPrompt / getPrompt

```
setPrompt(text: string) → void
  Sets textarea value and saves to localStorage.

getPrompt() → string
  Returns current textarea value.
```

### setModel / getModel

```
setModel(id: string) → void
  Sets the model picker selection.
  Note: model must be a valid ID from the curated list.

getModel() → string
  Returns current model ID.
```

### setTemplate

Loads a built-in prompt template into the textarea.

```
signature:   setTemplate(nameOrId: string) → string
async:       false
params:
  nameOrId  string  Template id (preferred) or label (case-insensitive)
returns:    string  The prompt text that was loaded
errors:
  - Error('Unknown template: "..."') with code UNKNOWN_TEMPLATE if not found

available templates:
  id            label
  executive     Executive Summary
  architecture  Architecture
  timeline      Timeline
  comparison    Comparison
  process       Process Flow
  stats         Stats Dashboard
  mindmap       Mind Map
```

### stop

```
signature:   stop() → void
async:       false
side-effects: cancels all active generations (calls cancel on each mini-bus)
```

---

## Window Events

All events dispatched on `window`. All include `instanceId` in detail.

```
tool:ready
  when:   page load, after api.activate()
  detail: { instanceId, tool, version: { api, ui, content } }

tool:connected
  when:   successful OpenRouter API key validation
  detail: { instanceId, provider: 'openrouter', model }

tool:generation:started
  when:   SEND event fired (before network request)
  detail: { instanceId, generationId: null, model, prompt }
  note:   generationId is always null at start (assigned by OpenRouter, arrives at complete)

tool:generation:complete
  when:   LLM response received and rendered
  detail: { instanceId, generationId: string|null, model, duration: number, imageSrc: string|null }

tool:generation:error
  when:   network error or provider error
  detail: { instanceId, generationId: null, model, error: string }

tool:generation:cancelled
  when:   user clicks Cancel or stop() is called
  detail: { instanceId, generationId: null }
```

---

## Known Limitations

```
concurrent-generate:
  FIFO queue — first complete resolves first pending generate() call.
  For true parallel tracking, listen to tool:generation:complete events directly.

imageSrc-null:
  SVG/text models return SVG markup as text content, not an image URL.
  imageSrc will be null. The SVG is rendered in the result tab DOM.

renderUI-false:
  Headless mode (suppressing UI tab creation) is not implemented.
  Every generate() call creates a visible result tab.

connect-re-validates:
  Each connect() call hits OpenRouter /models endpoint.
  No caching. Intentional for key rotation.

panel-detection:
  panelId auto-detection from DOM uses document.currentScript.closest('[data-panel-id]').
  In top-level module scripts this is always null → falls back to 'root'.
  Multi-panel pages should use window.__tool_registry.findAll().

sg-layout-warnings:
  Console shows "[sg-layout] Could not resolve panel for registered element" (3 warnings).
  These come from sg-openrouter-generation's internal sg-layout registering with the outer one.
  Does not affect functionality. Known fractal-nesting limitation in sg-layout current version.
```

---

## Dependencies

```
core:
  sg-layout     /core/sg-layout/v0.1.0/sg-layout.js
  sg-tool-api   /core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js

components:
  sg-llm-request              /components/llm/sg-llm-request/v0/v0.1/v0.1.2/
  sg-llm-stats                /components/llm/sg-llm-stats/v0/v0.1/v0.1.1/
  sg-llm-infographic          /components/llm/sg-llm-infographic/v0/v0.1/v0.1.0/
  sg-openrouter-generation    /components/openrouter/sg-openrouter-generation/v0/v0.1/v0.1.1/
  sg-infographic-model-picker /components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/
  sg-infographic-export       /components/infographic/sg-infographic-export/v0/v0.1/v0.1.0/

shared:
  sg-site-header   /components/site-header/v1/v1.0/v1.0.2/
  sg-tool-manifest ../../_common/js/sg-tool-manifest.js
```
