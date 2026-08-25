/**
 * whatsapp_lambda — Node tests. No AWS, no network, no dependencies.
 * Run:  node whatsapp_lambda/tests/handlers.test.mjs
 */

import { createHmac } from 'node:crypto';
import { handle, createSeenSet, buildPong, extractPings, signatureMatches } from '../src/handlers.mjs';

const SECRET = 'app-secret';
const VERIFY = 'verify-me';

let passed = 0, failed = 0;
const ok   = (l) => { console.log(`  ✓ ${l}`); passed++; };
const fail = (l, e) => { console.error(`  ✗ ${l}: ${e?.message || e}`); failed++; };
async function test(label, fn) { try { await fn(); ok(label); } catch (e) { fail(label, e); } }
const assert = (c, m = 'assertion') => { if (!c) throw new Error(m); };

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a Lambda Function URL event, correctly signed unless told otherwise. */
function makeEvent({ method = 'POST', path = '/webhook', body = '', query = {}, base64 = false, signature } = {}) {
    const raw = Buffer.from(body, 'utf8');
    const sig = signature ?? ('sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex'));
    return {
        requestContext: { http: { method, path } },
        // Deliberately mixed-case: the runtime lowercases, and so must we.
        headers: { 'X-Hub-Signature-256': sig, 'Content-Type': 'application/json' },
        queryStringParameters: query,
        body: base64 ? raw.toString('base64') : body,
        isBase64Encoded: base64,
    };
}

const textPayload = (id, from, body) => JSON.stringify({
    entry: [{ changes: [{ field: 'messages', value: {
        messages: [{ id, from, type: 'text', timestamp: '1755100000', text: { body } }],
    } }] }],
});

const statusPayload = () => JSON.stringify({
    entry: [{ changes: [{ field: 'messages', value: {
        statuses: [{ id: 'wamid.out1', recipient_id: '447700900001', status: 'read', timestamp: '1755100120' }],
    } }] }],
});

function makeDeps({ sendThrows = false } = {}) {
    const sends = [], logs = [];
    let clock = 1000;
    return {
        config: { appSecret: SECRET, verifyToken: VERIFY, accessToken: 'T', phoneNumberId: 'PNID', pongText: null },
        seen: createSeenSet(500),
        now: () => (clock += 7),
        cold: false,
        sendText: async (to, body) => {
            if (sendThrows) throw new Error('Graph send failed: HTTP 500');
            sends.push({ to, body });
            return { messageId: 'wamid.sent' };
        },
        log: (e) => logs.push(e),
        sends, logs,
    };
}

const body = (res) => JSON.parse(res.body);

// ── Tests ────────────────────────────────────────────────────────────────────

const run = async () => {
    console.log('\nwhatsapp_lambda ping/pong handlers\n');

    await test('GET /webhook echoes hub.challenge on the correct verify token', async () => {
        const res = await handle(makeEvent({ method: 'GET', query: {
            'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '12345',
        } }), makeDeps());
        assert(res.status === 200, `status ${res.status}`);
        assert(res.body === '12345', 'challenge echoed verbatim');
    });

    await test('GET /webhook 403s on a wrong verify token', async () => {
        const res = await handle(makeEvent({ method: 'GET', query: {
            'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1',
        } }), makeDeps());
        assert(res.status === 403);
    });

    await test('POST /webhook rejects a bad signature (401, nothing sent)', async () => {
        const deps = makeDeps();
        const res = await handle(makeEvent({
            body: textPayload('wamid.1', '447700900001', 'ping'),
            signature: 'sha256=deadbeef',
        }), deps);
        assert(res.status === 401, `status ${res.status}`);
        assert(deps.sends.length === 0, 'no send on bad signature');
    });

    await test('POST /webhook verifies over the RAW body when base64-encoded', async () => {
        const deps = makeDeps();
        const res = await handle(makeEvent({
            body: textPayload('wamid.b64', '447700900001', 'ping'),
            base64: true,
        }), deps);
        assert(res.status === 200, `status ${res.status}`);
        assert(deps.sends.length === 1, 'pong sent from a base64 body');
    });

    await test('a "ping" gets exactly one pong, to the right number', async () => {
        const deps = makeDeps();
        const res = await handle(makeEvent({ body: textPayload('wamid.2', '447700900001', 'ping') }), deps);
        assert(res.status === 200);
        assert(body(res).sent === 1, 'reported one send');
        assert(deps.sends.length === 1, 'one send');
        assert(deps.sends[0].to === '447700900001', 'replied to the sender');
        assert(deps.sends[0].body.startsWith('pong 🏓'), `body was "${deps.sends[0].body}"`);
    });

    await test('the pong carries the short message id and a latency figure', async () => {
        const deps = makeDeps();
        await handle(makeEvent({ body: textPayload('wamid.abcd', '447700900001', 'ping') }), deps);
        const sentBody = deps.sends[0].body;
        assert(sentBody.includes('…abcd'), `short id missing: ${sentBody}`);
        assert(/\d+ms/.test(sentBody), `latency missing: ${sentBody}`);
    });

    await test('a redelivered webhook (same message id) sends only one pong', async () => {
        const deps = makeDeps();
        const evt = () => makeEvent({ body: textPayload('wamid.dup', '447700900001', 'ping') });
        const first  = await handle(evt(), deps);
        const second = await handle(evt(), deps);
        assert(body(first).sent === 1 && body(second).sent === 0, 'second delivery sent nothing');
        assert(body(second).duplicates === 1, 'duplicate reported');
        assert(deps.sends.length === 1, 'exactly one send total');
    });

    await test('non-ping text gets no reply (but returns 200)', async () => {
        const deps = makeDeps();
        const res = await handle(makeEvent({ body: textPayload('wamid.3', '447700900001', 'hello there') }), deps);
        assert(res.status === 200 && deps.sends.length === 0);
    });

    await test('ping variants match; "pinging" does not', () => {
        const p = (s) => extractPings(JSON.parse(textPayload('id', 'from', s))).length;
        assert(p('ping') === 1 && p('  Ping!  ') === 1 && p('PING.') === 1, 'variants should match');
        assert(p('pinging') === 0 && p('ping me') === 0 && p('a ping') === 0, 'near-misses should not match');
    });

    await test('a statuses-only payload (receipts) sends nothing', async () => {
        const deps = makeDeps();
        const res = await handle(makeEvent({ body: statusPayload() }), deps);
        assert(res.status === 200 && deps.sends.length === 0);
        const summary = deps.logs.find((l) => l.event === 'webhook');
        assert(summary.statuses === 1 && summary.messages === 0, 'counted as a status, not a message');
    });

    await test('valid signature over malformed JSON → 400', async () => {
        const res = await handle(makeEvent({ body: 'not-json' }), makeDeps());
        assert(res.status === 400, `status ${res.status}`);
    });

    await test('a failed Graph send still returns 200 (no Meta retry storm)', async () => {
        const deps = makeDeps({ sendThrows: true });
        const res = await handle(makeEvent({ body: textPayload('wamid.4', '447700900001', 'ping') }), deps);
        assert(res.status === 200, `status ${res.status}`);
        assert(body(res).failed === 1, 'failure reported in the response');
        assert(deps.logs.some((l) => l.event === 'send-failed'), 'failure logged');
    });

    await test('message bodies are never logged', async () => {
        const deps = makeDeps();
        const secretText = 'CONFIDENTIAL-DIARY-ENTRY-9271';
        await handle(makeEvent({ body: textPayload('wamid.5', '447700900001', secretText) }), deps);
        assert(!JSON.stringify(deps.logs).includes(secretText), 'the message body leaked into the logs');
    });

    await test('GET /health reports readiness without echoing secrets', async () => {
        const deps = makeDeps();
        const res = await handle(makeEvent({ method: 'GET', path: '/health' }), deps);
        const b = body(res);
        assert(res.status === 200 && b.ok === true && b.configured === true);
        assert(!res.body.includes(SECRET) && !res.body.includes('PNID'), 'no secrets in the health body');
    });

    await test('unknown paths 404', async () => {
        const res = await handle(makeEvent({ method: 'GET', path: '/admin' }), makeDeps());
        assert(res.status === 404);
    });

    await test('createSeenSet evicts oldest ids beyond its cap', () => {
        const seen = createSeenSet(3);
        ['a', 'b', 'c', 'd'].forEach((id) => seen.add(id));
        assert(seen.size === 3, `size ${seen.size}`);
        assert(!seen.has('a') && seen.has('d'), 'oldest evicted, newest kept');
    });

    await test('signatureMatches is length-safe and buildPong honours an override', () => {
        assert(signatureMatches(Buffer.from('x'), 'sha256=short', SECRET) === false, 'short signature rejected');
        assert(buildPong({ messageId: 'wamid.zzzz', elapsedMs: 5, override: 'PONG' }) === 'PONG');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
};

run();
