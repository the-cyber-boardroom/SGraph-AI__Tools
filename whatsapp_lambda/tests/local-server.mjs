/**
 * local-server.mjs — run the Lambda handler locally over node:http.
 * Zero dependencies; the local mirror of src/index.mjs.
 *
 * Without META_ACCESS_TOKEN it uses a stub sender that just prints the reply,
 * so the full signature → dedupe → reply path is exercisable with no Meta
 * account at all. With the real token set, it sends for real.
 *
 *   META_APP_SECRET=app-secret META_VERIFY_TOKEN=verify-me \
 *   node tests/local-server.mjs                       # → http://127.0.0.1:8788
 *
 * Then, in another shell:
 *   META_APP_SECRET=app-secret node tests/sign-and-post.mjs \
 *     http://127.0.0.1:8788/webhook 447700900001 ping
 */

import http from 'node:http';
import { handle, createSeenSet } from '../src/handlers.mjs';
import { makeSender } from '../src/send.mjs';

const PORT = Number(process.env.PORT) || 8788;

const config = {
    appSecret:     process.env.META_APP_SECRET,
    verifyToken:   process.env.META_VERIFY_TOKEN,
    accessToken:   process.env.META_ACCESS_TOKEN,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID,
    pongText:      process.env.PONG_TEXT || null,
};

if (!config.appSecret) { console.error('META_APP_SECRET is required.'); process.exit(1); }

const live = !!(config.accessToken && config.phoneNumberId);
const sendText = live
    ? makeSender({ token: config.accessToken, phoneNumberId: config.phoneNumberId })
    : async (to, body) => { console.log(`  📤 [stub send] → ${to}: ${body}`); return { messageId: 'stub' }; };

const seen = createSeenSet(500);
let cold = true;

const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    const event = {
        requestContext: { http: { method: req.method, path: url.pathname } },
        headers: req.headers,
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        body: raw.toString('base64'),
        isBase64Encoded: true,          // exercises the base64 path, like a Function URL can
    };

    const wasCold = cold; cold = false;
    const out = await handle(event, {
        config, sendText, seen, now: Date.now, cold: wasCold,
        log: (e) => console.log(JSON.stringify(e)),
    });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[local] listening on http://127.0.0.1:${PORT}  (sender: ${live ? 'LIVE Graph API' : 'stub'})`);
});
