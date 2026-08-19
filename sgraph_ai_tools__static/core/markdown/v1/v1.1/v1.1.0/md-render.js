/**
 * md-render — block descriptors → HTML.
 *
 * Output carries CSS classes rather than inline styles, so a consumer themes it
 * with sg-markdown.css (or its own). The one exception is table alignment,
 * which is per-column data rather than a style decision.
 *
 * @module core/markdown/md-render
 * @version 1.1.0
 */

import { escapeHtml, slugify } from './md-escape.js';
import { renderInline }        from './md-inline.js';

/**
 * Render one block.
 *
 * @param {object} block - A descriptor from md-blocks
 * @param {object} [options]
 * @param {boolean} [options.headingIds] - Give headings slug ids (default true)
 * @param {Function} [options.renderNested] - Used for blockquote bodies, which
 *   contain markdown of their own. Injected to keep this module free of a
 *   circular import back to the pipeline entry point.
 * @returns {string} HTML
 */
export function renderBlock(block, options = {}) {
    switch (block.type) {
        case 'heading': {
            const inner = renderInline(block.content, options);
            const id    = options.headingIds === false ? '' : ` id="${escapeHtml(slugify(block.content))}"`;
            return `<h${block.level}${id}>${inner}</h${block.level}>`;
        }

        case 'paragraph':
            return `<p>${renderInline(block.content, options)}</p>`;

        case 'code_block': {
            const langAttr = block.lang ? ` data-lang="${escapeHtml(block.lang)}"` : '';
            const cls      = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
            return `<pre class="md-code"><code${cls}${langAttr}>${escapeHtml(block.content)}</code></pre>`;
        }

        case 'blockquote': {
            const inner = options.renderNested
                ? options.renderNested(block.content)
                : `<p>${renderInline(block.content, options)}</p>`;
            return `<blockquote>${inner}</blockquote>`;
        }

        case 'ul':
        case 'ol': {
            const items = block.items.map(item => `<li>${renderInline(item, options)}</li>`).join('');
            return `<${block.type}>${items}</${block.type}>`;
        }

        case 'hr':
            return '<hr>';

        case 'table':
            return renderTable(block, options);

        case 'page_break':
            return pageBreakHtml();

        default:
            return `<p>${escapeHtml(block.content || '')}</p>`;
    }
}

/**
 * Render a table, applying each column's alignment to both its header and its
 * cells. Short rows are padded so the table stays rectangular.
 *
 * @param {object} block - A `table` descriptor
 * @param {object} [options]
 * @returns {string} HTML
 */
export function renderTable(block, options = {}) {
    const align = (i) => ` class="md-ta-${block.aligns[i] || 'left'}"`;

    const head = block.headers
        .map((h, i) => `<th${align(i)}>${renderInline(h, options)}</th>`)
        .join('');

    const body = block.rows.map((row) => {
        const cells = block.headers
            .map((_, i) => `<td${align(i)}>${renderInline(i < row.length ? row[i] : '', options)}</td>`)
            .join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return `<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * The page-break marker: a labelled dashed rule on screen, an actual page break
 * in print. Both behaviours live in sg-markdown.css.
 *
 * @returns {string} HTML
 */
export function pageBreakHtml() {
    return '<div class="md-page-break" role="separator" aria-label="page break">' +
           '<span class="md-page-break__rule"></span>' +
           '<span class="md-page-break__label">page break</span>' +
           '<span class="md-page-break__rule"></span>' +
           '</div>';
}

/**
 * A compact summary of the document's front matter, shown above the content so
 * the reader can see that the file carries settings — and which ones — without
 * opening the source. Hidden in print.
 *
 * @param {object} config - Parsed front matter
 * @returns {string} HTML, or '' when there is no front matter
 */
export function frontMatterBadgeHtml(config) {
    const keys = Object.keys(config || {});
    if (!keys.length) return '';

    const tags = keys.map((key) => {
        const val = config[key];
        let label;

        if (key === 'page_break_before') {
            const levels = (Array.isArray(val) ? val : [val])
                .map(v => String(v).toUpperCase().replace(/^H?([1-6])$/, 'H$1'))
                .join(' ');
            label = 'page breaks: ' + (levels || String(val));
        } else if (key === 'print_css') {
            label = 'custom print CSS';
        } else {
            let v = typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (v.length > 40) v = v.slice(0, 37) + '…';
            label = `${key}: ${v}`;
        }
        return `<code class="md-frontmatter__tag">${escapeHtml(label)}</code>`;
    }).join('');

    return '<div class="md-frontmatter">' +
           '<span class="md-frontmatter__label">doc settings</span>' + tags +
           '</div>\n';
}
