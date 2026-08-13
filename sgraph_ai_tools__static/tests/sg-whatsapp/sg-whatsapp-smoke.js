/**
 * sg-whatsapp — Node smoke test (no network, mocked fetch).
 * Run:  node tests/sg-whatsapp/sg-whatsapp-smoke.js
 *
 * Covers: request shapes for sendText/sendTemplate/sendMedia/markRead,
 * typed error classification (window-expired, auth, template, rate),
 * webhook normalization (text, voice note, receipt, unknown type),
 * window expiry math, relay pull (+ relay auth error).
 */

import { WhatsAppApi, GRAPH_BASE } from '../../core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-api.js';
import { parseWebhookPayload, windowExpiry } from '../../core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-parse.js';
import { RelayClient } from '../../core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-relay.js';
import { classifyGraphError } from '../../core/sg-whatsapp/v0/v0.1/v0.1.0/sg-whatsapp-errors.js';

let passed = 0, failed = 0;
const ok   = l => { console.log(`  ✓ ${l}`); passed++; };
const fail = (l, e) => { console.error(`  ✗ ${l}: ${e?.message || e}`); failed++; };
async function test(label, fn) { try { await fn(); ok(label); } catch (e) { fail(label, e); } }
const assert = (c, m = 'assertion') => { if (!c) throw new Error(m); };

/** fetch mock capturing calls, returning queued responses. */
function makeFetch(responses) {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        calls.push({ url, opts, json: opts.body ? JSON.parse(opts.body) : null });
        const r = responses.shift() ?? { status: 200, body: {} };
        return {
            ok: r.status < 400, status: r.status,
            json: async () => r.body,
            blob: async () => r.blob,
        };
    };
    return { fetchImpl, calls };
}

const SAMPLE_WEBHOOK = {
    entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: '447700900001', profile: { name: 'Ana P.' } }],
        messages: [
            { from: '447700900001', id: 'wamid.text1', timestamp: '1755100000', type: 'text', text: { body: 'Hello :)' } },
            { from: '447700900001', id: 'wamid.voice1', timestamp: '1755100060', type: 'audio',
              audio: { id: 'media-123', mime_type: 'audio/ogg; codecs=opus', voice: true } },
            { from: '447700900001', id: 'wamid.weird', timestamp: '1755100061', type: 'reaction' },
        ],
        statuses: [
            { id: 'wamid.out1', recipient_id: '447700900001', status: 'read', timestamp: '1755100120' },
        ],
    } }] }],
};

const run = async () => {
    console.log('\nsg-whatsapp smoke\n');

    await test('sendText posts the right shape', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { messages: [{ id: 'wamid.X' }] } }]);
        const api = new WhatsAppApi({ token: 'T', phoneNumberId: 'PNID', fetchImpl });
        const r = await api.sendText('447700900001', 'hi');
        assert(r.messageId === 'wamid.X', 'messageId returned');
        assert(calls[0].url === `${GRAPH_BASE}/PNID/messages`, 'url');
        assert(calls[0].opts.headers.Authorization === 'Bearer T', 'auth header');
        assert(calls[0].json.type === 'text' && calls[0].json.text.body === 'hi', 'body');
    });

    await test('sendTemplate carries name + language', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { messages: [{ id: 'wamid.T' }] } }]);
        const api = new WhatsAppApi({ token: 'T', phoneNumberId: 'PNID', fetchImpl });
        await api.sendTemplate('447700900001', 'hello_world', 'en_GB');
        const j = calls[0].json;
        assert(j.type === 'template' && j.template.name === 'hello_world' && j.template.language.code === 'en_GB');
    });

    await test('sendMedia by id + caption', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { messages: [{ id: 'wamid.M' }] } }]);
        const api = new WhatsAppApi({ token: 'T', phoneNumberId: 'PNID', fetchImpl });
        await api.sendMedia('447700900001', { type: 'image', mediaId: 'm1', caption: 'pic' });
        const j = calls[0].json;
        assert(j.type === 'image' && j.image.id === 'm1' && j.image.caption === 'pic');
    });

    await test('markRead posts status read', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { success: true } }]);
        const api = new WhatsAppApi({ token: 'T', phoneNumberId: 'PNID', fetchImpl });
        await api.markRead('wamid.text1');
        assert(calls[0].json.status === 'read' && calls[0].json.message_id === 'wamid.text1');
    });

    await test('131047 → window-expired typed error', async () => {
        const { fetchImpl } = makeFetch([{ status: 400, body: { error: { code: 131047, message: 're-engagement' } } }]);
        const api = new WhatsAppApi({ token: 'T', phoneNumberId: 'PNID', fetchImpl });
        try { await api.sendText('4477', 'late'); throw new Error('should have thrown'); }
        catch (e) { assert(e.code === 'window-expired', `got ${e.code}`); }
    });

    await test('error classification table', () => {
        assert(classifyGraphError({ status: 401, body: { error: { code: 190 } } }).code === 'auth-invalid');
        assert(classifyGraphError({ body: { error: { code: 132001 } } }).code === 'template-unapproved');
        assert(classifyGraphError({ status: 429, body: null }).code === 'rate-limited');
        assert(classifyGraphError({ status: 500, body: {} }).code === 'wa-error');
    });

    await test('webhook normalization: text + voice note + receipt + tolerant unknown', () => {
        const ev = parseWebhookPayload(SAMPLE_WEBHOOK);
        assert(ev.length === 4, `4 events, got ${ev.length}`);
        const [text, voice, weird, receipt] = ev;
        assert(text.kind === 'message' && text.type === 'text' && text.text === 'Hello :)' && text.name === 'Ana P.');
        assert(voice.type === 'audio' && voice.voice === true && voice.mediaId === 'media-123');
        assert(weird.type === 'unknown', 'unknown type tolerated');
        assert(receipt.kind === 'receipt' && receipt.status === 'read' && receipt.messageId === 'wamid.out1');
        assert(text.timestamp === 1755100000000, 'seconds → ms');
    });

    await test('windowExpiry = inbound + 24h', () => {
        assert(windowExpiry(1000) === 1000 + 86_400_000);
    });

    await test('relay pull parses stored payloads + cursor', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { items: [{ payload: SAMPLE_WEBHOOK }], cursor: 'c2' } }]);
        const relay = new RelayClient({ url: 'https://relay.example/', token: 'RT', fetchImpl });
        const { events, cursor } = await relay.pull('c1');
        assert(events.length === 4 && cursor === 'c2');
        assert(calls[0].url === 'https://relay.example/messages?since=c1', 'trailing slash stripped + cursor passed');
        assert(calls[0].opts.headers.Authorization === 'Bearer RT');
    });

    await test('relay 401 → relay-auth typed error', async () => {
        const { fetchImpl } = makeFetch([{ status: 401, body: {} }]);
        const relay = new RelayClient({ url: 'https://relay.example', token: 'bad', fetchImpl });
        try { await relay.pull(); throw new Error('should have thrown'); }
        catch (e) { assert(e.code === 'relay-auth', `got ${e.code}`); }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
};

run();
