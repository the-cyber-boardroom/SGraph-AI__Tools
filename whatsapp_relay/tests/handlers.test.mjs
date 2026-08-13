/**
 * whatsapp_relay — Node tests (no wrangler, no network).
 * Run:  node whatsapp_relay/tests/handlers.test.mjs
 */

import { webcrypto } from 'node:crypto';
import { handleVerify, handleWebhook, handleMessages, handleOptions, signBody }
    from '../src/handlers.js';

let passed = 0, failed = 0;
const ok   = l => { console.log(`  ✓ ${l}`); passed++; };
const fail = (l, e) => { console.error(`  ✗ ${l}: ${e?.message || e}`); failed++; };
async function test(label, fn) { try { await fn(); ok(label); } catch (e) { fail(label, e); } }
const assert = (c, m = 'assertion') => { if (!c) throw new Error(m); };

/** Minimal in-memory KV honouring prefix list + TTL bookkeeping. */
function makeKV() {
    const store = new Map();
    return {
        store,
        async put(key, value, opts) { store.set(key, { value, opts }); },
        async get(key) { return store.get(key)?.value ?? null; },
        async list({ prefix = '' } = {}) {
            return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })) };
        },
    };
}

const env = () => ({
    KV: makeKV(),
    META_APP_SECRET: 'app-secret',
    META_VERIFY_TOKEN: 'verify-me',
    RELAY_TOKEN: 'relay-token',
});

const PAYLOAD = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'wamid.1' }] } }] }] });

const run = async () => {
    console.log('\nwhatsapp_relay handlers\n');

    await test('GET /webhook echoes hub.challenge on correct verify token', () => {
        const e = env();
        const url = new URL('https://r.example/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
        const res = handleVerify(url, e);
        assert(res.status === 200);
        return res.text().then(t => assert(t === '12345'));
    });

    await test('GET /webhook 403 on wrong verify token', () => {
        const url = new URL('https://r.example/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1');
        assert(handleVerify(url, env()).status === 403);
    });

    await test('POST /webhook stores payload when signature valid', async () => {
        const e = env();
        const sig = 'sha256=' + await signBody(e.META_APP_SECRET, PAYLOAD, webcrypto);
        const res = await handleWebhook(PAYLOAD, sig, e, { now: 1755100000000, cryptoImpl: webcrypto });
        assert(res.status === 200);
        assert(e.KV.store.size === 1, 'one KV entry');
        const [key, entry] = [...e.KV.store.entries()][0];
        assert(key.startsWith('msg:'), 'msg: prefix');
        assert(entry.opts.expirationTtl === 259200, '72h TTL default');
        assert(JSON.parse(entry.value).payload.entry[0].changes[0].field === 'messages');
    });

    await test('POST /webhook 401 on bad signature, nothing stored', async () => {
        const e = env();
        const res = await handleWebhook(PAYLOAD, 'sha256=deadbeef', e, { cryptoImpl: webcrypto });
        assert(res.status === 401 && e.KV.store.size === 0);
    });

    await test('POST /webhook 400 on invalid JSON (signature still required first)', async () => {
        const e = env();
        const bad = 'not-json';
        const sig = 'sha256=' + await signBody(e.META_APP_SECRET, bad, webcrypto);
        const res = await handleWebhook(bad, sig, e, { cryptoImpl: webcrypto });
        assert(res.status === 400);
    });

    await test('GET /messages requires bearer token', async () => {
        const res = await handleMessages(new URL('https://r.example/messages'), 'Bearer wrong', env());
        assert(res.status === 401);
    });

    await test('GET /messages returns items after cursor, ordered, with new cursor', async () => {
        const e = env();
        const mk = async (now) => {
            const sig = 'sha256=' + await signBody(e.META_APP_SECRET, PAYLOAD, webcrypto);
            await handleWebhook(PAYLOAD, sig, e, { now, cryptoImpl: webcrypto });
        };
        await mk(1000); await mk(2000); await mk(3000);
        const all = await handleMessages(new URL('https://r.example/messages?since='), 'Bearer relay-token', e);
        const body = JSON.parse(await all.text());
        assert(body.items.length === 3, 'all three');
        const afterCursor = await handleMessages(
            new URL(`https://r.example/messages?since=${encodeURIComponent(body.cursor)}`), 'Bearer relay-token', e);
        const body2 = JSON.parse(await afterCursor.text());
        assert(body2.items.length === 0 && body2.cursor === body.cursor, 'cursor is stable at the tip');
        assert(all.headers.get('Access-Control-Allow-Origin') === '*', 'CORS header for the desk');
    });

    await test('OPTIONS /messages preflight', () => {
        const res = handleOptions();
        assert(res.status === 204 && res.headers.get('Access-Control-Allow-Methods').includes('GET'));
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
};

run();
