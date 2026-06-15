/**
 * llm-errors — map an OpenRouter/LLM HTTP error to a stable, typed code.
 *
 * The vault dev brief (Finding 7) asks for a clear typed error when a distributed
 * SG-API-secret key is rejected (TTL/usage exhausted, no credit, rate-limited) so
 * an embedder doesn't hang or fail silently. `sg-llm-request` already forwards the
 * HTTP `status` (and `bodyError`) on its REQUEST_ERROR event, so we classify on
 * the status code — NOT on brittle message-string matching.
 *
 * NB: a 401 cannot be told apart (key invalid vs revoked vs exhausted) from the
 * provider status alone — that finer distinction belongs to the SG-API-secret
 * layer that minted the key. Here we give the caller a typed bucket + the raw
 * status + the provider's message so it can refine if it knows more.
 *
 * @module audio-transcribe/llm-errors
 */

/** HTTP status → typed code. */
export const LLM_ERROR_CODES = Object.freeze({
    401: 'key-invalid',      // missing / bad / revoked key
    402: 'budget-exceeded',  // OpenRouter: insufficient credits
    403: 'key-exhausted',    // distributed secret no longer usable (TTL / usage cap)
    429: 'rate-limited',     // too many requests
});

/**
 * @param {{ status?: number, error?: string, bodyError?: string }} [detail]
 *        the REQUEST_ERROR event detail from sg-llm-request.
 * @returns {{ code: string, status: number, message: string }}
 */
export function classifyLlmError(detail = {}) {
    const status = detail.status || 0;
    const code = LLM_ERROR_CODES[status] || 'llm-error';
    const message = detail.bodyError || detail.error || 'LLM request failed';
    return { code, status, message };
}
