# SG/Send Theme Explorer — API Reference

**Tool:** SG/Send Theme Explorer v0.1.42
**API version:** `0.1.0`
**Access:** `window.__tool` (available after page load)

---

## API Actions

### `setJson(json)`

Load a `_page.json` into the editor and trigger a re-render.

| Param | Type | Description |
|---|---|---|
| `json` | `string \| object` | JSON string or parsed object. Must follow the `_page.json` schema. |

Returns: `void`

```javascript
window.__tool.call('setJson', {
    title: 'My Page',
    theme: { mode: 'light', accent: '#4ecdc4', font: 'sans', background: '#ffffff' },
    components: [
        { type: 'hero', title: 'Hello' }
    ]
});
```

---

### `getJson()`

Return the current JSON from the textarea, parsed.

Returns: `object | null` — the parsed JSON, or `null` if the current content is invalid.

```javascript
const json = window.__tool.call('getJson');
```

---

### `setTheme(name)`

Switch to a named theme scheme. Updates the `theme` object in the JSON and re-renders.

| Param | Type | Description |
|---|---|---|
| `name` | `string` | One of: `default`, `navy`, `slate`, `minimal`, `brand`, `dark-deck` |

Returns: `void`  
Throws: `Error` if `name` is not a recognised scheme.

```javascript
window.__tool.call('setTheme', 'dark-deck');
```

---

### `getTheme()`

Return the currently selected theme name.

Returns: `string` — one of the 6 named schemes.

```javascript
const theme = window.__tool.call('getTheme'); // e.g. "default"
```

---

### `render()`

Force an immediate re-render from the current textarea content.

Returns: `Promise<void>` — resolves after `PageLayoutRenderer.render()` completes.

```javascript
await window.__tool.call('render');
```

Use this if you directly modify the textarea value without going through `setJson`.

---

### `getState()`

Return a snapshot of the current tool state.

Returns:
```typescript
{
    theme:    string,   // current theme name
    viewport: string,   // "desktop" | "tablet" | "phone"
    valid:    boolean,  // true if textarea contains valid JSON
    prompt:   null      // reserved; always null for page-builder
}
```

```javascript
const { theme, viewport, valid } = window.__tool.call('getState');
```

---

## _page.json Schema

```json
{
  "title":      "string — page title, shown in auto-banner",
  "banner":     "boolean — set false to suppress the auto-banner",
  "theme": {
    "mode":       "light | dark",
    "accent":     "#hex — CSS colour for accent elements",
    "font":       "sans | serif | mono | system",
    "background": "#hex — canvas background colour",
    "density":    "compact | comfortable | spacious (optional)"
  },
  "navigation": [
    { "label": "string", "anchor": "#id-string" }
  ],
  "components": [
    { "type": "hero",          "title": "...", "subtitle": "..." },
    { "type": "section",       "title": "...", "children": [ ... ] },
    { "type": "text",          "content": "..." },
    { "type": "markdown",      "content": "..." },
    { "type": "title",         "content": "...", "level": 2 },
    { "type": "bullet-points", "items": ["..."] },
    { "type": "callout",       "style": "info|warning|success|tip", "title": "...", "text": "..." },
    { "type": "stats",         "items": [{ "value": "42", "label": "..." }] },
    { "type": "quote",         "text": "...", "author": "...", "role": "..." },
    { "type": "author",        "name": "...", "role": "..." },
    { "type": "cards",         "cols": 3, "items": [{ "title": "...", "desc": "..." }] },
    { "type": "columns",       "ratio": "1:1", "gap": "medium", "children": [ ... ] },
    { "type": "image",         "src": "https://...", "alt": "..." },
    { "type": "pdf",           "src": "https://...", "label": "..." },
    { "type": "banner",        "title": "..." }
  ]
}
```

**Field name rules:**
- Top-level component list → `"components"` (not `"blocks"`)
- Nested items inside `section` or `columns` → `"children"` (not `"blocks"`)
- `"navigation"` is a separate top-level array for the sticky nav bar

---

## Theme Schemes

| Name | `mode` | `accent` | `font` | `background` |
|---|---|---|---|---|
| `default` | light | `#4ecdc4` | sans | `#ffffff` |
| `navy` | light | `#1a8fe0` | sans | `#f7f9fc` |
| `slate` | light | `#a0522d` | serif | `#faf9f7` |
| `minimal` | light | `#111111` | serif | `#ffffff` |
| `brand` | light | `#4ecdc4` | sans | `#f6fefe` |
| `dark-deck` | dark | `#7b9ef5` | sans | `#141820` |

---

## getMethods() output

```javascript
window.__tool.getMethods();
// Returns:
[
  { name: 'setJson',   async: false, params: ['json'] },
  { name: 'getJson',   async: false, params: [] },
  { name: 'setTheme',  async: false, params: ['name'] },
  { name: 'getTheme',  async: false, params: [] },
  { name: 'render',    async: true,  params: [] },
  { name: 'getState',  async: false, params: [] },
]
```
