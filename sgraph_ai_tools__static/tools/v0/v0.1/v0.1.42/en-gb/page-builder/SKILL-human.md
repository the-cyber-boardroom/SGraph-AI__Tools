# SG/Send Theme Explorer — Human Guide

**Tool:** SG/Send Theme Explorer v0.1.42
**URL:** `/en-gb/page-builder/`

## What This Tool Does

Build, preview, and refine `_page.json` files before dropping them into a vault. The left
panel is a JSON editor; the right panel renders the page live using the same renderer as the
SG/Send Browse component — no iframe, no separate server.

---

## Quick Start

1. The demo JSON loads automatically. It shows all the common block types rendered with the
   default theme.
2. **Edit the JSON** in the textarea — the preview updates within 200 ms.
3. **Switch themes** using the dropdown above the textarea.
4. Click a **palette chip** to append a default block of that type.
5. When satisfied, click **📋 Copy JSON** and paste it into a vault as `_page.json`.

---

## Theme Picker

Six named schemes are available:

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

Three buttons in the preview toolbar resize the preview container:

- **🖥 Desktop** — full width (default)
- **⬜ Tablet** — 768 px max-width
- **📱 Phone** — 375 px max-width

Use this to verify responsive behaviour before sharing.

---

## Component Palette

Click any chip to append a default block of that type to the JSON's `blocks` array:

`hero` `section` `text` `markdown` `title` `bullet-points`
`callout` `stats` `quote` `author` `cards` `columns` `navigation`

After inserting, edit the block directly in the textarea.

---

## _page.json Structure

```json
{
  "title": "Page title (shown in browser tab)",
  "theme": {
    "mode":       "light",
    "accent":     "#4ecdc4",
    "font":       "sans",
    "background": "#ffffff"
  },
  "blocks": [
    { "type": "hero", "title": "...", "subtitle": "..." },
    {
      "type": "section",
      "title": "...",
      "blocks": [
        { "type": "text", "content": "..." },
        { "type": "bullet-points", "items": ["...", "..."] }
      ]
    }
  ]
}
```

Blocks are rendered in order. Sections act as containers for other blocks.

---

## Common Block Reference

| Type | Required fields | Notes |
|---|---|---|
| `hero` | `title` | `subtitle`, `height` (small/medium/large/full), `style` |
| `section` | `title`, `blocks[]` | Container; all other blocks go inside sections |
| `text` | `content` | Plain text paragraph |
| `markdown` | `content` | Full markdown: bold, italic, code, tables, links |
| `title` | `content` | Heading; `level` 1–6 |
| `bullet-points` | `items[]` | Unordered list |
| `callout` | `text` | `style`: info / warning / success / tip; `title` optional |
| `stats` | `items[]` | Each item: `value`, `label`, optional `delta`, `trend` (up/down) |
| `quote` | `text` | `author`, `role` optional |
| `author` | `name` | `role`, `date` optional |
| `cards` | `items[]` | Each item: `title`, `desc`, optional `image`, `link`; `cols` (default 3) |
| `columns` | `cols[]` | Each col has its own `blocks[]`; `gap` (none/small/medium/large) |
| `navigation` | `items[]` | Each item: `label`, `anchor` |

---

## Tips

- **JSON errors** turn the textarea border red and show the error below — fix and the preview restores
- **Load Demo** resets the editor to the full demo JSON at any time
- **Clear** starts from an empty page with the default theme
- The `theme.background` property sets the preview container background colour
- Images in blocks must use external https:// URLs — vault-relative paths require a vault connection
- The tool is stateless — nothing is saved between reloads; export via **Copy JSON** before closing
