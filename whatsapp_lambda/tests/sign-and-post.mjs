/**
 * sign-and-post.mjs — dev helper, zero dependencies.
 *
 * POSTs a correctly-signed fake WhatsApp webhook at any URL, so the whole
 * signature → dedupe → send path can be exercised before Meta is configured
 * (or against a deployed Lambda, to prove the live wiring).
 *
 * Usage:
 *   META_APP_SECRET=app-secret node tests/sign-and-post.mjs <url> [from] [text]
 *
 * Examples:
 *   # deployed Lambda; sends a real pong to <from> if the Meta token is live
 *   META_APP_SECRET=… node tests/sign-and-post.mjs https://…lambda-url.eu-west-2.on.aws/webhook 447700900001 ping
 *
 *   # repeat the same message id twice to prove idempotency
 *   … node tests/sign-and-post.mjs <url> 447700900001 ping --id wamid.fixed
 */

import { createHmac } from 'node:crypto';

const [, , url, from = '447700900001', textArg = 'ping', ...rest] = process.argv;
const secret = process.env.META_APP_SECRET;

if (!url || !secret) {
    console.error('Usage: META_APP_SECRET=… node tests/sign-and-post.mjs <url> [from] [text] [--id <messageId>]');
    process.exit(1);
}

const idFlag = rest.indexOf('--id');
const messageId = idFlag !== -1 ? rest[idFlag + 1] : `wamid.test${Date.now()}`;

const payload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
        id: 'WABA_ID',
        changes: [{
            field: 'messages',
            value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '000', phone_number_id: 'PNID' },
                contacts: [{ wa_id: from, profile: { name: 'Test Sender' } }],
                messages: [{
                    from,
                    id: messageId,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: textArg },
                }],
            },
        }],
    }],
});

const signature = 'sha256=' + createHmac('sha256', secret).update(Buffer.from(payload, 'utf8')).digest('hex');

const t0 = Date.now();
const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body: payload,
});
const body = await res.text();

console.log(`POST ${url}`);
console.log(`  message id : ${messageId}`);
console.log(`  text       : ${JSON.stringify(textArg)}`);
console.log(`  → ${res.status} ${body}  (${Date.now() - t0}ms)`);
process.exit(res.ok ? 0 : 1);
