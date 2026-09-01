/**
 * service-worker.js — the middle of the extension.
 *
 * It holds the buffer for the armed tab and hands it to the tool page when
 * asked. It deliberately does NOT talk to any server: the events go from the
 * page, through here, into narrated-review in the user's own browser, and
 * nowhere else. There is no network code in this extension at all, which is the
 * cheapest way to be able to say that and mean it.
 *
 * The buffer is capped and drops OLDEST-first. A recorder that dies of its own
 * success halfway through a session is worse than one that admits it lost the
 * first few minutes — and `dropped` is reported either way.
 */

const MAX_EVENTS = 200_000;

/** tabId → { events, meta } */
const sessions = new Map();

function sessionFor(tabId) {
    if (!sessions.has(tabId)) {
        sessions.set(tabId, {
            events: [], dropped: 0, redacted: 0, startedAt: null,
            url: null, title: null, armed: false, cfg: null,
        });
    }
    return sessions.get(tabId);
}

function badge(tabId, armed) {
    try {
        chrome.action.setBadgeText({ tabId, text: armed ? 'REC' : '' });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
    } catch (_) { /* */ }
}

/** Inject both worlds. `activeTab` makes this legal only right after a click. */
async function arm(tabId, cfg) {
    const s = sessionFor(tabId);
    await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: ['page-hooks.js'],
        world: 'MAIN',
    });
    await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: ['content-input.js'],
        world: 'ISOLATED',
    });
    const [res] = await chrome.tabs.sendMessage(tabId, { type: 'sgpr:start', cfg })
        .then(r => [r]).catch(() => [null]);
    s.armed = true; s.cfg = cfg; s.startedAt = s.startedAt || Date.now();
    if (res) { s.url = res.url; s.title = res.title; }
    badge(tabId, true);
    return { armed: true, tabId, ...(res || {}) };
}

async function disarm(tabId) {
    const s = sessionFor(tabId);
    const res = await chrome.tabs.sendMessage(tabId, { type: 'sgpr:stop' }).catch(() => null);
    s.armed = false;
    badge(tabId, false);
    return { armed: false, tabId, ...(res || {}) };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || typeof msg.type !== 'string') return undefined;

    // ── From the recorded page ──────────────────────────────────────────────
    if (msg.type === 'sgpr:batch') {
        const tabId = sender.tab?.id;
        if (tabId == null) return undefined;
        const s = sessionFor(tabId);
        s.events.push(...(msg.events || []));
        s.dropped = msg.dropped || s.dropped;
        s.redacted = msg.redacted || s.redacted;
        s.url = msg.url || s.url;
        if (s.events.length > MAX_EVENTS) {
            const over = s.events.length - MAX_EVENTS;
            s.events.splice(0, over);
            s.dropped += over;
        }
        return undefined;
    }

    // ── From the popup, or from the tool page via content-bridge ────────────
    (async () => {
        try {
            if (msg.type === 'sgpr:arm') reply(await arm(msg.tabId ?? sender.tab?.id, msg.cfg || {}));
            else if (msg.type === 'sgpr:disarm') reply(await disarm(msg.tabId ?? sender.tab?.id));
            else if (msg.type === 'sgpr:list') {
                const out = [];
                for (const [tabId, s] of sessions) {
                    out.push({ tabId, armed: s.armed, url: s.url, title: s.title,
                        events: s.events.length, dropped: s.dropped, redacted: s.redacted, startedAt: s.startedAt });
                }
                reply({ tabs: out, version: chrome.runtime.getManifest().version });
            } else if (msg.type === 'sgpr:drain') {
                // Hand over everything buffered and clear it. The tool owns the
                // data from this point; keeping a second copy here would just be
                // a second place for it to leak from.
                const s = sessionFor(msg.tabId);
                const events = s.events; s.events = [];
                reply({ tabId: msg.tabId, events, dropped: s.dropped, redacted: s.redacted,
                    url: s.url, title: s.title, startedAt: s.startedAt, armed: s.armed });
            } else if (msg.type === 'sgpr:run') {
                reply(await chrome.tabs.sendMessage(msg.tabId, { type: 'sgpr:run', id: msg.id, js: msg.js, on: msg.on }));
            } else if (msg.type === 'sgpr:ping') {
                reply({ ok: true, version: chrome.runtime.getManifest().version });
            } else if (msg.type === 'sgpr:forget') {
                sessions.delete(msg.tabId);
                reply({ ok: true });
            } else return;
        } catch (err) {
            reply({ error: String(err && err.message || err) });
        }
    })();
    return true;                                          // async reply
});

chrome.tabs.onRemoved.addListener(tabId => sessions.delete(tabId));
