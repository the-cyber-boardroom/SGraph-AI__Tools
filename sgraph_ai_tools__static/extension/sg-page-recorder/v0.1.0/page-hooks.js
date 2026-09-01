/**
 * page-hooks.js — runs in the page's OWN world (MAIN).
 *
 * A content script cannot see the page's `console`, `fetch` or `XMLHttpRequest`
 * because it lives in an isolated world with its own copies. So this file is
 * injected into the page world and reports back over `window.postMessage`,
 * where `content-input.js` picks it up.
 *
 * THREE FEEDS:
 *
 * 1. **Console** — wraps `console.*` and catches `error` / `unhandledrejection`.
 *    Arguments are serialised shallowly, because a console line holding a live
 *    DOM node or a 40 MB object is common and would take the tab down with it.
 *
 * 2. **Network** — wraps `fetch` and `XMLHttpRequest`, plus a `PerformanceObserver`
 *    for everything else (images, scripts, beacons) which the wrappers never see.
 *    **Metadata only: method, URL, status, duration, size.** No headers and no
 *    bodies, ever, at any setting — that is where session tokens, cookies and
 *    personal data live, and a recording that quietly contains a bearer token is
 *    a liability rather than a feature. Query strings are stripped by default
 *    (`fullUrls` opts in), because ids and tokens hide there too.
 *
 * 3. **Scripted probes** — the page's own JavaScript, run on a trigger, with the
 *    result recorded into the timeline. This is arbitrary code execution in the
 *    page, authored by the operator: the point is to capture what a screenshot
 *    cannot — a computed style, a store's state, the length of a list. Every
 *    probe and every result is logged, so a reader can always see what was run.
 */

(() => {
    if (window.__sgprHooks) return;
    window.__sgprHooks = true;

    const MAX_STR = 2000;
    const cfg = { console: true, network: true, fullUrls: false };
    let on = false;
    const probes = [];

    const send = payload => {
        try { window.postMessage({ __sgpr: 'page', payload }, '*'); } catch (_) { /* */ }
    };

    /** Shallow, size-bounded serialisation. A console line is not a heap dump. */
    function brief(v, depth = 0) {
        try {
            if (v === null || v === undefined) return v ?? null;
            const t = typeof v;
            if (t === 'string') return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…[${v.length}]` : v;
            if (t === 'number' || t === 'boolean') return v;
            if (t === 'function') return `[fn ${v.name || 'anonymous'}]`;
            if (t === 'symbol' || t === 'bigint') return String(v);
            if (v instanceof Error) return { error: v.name, message: v.message, stack: String(v.stack || '').split('\n').slice(0, 4).join('\n') };
            if (typeof Node !== 'undefined' && v instanceof Node) return `[${v.nodeName}${v.id ? '#' + v.id : ''}]`;
            if (depth >= 2) return '[…]';
            if (Array.isArray(v)) return v.slice(0, 20).map(x => brief(x, depth + 1));
            const out = {};
            for (const k of Object.keys(v).slice(0, 20)) out[k] = brief(v[k], depth + 1);
            return out;
        } catch (_) { return '[unserialisable]'; }
    }

    const cleanUrl = u => {
        try {
            const url = new URL(u, location.href);
            if (cfg.fullUrls) return url.href;
            // The path is what identifies the request; the query is where the
            // secrets are. Report that a query existed rather than what it said.
            return url.origin + url.pathname + (url.search ? '?…' : '');
        } catch (_) { return String(u).slice(0, 200); }
    };

    // ── Console ─────────────────────────────────────────────────────────────
    const original = {};
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        original[level] = console[level].bind(console);
        console[level] = (...args) => {
            if (on && cfg.console) send({ t: Date.now(), k: 'console', level, args: args.map(a => brief(a)) });
            return original[level](...args);
        };
    }
    addEventListener('error', e => {
        if (on && cfg.console) send({ t: Date.now(), k: 'console', level: 'error', uncaught: true,
            args: [brief(e.error) || e.message], at: `${e.filename}:${e.lineno}` });
    });
    addEventListener('unhandledrejection', e => {
        if (on && cfg.console) send({ t: Date.now(), k: 'console', level: 'error', unhandledRejection: true, args: [brief(e.reason)] });
    });

    // ── Network ─────────────────────────────────────────────────────────────
    const realFetch = window.fetch;
    if (realFetch) {
        window.fetch = async function sgFetch(input, init) {
            if (!on || !cfg.network) return realFetch.apply(this, arguments);
            const started = Date.now();
            const url = cleanUrl(typeof input === 'string' ? input : input?.url);
            const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
            try {
                const res = await realFetch.apply(this, arguments);
                send({ t: started, k: 'net', via: 'fetch', method, url, status: res.status,
                    ms: Date.now() - started, ok: res.ok });
                return res;
            } catch (err) {
                send({ t: started, k: 'net', via: 'fetch', method, url, status: 0,
                    ms: Date.now() - started, ok: false, error: String(err && err.message || err) });
                throw err;
            }
        };
    }

    const RealXHR = window.XMLHttpRequest;
    if (RealXHR) {
        const open = RealXHR.prototype.open, sendM = RealXHR.prototype.send;
        RealXHR.prototype.open = function (method, url, ...rest) {
            this.__sgpr = { method: String(method || 'GET').toUpperCase(), url: cleanUrl(url) };
            return open.call(this, method, url, ...rest);
        };
        RealXHR.prototype.send = function (...args) {
            const meta = this.__sgpr;
            if (on && cfg.network && meta) {
                const started = Date.now();
                this.addEventListener('loadend', () => {
                    send({ t: started, k: 'net', via: 'xhr', method: meta.method, url: meta.url,
                        status: this.status, ms: Date.now() - started, ok: this.status >= 200 && this.status < 400 });
                }, { once: true });
            }
            return sendM.apply(this, args);
        };
    }

    // Everything the wrappers never see: images, stylesheets, beacons, media.
    let perfObs = null;
    try {
        perfObs = new PerformanceObserver(list => {
            if (!on || !cfg.network) return;
            for (const e of list.getEntries()) {
                if (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') continue;  // already have it
                send({ t: Date.now(), k: 'net', via: 'resource', kind: e.initiatorType,
                    url: cleanUrl(e.name), ms: Math.round(e.duration), size: e.transferSize || 0 });
            }
        });
    } catch (_) { /* */ }

    // ── Scripted probes ─────────────────────────────────────────────────────
    /**
     * Run operator-authored JavaScript and record the result.
     *
     * `new Function` rather than `eval` so the snippet cannot reach into this
     * closure and quietly rewrite the recorder that is watching it. The result
     * goes through `brief()` like everything else — a probe returning the whole
     * DOM should truncate, not crash the tab.
     */
    function runProbe(p, trigger) {
        const started = Date.now();
        try {
            const fn = new Function(`"use strict"; return (${p.js});`);
            const value = fn();
            const finish = v => send({ t: started, k: 'probe', id: p.id, on: trigger, ms: Date.now() - started, value: brief(v) });
            if (value && typeof value.then === 'function') value.then(finish, e => finish({ error: String(e) }));
            else finish(value);
        } catch (err) {
            send({ t: started, k: 'probe', id: p.id, on: trigger, ms: Date.now() - started,
                error: String(err && err.message || err) });
        }
    }

    function fireProbes(trigger) {
        for (const p of probes) if (p.on === trigger) runProbe(p, trigger);
    }

    addEventListener('message', ev => {
        if (ev.source !== window || !ev.data || ev.data.__sgpr !== 'cmd') return;
        const d = ev.data;
        if (d.cmd === 'start') {
            Object.assign(cfg, d.cfg || {});
            on = true;
            try { perfObs?.observe({ type: 'resource', buffered: false }); } catch (_) { /* */ }
            fireProbes('start');
        } else if (d.cmd === 'stop') {
            fireProbes('stop');
            on = false;
            try { perfObs?.disconnect(); } catch (_) { /* */ }
        } else if (d.cmd === 'run') {
            const p = { id: d.id, js: d.js, on: d.on || 'manual' };
            if (p.on === 'manual') runProbe(p, 'manual');
            else { probes.push(p); if (p.on === 'interval') startInterval(p); }
        }
    });

    const timers = [];
    function startInterval(p) {
        const every = Math.max(1000, Number(p.everyMs) || 5000);
        timers.push(setInterval(() => { if (on) runProbe(p, 'interval'); }, every));
    }

    // Probes bound to page events fire from here, so a click probe sees the
    // click at the same instant the input feed records it.
    for (const evName of ['click', 'keydown', 'scroll']) {
        addEventListener(evName, () => { if (on) fireProbes(evName); }, true);
    }
})();
