/**
 * handlers.js
 * Pure HTTP handlers over a provider (interface in provider-mock.js). No
 * Node http/Baileys imports here so tests drive them directly. Every data
 * route requires the bearer token; localhost-only is enforced by the server.
 * @module whatsapp_bridge/handlers
 */

function json(obj, status = 200) {
    return { status, headers: cors({ 'Content-Type': 'application/json' }), body: JSON.stringify(obj) };
}
function cors(extra = {}) {
    return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization', ...extra };
}

function authed(token, authHeader) {
    const t = (authHeader || '').replace(/^Bearer\s+/i, '');
    return token && t === token;
}

/**
 * @param {object} provider  provider instance
 * @param {string} token     bearer token this bridge requires
 * @param {{ method, path, query, authHeader }} req
 * @returns {Promise<{ status, headers, body }>}
 */
export async function handle(provider, token, { method, path, query = {}, authHeader } = {}) {
    if (method === 'OPTIONS') return { status: 204, headers: cors({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }), body: '' };
    if (path === '/health' && method === 'GET') return json({ ok: true, provider: provider.name });

    if (!authed(token, authHeader)) return json({ error: 'unauthorized' }, 401);

    try {
        if (path === '/status'   && method === 'GET')  return json(await provider.getStatus());
        if (path === '/link'     && method === 'POST') return json(await provider.link());
        if (path === '/unlink'   && method === 'POST') return json(await provider.unlink());
        if (path === '/chats'    && method === 'GET')  return json({ chats: await provider.listChats() });
        if (path === '/messages' && method === 'GET')  return json({ messages: await provider.getMessages(query.chatId, Number(query.limit) || 50) });
        if (path === '/pull'     && method === 'GET')  return json(await provider.pull(query.since || ''));
        if (path === '/send'     && method === 'POST') return json(await provider.sendText(query.chatId, query.body ?? query.text));
        if (path === '/media'    && method === 'GET')  return json(await provider.fetchMedia(query.messageId));
        return json({ error: 'not found' }, 404);
    } catch (err) {
        return json({ error: err.message, code: err.code || 'bridge-error' }, 500);
    }
}
