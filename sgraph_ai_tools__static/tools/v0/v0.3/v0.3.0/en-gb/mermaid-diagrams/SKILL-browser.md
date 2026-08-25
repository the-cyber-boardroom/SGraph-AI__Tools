# Mermaid Diagrams — Browser / Agent Guide

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

### Render a diagram and get the SVG

```js
const result = await window.__tool.render(`
flowchart LR
    A[Input] --> B[Process] --> C[Output]
`)
console.log(result.svg)   // full SVG string
console.log(result.markup) // echo of input
```

### Load a built-in demo

```js
// List all demos
const demos = await window.__tool.getDemos()
// [{ id, type, label, description }, …]

// Load one by id — loads into editor + renders
const demo = await window.__tool.loadDemo('gitgraph-feature')
console.log(demo.label)  // 'Feature Branch Flow'
```

### Read / write the editor

```js
// Set markup (triggers auto-render)
await window.__tool.setMarkup(`pie title Browser Share
    "Chrome" : 63
    "Safari" : 19
    "Firefox" : 4
    "Other" : 14`)

// Get current markup
const markup = await window.__tool.getMarkup()
```

### Export SVG or PNG

```js
// SVG string (null if nothing rendered yet)
const svg = await window.__tool.exportSvg()

// PNG as data URL — rasterised via Canvas
const png = await window.__tool.exportPng()

// Download helper
const a = document.createElement('a')
a.href = png
a.download = 'diagram.png'
a.click()
```

---

## Full Playwright Example

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page    = await browser.newPage()
await page.goto('https://tools.sgraph.ai/en-gb/mermaid-diagrams/')

// Wait for JS API
await page.waitForFunction(() => !!window.__tool)

// Render a sequence diagram
const result = await page.evaluate(async () => {
    return window.__tool.render(`sequenceDiagram
        Alice->>Bob: Hello Bob
        Bob-->>Alice: Hi Alice`)
})
console.log('SVG length:', result.svg.length)

// Export PNG
const pngDataUrl = await page.evaluate(() => window.__tool.exportPng())
// pngDataUrl is a data:image/png;base64,… string

// State snapshot
const state = await page.evaluate(() => window.__tool.getState())
console.log(state)
// { markup: '…', hasRendered: true, theme: 'dark' }

await browser.close()
```

---

## Event Listening

```js
// Fired each time a diagram renders successfully
document.addEventListener('sg-mermaid:rendered', e => {
    console.log('Rendered! SVG length:', e.detail.svg.length)
})

// Fired on Mermaid parse / render errors
document.addEventListener('sg-mermaid:error', e => {
    console.error('Render error:', e.detail.error)
})

// Fired each time the editor content changes (debounced)
document.addEventListener('sg-mermaid:markup-changed', e => {
    console.log('Markup changed, length:', e.detail.markup.length)
})

// Fired when a demo card is clicked
document.addEventListener('sg-mermaid:demo-selected', e => {
    console.log('Demo selected:', e.detail.id, e.detail.type)
})
```

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
console.log(skills.browser)
console.log(skills.api)

// Tool version
window.__tool.meta.getVersion()   // '0.1.57'

// Recent call log (ring buffer, max 500 entries)
window.__tool.meta.getLog()
```
