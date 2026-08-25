# Mermaid Diagrams — API Reference

Machine-readable capability spec for agents and integrations.

**Global:** `window.__tool`
**Event:** `tool:ready` fires when `window.__tool` is available
**Tool name:** `mermaid-diagrams`
**Version:** `0.1.57`

---

## Methods

### render(markup)
- **Type:** async
- **Params:** `markup: string` — Mermaid diagram source text
- **Returns:** `Promise<{ svg: string, markup: string }>`
- **Throws:** if markup is empty or Mermaid fails to parse
- **Side-effects:** updates editor, triggers preview
- **Notes:** Lazy-loads Mermaid v11 from CDN on first call (~300 KB)

### getMarkup()
- **Type:** sync
- **Returns:** `string` — current editor content (may be empty)

### setMarkup(markup)
- **Type:** sync
- **Params:** `markup: string`
- **Returns:** `void`
- **Side-effects:** sets editor value, fires `sg-mermaid:markup-changed`, triggers debounced render

### loadDemo(id)
- **Type:** sync
- **Params:** `id: string` — one of the demo IDs listed by `getDemos()`
- **Returns:** `{ id: string, type: string, label: string, description: string }`
- **Throws:** if id not found
- **Side-effects:** loads markup into editor, fires `sg-mermaid:demo-selected`, triggers render

### getDemos()
- **Type:** sync
- **Returns:** `Array<{ id: string, type: string, label: string, description: string }>`
- **Notes:** Returns all 8 built-in demos; markup excluded (use `loadDemo(id)` to get it)

### exportSvg()
- **Type:** sync
- **Returns:** `string | null` — current rendered SVG, or null if nothing rendered

### exportPng()
- **Type:** async
- **Returns:** `Promise<string | null>` — PNG as `data:image/png;base64,…`, or null
- **Notes:** Rasterises via Canvas API. Background filled with `#0a0a18`. Requires a rendered diagram.

### getState()
- **Type:** sync
- **Returns:** `{ markup: string, hasRendered: boolean, theme: string }`

---

## Events

All events bubble and are composed (cross shadow-DOM).

### sg-mermaid:rendered
- **Source:** `<sg-mermaid-render>` element
- **Detail:** `{ markup: string, svg: string }`
- **Fired:** after each successful Mermaid render

### sg-mermaid:error
- **Source:** `<sg-mermaid-render>` element
- **Detail:** `{ markup: string, error: string }`
- **Fired:** when Mermaid fails to parse or render markup

### sg-mermaid:markup-changed
- **Source:** `<sg-mermaid-editor>` element
- **Detail:** `{ markup: string }`
- **Fired:** debounced (600 ms) on every editor keystroke, and immediately on `setValue()`

### sg-mermaid:demo-selected
- **Source:** `<sg-mermaid-demos>` element
- **Detail:** `{ id: string, type: string, label: string, markup: string }`
- **Fired:** when a demo card is clicked or `selectDemo(id)` is called

### tool:ready
- **Source:** `window`
- **Detail:** none
- **Fired:** once when `window.__tool` is populated

---

## Demo IDs

| id | type | label |
|---|---|---|
| `flowchart-api` | Flowchart | API Auth Flow |
| `sequence-login` | Sequence | Login Sequence |
| `class-domain` | Class | Domain Model |
| `state-task` | State | Task Lifecycle |
| `er-blog` | ER Diagram | Blog Schema |
| `gantt-sprint` | Gantt | Sprint Timeline |
| `mindmap-sgraph` | Mind Map | SGraph Ecosystem |
| `gitgraph-feature` | Git Graph | Feature Branch Flow |

---

## Components

| Element | Module | Description |
|---|---|---|
| `<sg-mermaid-render>` | `sg-mermaid-render.js` | Renderer with zoom + fullscreen |
| `<sg-mermaid-editor>` | `sg-mermaid-editor.js` | Monospace textarea with Copy/Clear |
| `<sg-mermaid-demos>` | `sg-mermaid-demos.js` | Scrollable demo card gallery |

---

## Known Limitations

- Mermaid v11 is loaded from `cdn.jsdelivr.net` — requires internet on first use; subsequent renders use the cached module
- PNG export rasterises at the SVG's intrinsic pixel size; very large diagrams may produce very large files
- The `theme` attribute on `<sg-mermaid-render>` only takes effect on the first render (Mermaid initialises once per page load)
- No server round-trip; all processing is client-side
