/**
 * nr-handover.js
 * The agent handover bundle — the same session, packed for a reader that does
 * not have ears or eyes.
 *
 * WHAT IT DROPS, AND WHY. The full export carries per-capture WAVs, the
 * continuous take and a PDF. An agent gets nothing from any of them: it reads
 * the words from `session.json`, and it can already see the screenshots. The
 * audio is usually 90%+ of the bytes, so dropping it turns a bundle that has to
 * be uploaded into one that can be pasted around — and a smaller bundle is one
 * an agent can actually be handed inside a context window.
 *
 * WHAT IT ADDS. Two files that exist only here, both because agents asked for
 * them by using the data awkwardly without them:
 *
 * - **`uncertain.json`** — every span the cleanup model flagged, lifted out of
 *   the per-capture records and gathered into one list with its surrounding
 *   sentence. This is the single most-used part of the export: it is the tool
 *   saying "here is precisely what I am not sure I heard correctly", which is
 *   the thing a reader most needs and can most easily help with. Buried inside
 *   `pairs[i].clean.marks` it has to be hunted for; here it is the file.
 * - **`actions.json`** — what was done to this document, in order. The words
 *   say what was said; this says what was *decided* — reordered, re-transcribed,
 *   annotated, undone. None of it is recoverable from the finished document.
 *
 * @module nr-handover
 */

import { zipEntries } from '/core/sg-zip/v0/v0.1/v0.1.0/sg-zip.js';
import { state, sessionToJson } from './nr-state.js';
import { billingToJson } from './nr-billing.js';
import { buildDocument } from './nr-document.js';
import { actionsToJson } from './nr-actions.js';

/**
 * Every uncertain span in the session, with enough context to resolve it.
 *
 * A mark on its own ("meaning through connectivity") is not actionable — the
 * reader needs to know where it sat. So each carries the sentence around it and
 * the raw transcript for that capture, which is the evidence the correction was
 * made against.
 */
export function uncertainToJson() {
    const items = [];
    state.pairs.forEach((p, i) => {
        const marks = p.clean?.marks || [];
        if (!marks.length) return;
        const text = p.clean?.text || '';
        for (const m of marks) {
            const span = String(m.span || '');
            const at = span ? text.indexOf(span) : -1;
            items.push({
                momentIndex: i + 1,
                pairId: p.id,
                image: `images/pair-${String(i + 1).padStart(2, '0')}.png`,
                tMs: p.tPress ?? null,
                span,
                note: m.note || '',
                // The sentence it sits in, so the span can be judged in context
                // rather than in isolation.
                context: at >= 0 ? sentenceAround(text, at, span.length) : text.slice(0, 240),
                rawText: p.raw?.text || '',
            });
        }
    });
    return {
        schema: {
            name: 'narrated-review/uncertain',
            version: 1,
            note: 'Spans the cleanup model flagged as UNCERTAIN while correcting the transcript '
                + 'against the screenshot. These are the places where the words are least '
                + 'trustworthy and where a reader who knows the subject can help most. '
                + '`context` is the sentence the span sits in; `rawText` is what was actually '
                + 'heard, unedited. Resolving one means choosing between them, not inventing '
                + 'a third option.',
            resolve: 'Look at `image`, read `context`, compare with `rawText`. If the raw text '
                + 'makes sense in view of the screenshot, the raw text is probably right.',
        },
        sessionId: state.sessionId,
        count: items.length,
        capturesWithUncertainty: new Set(items.map(i => i.pairId)).size,
        totalCaptures: state.pairs.length,
        items,
    };
}

/** The sentence containing `at`, bounded by sentence punctuation. */
function sentenceAround(text, at, len) {
    const before = text.lastIndexOf('.', at);
    const q = Math.max(text.lastIndexOf('?', at), text.lastIndexOf('!', at));
    const start = Math.max(before, q) + 1;
    const rest = text.slice(at + len);
    const endRel = rest.search(/[.?!]/);
    const end = endRel < 0 ? text.length : at + len + endRel + 1;
    return text.slice(Math.max(0, start), end).trim();
}

/** The bundle's front page, written for a reader that is a program. */
export function buildHandoverReadme() {
    const n = state.pairs.length;
    const unc = uncertainToJson();
    return [
        `# Agent handover — ${state.sessionId || 'session'}`,
        '',
        `${n} capture${n === 1 ? '' : 's'}. Someone narrated a walk through a screen; this is what they`,
        'showed and what they said about it, aligned.',
        '',
        '**No audio and no PDF in this bundle.** They are in the full export and carry nothing',
        'you can use. Everything here is text or images.',
        '',
        '## Read in this order',
        '',
        '1. **`session.json` → `moments[]`** — one entry per capture in document order, each',
        '   joining its image, words and raw transcript. Do not parse `review.md` to rebuild',
        '   that join; it is already made.',
        `2. **\`uncertain.json\`** — ${unc.count} span${unc.count === 1 ? '' : 's'} the cleanup model was not sure it heard correctly,`,
        `   across ${unc.capturesWithUncertainty} of ${unc.totalCaptures} captures. **Start here if you are looking for where to help.**`,
        '   Each carries the sentence it sits in and the unedited transcript to compare against.',
        '3. **`review.md`** — the same content as prose, if you would rather read it that way.',
        '4. **`actions.json`** — what was done to this document and when: reorders, re-transcribes,',
        '   notes, undos. The words say what was *said*; this says what was *decided*, and none of',
        '   it survives into the finished document.',
        '',
        '## Three kinds of text, and they are not interchangeable',
        '',
        '| Field | What it is | How much to trust it |',
        '|---|---|---|',
        '| `rawText` | What the recogniser heard. Never edited. | Verbatim, but may be wrong |',
        '| `text` (`textSource:"clean"`) | Those words corrected against the screenshot | Better — except any span in `marks` |',
        '| `notes` | Commentary added afterwards by a human or agent | **Never something that was said** |',
        '',
        'A span listed in `marks` is unresolved, not settled. Treating it as settled is the',
        'single easiest way to build a confident wrong summary from this bundle.',
        '',
        '## Contents',
        '',
        '| Path | What |',
        '|---|---|',
        '| `session.json` | Everything, including `moments[]`. Authoritative. |',
        '| `uncertain.json` | Every flagged span, with context. |',
        '| `actions.json` | Append-only history of what was done. |',
        '| `review.md` | The readable document. |',
        '| `images/` | One screenshot per capture, named by document position. |',
        '| `raw/` | Unedited transcript per capture, by stable id. |',
        '| `billing.json` | What each model call cost, by capture. |',
        '',
        '*Built by narrated-review (tools.sgraph.ai).*',
        '',
    ].join('\n');
}

/**
 * Entry list for the handover bundle (pure over current state).
 * @returns {{ entries: Array, count: number, bytesSaved: string }}
 */
export function buildHandoverEntries() {
    const { markdown, images } = buildDocument(state, state.pairs);
    const entries = [
        { path: 'README.md', text: buildHandoverReadme() },
        { path: 'session.json', text: JSON.stringify(sessionToJson(), null, 2) },
        { path: 'uncertain.json', text: JSON.stringify(uncertainToJson(), null, 2) },
        { path: 'actions.json', text: JSON.stringify(actionsToJson(), null, 2) },
        { path: 'review.md', text: markdown },
    ];
    for (const { name, pairId } of images) {
        const pair = state.pairs.find(p => p.id === pairId);
        if (pair && pair.screenshot) entries.push({ path: `images/${name}`, blob: pair.screenshot });
    }
    for (const pair of state.pairs) {
        if (pair.raw) entries.push({ path: `raw/${pair.id}.txt`, text: pair.raw.text });
    }
    if (state.billing.length) entries.push({ path: 'billing.json', text: JSON.stringify(billingToJson(), null, 2) });
    return { entries, count: state.pairs.length };
}

/**
 * Build the handover zip.
 * @param {{ JSZip?: Function }} [opts]
 * @returns {Promise<{ blob, name, count, omitted }>}
 */
export async function buildHandoverZip(opts = {}) {
    const { entries, count } = buildHandoverEntries();
    const blob = await zipEntries(entries, { JSZip: opts.JSZip });
    return {
        blob,
        name: `narrated-review-${state.sessionId || 'session'}-handover.zip`,
        count,
        // Stated so the difference from the full export is never a surprise —
        // someone will eventually reach for the audio and needs to know where
        // it went rather than thinking the export was broken.
        omitted: ['audio/ (per-capture WAVs and the continuous take)', 'the PDF'],
    };
}
