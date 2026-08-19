/**
 * md-frontmatter — YAML front matter at the top of a markdown document.
 *
 * A deliberately small YAML subset: flat `key: value` pairs, inline arrays, and
 * literal block scalars. Nesting is not supported and never will be here — the
 * moment a document needs it, it wants a real YAML parser, not this one.
 *
 * Recognised keys (interpreted by the renderer; anything else is carried
 * through untouched for the caller to use):
 *
 *   page_break_before: h1        break before every h1
 *   page_break_before: [h1, h2]  break before h1 and h2
 *   page_break_before: true      shorthand for h1
 *   title: My Document           used by consumers for tab/print titles
 *   print_css: |                 raw CSS injected into the print stylesheet
 *     h2 { color: navy; }
 *
 * @module core/markdown/md-frontmatter
 * @version 1.1.0
 */

/**
 * Split a document into its front-matter config and its body.
 *
 * The block must open on the very first line, so a document that merely starts
 * with a horizontal rule is not mistaken for one with front matter.
 *
 * @param {string} text - Full document source
 * @returns {{ config: object, body: string }} Config is `{}` when absent
 */
export function extractFrontMatter(text) {
    if (!text) return { config: {}, body: '' };
    if (!text.startsWith('---\n') && text !== '---') return { config: {}, body: text };

    const closeIdx = text.indexOf('\n---', 4);
    if (closeIdx === -1) return { config: {}, body: text };

    const yamlBlock = text.slice(4, closeIdx).trim();
    const body      = text.slice(closeIdx + 4).replace(/^\n/, '');
    return { config: parseSimpleYaml(yamlBlock), body };
}

/**
 * Parse the flat YAML subset described above.
 *
 * @param {string} yaml - The text between the `---` delimiters
 * @returns {object} Parsed key/value pairs
 */
export function parseSimpleYaml(yaml) {
    const config = {};
    const lines  = String(yaml ?? '').split('\n');
    let i = 0;

    while (i < lines.length) {
        const m = lines[i].match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
        if (!m) { i++; continue; }

        const key = m[1];
        const val = m[2].trim();

        // Literal block scalar: everything indented by two spaces, verbatim.
        if (val === '|') {
            i++;
            const blockLines = [];
            while (i < lines.length && (lines[i].startsWith('  ') || lines[i] === '')) {
                blockLines.push(lines[i].startsWith('  ') ? lines[i].slice(2) : '');
                i++;
            }
            config[key] = blockLines.join('\n').trimEnd();
            continue;
        }

        if (val.startsWith('[') && val.endsWith(']')) {
            config[key] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        } else if (val === 'true')   { config[key] = true;  }
        else if (val === 'false')    { config[key] = false; }
        else if (/^-?\d+$/.test(val)) { config[key] = parseInt(val, 10); }
        else                          { config[key] = val;  }

        i++;
    }
    return config;
}

/**
 * Normalise a `page_break_before` value into a set of heading levels.
 *
 * Accepts `'h1'`, `1`, `true`, `['h1','h2']`, `[1,2]` — anything else is
 * ignored rather than throwing, because it comes from a document, not code.
 *
 * @param {*} option - The raw front-matter or option value
 * @returns {Set<number>} Heading levels (1-6) that should start a new page
 */
export function normalisePageBreakLevels(option) {
    if (!option && option !== 0) return new Set();
    if (option === true)         return new Set([1]);

    const items = Array.isArray(option) ? option : [option];
    const out   = new Set();

    for (const x of items) {
        if (typeof x === 'number' && x >= 1 && x <= 6) { out.add(x); continue; }
        if (typeof x === 'string') {
            const m = x.match(/^h?([1-6])$/i);
            if (m) out.add(parseInt(m[1], 10));
        }
    }
    return out;
}
