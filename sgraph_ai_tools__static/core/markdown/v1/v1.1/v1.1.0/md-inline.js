/**
 * md-inline — inline markdown inside a block's text.
 *
 * A left-to-right scanner rather than a chain of regex replacements. That
 * ordering is the point: a regex pass over the whole string cannot tell that
 * the `![x](y)` inside `` `![x](y)` `` is meant to be literal, whereas a scanner
 * that consumes a code span before it ever looks for an image can.
 *
 * Every character that is not consumed as syntax goes through escapeHtml, so
 * the output contains no author-controlled markup anywhere.
 *
 * @module core/markdown/md-inline
 * @version 1.1.0
 */

import { escapeHtml, sanitizeUrl } from './md-escape.js';

/**
 * Render the inline layer of a block's text.
 *
 * Supports: code spans, images (with `|width` sizing), links, `***bold italic***`,
 * `**bold**`, `*italic*`, `__bold__`, `_italic_`, `~~strikethrough~~`, and a
 * newline as `<br>`.
 *
 * @param {string} text - Raw block text
 * @param {object} [options]
 * @param {'direct'|'deferred'} [options.imageSrc] - `deferred` emits only
 *   `data-md-src`, leaving `src` unset so a host (a vault, an archive) can
 *   resolve the path to a blob URL without the browser first 404-ing on it.
 * @returns {string} HTML
 */
export function renderInline(text, options = {}) {
    if (!text) return '';
    const deferImages = options.imageSrc === 'deferred';

    let out = '';
    let i = 0;

    while (i < text.length) {
        // Code spans first — everything inside one is literal.
        if (text[i] === '`') {
            const end = text.indexOf('`', i + 1);
            if (end > i) {
                out += '<code>' + escapeHtml(text.slice(i + 1, end)) + '</code>';
                i = end + 1; continue;
            }
        }

        if (text[i] === '!' && text[i + 1] === '[') {
            const img = readBracketPair(text, i + 1);
            if (img) {
                out += renderImage(img.label, img.target, deferImages);
                i = img.next; continue;
            }
        }

        if (text[i] === '[') {
            const link = readBracketPair(text, i);
            if (link) {
                out += renderLink(link.label, link.target, options);
                i = link.next; continue;
            }
        }

        const emphasis = readEmphasis(text, i, options);
        if (emphasis) { out += emphasis.html; i = emphasis.next; continue; }

        if (text[i] === '\n') { out += '<br>'; i++; continue; }

        out += escapeHtml(text[i]);
        i++;
    }

    return out;
}

/**
 * Read a `[label](target)` pair starting at `open`.
 * @returns {{ label: string, target: string, next: number }|null}
 */
function readBracketPair(text, open) {
    const close = text.indexOf(']', open + 1);
    if (close <= open || text[close + 1] !== '(') return null;
    const paren = text.indexOf(')', close + 2);
    if (paren <= close) return null;
    return {
        label:  text.slice(open + 1, close),
        target: text.slice(close + 2, paren),
        next:   paren + 1,
    };
}

/**
 * `![alt](url)`, with an optional size after a pipe in the alt text:
 * `![alt|400]`, `![alt|50%]`, `![alt|640x480]`.
 */
function renderImage(altText, url, defer) {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return '<em>[image: ' + escapeHtml(altText) + ']</em>';

    const pipe = altText.indexOf('|');
    const alt  = pipe === -1 ? altText : altText.slice(0, pipe);

    let sizeAttrs = '';
    if (pipe !== -1) {
        const dim = altText.slice(pipe + 1).trim();
        const pct = dim.match(/^(\d+)%$/);
        const wh  = dim.match(/^(\d+)x(\d+)$/);
        const w   = dim.match(/^(\d+)$/);
        if (pct)     sizeAttrs = ` style="width:${pct[1]}%"`;
        else if (wh) sizeAttrs = ` width="${wh[1]}" height="${wh[2]}"`;
        else if (w)  sizeAttrs = ` width="${w[1]}"`;
    }

    const escaped = escapeHtml(safeUrl);
    const src     = defer ? '' : ` src="${escaped}"`;
    return `<img class="md-img" data-md-src="${escaped}"${src} alt="${escapeHtml(alt)}" loading="lazy"${sizeAttrs}>`;
}

/** `[text](url)`. An unsafe URL degrades to plain text rather than vanishing. */
function renderLink(label, url, options) {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return escapeHtml(label) + ' (' + escapeHtml(url) + ')';

    const external = /^https?:\/\//i.test(safeUrl);
    const target   = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(safeUrl)}"${target}>${renderInline(label, options)}</a>`;
}

/** Emphasis run starting at `i`, longest marker first. */
function readEmphasis(text, i, options) {
    const wrap = (marker, tag) => {
        const len = marker.length;
        if (text.slice(i, i + len) !== marker) return null;
        // A single-char marker must not be the start of a double one.
        if (len === 1 && text[i + 1] === marker) return null;
        const end = text.indexOf(marker, i + len);
        if (end <= i) return null;
        if (len === 1 && text[end + 1] === marker) return null;
        const inner = renderInline(text.slice(i + len, end), options);
        return { html: `<${tag}>${inner}</${tag}>`, next: end + len };
    };

    if (text[i] === '*') {
        if (text.slice(i, i + 3) === '***') {
            const end = text.indexOf('***', i + 3);
            if (end > i) return {
                html: '<strong><em>' + renderInline(text.slice(i + 3, end), options) + '</em></strong>',
                next: end + 3,
            };
        }
        return wrap('**', 'strong') || wrap('*', 'em');
    }
    if (text[i] === '_') return wrap('__', 'strong') || wrap('_', 'em');
    if (text[i] === '~') return wrap('~~', 'del');
    return null;
}
