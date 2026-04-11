/**
 * OpenRouter API helpers — pure fetch functions, no side effects.
 *
 * All functions return parsed JSON data (unwrapped from the `data` envelope
 * where applicable). Callers are responsible for error handling.
 *
 * @module openrouter/api
 * @version 0.1.23
 */

const OR_BASE = 'https://openrouter.ai/api/v1';

/**
 * @param {string} apiKey
 * @returns {HeadersInit}
 */
function _authHeaders(apiKey) {
    return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/**
 * Assert response is OK, throw with status text on failure.
 * @param {Response} res
 */
async function _assertOk(res) {
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error?.message || j.message || msg; } catch {}
        throw new Error(msg);
    }
}

// ── Key / account ─────────────────────────────────────────────────────────────

/**
 * Fetch current key stats (balance, rate limit, usage).
 * GET /api/v1/key
 * @param {string} apiKey
 * @returns {Promise<object>} { label, usage, limit, isFreeTier, rateLimitRequests, rateLimitInterval, ... }
 */
export async function fetchKeyStats(apiKey) {
    const res = await fetch(`${OR_BASE}/key`, { headers: _authHeaders(apiKey) });
    await _assertOk(res);
    const json = await res.json();
    return json.data ?? json;
}

// ── Models ────────────────────────────────────────────────────────────────────

/**
 * Fetch all available models (cached — no auth required but key included for consistency).
 * GET /api/v1/models
 * @param {string} apiKey
 * @param {{ query?: string, top?: number }} [filter]
 * @returns {Promise<object[]>} Array of model objects
 */
export async function fetchModels(apiKey, filter = {}) {
    const res  = await fetch(`${OR_BASE}/models`, { headers: _authHeaders(apiKey) });
    await _assertOk(res);
    const json = await res.json();
    let models = json.data ?? json;
    if (filter.query) {
        const q = filter.query.toLowerCase();
        models = models.filter(m => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q));
    }
    if (filter.top) models = models.slice(0, filter.top);
    return models;
}

/**
 * Fetch detail for a specific model.
 * GET /api/v1/models (filtered client-side)
 * @param {string} apiKey
 * @param {string} modelId
 * @returns {Promise<object|null>}
 */
export async function fetchModelDetail(apiKey, modelId) {
    const all = await fetchModels(apiKey);
    return all.find(m => m.id === modelId) ?? null;
}

// ── Usage & spending ──────────────────────────────────────────────────────────

/**
 * Fetch usage buckets.
 * GET /api/v1/usage/activity
 * @param {string} apiKey
 * @param {{ bucketDuration?: string }} [params]
 * @returns {Promise<object[]>}
 */
export async function fetchUsage(apiKey, params = {}) {
    const qs  = params.bucketDuration ? `?bucket_duration=${encodeURIComponent(params.bucketDuration)}` : '';
    const res = await fetch(`${OR_BASE}/usage/activity${qs}`, { headers: _authHeaders(apiKey) });
    await _assertOk(res);
    const json = await res.json();
    return json.data ?? json;
}

/**
 * Fetch spending grouped by model.
 * GET /api/v1/usage/credits-usage
 * @param {string} apiKey
 * @returns {Promise<object[]>}
 */
export async function fetchSpending(apiKey) {
    const res = await fetch(`${OR_BASE}/usage/credits-usage`, { headers: _authHeaders(apiKey) });
    await _assertOk(res);
    const json = await res.json();
    return json.data ?? json;
}

// ── Generation history ────────────────────────────────────────────────────────

/**
 * Fetch recent generation activity.
 * GET /api/v1/activity
 * @param {string} apiKey
 * @param {{ limit?: number, offset?: number }} [params]
 * @returns {Promise<object[]>}
 */
export async function fetchActivity(apiKey, params = {}) {
    const parts = [];
    if (params.limit  != null) parts.push(`limit=${params.limit}`);
    if (params.offset != null) parts.push(`offset=${params.offset}`);
    const qs  = parts.length ? `?${parts.join('&')}` : '';
    const res = await fetch(`${OR_BASE}/activity${qs}`, { headers: _authHeaders(apiKey) });
    await _assertOk(res);
    const json = await res.json();
    return json.data ?? json;
}

// ── Provisioned key management (requires management key) ─────────────────────

/**
 * List all provisioned API keys.
 * GET /api/v1/keys
 * @param {string} managementKey
 * @returns {Promise<object[]>}
 */
export async function fetchListKeys(managementKey) {
    const res = await fetch(`${OR_BASE}/keys`, { headers: _authHeaders(managementKey) });
    await _assertOk(res);
    const json = await res.json();
    return json.data ?? json;
}

/**
 * Create a new provisioned API key.
 * POST /api/v1/keys
 * @param {string} managementKey
 * @param {{ name: string, limit?: number }} params
 * @returns {Promise<{ key: string, hash: string, label: string }>}
 */
export async function fetchCreateKey(managementKey, params) {
    const body = { name: params.name };
    if (params.limit != null) body.limit = params.limit;
    const res = await fetch(`${OR_BASE}/keys`, {
        method:  'POST',
        headers: _authHeaders(managementKey),
        body:    JSON.stringify(body),
    });
    await _assertOk(res);
    const json = await res.json();
    return json.data ?? json;
}

/**
 * Delete a provisioned API key by its hash.
 * DELETE /api/v1/keys/{hash}
 * @param {string} managementKey
 * @param {string} hash
 * @returns {Promise<void>}
 */
export async function fetchDeleteKey(managementKey, hash) {
    const res = await fetch(`${OR_BASE}/keys/${encodeURIComponent(hash)}`, {
        method:  'DELETE',
        headers: _authHeaders(managementKey),
    });
    await _assertOk(res);
}
