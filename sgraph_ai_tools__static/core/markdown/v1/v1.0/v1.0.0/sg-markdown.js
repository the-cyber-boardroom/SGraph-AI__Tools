/**
 * sg-markdown — Reusable markdown → HTML renderer.
 *
 * Pure JS, no external dependencies. Handles:
 *   - Fenced code blocks (```lang)
 *   - Headings (h1-h3)
 *   - Horizontal rules (---)
 *   - Blockquotes (> )
 *   - Tables (pipe-separated)
 *   - Ordered + unordered lists
 *   - Paragraphs
 *   - Inline: bold, italic, inline code, links
 *
 * HTML-escapes input first to prevent XSS.
 *
 * Originally lived inside sg-llm-output and infographic-gen tool. Extracted
 * to a reusable core module for use by vault file preview and other tools.
 *
 * @module sg-markdown
 * @version 1.0.0
 */

/**
 * HTML-escape a string for safe insertion into HTML.
 *
 * @param {string} s - Raw text
 * @returns {string} Escaped HTML
 */
export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Render inline markdown: bold, italic, inline code, links.
 *
 * @param {string} text - Already HTML-escaped
 * @returns {string} HTML with inline formatting
 */
export function inlineMarkdown(text) {
    return text
        .replace(/`([^`]+)`/g,       '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g,     '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g,     '<em>$1</em>')
        .replace(/_([^_]+)_/g,       '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/**
 * Render block + inline markdown to an HTML string.
 *
 * @param {string} text - Raw markdown source
 * @returns {string} HTML string ready for innerHTML
 */
export function renderMarkdown(text) {
    if (!text) return '';

    const codeBlocks = [];
    let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre><code class="lang-${lang || 'text'}">${escapeHtml(code.trimEnd())}</code></pre>`);
        return `\x00CODE${idx}\x00`;
    });

    processed = escapeHtml(processed);
    processed = processed.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

    const lines  = processed.split('\n');
    const html   = [];
    let inList   = false, listTag = '';
    let inTable  = false, tableRows = [];

    const flushList = () => {
        if (inList) { html.push(`</${listTag}>`); inList = false; listTag = ''; }
    };
    const flushTable = () => {
        if (!inTable) return;
        const [headerRow, , ...bodyRows] = tableRows;
        const ths  = headerRow.split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('');
        const rows = bodyRows.map(r =>
            '<tr>' + r.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'
        ).join('');
        html.push(`<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
        inTable = false; tableRows = [];
    };

    for (const line of lines) {
        if (line.includes('\x00CODE') || /<pre>/.test(line)) {
            flushList(); flushTable(); html.push(line); continue;
        }
        if (/^---+$/.test(line.trim())) {
            flushList(); flushTable(); html.push('<hr>'); continue;
        }

        const hm = line.match(/^(#{1,3})\s+(.*)/);
        if (hm) {
            flushList(); flushTable();
            html.push(`<h${hm[1].length}>${inlineMarkdown(hm[2])}</h${hm[1].length}>`);
            continue;
        }

        if (line.startsWith('&gt; ')) {
            flushList(); flushTable();
            html.push(`<blockquote>${inlineMarkdown(line.slice(5))}</blockquote>`);
            continue;
        }

        if (line.startsWith('|')) {
            flushList(); inTable = true; tableRows.push(line); continue;
        } else if (inTable) {
            flushTable();
        }

        const ulm = line.match(/^[-*+]\s+(.*)/);
        const olm = line.match(/^\d+\.\s+(.*)/);
        if (ulm) {
            if (!inList || listTag !== 'ul') { flushList(); html.push('<ul>'); inList = true; listTag = 'ul'; }
            html.push(`<li>${inlineMarkdown(ulm[1])}</li>`);
            continue;
        }
        if (olm) {
            if (!inList || listTag !== 'ol') { flushList(); html.push('<ol>'); inList = true; listTag = 'ol'; }
            html.push(`<li>${inlineMarkdown(olm[1])}</li>`);
            continue;
        }
        flushList();

        if (!line.trim()) { html.push(''); continue; }
        html.push(`<p>${inlineMarkdown(line)}</p>`);
    }

    flushList();
    flushTable();
    return html.join('\n');
}
