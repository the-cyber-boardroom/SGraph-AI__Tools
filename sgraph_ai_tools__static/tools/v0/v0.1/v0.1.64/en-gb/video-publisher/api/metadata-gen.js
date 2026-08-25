/**
 * metadata-gen.js
 * Typed metadata generation (Decision 6): wraps the isolated OpenRouter
 * transport with a strict-JSON contract — { title ≤100 chars, description,
 * tags[] } from the transcript — instead of a free-form chat + copy-paste.
 * @module metadata-gen
 */

/**
 * Curated metadata/description models (the audio-transcribe chat set).
 * Sonnet default — it writes noticeably better descriptions than the flash
 * tiers; the transcription default (gemini flash) stays cheap separately.
 */
export const METADATA_MODELS = [
    { id: 'anthropic/claude-sonnet-4-6',   label: 'Claude Sonnet 4.6 (best descriptions)' },
    { id: 'google/gemini-3.5-flash',       label: 'Gemini 3.5 Flash (fast + cheap)' },
    { id: 'anthropic/claude-haiku-4.5',    label: 'Claude Haiku 4.5' },
    { id: 'google/gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash Lite' },
];
export const METADATA_DEFAULT_MODEL = METADATA_MODELS[0].id;

const SYSTEM_PROMPT = [
    'You write YouTube upload metadata from a video transcript.',
    'Respond with ONLY a JSON object — no markdown fences, no commentary — shaped exactly:',
    '{ "title": string, "description": string, "tags": string[] }',
    'Rules: title ≤ 100 characters, punchy but faithful to the content.',
    'Description: 2–5 short paragraphs or a paragraph plus a bullet list of what the video covers; emojis only where they genuinely help.',
    'Tags: 5–12 short topical tags, no # prefix.',
].join('\n');

/**
 * Generate YouTube metadata from a transcript.
 *
 * @param {object} ctx
 * @param {(req: { messages: object[], model: string }) => Promise<{ content: string, generationId?: string, responseCost?: number }>} ctx.sendToLlm
 * @param {(generationId: string) => Promise<number|null>} [ctx.fetchCost]
 * @param {(entry: { kind: string, usd: number|null, generationId?: string }) => void} [ctx.onCost]
 * @param {object} params
 * @param {string} params.transcript
 * @param {string} [params.guidance]   free-text steer, e.g. "shorter, more emojis"
 * @param {string} [params.model]
 * @returns {Promise<{ title: string, description: string, tags: string[], model: string, generationId?: string, costUsd?: number }>}
 * @throws {Error & { code: 'no-transcript'|'bad-metadata-json' }}
 */
export async function generateMetadata({ sendToLlm, fetchCost, onCost }, params = {}) {
    const transcript = (params.transcript || '').trim();
    if (!transcript) throw Object.assign(new Error('No transcript to generate metadata from'), { code: 'no-transcript' });

    const model = params.model || METADATA_DEFAULT_MODEL;
    const messages = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nTRANSCRIPT:\n${transcript}` },
        { role: 'user',   content: params.guidance
            ? `Generate the metadata JSON. Guidance: ${params.guidance}`
            : 'Generate the metadata JSON.' },
    ];

    const res  = await sendToLlm({ messages, model });
    const meta = parseMetadataJson(res.content);

    let costUsd = (typeof res.responseCost === 'number') ? res.responseCost : undefined;
    if (res.generationId && fetchCost && costUsd == null) {
        try { costUsd = (await fetchCost(res.generationId)) ?? undefined; } catch (_e) { /* cost stays unknown */ }
    }
    onCost?.({ kind: 'metadata', usd: costUsd ?? null, generationId: res.generationId });

    return { ...meta, model, generationId: res.generationId, costUsd };
}

/**
 * Parse + validate the model's JSON (tolerating stray code fences).
 * @param {string} raw
 * @returns {{ title: string, description: string, tags: string[] }}
 */
export function parseMetadataJson(raw) {
    let text = String(raw || '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) text = fenced[1].trim();
    // Last resort: take the outermost {...} span.
    if (!text.startsWith('{')) {
        const a = text.indexOf('{'), b = text.lastIndexOf('}');
        if (a >= 0 && b > a) text = text.slice(a, b + 1);
    }

    let obj;
    try { obj = JSON.parse(text); }
    catch (e) {
        throw Object.assign(new Error(`Metadata response was not valid JSON: ${e.message}`), { code: 'bad-metadata-json' });
    }

    const title = String(obj.title || '').trim().slice(0, 100);
    const description = String(obj.description || '').trim();
    const tags = Array.isArray(obj.tags)
        ? obj.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20)
        : [];
    if (!title) throw Object.assign(new Error('Metadata JSON had no title'), { code: 'bad-metadata-json' });
    return { title, description, tags };
}
