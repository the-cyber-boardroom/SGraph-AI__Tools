# Mermaid Diagrams — Human Guide

A browser-based tool for creating, editing, and previewing Mermaid diagrams. Everything runs locally — no server, no data sent anywhere.

---

## Quick Start

1. **Open the tool** at `tools.sgraph.ai/en-gb/mermaid-diagrams/`
2. **Pick an example** from the **🎨 Examples** tab on the left
3. The diagram renders live in the **📊 Preview** panel on the right
4. Switch to the **✏️ Editor** tab to modify the markup
5. Changes render automatically after you stop typing (600 ms debounce)

---

## Built-in Examples

| ID | Type | What it shows |
|---|---|---|
| `flowchart-api` | Flowchart | API gateway with auth decision, cache, DB |
| `sequence-login` | Sequence | Browser → API → DB login flow |
| `class-domain` | Class | User / Post / Comment domain model |
| `state-task` | State | Task lifecycle (Backlog → Done) |
| `er-blog` | ER Diagram | Blog platform schema with tags |
| `gantt-sprint` | Gantt | Two-week sprint timeline |
| `mindmap-sgraph` | Mind Map | SGraph ecosystem overview |
| `gitgraph-feature` | Git Graph | Feature branch merge workflow |

---

## Editor Tips

- **Tab key** inserts 2 spaces (useful for indenting `flowchart` and `mindmap`)
- **Copy button** copies the current markup to the clipboard
- **Clear button** empties the editor (the preview clears too)
- **Clear editor** button below the editor provides a quick reset

---

## Preview Panel Controls

- **− / +** — Zoom out / in (step: 15%)
- **Fit** — Reset zoom to 100%
- **⛶ Fullscreen** — Opens the SVG in a full-screen overlay with its own zoom controls; press **Esc** to close

---

## Exporting Your Diagram

Via the JS API console (open the footer bar):

```js
// Get SVG string
const svg = await window.__tool.exportSvg()

// Get PNG as data URL
const png = await window.__tool.exportPng()

// Trigger download
const a = document.createElement('a')
a.href = png
a.download = 'diagram.png'
a.click()
```

---

## Supported Diagram Types

All diagram types supported by Mermaid v11 work here:

- `flowchart` / `graph` — directed and undirected graphs
- `sequenceDiagram` — actors and message arrows
- `classDiagram` — OOP class structure
- `stateDiagram-v2` — finite state machines
- `erDiagram` — entity-relationship schemas
- `gantt` — project timelines
- `mindmap` — hierarchical mind maps
- `gitGraph` — branch/commit visualisation
- `pie` — pie charts
- `xychart-beta` — bar and line charts
- `timeline` — chronological events
- `quadrantChart` — 2×2 priority matrices

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Diagram error" in red | Check Mermaid syntax — copy the markup to the Mermaid Live Editor for detailed errors |
| Preview is blank | Make sure the markup is not empty; the preview clears when the editor is empty |
| Diagram too small | Use the **+** zoom button or open **Fullscreen** |
| Mermaid library loading… | First render lazy-loads ~300 KB from CDN; subsequent renders are instant |
