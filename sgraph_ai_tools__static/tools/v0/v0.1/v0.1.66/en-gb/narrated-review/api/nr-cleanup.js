/**
 * nr-cleanup.js
 * The screenshot-grounded cleanup call (Decision 6, source brief claim 7-8):
 * per segment the model receives the RAW transcript, the pair's SCREENSHOT
 * (grounded mode), and the ROLLING SUMMARY — never the history (constant cost,
 * claim 10). Strict-JSON contract, mark-don't-resolve; the response's summary
 * field IS the rolling-summary update (Decision 7).
 *
 * Pure builders/parsers are exported for headless tests; only runCleanup
 * touches the transport.
 *
 * @module nr-cleanup
 */

const CLEANUP_SYSTEM = [
    'You are a transcript corrector for a narrated screen review.',
    'You receive: the raw speech-to-text transcript of one segment, optionally a screenshot',
    'of what was on screen while the words were spoken, and a rolling summary of the session',
    'so far (it establishes names, product terms, and spellings).',
    'Correct ONLY recognition errors — misheard words, names and terms that are visible on',
    'the screenshot or established in the summary, punctuation and casing. Keep the speaker\'s',
    'wording, order, and meaning. Never add content. Never summarise the transcript.',
    'Where you are UNSURE of a correction, keep your best reading in cleanText and add the',
    'span to marks with a short note — surface doubt, never resolve it silently.',
    'Return STRICT JSON only, no markdown fences, exactly:',
    '{ "cleanText": string, "marks": [ { "span": string, "note": string } ],',
    '  "summary": string }',
    'summary = the rolling summary UPDATED with this segment (≤1500 characters: compress,',
    'keep names, terms, and spellings established so far).',
].join(' ');

/**
 * Read a Blob into a base64 data URL.
 * @param {Blob} blob @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
        fr.readAsDataURL(blob);
    });
}

/**
 * Build the cleanup messages (pure given a prepared imageDataUrl).
 * @param {{ rawText: string, summary: string, imageDataUrl?: string|null }} p
 * @returns {object[]} messages
 */
export function buildCleanupMessages({ rawText, summary, imageDataUrl }) {
    const content = [{
        type: 'text',
        text: `Rolling summary so far:\n${summary || '(session start — empty)'}\n\nRaw transcript of this segment:\n${rawText}`,
    }];
    if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    return [
        { role: 'system', content: CLEANUP_SYSTEM },
        { role: 'user', content },
    ];
}

/**
 * Parse the strict-JSON cleanup response. Tolerates accidental code fences.
 * Throws `{code:'clean-parse'}` on anything unusable.
 * @param {string} content
 * @returns {{ cleanText: string, marks: Array<{span,note}>, summary: string }}
 */
export function parseCleanupJson(content) {
    let text = String(content || '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    let data;
    try { data = JSON.parse(text); } catch (_) {
        throw Object.assign(new Error('Cleanup response was not valid JSON'), { code: 'clean-parse' });
    }
    if (!data || typeof data.cleanText !== 'string' || !data.cleanText.trim()) {
        throw Object.assign(new Error('Cleanup JSON missing cleanText'), { code: 'clean-parse' });
    }
    const marks = Array.isArray(data.marks)
        ? data.marks
            .filter(m => m && typeof m.span === 'string')
            .map(m => ({ span: m.span, note: typeof m.note === 'string' ? m.note : '' }))
        : [];
    return {
        cleanText: data.cleanText.trim(),
        marks,
        summary: typeof data.summary === 'string' ? data.summary.trim() : '',
    };
}

/**
 * Run one cleanup call through the isolated transport.
 * @param {{ pair: object, summary: string, mode: 'grounded'|'text-only', model: string, transport: Function }} p
 * @returns {Promise<{ cleanText, marks, summary, generationId, costUsd }>}
 */
export async function runCleanup({ pair, summary, mode, model, transport }) {
    let imageDataUrl = null;
    if (mode === 'grounded' && pair.screenshot) {
        imageDataUrl = await blobToDataUrl(pair.screenshot);
    }
    const messages = buildCleanupMessages({ rawText: pair.raw.text, summary, imageDataUrl });
    const res = await transport({ messages, model });
    const parsed = parseCleanupJson(res.content);
    return {
        ...parsed,
        generationId: res.generationId || null,
        costUsd: typeof res.responseCost === 'number' ? res.responseCost : null,
    };
}
