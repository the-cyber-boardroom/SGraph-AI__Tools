# Markdown Viewer — for people

Open a markdown file and read it the way it was meant to look. Then print it, or
save it as a PDF.

**<https://tools.sgraph.ai/en-gb/markdown-viewer/>**

Nothing you open is uploaded. The file is read by your browser, rendered in the
tab, and never sent anywhere.

---

## Opening a document

Four ways in, all equivalent:

| | How |
|---|---|
| **Drop** | Drag a `.md` file anywhere onto the page — including while another document is already open |
| **Choose** | Click the drop area to pick a file |
| **URL** | Paste a link to a raw markdown file and press Open |
| **Paste** | Drop the text itself into the paste box |

You can also link straight to a document:

```
https://tools.sgraph.ai/en-gb/markdown-viewer/?url=https://example.com/README.md
```

**A note on URLs.** Your browser does the fetching, so the far host has to permit
cross-origin reads. GitHub's `raw.githubusercontent.com` does. Many sites do not,
and there is no server here to fetch on your behalf — that is the trade for the
tool never seeing your files. When a fetch is blocked you get a clear message
rather than an empty page; download the file and drop it in instead.

---

## Reading

- **The outline** on the left lists every heading. Click one to jump. It appears
  once a document has at least two headings, and hides itself on narrow screens.
- **Source** swaps the rendered document for the raw markdown, byte for byte.
- **Wide** drops the reading-measure cap and uses the full window — useful for
  documents that are mostly wide tables.
- **Close** clears the document and returns you to the opening screen.

Source and Wide are remembered between visits. Which document you had open is
not — the tool holds nothing after you close the tab.

---

## Printing

Press **Print** (or ⌘/Ctrl-P). Your browser's print dialog opens, where "Save as
PDF" is one of the destinations.

What prints is the document alone: the toolbar, the outline and the site header
are all dropped. Code blocks wrap instead of scrolling, tables and images avoid
being split across a page boundary, and the whole thing switches to black text on
white. If you press Print while the Source view is open you still get the
rendered document, not a wall of monospace.

### Page breaks

A document can say where its pages should end. Put this at the very top:

```markdown
---
title: My Report
page_break_before: h1
---
```

Now every `#` heading starts a new page. `page_break_before: [h1, h2]` breaks on
both levels; `true` is shorthand for `h1`.

For a break at one exact spot, put this on its own line in the body:

```markdown
<!-- page-break -->
```

Breaks show on screen as a labelled dashed line, so you can see where the paper
will end before you print. Those labels do not print.

You can also fine-tune the printed styling from the document itself:

```markdown
---
print_css: |
  h2 { color: navy; }
  .md-table { font-size: 9pt; }
---
```

When a document carries front matter, a small strip above the content shows what
it asked for. It never prints.

---

## What it renders

Headings `#` to `######` · **bold** · *italic* · `***both***` · ~~strikethrough~~ ·
`inline code` · fenced code blocks · links · images (with `![alt|400](x.png)`
sizing) · bullet and numbered lists, including items that wrap over several lines ·
blockquotes, which can contain their own headings and lists · tables with `:---:`
column alignment · horizontal rules · front matter · page breaks.

**Raw HTML in a document is shown as text, never rendered.** That is deliberate:
it means opening a markdown file from someone you do not know cannot run anything
in your browser. `javascript:` links are shown as plain text too.

---

## If something looks wrong

| What you see | Why |
|---|---|
| "Could not fetch…" | The host does not allow cross-origin reads. Download the file and drop it in. |
| A table rendered as plain text | A pipe table needs its `\|---\|---\|` separator row directly under the header. |
| `<div>` showing as text | Working as intended — raw HTML is escaped, not rendered. |
| A heading missing from the outline | The outline hides itself below two headings. |
