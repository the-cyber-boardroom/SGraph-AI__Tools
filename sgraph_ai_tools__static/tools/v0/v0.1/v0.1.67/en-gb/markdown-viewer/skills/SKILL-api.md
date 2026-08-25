# Markdown Viewer — JS API

`window.__tool` is live once `tool:ready` has fired. No key, no account, and no
network at all unless you call `loadUrl`.

```js
await new Promise(r => document.addEventListener('tool:ready', r, { once: true }));
const t = window.__tool;
```

**Every action returns a Promise, including the synchronous ones.** SgToolApi
wraps them all, so `t.getStatus()` is a Promise, not an object. Always `await`.

---

## Loading

```js
await t.loadText({ text: '# Hi\n\nSome **markdown**.', name: 'notes.md' });
await t.loadFile({ file: someFileOrBlob });          // no user gesture needed
await t.loadUrl({ url: 'https://raw.githubusercontent.com/o/r/main/README.md' });
```

All three return `{ name, bytes, headings, config }`. A `title:` in the
document's front matter overrides the `name` you passed — the document's own
idea of what it is called wins.

`loadUrl` is a plain `fetch` from the page, so a cross-origin document needs
CORS headers from the far host. There is no proxy, by design.

## Reading

```js
await t.getStatus();        // { loaded, name, bytes, loadedFrom, headings, config, showSource, wide, pageBreakBefore }
await t.getSource();        // the raw markdown, front matter included
await t.getHtml();          // the rendered HTML
await t.getHeadings();      // [{ level, text, id }]
await t.getFrontMatter();   // {} when the document has none
```

## Rendering without loading

`renderToHtml` is the parser as a pure function. It returns HTML and changes
nothing on screen — useful when you want markdown rendered but the reader is
looking at something else.

```js
const { html, headings, config } = await t.renderToHtml({
    text: '# Report\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    options: { headingIds: false, imageSrc: 'deferred' },
});
```

`options` are passed straight through to `core/markdown`'s `parseMarkdown`:
`pageBreakBefore`, `imageSrc` (`'direct'` | `'deferred'`), `headingIds`,
`frontMatterBadge`.

## View and print

```js
await t.setSourceView({ source: true });   // omit `source` to toggle
await t.setOptions({ wide: true });
await t.setOptions({ pageBreakBefore: ['h1', 'h2'] });   // overrides the document
await t.setOptions({ pageBreakBefore: null });           // hand control back to it
await t.print();                            // opens the browser print dialog
await t.clear();
```

`setSourceView` and `setOptions({wide})` persist to localStorage;
`pageBreakBefore` does not, because it belongs to the document.

**`print()` opens a modal browser dialog that script cannot dismiss.** In an
automated run, either stub `window.print` before navigation or assert on the
`mv:print:opened` event instead of calling it.

---

## Events

All on `document`, all bubbling.

| Event | When | `detail` |
|---|---|---|
| `tool:ready` | `activate()` | `{ instanceId, tool, version }` |
| `mv:document:loaded` | a document loaded and parsed | `{ name, bytes, headings, config, from }` |
| `mv:document:rendered` | the rendered HTML changed | `{ headings, bytes }` |
| `mv:view:changed` | rendered ↔ source | `{ source }` |
| `mv:options:changed` | a render or layout option changed | `{ wide, pageBreakBefore }` |
| `mv:print:opened` | the print dialog opened | `{ name }` |
| `mv:document:cleared` | `clear()` | `{}` |
| `mv:error` | a typed failure | `{ code, message }` |

`from` is `'file'`, `'text'` or `'url'`.

## Errors

Failures are both **thrown** (with a `.code`) and **emitted** as `mv:error`, so
either style works.

| `code` | Means |
|---|---|
| `no-document` | an action needed a document and none was loaded |
| `bad-url` | not a URL, or not http(s) |
| `fetch-failed` | network error, CORS refusal, or a non-2xx response |
| `read-failed` | the File/Blob could not be read |

```js
try {
    await t.loadUrl({ url: 'https://example.com/no-cors.md' });
} catch (err) {
    if (err.code === 'fetch-failed') { /* fall back to asking for the file */ }
}
```

---

## Recipes

**Render a document and pull out its outline**

```js
const { headings } = await t.loadText({ text: md, name: 'spec.md' });
console.log(headings.map(h => `${'  '.repeat(h.level - 1)}${h.text}`).join('\n'));
```

**Wait for a render rather than guessing at a timeout**

```js
const rendered = new Promise(r =>
    document.addEventListener('mv:document:rendered', r, { once: true }));
await t.loadText({ text: md });
await rendered;
```

**Force page breaks the document did not ask for, then print**

```js
await t.loadUrl({ url });
await t.setOptions({ pageBreakBefore: 'h1' });
await t.print();
```

**Use it purely as a markdown-to-HTML service**

```js
const { html } = await t.renderToHtml({ text: someUntrustedMarkdown });
// Safe to innerHTML: raw HTML is escaped and javascript: URLs are refused.
```

---

## The parser directly

If you only want markdown rendering and not the tool around it, skip
`window.__tool` and import the module:

```js
import { renderMarkdown, parseMarkdown }
    from '/core/markdown/v1/v1.1/v1.1.0/sg-markdown.js';

el.innerHTML = renderMarkdown(text);
const { html, config, headings, body } = parseMarkdown(text);
```

Pair it with `/core/markdown/v1/v1.1/v1.1.0/sg-markdown.css` and put `md-body`
on the container. It has no DOM dependency, so it also runs under Node.
