/**
 * whatsapp_bridge — Node tests (mock provider, no WhatsApp, no network).
 * Run:  node whatsapp_bridge/tests/handlers.test.mjs
 */

import { handle } from '../src/handlers.js';
import { createMockProvider } from '../src/provider-mock.js';
import { normalizeMessage, jidToNumber } from '../src/normalize.js';

let passed = 0, failed = 0;
const ok   = l => { console.log(`  ✓ ${l}`); passed++; };
const fail = (l, e) => { console.error(`  ✗ ${l}: ${e?.message || e}`); failed++; };
async function test(label, fn) { try { await fn(); ok(label); } catch (e) { fail(label, e); } }
const assert = (c, m = 'assertion') => { if (!c) throw new Error(m); };

const TOKEN = 'bridge-secret';
const call = (provider, req) => handle(provider, TOKEN, req);
const auth = { authHeader: `Bearer ${TOKEN}` };
const body = res => JSON.parse(res.body);

const run = async () => {
    console.log('\nwhatsapp_bridge handlers (mock)\n');

    await test('jidToNumber strips suffixes', () => {
        assert(jidToNumber('447700900701@s.whatsapp.net') === '447700900701');
        assert(jidToNumber('447700900701:12@s.whatsapp.net') === '447700900701');
    });

    await test('normalizeMessage: inbound text + direction + voice + group-skip', () => {
        const me = '447700900500';
        const txt = normalizeMessage({ key: { id: 'x', remoteJid: '4477@s.whatsapp.net', fromMe: false },
            pushName: 'A', messageTimestamp: 1755000000, message: { conversation: 'hi' } }, me);
        assert(txt.direction === 'in' && txt.text === 'hi' && txt.timestamp === 1755000000000);
        const out = normalizeMessage({ key: { id: 'y', remoteJid: '4477@s.whatsapp.net', fromMe: true },
            messageTimestamp: 1, message: { conversation: 'yo' } }, me);
        assert(out.direction === 'out');
        const ptt = normalizeMessage({ key: { id: 'z', remoteJid: '4477@s.whatsapp.net', fromMe: false },
            messageTimestamp: 1, message: { audioMessage: { ptt: true } } }, me);
        assert(ptt.type === 'audio' && ptt.voice === true && ptt.mediaId === 'z');
        const grp = normalizeMessage({ key: { id: 'g', remoteJid: '123@g.us', fromMe: false }, message: { conversation: 'hi' } }, me);
        assert(grp === null, 'group skipped in v0.1');
    });

    await test('/health is open (no auth)', async () => {
        const res = await call(createMockProvider(), { method: 'GET', path: '/health' });
        assert(res.status === 200 && body(res).ok === true);
    });

    await test('data routes require the bearer token', async () => {
        const res = await call(createMockProvider(), { method: 'GET', path: '/chats', authHeader: 'Bearer nope' });
        assert(res.status === 401);
    });

    await test('/status reports linked + me', async () => {
        const res = await call(createMockProvider(), { method: 'GET', path: '/status', ...auth });
        const s = body(res);
        assert(s.linked === true && s.me.id === '447700900500');
    });

    await test('/chats lists conversations most-recent-first with unread', async () => {
        const res = await call(createMockProvider(), { method: 'GET', path: '/chats', ...auth });
        const { chats } = body(res);
        assert(chats.length === 2, `2 chats, got ${chats.length}`);
        assert(chats.some(c => c.id === '447700900702' && c.snippet.includes('voice')));
    });

    await test('/pull returns events after cursor, advancing', async () => {
        const p = createMockProvider();
        const first = body(await call(p, { method: 'GET', path: '/pull', query: { since: '' }, ...auth }));
        assert(first.events.length === 3 && first.cursor === '3');
        const empty = body(await call(p, { method: 'GET', path: '/pull', query: { since: first.cursor }, ...auth }));
        assert(empty.events.length === 0);
    });

    await test('/send appends an outbound message, visible on next pull', async () => {
        const p = createMockProvider();
        await call(p, { method: 'GET', path: '/pull', query: { since: '' }, ...auth });   // advance to tip
        const sent = body(await call(p, { method: 'POST', path: '/send', query: { chatId: '447700900701', body: 'on it' }, ...auth }));
        assert(sent.messageId.startsWith('mb-out-'));
        const after = body(await call(p, { method: 'GET', path: '/pull', query: { since: '3' }, ...auth }));
        assert(after.events.length === 1 && after.events[0].direction === 'out' && after.events[0].text === 'on it');
    });

    await test('/media returns base64 audio for the voice note', async () => {
        const res = await call(createMockProvider(), { method: 'GET', path: '/media', query: { messageId: 'mb3' }, ...auth });
        const m = body(res);
        assert(m.mimeType === 'audio/wav' && typeof m.base64 === 'string' && m.base64.length > 100);
    });

    await test('OPTIONS preflight + CORS on data routes', async () => {
        const pre = await call(createMockProvider(), { method: 'OPTIONS', path: '/chats' });
        assert(pre.status === 204 && pre.headers['Access-Control-Allow-Methods'].includes('GET'));
        const res = await call(createMockProvider(), { method: 'GET', path: '/status', ...auth });
        assert(res.headers['Access-Control-Allow-Origin'] === '*');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
};

run();
