# SG/Send Theme Explorer — Human Guide

**Tool:** SG/Send Theme Explorer v0.1.42
**URL:** `/en-gb/page-builder/`

## What This Tool Does

Build, preview, and refine `_page.json` files before dropping them into a vault. The left
panel is a JSON editor; the right panel renders the page live using the same renderer as the
SG/Send Browse component — no iframe, no separate server.

---

## Quick Start

1. The demo JSON loads automatically. It shows the common component types rendered with the
   default theme.
2. **Edit the JSON** in the textarea — the preview updates within 200 ms.
3. **Switch themes** using the dropdown or click a swatch chip in the row below it.
4. Click a **palette chip** to append a default component of that type.
5. When satisfied, click **📋 Copy JSON** and paste it into a vault as `_page.json`.

---

## Theme Picker

Six named schemes are available. Use the dropdown **or** the visual swatch row — each chip
shows the accent colour dot and the page background square side by side:

| Scheme | Mode | Accent | Feel |
|---|---|---|---|
| **default** | light | teal `#4ecdc4` | Clean, modern |
| **navy** | light | blue `#1a8fe0` | Professional |
| **slate** | light | brown `#a0522d` | Warm serif |
| **minimal** | light | black `#111111` | Typography-first |
| **brand** | light | teal `#4ecdc4` | Soft teal tint background |
| **dark-deck** | dark | indigo `#7b9ef5` | Dark presentation |

Selecting a theme replaces the `theme` object in the JSON and re-renders.
The JSON remains the source of truth — you can also edit `theme` directly in the textarea.

---

## Viewport Switcher

Three buttons in the preview toolbar resize the preview canvas:

- **🖥 Desktop** — full width (default)
- **⬜ Tablet** — 768 px max-width
- **📱 Phone** — 375 px max-width

The dark stage area always fills the full panel height. In Phone/Tablet mode the narrow canvas
is centred with stage visible on both sides — this gives a clear visual boundary of what
recipients see at each breakpoint.

---

## Component Palette

Click any chip to append a default component of that type to the JSON's `components` array:

`hero` `section` `text` `markdown` `title` `bullet-points`
`callout` `stats` `quote` `author` `cards` `columns` `image` `pdf`

The `navigation` chip is special: it inserts an item into `page.navigation` (the top-level
sticky nav array), not into `page.components`.

After inserting, edit the component directly in the textarea.

---

## _page.json Structure

```json
{
  "title": "Page title (shown in browser tab and auto-banner)",
  "theme": {
    "mode":       "light",
    "accent":     "#4ecdc4",
    "font":       "sans",
    "background": "#ffffff"
  },
  "navigation": [
    { "label": "Section 1", "anchor": "#section-1" }
  ],
  "components": [
    { "type": "hero", "title": "...", "subtitle": "..." },
    {
      "type": "section",
      "title": "...",
      "children": [
        { "type": "text", "content": "..." },
        { "type": "bullet-points", "items": ["...", "..."] }
      ]
    }
  ]
}
```

**Key field names (critical):**
- Top-level component list → `"components"` (not `"blocks"`)
- Items nested inside `section` or `columns` → `"children"` (not `"blocks"`)
- `"navigation"` is a separate top-level array rendered as a sticky nav bar

The auto-banner (page title + "Page Layout" badge + close button) renders automatically at the
top of every page. Add `"banner": false` at the top level to suppress it.

---

## Component Reference

| Type | Required fields | Notes |
|---|---|---|
| `hero` | `title` | `subtitle`, `height` (small/medium/large/full) |
| `section` | `title`, `children[]` | Container; `children` holds nested components |
| `text` | `content` | Plain text paragraph |
| `markdown` | `content` | Full markdown: bold, italic, code, tables, links |
| `title` | `content` | Heading; `level` 1–6 |
| `bullet-points` | `items[]` | Unordered list |
| `callout` | `text` | `style`: info / warning / success / tip; `title` optional |
| `stats` | `items[]` | Each item: `value`, `label`, optional `delta`, `trend` (up/down) |
| `quote` | `text` | `author`, `role` optional |
| `author` | `name` | `role`, `date` optional |
| `cards` | `items[]` | Each item: `title`, `desc`, optional `image`, `link`; `cols` (default 3) |
| `columns` | `children[]`, `ratio` | Each child is a full component; `ratio`: 1:1, 1:2, 2:1, etc. |
| `image` | `src` | `alt`, `caption` optional; use https:// URLs |
| `pdf` | `src` | `label` optional; use https:// URLs |
| `banner` | `title` | Replaces the auto-banner if placed first in `components` |

---

## Tips

- **JSON errors** turn the textarea border red and show the error below — fix and the preview restores
- **Load Demo** resets the editor to the full demo JSON at any time
- **Clear** starts from an empty page with the default theme
- The `theme.background` property sets the canvas background colour
- Images and PDFs must use external `https://` URLs — vault-relative paths require a vault connection
- The tool is stateless — nothing is saved between reloads; export via **Copy JSON** before closing
- The dark stage behind the canvas always shows the full available space — use Phone mode to see the
  responsive breakpoints in action before sharing
