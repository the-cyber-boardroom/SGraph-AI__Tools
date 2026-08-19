/**
 * core/markdown v1.1.0 — parser tests. No browser, no dependencies.
 * Run:  node sgraph_ai_tools__static/tests/node/sg-markdown.test.mjs
 */

import {
    renderMarkdown, parseMarkdown, extractFrontMatter, escapeHtml, sanitizeUrl, slugify,
} from '../../core/markdown/v1/v1.1/v1.1.0/sg-markdown.js';

let passed = 0, failed = 0;
const assert = (c, m = 'assertion') => { if (!c) throw new Error(m); };
const has    = (html, frag) => assert(html.includes(frag), `expected ${frag}\n  in: ${html}`);
const lacks  = (html, frag) => assert(!html.includes(frag), `did NOT expect ${frag}\n  in: ${html}`);

function test(label, fn) {
    try { fn(); console.log(`  ✓ ${label}`); passed++; }
    catch (e) { console.error(`  ✗ ${label}: ${e.message}`); failed++; }
}

console.log('\ncore/markdown v1.1.0\n');

// ── Security ─────────────────────────────────────────────────────────────────
// The v1.0.0 regression this version exists to fix, plus its neighbours.

console.log('security');

test('a quote in a link URL cannot inject an attribute (v1.0.0 XSS)', () => {
    const html = renderMarkdown('[hover me](https://x/" onmouseover="fetch(1)');
    lacks(html, 'onmouseover="');
    has(html, '&quot;');
});

test('a quote in an image URL or alt text cannot inject an attribute', () => {
    lacks(renderMarkdown('![a](p.png" onerror="alert(1)'), 'onerror="');
    lacks(renderMarkdown('![" onerror="alert(1)](p.png)'),  'onerror="');
});

test('raw HTML in the source is escaped, never passed through', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    lacks(html, '<script');
    lacks(html, '<img src=x');
    has(html, '&lt;script&gt;');
});

test('javascript:, data: and vbscript: URLs are refused', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox']) {
        const html = renderMarkdown(`[click](${url})`);
        lacks(html, '<a href');
        has(html, 'click');          // degrades to text, does not vanish
    }
});

test('http(s), mailto, relative and fragment URLs still link', () => {
    for (const url of ['https://sgraph.ai', 'mailto:a@b.c', '/docs/x.md', './sibling.md', '../up.md', '#anchor', 'notes.md']) {
        has(renderMarkdown(`[go](${url})`), '<a href=');
    }
});

test('escapeHtml covers both quote characters', () => {
    assert(escapeHtml(`<&>"'`) === '&lt;&amp;&gt;&quot;&#39;', escapeHtml(`<&>"'`));
});

test('code spans and fences are escaped, not executed', () => {
    has(renderMarkdown('`<b>x</b>`'), '<code>&lt;b&gt;x&lt;/b&gt;</code>');
    has(renderMarkdown('```\n<b>x</b>\n```'), '&lt;b&gt;x&lt;/b&gt;');
});

// ── Blocks ───────────────────────────────────────────────────────────────────

console.log('\nblocks');

test('headings h1 through h6 (v1.0.0 stopped at h3)', () => {
    for (let n = 1; n <= 6; n++) {
        has(renderMarkdown('#'.repeat(n) + ' Title'), `<h${n}`);
    }
});

test('headings get slug ids, and duplicates in quotes do not', () => {
    has(renderMarkdown('## Hello, World!'), 'id="hello-world"');
    lacks(renderMarkdown('> ## Quoted'), 'id=');
});

test('a table renders with per-column alignment', () => {
    const html = renderMarkdown('| A | B | C |\n|---|:-:|--:|\n| 1 | 2 | 3 |');
    has(html, '<table class="md-table">');
    has(html, 'class="md-ta-left">A');
    has(html, 'class="md-ta-center">B');
    has(html, 'class="md-ta-right">C');
});

test('a short table row is padded to the header width', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 |');
    assert((html.match(/<td/g) || []).length === 2, 'expected two cells');
});

test('pipes without a delimiter row stay a paragraph', () => {
    const html = renderMarkdown('| not | a table |');
    lacks(html, '<table');
    has(html, '<p>');
});

test('a fenced block keeps its language and its blank lines', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n\nconst b = 2;\n```');
    has(html, 'class="language-js"');
    has(html, 'data-lang="js"');
    has(html, 'const a = 1;\n\nconst b = 2;');
});

test('markdown inside a fence is not parsed', () => {
    const html = renderMarkdown('```\n# not a heading\n- not a list\n```');
    lacks(html, '<h1');
    lacks(html, '<li>');
});

test('lists: ul, ol, and a wrapped continuation line', () => {
    has(renderMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
    has(renderMarkdown('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
    has(renderMarkdown('- a long item\n  that wraps'), 'a long item<br>that wraps');
});

test('a blockquote parses markdown inside itself', () => {
    const html = renderMarkdown('> ## Heading\n> with **bold**');
    has(html, '<blockquote>');
    has(html, '<h2');
    has(html, '<strong>bold</strong>');
});

test('horizontal rules, and a heading right after a paragraph', () => {
    has(renderMarkdown('---'), '<hr>');
    has(renderMarkdown('text\n# Heading'), '<h1');
});

// ── Inline ───────────────────────────────────────────────────────────────────

console.log('\ninline');

test('emphasis: bold, italic, both, underscores, strikethrough', () => {
    has(renderMarkdown('**b**'),   '<strong>b</strong>');
    has(renderMarkdown('*i*'),     '<em>i</em>');
    has(renderMarkdown('***bi***'), '<strong><em>bi</em></strong>');
    has(renderMarkdown('__b__'),   '<strong>b</strong>');
    has(renderMarkdown('_i_'),     '<em>i</em>');
    has(renderMarkdown('~~s~~'),   '<del>s</del>');
});

test('emphasis nests, and bold inside a link works', () => {
    has(renderMarkdown('**bold with *italic* inside**'), '<strong>bold with <em>italic</em> inside</strong>');
    has(renderMarkdown('[**bold link**](https://x)'), '<strong>bold link</strong>');
});

test('a code span shields link and image syntax inside it', () => {
    const html = renderMarkdown('use `![alt](url)` and `[a](b)` literally');
    lacks(html, '<img');
    lacks(html, '<a href');
});

test('images render, with optional sizing', () => {
    has(renderMarkdown('![alt](p.png)'),        '<img class="md-img"');
    has(renderMarkdown('![alt](p.png)'),        'alt="alt"');
    has(renderMarkdown('![alt|400](p.png)'),    'width="400"');
    has(renderMarkdown('![alt|50%](p.png)'),    'style="width:50%"');
    has(renderMarkdown('![alt|64x48](p.png)'),  'width="64" height="48"');
});

test('deferred image mode withholds src for a host to resolve', () => {
    const html = renderMarkdown('![alt](p.png)', { imageSrc: 'deferred' });
    has(html,   'data-md-src="p.png"');
    lacks(html, ' src="p.png"');
});

test('external links open in a new tab; internal ones do not', () => {
    has(renderMarkdown('[x](https://a.b)'), 'rel="noopener noreferrer"');
    lacks(renderMarkdown('[x](./local.md)'), 'target="_blank"');
});

// ── Front matter and page breaks ─────────────────────────────────────────────

console.log('\nfront matter + page breaks');

test('front matter is extracted and kept out of the body', () => {
    const { config, body } = extractFrontMatter('---\ntitle: Hi\npage_break_before: h1\n---\n# Doc');
    assert(config.title === 'Hi', 'title');
    assert(config.page_break_before === 'h1', 'page_break_before');
    assert(body === '# Doc', `body was ${JSON.stringify(body)}`);
});

test('YAML subset: arrays, booleans, integers, block scalars', () => {
    const { config } = extractFrontMatter(
        '---\nlevels: [h1, h2]\nflag: true\noff: false\nn: 42\nprint_css: |\n  h2 { color: navy; }\n---\nbody');
    assert(Array.isArray(config.levels) && config.levels.length === 2, 'array');
    assert(config.flag === true && config.off === false, 'booleans');
    assert(config.n === 42, 'integer');
    assert(config.print_css === 'h2 { color: navy; }', `block scalar: ${config.print_css}`);
});

test('a document opening with a rule is not mistaken for front matter', () => {
    const { config, body } = extractFrontMatter('---\n\nJust a rule above.');
    assert(Object.keys(config).length === 0 || body.includes('Just a rule'), 'body preserved');
});

test('page_break_before inserts breaks — but never above the first block', () => {
    const html = renderMarkdown('# One\n\ntext\n\n# Two\n\n# Three', { pageBreakBefore: 'h1' });
    assert((html.match(/class="md-page-break"/g) || []).length === 2, 'expected exactly two breaks');
    assert(!html.trimStart().startsWith('<div class="md-page-break"'), 'no break above the first heading');
});

test('page_break_before accepts h1 / 1 / true / [h1,h2]', () => {
    const doc = '# a\n\n## b';
    for (const opt of ['h1', 1, true]) {
        assert((renderMarkdown(doc, { pageBreakBefore: opt }).match(/class="md-page-break"/g) || []).length === 0,
            `only one h1 at the top → no break (${opt})`);
    }
    assert((renderMarkdown(doc, { pageBreakBefore: ['h1', 'h2'] }).match(/class="md-page-break"/g) || []).length === 1,
        'h2 breaks');
});

test('an inline <!-- page-break --> directive works anywhere', () => {
    has(renderMarkdown('a\n\n<!-- page-break -->\n\nb'), 'md-page-break');
    has(renderMarkdown('a\n\n<!--pagebreak-->\n\nb'),     'md-page-break');
});

test('the front-matter badge shows settings, and can be turned off', () => {
    const src = '---\ntitle: Doc\n---\n# H';
    has(renderMarkdown(src), 'md-frontmatter');
    lacks(renderMarkdown(src, { frontMatterBadge: false }), 'md-frontmatter');
});

// ── parseMarkdown extras ─────────────────────────────────────────────────────

console.log('\nparseMarkdown');

test('headings are returned for building an outline', () => {
    const { headings } = parseMarkdown('# One\n\n## Two\n\n### Three');
    assert(headings.length === 3, `got ${headings.length}`);
    assert(headings[1].level === 2 && headings[1].id === 'two', JSON.stringify(headings[1]));
});

test('config and body come back alongside the html', () => {
    const out = parseMarkdown('---\ntitle: T\n---\n# H');
    assert(out.config.title === 'T' && out.body === '# H' && out.html.includes('<h1'), 'shape');
});

test('empty and nullish input are safe', () => {
    for (const v of ['', null, undefined]) {
        assert(renderMarkdown(v) === '', `renderMarkdown(${v})`);
    }
});

test('slugify and sanitizeUrl behave at the edges', () => {
    assert(slugify('  Hello — World!  ') === 'hello-world', slugify('  Hello — World!  '));
    assert(slugify('***') === 'section', slugify('***'));
    assert(sanitizeUrl('  https://x  ') === 'https://x', 'trims');
    assert(sanitizeUrl('javascript:x') === null, 'refuses javascript:');
});

// ── A whole document ─────────────────────────────────────────────────────────

console.log('\nend to end');

test('a realistic document parses without losing a block', () => {
    const doc = [
        '---', 'title: Dev Pack', 'page_break_before: h1', '---',
        '# Dev Pack', '', 'Intro with **bold**, `code` and a [link](https://sgraph.ai).', '',
        '## Table', '', '| Route | Works? |', '|---|:-:|', '| `git clone` | ✅ |', '',
        '> A quote with a list:', '> - one', '> - two', '',
        '```bash', 'curl -sI https://example.com', '```', '',
        '<!-- page-break -->', '', '# Part 2', '', '1. first', '2. second', '', '---', '', '![shot|300](shot.png)',
    ].join('\n');

    const { html, config, headings } = parseMarkdown(doc);
    assert(config.title === 'Dev Pack', 'front matter read');
    assert(headings.length === 3, `headings: ${headings.length}`);
    for (const frag of ['<h1', '<h2', '<table', '<blockquote', '<pre class="md-code"', '<ol>', '<hr>', '<img']) {
        has(html, frag);
    }
    assert((html.match(/class="md-page-break"/g) || []).length === 2, 'one directive + one h1 break');
    lacks(html, 'undefined');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
