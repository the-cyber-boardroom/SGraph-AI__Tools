/**
 * markdown-viewer — boot smoke test.
 *
 * Drives the real tool in a real browser through its JS API and its UI, and
 * asserts on what the reader actually ends up looking at.
 *
 *   ./scripts/run-locally.sh &
 *   PW_CHROMIUM=/opt/pw-browsers/chromium \
 *     node sgraph_ai_tools__static/tests/playwright/markdown-viewer-boot-smoke.js
 */

const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:10063';
const URL  = `${BASE}/en-gb/markdown-viewer/`;

let passed = 0, failed = 0;
const ok   = (l) => { console.log(`  ✓ ${l}`); passed++; };
const bad  = (l, e) => { console.error(`  ✗ ${l}: ${e?.message || e}`); failed++; };
const check = async (label, fn) => { try { await fn(); ok(label); } catch (e) { bad(label, e); } };
const assert = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };

const DOC = `---
title: Smoke Document
page_break_before: h1
---

# First Part

Intro with **bold**, *italic*, \`code\` and a [link](https://sgraph.ai).

## A Table

| Route | Works? | Why |
|---|:-:|--:|
| \`git clone\` | yes | the filesystem is the listing |
| no key | no | nothing is nameable |

> A quote with a list:
> - one
> - two

\`\`\`bash
curl -sI https://sgraph.ai/
\`\`\`

<!-- page-break -->

# Second Part

1. first
2. second

![a picture|300](picture.png)
`;

(async () => {
    console.log('\nmarkdown-viewer boot smoke\n');

    const browser = await chromium.launch({
        headless: true,
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    });
    const page = await browser.newPage();

    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    // Never let a real print dialog block a headless run.
    await page.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });

    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    // ── Boot ────────────────────────────────────────────────────────────────

    await check('the tool boots and publishes window.__tool', async () => {
        await page.waitForFunction(() => window.__tool && typeof window.__tool.loadText === 'function',
            null, { timeout: 15000 });
    });

    await check('it opens on the empty state, with the reading pane hidden', async () => {
        assert(await page.locator('#mv-empty').isVisible(), 'empty state should show');
        assert(!(await page.locator('#mv-main').isVisible()), 'reading pane should be hidden');
    });

    await check('the toolbar buttons are disabled until a document is loaded', async () => {
        for (const id of ['#mv-print', '#mv-toggle-source', '#mv-close']) {
            assert(await page.locator(id).isDisabled(), `${id} should start disabled`);
        }
    });

    // ── Load ────────────────────────────────────────────────────────────────

    await check('loadText renders the document and reports its shape', async () => {
        const out = await page.evaluate((md) => window.__tool.loadText({ text: md, name: 'smoke.md' }), DOC);
        assert(out.headings.length === 3, `expected 3 headings, got ${out.headings.length}`);
        assert(out.config.title === 'Smoke Document', `front matter title: ${out.config.title}`);
        assert(out.bytes > 200, `bytes looked wrong: ${out.bytes}`);
    });

    await check('the reading pane replaces the empty state', async () => {
        await page.waitForSelector('#mv-main', { state: 'visible', timeout: 5000 });
        assert(!(await page.locator('#mv-empty').isVisible()), 'empty state should be gone');
    });

    await check('every block type made it into the DOM', async () => {
        const counts = await page.evaluate(() => {
            const q = (s) => document.querySelectorAll(`#mv-rendered ${s}`).length;
            return {
                h1: q('h1'), h2: q('h2'), table: q('table.md-table'), quote: q('blockquote'),
                code: q('pre.md-code'), ol: q('ol'), li: q('li'), img: q('img.md-img'),
                link: q('a[href^="https://"]'), strong: q('strong'), em: q('em'),
            };
        });
        for (const [k, v] of Object.entries(counts)) assert(v > 0, `no ${k} rendered (${JSON.stringify(counts)})`);
    });

    await check('the table keeps its per-column alignment', async () => {
        const aligns = await page.$$eval('#mv-rendered table.md-table thead th',
            ths => ths.map(t => t.className));
        assert(aligns.join(' ').includes('md-ta-center'), `alignments: ${aligns}`);
        assert(aligns.join(' ').includes('md-ta-right'),  `alignments: ${aligns}`);
    });

    await check('both page breaks are present — one from front matter, one inline', async () => {
        const n = await page.locator('#mv-rendered .md-page-break').count();
        assert(n === 2, `expected 2 page breaks, got ${n}`);
    });

    await check('the front-matter title becomes the document name', async () => {
        assert((await page.locator('#mv-name').textContent()).trim() === 'Smoke Document', 'toolbar name');
    });

    // ── Outline ─────────────────────────────────────────────────────────────

    await check('the outline lists every heading and links to real ids', async () => {
        const items = await page.$$eval('#mv-outline a[data-id]', as => as.map(a => a.dataset.id));
        assert(items.length === 3, `outline items: ${items.length}`);
        for (const id of items) {
            assert(await page.locator(`#mv-rendered [id="${id}"]`).count() === 1, `no heading with id ${id}`);
        }
    });

    // ── Source toggle ───────────────────────────────────────────────────────

    await check('the Source button swaps in the raw markdown, verbatim', async () => {
        await page.click('#mv-toggle-source');
        await page.waitForSelector('#mv-source', { state: 'visible', timeout: 3000 });
        assert(!(await page.locator('#mv-rendered').isVisible()), 'rendered view should hide');
        const shown = await page.locator('#mv-source').textContent();
        assert(shown.includes('page_break_before: h1'), 'front matter missing from the source view');
        assert(shown === DOC, 'source view is not byte-identical to the input');
    });

    await check('toggling back returns to the rendered document', async () => {
        await page.click('#mv-toggle-source');
        await page.waitForSelector('#mv-rendered', { state: 'visible', timeout: 3000 });
        assert(!(await page.locator('#mv-source').isVisible()), 'source view should hide');
    });

    // ── Options ─────────────────────────────────────────────────────────────

    await check('setOptions({wide}) widens the measure', async () => {
        await page.evaluate(() => window.__tool.setOptions({ wide: true }));
        assert(await page.locator('#mv-main.mv-main--wide').count() === 1, 'wide class not applied');
        await page.evaluate(() => window.__tool.setOptions({ wide: false }));
    });

    await check('setOptions({pageBreakBefore}) overrides the document and re-renders', async () => {
        await page.evaluate(() => window.__tool.setOptions({ pageBreakBefore: ['h1', 'h2'] }));
        const n = await page.locator('#mv-rendered .md-page-break').count();
        assert(n === 3, `h1+h2 breaks: expected 3, got ${n}`);
        await page.evaluate(() => window.__tool.setOptions({ pageBreakBefore: null }));
    });

    // ── Print ───────────────────────────────────────────────────────────────

    await check('print() fires mv:print:opened and calls window.print', async () => {
        const fired = await page.evaluate(async () => {
            const seen = new Promise(r => document.addEventListener('mv:print:opened', e => r(e.detail), { once: true }));
            await window.__tool.print();
            return Promise.race([seen, new Promise(r => setTimeout(() => r(null), 2000))]);
        });
        assert(fired, 'mv:print:opened never fired');
        assert(await page.evaluate(() => window.__printCalls) === 1, 'window.print was not called');
    });

    await check('the print stylesheet hides the chrome and keeps the document', async () => {
        await page.emulateMedia({ media: 'print' });
        const vis = await page.evaluate(() => {
            const shown = (sel) => {
                const el = document.querySelector(sel);
                return el ? getComputedStyle(el).display !== 'none' : false;
            };
            return { toolbar: shown('.mv-toolbar'), outline: shown('#mv-outline'), doc: shown('#mv-rendered') };
        });
        assert(!vis.toolbar, 'the toolbar would print');
        assert(!vis.outline, 'the outline would print');
        assert(vis.doc, 'the document would NOT print');
        await page.emulateMedia({ media: 'screen' });
    });

    await check('the document still prints while the source view is open', async () => {
        await page.evaluate(() => window.__tool.setSourceView({ source: true }));
        await page.emulateMedia({ media: 'print' });
        const vis = await page.evaluate(() => ({
            doc:    getComputedStyle(document.querySelector('#mv-rendered')).display !== 'none',
            source: getComputedStyle(document.querySelector('#mv-source')).display !== 'none',
        }));
        assert(vis.doc, 'the rendered document would not print');
        assert(!vis.source, 'the raw source would print instead');
        await page.emulateMedia({ media: 'screen' });
        await page.evaluate(() => window.__tool.setSourceView({ source: false }));
    });

    // ── Safety ──────────────────────────────────────────────────────────────

    await check('a malicious document cannot inject script or handlers', async () => {
        const evil = [
            '<script>window.__pwned = 1;</script>',
            '<img src=x onerror="window.__pwned = 1">',
            '[hover](https://x/" onmouseover="window.__pwned = 1)',
            '![alt](p.png" onerror="window.__pwned = 1)',
            '[click](javascript:window.__pwned = 1)',
        ].join('\n\n');

        await page.evaluate((md) => window.__tool.loadText({ text: md, name: 'evil.md' }), evil);
        await page.waitForTimeout(150);

        assert(await page.evaluate(() => window.__pwned) === undefined, 'the document executed script');
        const inline = await page.evaluate(() => {
            const els = [...document.querySelectorAll('#mv-rendered *')];
            return els.filter(el => [...el.attributes].some(a => a.name.startsWith('on'))).length;
        });
        assert(inline === 0, `${inline} elements carry an inline event handler`);
        assert(await page.locator('#mv-rendered script').count() === 0, 'a script tag survived');
        assert(await page.locator('#mv-rendered a[href^="javascript:"]').count() === 0, 'a javascript: link survived');
    });

    // ── Clear + errors ──────────────────────────────────────────────────────

    await check('clear() returns the tool to its empty state', async () => {
        await page.evaluate(() => window.__tool.clear());
        await page.waitForSelector('#mv-empty', { state: 'visible', timeout: 3000 });
        assert(!(await page.locator('#mv-main').isVisible()), 'reading pane should hide');
        assert(await page.locator('#mv-print').isDisabled(), 'Print should be disabled again');
    });

    await check('print() with no document reports a typed error', async () => {
        const code = await page.evaluate(async () => {
            try { await window.__tool.print(); return 'no-throw'; }
            catch (e) { return e?.code || e?.message || 'unknown'; }
        });
        assert(String(code).includes('no-document'), `expected no-document, got ${code}`);
    });

    await check('a bad URL fails with bad-url rather than hanging', async () => {
        const code = await page.evaluate(async () => {
            try { await window.__tool.loadUrl({ url: 'ftp://example.com/x.md' }); return 'no-throw'; }
            catch (e) { return e?.code || e?.message || 'unknown'; }
        });
        assert(String(code).includes('bad-url'), `expected bad-url, got ${code}`);
    });

    await check('renderToHtml is pure — it does not disturb the loaded document', async () => {
        const out = await page.evaluate(() => window.__tool.renderToHtml({ text: '# Standalone' }));
        assert(out.html.includes('<h1'), 'did not render');
        assert(await page.locator('#mv-empty').isVisible(), 'it changed what is on screen');
    });

    // ── Paste path through the UI ───────────────────────────────────────────

    await check('the paste box renders through the real UI', async () => {
        await page.fill('#mv-paste', '# Pasted\n\nSome **text**.');
        await page.click('#mv-paste-go');
        await page.waitForSelector('#mv-rendered h1', { timeout: 3000 });
        assert((await page.locator('#mv-rendered h1').textContent()) === 'Pasted', 'heading text');
    });

    await check('the landing page lists the tool', async () => {
        await page.goto(`${BASE}/en-gb/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('a[href="markdown-viewer/"]', { timeout: 10000 });
    });

    await check('no console errors along the way', async () => {
        const real = consoleErrors.filter(e => !/favicon|net::ERR_|404|picture\.png/i.test(e));
        assert(real.length === 0, `console errors:\n    ${real.join('\n    ')}`);
    });

    await browser.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
})();
