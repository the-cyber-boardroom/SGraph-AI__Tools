/**
 * whatsapp_relay — Cloudflare Worker entry. Routes only; logic in handlers.js.
 * Deploy: see ../README.md (wrangler + three secrets + one KV binding).
 */

import { handleVerify, handleWebhook, handleMessages, handleOptions } from './handlers.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/webhook' && request.method === 'GET') {
            return handleVerify(url, env);
        }
        if (url.pathname === '/webhook' && request.method === 'POST') {
            const rawBody = await request.text();
            return handleWebhook(rawBody, request.headers.get('X-Hub-Signature-256'), env);
        }
        if (url.pathname === '/messages' && request.method === 'GET') {
            return handleMessages(url, request.headers.get('Authorization'), env);
        }
        if (url.pathname === '/messages' && request.method === 'OPTIONS') {
            return handleOptions();
        }
        return new Response('not found', { status: 404 });
    },
};
