/**
 * yp-captions.js
 * Caption cue parsers — WebVTT, SRT and SBV.
 *
 * These live in the probe rather than in `core/youtube-api` on purpose. The
 * v0.2.92 pack's Decision 2 turns on a question nobody has answered yet — whether
 * the API will hand back an auto-generated track at all — and promoting a parser
 * into a core module before knowing whether it has a source is exactly the
 * "extract before validating" mistake the video-review pack already made once.
 * Promote after Phase 0, not before.
 *
 * WHAT A CUE IS, AND IS NOT. A cue is a couple of seconds of words with a start
 * and an end. It is NOT a capture: 45 minutes of talk is ~800 cues and ~40 slides,
 * so grouping cues against slide boundaries is a separate job (pack Decision 6).
 * This module's only contract is: text in, honest cues out.
 *
 * @module yp-captions
 */

/** `00:01:02.345`, `00:01:02,345`, `1:02.345` and `62.345` all mean the same thing. */
export function parseTimestamp(raw) {
    const s = String(raw).trim().replace(',', '.');
    const parts = s.split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return null;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return Math.round(sec * 1000);
}

/**
 * Strip the markup YouTube puts inside cue text: speaker spans (`<v Name>`),
 * class spans (`<c.colorE5E5E5>`), and the per-word timing tags
 * (`<00:00:01.234>`) that auto-captions use for the karaoke effect.
 *
 * Those word timings are thrown away deliberately. They are tempting — word-level
 * alignment! — but they are a property of the ASR, not of the talk, and nothing
 * downstream needs a finer grain than the cue.
 */
export function cleanCueText(text) {
    return String(text)
        .replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g, '')   // word timings
        .replace(/<\/?[cv](?:[.\s][^>]*)?>/gi, '')        // <v Name> / <c.foo>
        .replace(/<\/?[bi]>/gi, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/** WebVTT and SRT share a shape: an optional id line, `a --> b`, then text. */
function parseArrowFormat(text) {
    const cues = [];
    const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n').filter(l => l.trim() !== '');
        if (!lines.length) continue;
        const arrowAt = lines.findIndex(l => l.includes('-->'));
        if (arrowAt < 0) continue;                        // header ("WEBVTT"), NOTE, styling
        // Cue settings ride on the timing line — "align:start position:0%".
        const [from, restRaw] = lines[arrowAt].split('-->');
        const to = String(restRaw).trim().split(/\s+/)[0];
        const tMs = parseTimestamp(from);
        const endMs = parseTimestamp(to);
        if (tMs == null || endMs == null) continue;
        const body = cleanCueText(lines.slice(arrowAt + 1).join(' '));
        if (body) cues.push({ tMs, endMs, text: body });
    }
    return cues;
}

/** SBV: `0:00:01.000,0:00:04.000` then text. YouTube's own download format. */
function parseSbv(text) {
    const cues = [];
    for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
        const lines = block.split('\n').filter(l => l.trim() !== '');
        if (lines.length < 2 || !lines[0].includes(',')) continue;
        const [from, to] = lines[0].split(',');
        const tMs = parseTimestamp(from);
        const endMs = parseTimestamp(to);
        if (tMs == null || endMs == null) continue;
        const body = cleanCueText(lines.slice(1).join(' '));
        if (body) cues.push({ tMs, endMs, text: body });
    }
    return cues;
}

/**
 * Parse any of the three, sniffing the format.
 * @param {string} text
 * @param {{ format?: 'vtt'|'srt'|'sbv' }} [opts]
 * @returns {{ cues: Array<{tMs,endMs,text}>, format: string, dropped: number }}
 *   `dropped` counts blocks that looked like cues and could not be read — a
 *   parser that silently returns fewer cues than the file contains is the same
 *   defect class as a measurement that looks like a measurement and is not.
 */
export function parseCaptions(text, opts = {}) {
    const raw = String(text || '');
    const format = opts.format
        || (/^WEBVTT/m.test(raw) ? 'vtt'
            : raw.includes('-->') ? 'srt'
                : /^\d{1,2}:\d{2}:\d{2}[.,]\d{3},/m.test(raw) ? 'sbv' : 'unknown');
    const cues = format === 'sbv' ? parseSbv(raw) : format === 'unknown' ? [] : parseArrowFormat(raw);
    const blocks = raw.replace(/\r/g, '').split(/\n{2,}/)
        .filter(b => b.includes('-->') || /^\d{1,2}:\d{2}:\d{2}[.,]\d{3},/m.test(b)).length;
    return { cues, format, dropped: Math.max(0, blocks - cues.length) };
}

/**
 * Group cues into the spans between boundaries — pack Decision 6.
 *
 * A cue belongs to the span its MIDPOINT falls in, not its start: a cue that
 * straddles a slide change is mostly about one side of it, and its midpoint says
 * which. Cues before the first boundary attach to the first span rather than
 * being dropped, because the opening words of a talk are not noise.
 *
 * @param {Array} cues @param {number[]} boundariesMs sorted
 * @returns {Array<{ tStart, tEnd, text, cueCount }>}
 */
export function groupCuesByBoundaries(cues, boundariesMs, durationMs) {
    const bounds = [...new Set([0, ...boundariesMs])].sort((a, b) => a - b);
    const spans = bounds.map((b, i) => ({
        tStart: b, tEnd: i + 1 < bounds.length ? bounds[i + 1] : (durationMs || Infinity),
        parts: [], cueCount: 0,
    }));
    for (const c of cues) {
        const mid = c.tMs + (c.endMs - c.tMs) / 2;
        let idx = spans.findIndex(s => mid >= s.tStart && mid < s.tEnd);
        if (idx < 0) idx = mid < spans[0].tStart ? 0 : spans.length - 1;
        spans[idx].parts.push(c.text);
        spans[idx].cueCount += 1;
    }
    return spans.map(s => ({
        tStart: s.tStart, tEnd: Number.isFinite(s.tEnd) ? s.tEnd : (durationMs || s.tStart),
        text: s.parts.join(' ').replace(/\s+/g, ' ').trim(), cueCount: s.cueCount,
    }));
}
