/**
 * md-escape — HTML escaping and URL sanitising for the markdown pipeline.
 *
 * The two functions here are the security boundary of the whole module: every
 * scrap of author-controlled text passes through `escapeHtml`, and every URL
 * through `sanitizeUrl`. Nothing else in the pipeline is allowed to write a
 * raw substring into the output.
 *
 * @module core/markdown/md-escape
 * @version 1.1.0
 */

/**
 * HTML-escape a string for safe insertion into element text OR an attribute
 * value.
 *
 * Quotes matter as much as angle brackets. v1.0.0 escaped only `& < >`, which
 * left `<a href="{url}">` open to attribute injection: a link URL containing a
 * double quote closed the attribute and the rest became markup
 * (`[x](y" onmouseover="…)`). Escaping both quote characters closes that.
 *
 * @param {string} s - Raw text
 * @returns {string} Escaped HTML, safe in text and attribute positions
 */
export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

/**
 * Vet a URL taken from a markdown link or image.
 *
 * Allows: absolute http(s), mailto, root-relative, fragment, ./ and ../
 * relative, and bare relative paths (so `[notes](chapter-2.md)` works inside a
 * vault or a folder of documents).
 *
 * Rejects: `javascript:`, `data:` and `vbscript:` — the three schemes that turn
 * a link into script execution. `data:` is refused even for images, because
 * `data:text/html` in an href is a same-origin document.
 *
 * @param {string} url - Raw URL text from the source
 * @returns {string|null} The trimmed URL, or null when it must not be linked
 */
export function sanitizeUrl(url) {
    const trimmed = String(url ?? '').trim();
    const lower   = trimmed.toLowerCase();

    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:'))
        return null;

    if (trimmed.startsWith('/') || trimmed.startsWith('#') ||
        trimmed.startsWith('./') || trimmed.startsWith('../'))
        return trimmed;

    if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed))
        return trimmed;

    // Bare relative paths: filenames, folder/file, with spaces and brackets.
    if (/^[a-zA-Z0-9_\-/.()[\] %#]+$/.test(trimmed))
        return trimmed;

    return null;
}

/**
 * Turn heading text into a URL fragment id, so a document can be linked into
 * and an outline can scroll to a section.
 *
 * @param {string} text - Heading source text (may contain inline markdown)
 * @returns {string} A slug — lowercase, alphanumerics and single hyphens
 */
export function slugify(text) {
    return String(text ?? '')
        .replace(/`([^`]*)`/g, '$1')          // strip inline code fences
        .replace(/[*_~]/g, '')                // strip emphasis markers
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links → their text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'section';
}
