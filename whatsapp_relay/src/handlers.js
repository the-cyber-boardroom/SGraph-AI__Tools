/**
 * whatsapp_relay — handler logic, separated from the Worker entry so plain
 * Node tests can drive it with a mocked KV (tests/handlers.test.mjs).
 *
 * The relay is a DUMB PIPE (brief part 2, Decision 2): it verifies Meta's
 * webhook signature, stores raw payloads in KV with a TTL, and serves them
 * to the bearer-authed desk. No parsing, no Meta token, no LLM keys.
 * A `config` KV key is reserved for the future Tier-2 responder (part 0 §3).
 *
 * env contract (Worker bindings/secrets):
 *   KV                  — KV namespace
 *   META_APP_SECRET     — webhook signature verification (secret)
 *   META_VERIFY_TOKEN   — the hub.challenge handshake token (secret)
 *   RELAY_TOKEN         — bearer token the desk presents (secret)
 *   RETENTION_SECONDS   — optional, default 259200 (72 h)
 */

const DEFAULT_TTL_S = 72 * 60 * 60;
const MSG_PREFIX    = 'msg:';

const te = new TextEncoder();

/** Constant-time-ish string compare (both sides hashed lengths are public anyway). */
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** HMAC-SHA256 hex of rawBody with the app secret (X-Hub-Signature-256). */
export async function signBody(secret, rawBody, cryptoImpl = crypto) {
    const key = await cryptoImpl.subtle.importKey(
        'raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await cryptoImpl.subtle.sign('HMAC', key, te.encode(rawBody));
    return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** GET /webhook — Meta's subscription handshake: echo hub.challenge. */
export function handleVerify(url, env) {
    const p = url.searchParams;
    if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === env.META_VERIFY_TOKEN) {
        return new Response(p.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
}

/**
 * POST /webhook — verify signature, store raw payload under a sortable key.
 * Always 200 on success so Meta doesn't retry-storm; 401 on bad signature.
 */
export async function handleWebhook(rawBody, signatureHeader, env, { now = Date.now(), cryptoImpl = crypto } = {}) {
    const expected = 'sha256=' + await signBody(env.META_APP_SECRET, rawBody, cryptoImpl);
    if (!safeEqual(signatureHeader ?? '', expected)) {
        return new Response('bad signature', { status: 401 });
    }
    let payload;
    try { payload = JSON.parse(rawBody); }
    catch { return new Response('bad json', { status: 400 }); }

    const key = `${MSG_PREFIX}${String(now).padStart(15, '0')}:${Math.random().toString(36).slice(2, 8)}`;
    const ttl = Number(env.RETENTION_SECONDS) > 0 ? Number(env.RETENTION_SECONDS) : DEFAULT_TTL_S;
    await env.KV.put(key, JSON.stringify({ receivedAt: now, payload }), { expirationTtl: ttl });
    return new Response('ok', { status: 200 });
}

/**
 * GET /messages?since=<cursor> — bearer-authed pull for the desk.
 * cursor = last key seen; returns items after it (KV list is key-ordered
 * and our keys are zero-padded timestamps, so lexicographic == chronological).
 */
export async function handleMessages(url, authHeader, env) {
    const token = (authHeader ?? '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(token, env.RELAY_TOKEN)) {
        return json({ error: 'unauthorized' }, 401);
    }
    const since = url.searchParams.get('since') ?? '';
    const list  = await env.KV.list({ prefix: MSG_PREFIX });
    const keys  = list.keys.map(k => k.name).filter(name => name > since).sort();

    const items = [];
    for (const name of keys.slice(0, 100)) {          // page cap; desk re-pulls
        const raw = await env.KV.get(name);
        if (raw) { try { items.push(JSON.parse(raw)); } catch { /* skip corrupt */ } }
    }
    const cursor = keys.length ? keys[Math.min(keys.length, 100) - 1] : since;
    return json({ items, cursor });
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Content-Type': 'application/json',
            // The desk is a browser app on another origin.
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Authorization',
        },
    });
}

/** OPTIONS preflight for /messages. */
export function handleOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}
