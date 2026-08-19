/**
 * sg-markdown — markdown → safe HTML. Pure JS, no DOM, no dependencies.
 *
 * v1.1.0. Ported from the SG/Send vault parser (vault/lib/markdown v0.2.0) and
 * split into single-purpose modules. Runs unchanged in a browser or in Node.
 *
 * Over v1.0.0 this adds h4–h6, images, front matter, page breaks, table
 * alignment, strikethrough, nested emphasis, list continuation lines and
 * heading ids — and closes an attribute-injection hole: v1.0.0 escaped only
 * `& < >`, so a link URL containing a quote escaped its `href` and could add an
 * event handler. See md-escape.js.
 *
 * Everything the author writes is escaped; no raw HTML passes through. There is
 * no `allowHtml` option, deliberately — a document that needs one wants a
 * sanitiser, and that is a different dependency.
 *
 *   import { renderMarkdown } from '/core/markdown/v1/v1.1/v1.1.0/sg-markdown.js'
 *   el.innerHTML = renderMarkdown(text)
 *
 * Pair with sg-markdown.css for screen and print styling.
 *
 * @module core/markdown/sg-markdown
 * @version 1.1.0
 */

import { escapeHtml, sanitizeUrl, slugify }                    from './md-escape.js';
import { extractFrontMatter, normalisePageBreakLevels }        from './md-frontmatter.js';
import { parseBlocks }                                         from './md-blocks.js';
import { renderInline }                                        from './md-inline.js';
import { renderBlock, pageBreakHtml, frontMatterBadgeHtml }    from './md-render.js';

export { escapeHtml, sanitizeUrl, slugify, extractFrontMatter, renderInline };

/**
 * Parse a document and return its HTML alongside what was learned about it.
 *
 * Use this over `renderMarkdown` when the caller wants the front matter (to set
 * a title, to inject print CSS) or the heading list (to build an outline).
 *
 * @param {string} text - Markdown source, front matter included
 * @param {object} [options]
 * @param {*} [options.pageBreakBefore] - Overrides the front-matter value.
 *   `'h1'` | `1` | `true` | `['h1','h2']`
 * @param {'direct'|'deferred'} [options.imageSrc] - `deferred` withholds `src`
 *   and emits only `data-md-src`, for hosts that resolve paths to blob URLs
 * @param {boolean} [options.headingIds] - Slug ids on headings (default true)
 * @param {boolean} [options.frontMatterBadge] - Show the settings strip
 *   (default true; ignored when there is no front matter)
 * @returns {{ html: string, config: object, body: string,
 *             headings: Array<{ level: number, text: string, id: string }> }}
 */
export function parseMarkdown(text, options = {}) {
    if (!text) return { html: '', config: {}, body: '', headings: [] };

    const { config, body } = extractFrontMatter(text);

    const pageBreak = options.pageBreakBefore !== undefined && options.pageBreakBefore !== null
        ? options.pageBreakBefore
        : config.page_break_before;
    const breakLevels = normalisePageBreakLevels(pageBreak);

    // Blockquotes hold markdown of their own. Passing the recursion in keeps
    // md-render from importing this module back.
    const blockOptions = {
        ...options,
        renderNested: (nested) => parseMarkdown(nested, {
            ...options,
            headingIds: false,          // ids inside a quote would collide
            frontMatterBadge: false,
        }).html,
    };

    const blocks   = parseBlocks(body.split('\n'));
    const headings = [];

    const rendered = blocks.map((block, idx) => {
        if (block.type === 'heading') {
            headings.push({ level: block.level, text: block.content, id: slugify(block.content) });
        }
        // No break above the first block — a page break at the top of a
        // document would print a blank first page.
        const prefix = breakLevels.size && block.type === 'heading' &&
                       breakLevels.has(block.level) && idx > 0
            ? pageBreakHtml() + '\n'
            : '';
        return prefix + renderBlock(block, blockOptions);
    }).join('\n');

    const badge = options.frontMatterBadge === false ? '' : frontMatterBadgeHtml(config);

    return { html: badge + rendered, config, body, headings };
}

/**
 * Render markdown to an HTML string.
 *
 * Signature-compatible with v1.0.0, so a consumer upgrades by changing the
 * import path alone.
 *
 * @param {string} text - Markdown source
 * @param {object} [options] - As `parseMarkdown`
 * @returns {string} HTML, ready for innerHTML
 */
export function renderMarkdown(text, options = {}) {
    return parseMarkdown(text, options).html;
}

/**
 * Back-compatible alias for v1.0.0's `inlineMarkdown`.
 *
 * The v1.0.0 function took ALREADY-ESCAPED text; this one takes raw text and
 * escapes it itself, which is the safe direction — double-escaping shows stray
 * `&amp;`, under-escaping is an injection.
 *
 * @param {string} text - Raw inline markdown
 * @returns {string} HTML
 * @deprecated Prefer `renderInline`.
 */
export function inlineMarkdown(text) {
    return renderInline(text);
}
