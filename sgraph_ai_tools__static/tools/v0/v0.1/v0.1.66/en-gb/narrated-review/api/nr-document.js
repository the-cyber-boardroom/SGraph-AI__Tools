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

/** Per-pair audio filename in an export bundle. */
export function audioName(pair) { return `${pair.id}.wav`; }

/**
 * The machine-readable projection of the review — `moments[]`.
 *
 * WHY THIS EXISTS. The first agent handed one of these bundles had to parse
 * `review.md` headings to pair each image with its words, because nothing else
 * joined them: `pairs[]` carried the text but no image filename, and the images
 * are named `pair-01.png` by document position while the pairs are keyed `p01`
 * by identity. Everything needed was in the bundle and none of it was
 * addressable. That is an export defect, not a consumer problem.
 *
 * So each moment carries the join explicitly: the words inline (no second file
 * to open), the bundle-relative paths to the image, the audio and the raw
 * transcript, and `index` matching the `## N.` headings in `review.md` and the
 * `Moment N` labels in the PDF — so a consumer can cite either interchangeably.
 *
 * `text` is the best available words with `textSource` saying which they are —
 * because "corrected" and "as the recogniser heard it" are not the same claim,
 * and a consumer must be able to tell without guessing. `marks` are spans the
 * cleanup model flagged rather than resolved: an LLM reading this should treat
 * them as uncertain, which is exactly why they are structured here instead of
 * only appearing as `[unsure]` inside prose.
 *
 * Paths describe where things sit in an EXPORT (zip or vault folder). An export
 * may omit `audio/` by option, so a path is a location, not a guarantee.
 *
 * @param {object[]} pairs
 * @returns {object[]} one entry per capture, in document order
 */
export function momentsToJson(pairs) {
    return [...pairs].sort((a, b) => a.seq - b.seq).map(p => {
        const clean = p.clean && p.clean.text ? p.clean.text : null;
        const raw = p.raw && p.raw.text ? p.raw.text : null;
        const hasImage = !!(p.screenshot || p.hasScreenshot);
        return {
            index: p.seq + 1,
            id: p.id,
            tMs: p.tPress ?? null,
            at: p.tPress == null ? null : fmtTime(p.tPress),
            tStart: p.tStart ?? null,
            tEnd: p.tEnd ?? null,
            durationMs: p.tStart != null && p.tEnd != null ? p.tEnd - p.tStart : null,
            image: hasImage ? `images/${imageName(p)}` : null,
            audio: p.tEnd != null ? `audio/${audioName(p)}` : null,
            rawFile: raw ? `raw/${p.id}.txt` : null,
            text: clean || raw || null,
            textSource: clean ? 'clean' : raw ? 'raw' : 'none',
            rawText: raw,
            notes: p.notes || '',
            marks: (p.clean && p.clean.marks) || [],
            source: p.source || 'capture',
            videoAt: p.videoAt ?? null,
            models: { transcribe: (p.raw && p.raw.model) || null, clean: (p.clean && p.clean.model) || null },
            costUsd: { transcribe: (p.raw && p.raw.costUsd) ?? null, clean: (p.clean && p.clean.costUsd) ?? null },
        };
    });
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
        // Authored captures carry no timestamp — they were added, not narrated.
        lines.push(p.tPress == null ? `## ${p.seq + 1}. Added` : `## ${p.seq + 1}. At ${fmtTime(p.tPress)}`);
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
        } else if (!p.notes) {
            lines.push('*(no transcript for this segment)*');
        }
        // Notes are commentary added after the fact — marked as such so a
        // reader never mistakes them for what was said.
        if (p.notes) {
            lines.push('');
            for (const l of String(p.notes).split('\n')) lines.push(`> ${l}`);
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
