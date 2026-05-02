/**
 * Markdown → HTML renderer for the Skills panel.
 * @module markdown
 * @version 0.1.57
 */

function inlineMarkdown(text) {
    return text
        .replace(/`([^`]+)`/g,       '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g,     '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g,     '<em>$1</em>')
        .replace(/_([^_]+)_/g,       '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/**
 * @param {string} text  raw markdown
 * @returns {string}  HTML string
 */
function renderMarkdown(text) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const codeBlocks = [];
    let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre><code class="lang-${lang||'text'}">${esc(code.trimEnd())}</code></pre>`);
        return `\x00CODE${idx}\x00`;
    });

    processed = esc(processed);
    processed = processed.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

    const lines = processed.split('\n');
    const html  = [];
    let inList = false, listTag = '', inTable = false, tableRows = [];

    const flushList  = () => { if (inList)  { html.push(`</${listTag}>`); inList = false; listTag = ''; } };
    const flushTable = () => {
        if (!inTable) return;
        const [headerRow, , ...bodyRows] = tableRows;
        const ths  = headerRow.split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('');
        const rows = bodyRows.map(r => '<tr>' + r.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('') + '</tr>').join('');
        html.push(`<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
        inTable = false; tableRows = [];
    };

    for (const line of lines) {
        if (line.includes('\x00CODE') || /<pre>/.test(line)) { flushList(); flushTable(); html.push(line); continue; }
        if (/^---+$/.test(line.trim())) { flushList(); flushTable(); html.push('<hr>'); continue; }
        const hm = line.match(/^(#{1,3})\s+(.*)/);
        if (hm) { flushList(); flushTable(); html.push(`<h${hm[1].length}>${inlineMarkdown(hm[2])}</h${hm[1].length}>`); continue; }
        if (line.startsWith('&gt; ')) { flushList(); flushTable(); html.push(`<blockquote>${inlineMarkdown(line.slice(5))}</blockquote>`); continue; }
        if (line.startsWith('|')) { flushList(); inTable = true; tableRows.push(line); continue; }
        else if (inTable) { flushTable(); }
        const ulm = line.match(/^[-*+]\s+(.*)/);
        const olm = line.match(/^\d+\.\s+(.*)/);
        if (ulm) { if (!inList || listTag !== 'ul') { flushList(); html.push('<ul>'); inList = true; listTag = 'ul'; } html.push(`<li>${inlineMarkdown(ulm[1])}</li>`); continue; }
        if (olm) { if (!inList || listTag !== 'ol') { flushList(); html.push('<ol>'); inList = true; listTag = 'ol'; } html.push(`<li>${inlineMarkdown(olm[1])}</li>`); continue; }
        flushList();
        if (!line.trim()) { html.push(''); continue; }
        html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
    flushList(); flushTable();
    return html.join('\n');
}

export { renderMarkdown, inlineMarkdown };
