/**
 * sg-whatsapp-errors.js
 * Graph API error responses → typed { code } errors, the house convention
 * (mirrors core/sg-transcribe's llm-errors.js): embedders react to codes,
 * not to Meta's message strings.
 * @module sg-whatsapp-errors
 */

/** Stable error codes the desk / agents can branch on. */
export const WA_ERROR_CODES = Object.freeze([
    'auth-invalid',        // 190 / 401-ish — token expired, revoked, wrong scopes
    'window-expired',      // 131047 — re-engagement outside the 24h window
    'recipient-invalid',   // 131026 / 131030 — not a WhatsApp number / not in allowed list
    'template-unapproved', // 132000/132001/132012 — template missing, unapproved, or param mismatch
    'rate-limited',        // 4 / 80007 / 130429 — throttled
    'media-error',         // 131052/131053 — media download/upload failure
    'relay-unreachable',   // our relay: network failure
    'relay-auth',          // our relay: bearer token rejected
    'wa-error',            // anything else
]);

const GRAPH_CODE_MAP = new Map([
    [190,    'auth-invalid'],
    [131047, 'window-expired'],
    [131026, 'recipient-invalid'],
    [131030, 'recipient-invalid'],
    [132000, 'template-unapproved'],
    [132001, 'template-unapproved'],
    [132012, 'template-unapproved'],
    [4,      'rate-limited'],
    [80007,  'rate-limited'],
    [130429, 'rate-limited'],
    [131052, 'media-error'],
    [131053, 'media-error'],
]);

/**
 * Classify a Graph API error body (and/or HTTP status) into a typed error.
 * @param {{ status?: number, body?: any }} info  body = parsed Graph JSON (may be null)
 * @returns {Error & { code: string, status?: number, graphCode?: number, graphMessage?: string }}
 */
export function classifyGraphError({ status, body } = {}) {
    const g = body?.error;
    const graphCode = g?.code;
    let code = GRAPH_CODE_MAP.get(graphCode)
        ?? (status === 401 || status === 403 ? 'auth-invalid'
        :  status === 429 ? 'rate-limited'
        :  'wa-error');
    const message = g?.error_user_msg || g?.message
        || `WhatsApp API error${status ? ` (HTTP ${status})` : ''}`;
    return Object.assign(new Error(message), {
        code, status, graphCode, graphMessage: g?.message,
    });
}
