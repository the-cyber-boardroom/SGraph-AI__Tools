# Markdown Viewer — driving it from a browser agent

For Playwright, Puppeteer, or anything else holding a real page. The tool needs
no key, no account and no user gesture, so the whole surface is reachable
headlessly.

```
https://tools.sgraph.ai/en-gb/markdown-viewer/
```

---

## Wait for the tool, not for a timeout

```js
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__tool && typeof window.__tool.loadText === 'function');
```

## Stub print before you navigate

`print()` opens a modal dialog that no driver can dismiss, and it will hang the
run. Stub it in an init script, then assert the call happened:

```js
await page.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
// …later…
await page.evaluate(() => window.__tool.print());
await page.evaluate(() => window.__printCalls);   // 1
```

Or watch the event and never call it at all.

## Load a document

The reliable path is `loadText` — no file chooser, no network:

```js
await page.evaluate(md => window.__tool.loadText({ text: md, name: 'doc.md' }), markdown);
await page.waitForSelector('#mv-main', { state: 'visible' });
```

Through the real file input, when you want to exercise that path:

```js
await page.setInputFiles('#mv-file', '/path/to/doc.md');
```

Through the paste box:

```js
await page.fill('#mv-paste', '# Hi');
await page.click('#mv-paste-go');
```

Or straight from the URL, which needs no scripting at all:

```js
await page.goto(`${URL}?url=${encodeURIComponent(rawMdUrl)}`);
```

---

## Selectors

Stable ids, no shadow DOM anywhere in this tool — `page.evaluate` with
`document.querySelector` works as well as Playwright's own engine.

| Selector | What |
|---|---|
| `#mv-empty` | opening screen (hidden once a document is loaded) |
| `#mv-main` | reading pane |
| `#mv-rendered` | the rendered document — `.md-body` |
| `#mv-source` | the raw-source view |
| `#mv-outline a[data-id]` | outline entries; `data-id` matches a heading's `id` |
| `#mv-name` / `#mv-meta` | document name and its size/heading/page-break line |
| `#mv-toggle-source`, `#mv-toggle-wide`, `#mv-print`, `#mv-close` | toolbar buttons |
| `#mv-drop`, `#mv-file`, `#mv-paste`, `#mv-paste-go`, `#mv-url`, `#mv-url-go` | the ways in |
| `#mv-error` | the error line (`hidden` when there is nothing to say) |

Inside the rendered document, the parser's own classes: `.md-table`,
`.md-ta-left|center|right`, `.md-code`, `.md-img`, `.md-page-break`,
`.md-frontmatter`.

---

## Asserting on the render

```js
const counts = await page.evaluate(() => {
    const q = s => document.querySelectorAll(`#mv-rendered ${s}`).length;
    return { h1: q('h1'), tables: q('table.md-table'), breaks: q('.md-page-break') };
});
```

Heading ids are slugs of the heading text, so a deep link is predictable:
`## A Table` → `#a-table`.

## Print behaviour without printing

```js
await page.emulateMedia({ media: 'print' });
const printed = await page.evaluate(() => getComputedStyle(document.querySelector('#mv-rendered')).display !== 'none');
const chrome  = await page.evaluate(() => getComputedStyle(document.querySelector('.mv-toolbar')).display !== 'none');
await page.emulateMedia({ media: 'screen' });
```

To capture the printed artefact itself, `page.pdf()` picks up the same
stylesheet — a document with `page_break_before: h1` produces one page per `#`
heading, which is a cheap way to assert the breaks really break.

---

## Things that will trip you up

- **Every action is a Promise**, including `getStatus()` and `getHtml()`. Await
  them.
- **`loadUrl` needs CORS** from the far host. In a test, prefer `loadText`, or
  serve the fixture from the same origin.
- **`?url=` fires on load**, so the page may already be showing a document
  before your first `evaluate` runs.
- **`setSourceView` and `wide` persist to localStorage.** A fresh context each
  run keeps things deterministic; otherwise reset with
  `setOptions({ wide: false })` and `setSourceView({ source: false })`.
- **A 404 on an image in the document is expected noise** if the markdown
  references relative paths that do not exist — filter it out of console-error
  assertions.

## A minimal end-to-end

```js
await page.addInitScript(() => { window.print = () => {}; });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__tool?.loadText);

const out = await page.evaluate(() => window.__tool.loadText({
    text: '---\npage_break_before: h1\n---\n# One\n\ntext\n\n# Two',
    name: 'test.md',
}));
// out.headings.length === 2

await page.waitForSelector('#mv-rendered h1');
await page.locator('#mv-outline a[data-id="two"]').click();
await page.pdf({ path: 'out.pdf', format: 'A4' });   // 2 pages
```

The tool's own smoke test is a fuller worked example:
`sgraph_ai_tools__static/tests/playwright/markdown-viewer-boot-smoke.js`.
