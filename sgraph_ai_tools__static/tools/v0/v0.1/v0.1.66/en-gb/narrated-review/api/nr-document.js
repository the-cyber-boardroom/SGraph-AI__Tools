/**
 * nr-document.js
 * The markdown assembler (pure): ordered pairs → one document, one section per
 * pair — heading, image reference, the words about it. Clean text leads when
 * present ([unsure] marks as footnotes); raw sits in a collapsible appendix so
 * the source always ships with the derived (source brief claims 9, 12).
 *
 * @module nr-document
 */

/** mm:ss for a session timestamp. @param {number} ms @returns {string} */
export function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Image filename for a pair. @param {object} pair @returns {string} */
export function imageName(pair) {
    return `pair-${String(pair.seq + 1).padStart(2, '0')}.png`;
}

/**
 * Build the review document.
 * @param {object} session  the serialisable session (nr-state sessionToJson shape
 *                          is fine, but the live state object works too)
 * @param {object[]} pairs  ordered pairs (live objects; screenshot presence read)
 * @returns {{ markdown: string, images: Array<{ name: string, pairId: string }> }}
 */
export function buildDocument(session, pairs) {
    const ordered = [...pairs].sort((a, b) => a.seq - b.seq);
    const images = [];
    const lines = [];
    const dur = session.durationMs ? ` · ${fmtTime(session.durationMs)}` : '';

    lines.push(`# Narrated review — ${session.sessionId || 'session'}`);
    lines.push('');
    lines.push(`*${ordered.length} moments${dur} · captured with narrated-review (tools.sgraph.ai)*`);
    if (session.rollingSummary) {
        lines.push('');
        lines.push(`**Session summary:** ${session.rollingSummary}`);
    }

    const unsureNotes = [];
    for (const p of ordered) {
        lines.push('');
        lines.push(`## ${p.seq + 1}. At ${fmtTime(p.tPress)}`);
        lines.push('');
        if (p.screenshot || p.hasScreenshot) {
            const name = imageName(p);
            images.push({ name, pairId: p.id });
            lines.push(`![Moment ${p.seq + 1}](images/${name})`);
            lines.push('');
        }
        const clean = p.clean && p.clean.text;
        const raw = p.raw && p.raw.text;
        if (clean) {
            let text = clean;
            for (const m of (p.clean.marks || [])) {
                if (m.span && text.includes(m.span)) {
                    unsureNotes.push(`- Moment ${p.seq + 1}: "${m.span}" — ${m.note || 'uncertain'}`);
                    text = text.replace(m.span, `${m.span} [unsure]`);
                }
            }
            lines.push(text);
        } else if (raw) {
            lines.push(raw);
        } else {
            lines.push('*(no transcript for this segment)*');
        }
    }

    if (unsureNotes.length) {
        lines.push('');
        lines.push('## Uncertain corrections');
        lines.push('');
        lines.push('*The cleanup model flagged these spans rather than resolving them silently:*');
        lines.push('');
        lines.push(...unsureNotes);
    }

    const rawSections = ordered.filter(p => p.clean && p.raw);
    if (rawSections.length) {
        lines.push('');
        lines.push('## Appendix — raw transcripts');
        lines.push('');
        lines.push('*Unedited recogniser output (the source; the sections above are derived).*');
        for (const p of rawSections) {
            lines.push('');
            lines.push(`### Moment ${p.seq + 1} (raw)`);
            lines.push('');
            lines.push(p.raw.text);
        }
    }

    lines.push('');
    return { markdown: lines.join('\n'), images };
}
