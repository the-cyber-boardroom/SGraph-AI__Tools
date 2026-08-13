/**
 * server.js
 * Thin localhost HTTP server around the pure handlers. Providers:
 *   --mock            canned data, no WhatsApp (default when Baileys absent)
 *   (default)         Baileys companion provider (needs `npm i` + a QR link)
 *
 * Env:
 *   BRIDGE_TOKEN   bearer token the desk must present (required)
 *   BRIDGE_PORT    default 8787
 *   BRIDGE_HOST    default 127.0.0.1  (localhost-only — do NOT bind 0.0.0.0)
 *
 * Run:  BRIDGE_TOKEN=secret node src/server.js --mock
 */

import http from 'node:http';
import { handle } from './handlers.js';

const PORT  = Number(process.env.BRIDGE_PORT) || 8787;
const HOST  = process.env.BRIDGE_HOST || '127.0.0.1';
const TOKEN = process.env.BRIDGE_TOKEN || '';
const MOCK  = process.argv.includes('--mock');

if (!TOKEN) { console.error('BRIDGE_TOKEN is required.'); process.exit(1); }

async function makeProvider() {
    if (MOCK) {
        const { createMockProvider } = await import('./provider-mock.js');
        console.log('[bridge] provider: mock');
        return createMockProvider();
    }
    try {
        const { createBaileysProvider } = await import('./provider-baileys.js');
        console.log('[bridge] provider: baileys (scan the QR printed on link)');
        return await createBaileysProvider();
    } catch (err) {
        console.error('[bridge] Baileys provider unavailable — run `npm install` in whatsapp_bridge/, or pass --mock.');
        console.error('        ', err.message);
        process.exit(1);
    }
}

const provider = await makeProvider();

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    const query = Object.fromEntries(url.searchParams.entries());
    // POST bodies arrive as query for the tiny surface here (send takes chatId+body);
    // read a JSON body too if present and merge.
    if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        if (chunks.length) { try { Object.assign(query, JSON.parse(Buffer.concat(chunks).toString())); } catch { /* query-only */ } }
    }
    const out = await handle(provider, TOKEN, {
        method: req.method, path: url.pathname, query,
        authHeader: req.headers['authorization'],
    });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
});

server.listen(PORT, HOST, () => console.log(`[bridge] listening on http://${HOST}:${PORT}`));
