/**
 * handlers.mjs
 * Pure request handling for the WhatsApp ping/pong Lambda.
 *
 * ZERO DEPENDENCIES: no AWS SDK, no npm packages — only `node:crypto`.
 * Everything from the outside world (config, clock, sender, dedupe store,
 * logger) is INJECTED, so the tests need neither AWS nor network.
 *
 * Routes:
 *   GET  /webhook  — Meta's subscription handshake (echo hub.challenge)
 *   POST /webhook  — verify signature → dedupe → reply "pong" to "ping"
 *   GET  /health   — liveness (no secrets echoed)
 *
 * @module whatsapp_lambda/handlers
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Matches "ping", "Ping!", "  PING ." — nothing else. */
const PING_RE = /^ping[\s!.?]*$/i;

// ── Small response helpers ───────────────────────────────────────────────────

const text = (status, body) => ({ status, headers: { 'Content-Type': 'text/plain' }, body });
const json = (status, obj)  => ({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

/** Constant-time string compare that tolerates unequal lengths. */
export function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── Request normalisation ────────────────────────────────────────────────────

/**
 * Normalise a Lambda Function URL (or API Gateway v2) event into a plain
 * request. The body is returned as a Buffer of the EXACT bytes Meta sent —
 * base64-decoding when the runtime flagged it — because the signature must be
 * computed over the raw payload, before any JSON parsing.
 *
 * @param {object} event
 * @returns {{ method: string, path: string, query: object, headers: object, rawBody: Buffer }}
 */
export function parseRequest(event = {}) {
    const http    = event.requestContext?.http ?? {};
    const method  = String(http.method || event.httpMethod || 'GET').toUpperCase();
    const path    = http.path || event.rawPath || '/';
    const headers = {};
    for (const [k, v] of Object.entries(event.headers || {})) headers[String(k).toLowerCase()] = v;
    const rawBody = event.body == null
        ? Buffer.alloc(0)
        : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    return { method, path, query: event.queryStringParameters || {}, headers, rawBody };
}

/**
 * Verify Meta's X-Hub-Signature-256 over the raw body.
 * @param {Buffer} rawBody
 * @param {string} headerValue  e.g. "sha256=abc123…"
 * @param {string} appSecret
 */
export function signatureMatches(rawBody, headerValue, appSecret) {
    if (!headerValue || !appSecret) return false;
    const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
    return safeEqual(String(headerValue), expected);
}

// ── Payload inspection ───────────────────────────────────────────────────────

/**
 * Pull out inbound text messages that say "ping".
 * Ignores statuses (delivery/read receipts) and every non-text type.
 * @param {object} payload  parsed webhook body
 * @returns {Array<{ messageId: string, from: string }>}
 */
export function extractPings(payload) {
    const out = [];
    for (const entry of payload?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
            if (change?.field !== 'messages') continue;
            for (const m of change?.value?.messages ?? []) {
                if (m?.type !== 'text' || !m.id || !m.from) continue;
                if (!PING_RE.test(String(m.text?.body ?? '').trim())) continue;
                out.push({ messageId: m.id, from: m.from });
            }
        }
    }
    return out;
}

/** Counts for the log line — never the message bodies themselves. */
export function countPayload(payload) {
    let messages = 0, statuses = 0;
    for (const entry of payload?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
            messages += (change?.value?.messages ?? []).length;
            statuses += (change?.value?.statuses ?? []).length;
        }
    }
    return { messages, statuses };
}

/** Last 4 characters of a WhatsApp message id — safe to log and to echo back. */
export const shortId = (id) => String(id || '').slice(-4);

/**
 * The reply text. Diagnostics by default: proving the round trip is the whole
 * point of this milestone, so the message carries what we want to see.
 */
export function buildPong({ messageId, elapsedMs, cold, override }) {
    if (override) return override;
    return `pong 🏓 (msg …${shortId(messageId)} · ${elapsedMs}ms${cold ? ' · cold start' : ''})`;
}

// ── Dedupe (Meta retries webhooks; without this you get double pongs) ────────

/**
 * Bounded FIFO set of seen message ids. Module-scope in the Lambda, so it
 * survives warm invocations — which covers Meta's retry window in practice.
 * A container recycle can let one duplicate through; DynamoDB is the fix when
 * that matters (see the plan, milestone 2).
 * @param {number} [max]
 */
export function createSeenSet(max = 500) {
    const set = new Set();
    const order = [];
    return {
        has: (id) => set.has(id),
        add(id) {
            if (set.has(id)) return;
            set.add(id);
            order.push(id);
            while (order.length > max) set.delete(order.shift());
        },
        get size() { return set.size; },
    };
}

// ── Route handlers ───────────────────────────────────────────────────────────

/** GET /webhook — Meta's subscription handshake. */
export function handleHandshake(query, verifyToken) {
    if (query['hub.mode'] === 'subscribe' && safeEqual(query['hub.verify_token'] ?? '', verifyToken ?? '')) {
        return text(200, String(query['hub.challenge'] ?? ''));
    }
    return text(403, 'forbidden');
}

/**
 * POST /webhook — verify, dedupe, reply to pings.
 *
 * Returns 200 once the signature is valid, even if a send fails: a non-200
 * makes Meta redeliver, which would multiply the failure rather than fix it.
 * Send failures are logged instead.
 */
export async function handleWebhook(req, deps) {
    const { config, sendText, seen, now = Date.now, cold = false, log = () => {} } = deps;
    const startedAt = now();

    if (!signatureMatches(req.rawBody, req.headers['x-hub-signature-256'], config.appSecret)) {
        log({ event: 'signature-rejected', bytes: req.rawBody.length });
        return text(401, 'bad signature');
    }

    let payload;
    try { payload = JSON.parse(req.rawBody.toString('utf8')); }
    catch { log({ event: 'bad-json', bytes: req.rawBody.length }); return text(400, 'bad json'); }

    const counts = countPayload(payload);
    const pings  = extractPings(payload);
    let sent = 0, duplicates = 0, failed = 0;

    for (const ping of pings) {
        if (seen.has(ping.messageId)) {
            duplicates++;
            log({ event: 'duplicate-skipped', id: shortId(ping.messageId) });
            continue;
        }
        seen.add(ping.messageId);
        const body = buildPong({
            messageId: ping.messageId,
            elapsedMs: now() - startedAt,
            cold,
            override: config.pongText,
        });
        try {
            await sendText(ping.from, body);
            sent++;
            log({ event: 'pong-sent', id: shortId(ping.messageId), ms: now() - startedAt });
        } catch (err) {
            failed++;
            log({ event: 'send-failed', id: shortId(ping.messageId), error: err?.message });
        }
    }

    log({ event: 'webhook', ...counts, pings: pings.length, sent, duplicates, failed });
    return json(200, { ok: true, sent, duplicates, failed });
}

/**
 * Route an incoming event. `/` is accepted alongside `/webhook` so a Function
 * URL configured without a path still works.
 */
export async function handle(event, deps) {
    const req = parseRequest(event);
    const isWebhook = req.path === '/webhook' || req.path === '/';

    if (isWebhook && req.method === 'GET')  return handleHandshake(req.query, deps.config.verifyToken);
    if (isWebhook && req.method === 'POST') return handleWebhook(req, deps);
    if (req.path === '/health' && req.method === 'GET') {
        return json(200, {
            ok: true,
            service: 'whatsapp-ping-pong',
            configured: !!(deps.config.appSecret && deps.config.accessToken && deps.config.phoneNumberId),
            cold: !!deps.cold,
        });
    }
    return text(404, 'not found');
}
