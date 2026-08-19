/**
 * md-blocks — source lines → a flat list of block descriptors.
 *
 * This is the structural half of the parser. It produces plain data objects and
 * touches no HTML at all; md-render turns them into markup. Keeping the two
 * apart is what makes the block grammar testable without string-matching tags.
 *
 * Block shapes:
 *   { type:'heading',    level, content }
 *   { type:'paragraph',  content }
 *   { type:'code_block', lang, content }
 *   { type:'blockquote', content }        content is markdown, parsed recursively
 *   { type:'ul'|'ol',    items[] }
 *   { type:'table',      headers[], aligns[], rows[][] }
 *   { type:'hr' }
 *   { type:'page_break' }
 *
 * @module core/markdown/md-blocks
 * @version 1.1.0
 */

/** A line that interrupts a paragraph or a list-item continuation. */
const BREAKS_FLOW = [
    /^#{1,6}\s/,            // heading
    /^```/,                 // fence
    /^>\s?/,                // quote
    /^\|/,                  // table
    /^\s*<!--\s*page-?break\s*-->\s*$/i,
];

const isUlLine = (l) => /^\s*[-*+]\s+/.test(l);
const isOlLine = (l) => /^\s*\d+\.\s+/.test(l);
const isHrLine = (l) => /^(\s*[-*_]\s*){3,}$/.test(l) && l.trim().length >= 3;

/**
 * Parse a document body into blocks.
 *
 * @param {string[]} lines - Body split on newlines (front matter already removed)
 * @returns {object[]} Block descriptors, in document order
 */
export function parseBlocks(lines) {
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (/^\s*<!--\s*page-?break\s*-->\s*$/i.test(line)) {
            blocks.push({ type: 'page_break' });
            i++;
            continue;
        }

        // Fenced code — taken verbatim, so nothing inside is ever parsed.
        if (/^```/.test(line)) {
            const lang = line.slice(3).trim();
            const codeLines = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
            i++;   // consume the closing fence (or run off the end, which is fine)
            blocks.push({ type: 'code_block', lang: lang || null, content: codeLines.join('\n') });
            continue;
        }

        if (isHrLine(line)) { blocks.push({ type: 'hr' }); i++; continue; }

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] });
            i++;
            continue;
        }

        // A table needs its delimiter row, else `|a|b|` is just a paragraph.
        if (/^\|(.+)\|/.test(line) && i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1])) {
            const tableLines = [];
            while (i < lines.length && /^\|/.test(lines[i])) { tableLines.push(lines[i]); i++; }
            blocks.push(parseTable(tableLines));
            continue;
        }

        if (/^>\s?/.test(line)) {
            const quoteLines = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                quoteLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
            continue;
        }

        if (isUlLine(line) || isOlLine(line)) {
            const ordered = isOlLine(line) && !isUlLine(line);
            const consumed = parseList(lines, i, ordered);
            blocks.push({ type: ordered ? 'ol' : 'ul', items: consumed.items });
            i = consumed.next;
            continue;
        }

        if (line.trim() === '') { i++; continue; }

        // Paragraph. The first line is taken unconditionally: it reached here
        // having matched no block branch, so if the loop were allowed to reject
        // it too the line would be dropped from the document entirely. That is
        // what a `|`-led line without a delimiter row does — it looks like a
        // table to startsNewBlock, but is not one.
        const paraLines = [lines[i]];
        i++;
        while (i < lines.length && lines[i].trim() !== '' && !startsNewBlock(lines[i])) {
            paraLines.push(lines[i]);
            i++;
        }
        blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
    }

    return blocks;
}

/** True when this line cannot be swallowed into the paragraph above it. */
function startsNewBlock(line) {
    return BREAKS_FLOW.some(re => re.test(line)) || isUlLine(line) || isOlLine(line) || isHrLine(line);
}

/**
 * Collect consecutive list items, including their wrapped continuation lines.
 *
 * Continuation follows CommonMark's rule: a line belongs to the item above when
 * it is indented at least as far as that item's content. That is what lets a
 * long bullet wrap across lines without silently becoming a new paragraph.
 *
 * @param {string[]} lines
 * @param {number} start - Index of the first item line
 * @param {boolean} ordered
 * @returns {{ items: string[], next: number }}
 */
function parseList(lines, start, ordered) {
    const matcher = ordered ? /^(\s*)\d+\.\s+(.*)/ : /^(\s*)[-*+]\s+(.*)/;
    const isItem  = ordered ? isOlLine : isUlLine;
    const items   = [];
    let i = start;

    while (i < lines.length && isItem(lines[i])) {
        const m       = lines[i].match(matcher);
        if (!m) break;
        const minCont = (m[1] || '').length + 2;
        let itemText  = m[2];
        i++;

        while (i < lines.length) {
            const next = lines[i];
            if (!next.trim()) break;
            if (BREAKS_FLOW.some(re => re.test(next))) break;

            const spaces = (next.match(/^(\s*)/)[1] || '').length;
            if (spaces < minCont) break;

            const stripped = next.slice(spaces);
            if (isUlLine(stripped) || isOlLine(stripped)) break;

            itemText += '\n' + stripped;
            i++;
        }
        items.push(itemText);
    }

    return { items, next: i };
}

/**
 * Parse a pipe table, including its column alignments.
 *
 * @param {string[]} lines - Header row, delimiter row, then body rows
 * @returns {object} A `table` block, or a `paragraph` when it is not one
 */
export function parseTable(lines) {
    if (lines.length < 2) return { type: 'paragraph', content: lines.join('\n') };

    const parseRow = (line) =>
        line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

    const headers = parseRow(lines[0]);
    const aligns  = parseRow(lines[1]).map((s) => {
        const t = s.trim();
        if (t.startsWith(':') && t.endsWith(':')) return 'center';
        if (t.endsWith(':')) return 'right';
        return 'left';
    });

    const rows = [];
    for (let i = 2; i < lines.length; i++) rows.push(parseRow(lines[i]));

    return { type: 'table', headers, aligns, rows };
}
