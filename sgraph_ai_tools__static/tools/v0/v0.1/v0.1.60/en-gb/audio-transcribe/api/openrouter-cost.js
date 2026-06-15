/**
 * openrouter-cost — fetch the exact charged cost of one generation.
 *
 * After a chat completion, OpenRouter exposes the true cost a couple of seconds
 * later at GET /api/v1/generation?id=<id>. We capture the generation id from the
 * response and look the cost up here. `fetchImpl` is injectable for testing.
 *
 * @module audio-transcribe/openrouter-cost
 */

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * Fetch the total cost (USD) for a generation id. Returns null if unavailable
 * (e.g. not yet ready, bad key, network error) — callers should treat null as
 * "unknown", never as zero.
 *
 * @param {string} id              OpenRouter generation id (from rawResponse.id)
 * @param {string} apiKey          OpenRouter key
 * @param {{ fetchImpl?: Function, baseUrl?: string }} [opts]
 * @returns {Promise<number|null>} total cost in USD, or null
 */
export async function fetchGenerationCost(id, apiKey, opts = {}) {
    if (!id || !apiKey) return null;
    const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return null;
    const base = opts.baseUrl || OPENROUTER_BASE;
    try {
        const res = await fetchImpl(`${base}/generation?id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res || !res.ok) return null;
        const json = await res.json();
        const data = json && json.data ? json.data : json;
        const cost = data && (data.total_cost != null ? data.total_cost : data.cost);
        return typeof cost === 'number' ? cost : null;
    } catch (_) {
        return null;
    }
}

/**
 * Fetch the cost with a short delay + one retry, since the generation row is not
 * immediately queryable. Resolves to a number or null.
 *
 * @param {string} id
 * @param {string} apiKey
 * @param {{ fetchImpl?: Function, baseUrl?: string, delayMs?: number, sleep?: Function }} [opts]
 * @returns {Promise<number|null>}
 */
export async function fetchGenerationCostDeferred(id, apiKey, opts = {}) {
    const delayMs = opts.delayMs != null ? opts.delayMs : 2500;
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    await sleep(delayMs);
    let cost = await fetchGenerationCost(id, apiKey, opts);
    if (cost == null) { await sleep(delayMs); cost = await fetchGenerationCost(id, apiKey, opts); }
    return cost;
}
