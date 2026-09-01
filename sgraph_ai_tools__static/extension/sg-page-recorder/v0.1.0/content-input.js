/**
 * content-input.js — the recorder, injected into the page being narrated.
 *
 * Runs in the ISOLATED world, so it sees the page's DOM and its input events but
 * not its JavaScript. That is enough for mouse, keys, scroll and focus; console
 * and network need the page's own globals, so `page-hooks.js` is injected into
 * the MAIN world alongside this and reports back over `window.postMessage`.
 *
 * NOTHING RUNS UNTIL A TAB IS ARMED. This file is injected by the popup, under
 * `activeTab`, when the user explicitly asks for this tab — it is not a
 * content script sitting on every page waiting to be told to start. An
 * always-present keylogger that promises to be asleep is not a design anyone
 * should have to take on trust.
 *
 * KEYSTROKES ARE THE DANGEROUS FEED and are treated accordingly:
 *   - off (default) — nothing.
 *   - 'keys'        — WHICH key, never the character typed. Printable characters
 *                     become '·'. Enough to see shortcuts, navigation, rhythm
 *                     and hesitation, which is what a UX question actually asks.
 *   - 'text'        — literal characters. Explicit opt-in, per session.
 * In EVERY mode, a password field records nothing but the fact that typing
 * happened. Same for anything the page marks as sensitive. Redactions are
 * COUNTED and reported, so a reader can tell "they typed nothing here" from
 * "we refused to record what they typed".
 */

(() => {
    if (window.__sgPageRecorder) return;                 // idempotent re-injection

    const MOUSE_HZ = 30;                                 // 60 Hz for ten minutes is 36k points of nothing
    const MOUSE_MIN_PX = 2;                              // ignore sub-pixel jitter
    const FLUSH_MS = 1000;
    const CAP = 200_000;                                 // stated, not silent — see `capped`

    // EVERYTHING OFF BY DEFAULT. A recorder that starts recording because nobody
    // changed anything is a recorder that will one day capture something it
    // should not have. Each feed is turned on deliberately, per tab, per session.
    const cfg = { mouse: false, keys: 'off', console: false, network: false, scroll: false };
    let on = false, buf = [], dropped = 0, redacted = 0, lastMouse = 0, lastX = 0, lastY = 0, total = 0;

    const now = () => Date.now();

    function push(ev) {
        if (!on) return;
        if (total >= CAP) { dropped += 1; return; }
        buf.push(ev); total += 1;
    }

    // ── Is this field one we must never read? ───────────────────────────────
    function sensitive(el) {
        if (!el) return false;
        const t = (el.type || '').toLowerCase();
        if (t === 'password') return true;
        const ac = (el.getAttribute && el.getAttribute('autocomplete') || '').toLowerCase();
        if (/cc-|one-time-code|current-password|new-password/.test(ac)) return true;
        // An explicit opt-out any page can use, and which we honour without asking why.
        return !!(el.closest && el.closest('[data-sg-no-capture]'));
    }

    /** A stable, short description of an element — enough to replay, not enough to fingerprint a person. */
    function describe(el) {
        if (!el || el === document || el === window) return null;
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className
            ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        const label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name'))) || '';
        const text = (el.tagName === 'BUTTON' || el.tagName === 'A') ? (el.textContent || '').trim().slice(0, 40) : '';
        return { tag: (el.tagName || '').toLowerCase(), sel: `${el.tagName?.toLowerCase() || ''}${id}${cls}`, label, text };
    }

    // ── Mouse ───────────────────────────────────────────────────────────────
    function onMove(e) {
        if (!cfg.mouse) return;
        const t = now();
        if (t - lastMouse < 1000 / MOUSE_HZ) return;
        const x = Math.round(e.clientX), y = Math.round(e.clientY);
        if (Math.abs(x - lastX) < MOUSE_MIN_PX && Math.abs(y - lastY) < MOUSE_MIN_PX) return;
        lastMouse = t; lastX = x; lastY = y;
        push({ t, k: 'move', x, y });
    }
    function onDown(e) { push({ t: now(), k: 'down', x: Math.round(e.clientX), y: Math.round(e.clientY), b: e.button, el: describe(e.target) }); }
    function onUp(e)   { push({ t: now(), k: 'up',   x: Math.round(e.clientX), y: Math.round(e.clientY), b: e.button }); }
    function onClick(e){ push({ t: now(), k: 'click',x: Math.round(e.clientX), y: Math.round(e.clientY), el: describe(e.target) }); }
    function onScroll() {
        if (!cfg.scroll) return;
        push({ t: now(), k: 'scroll', x: Math.round(window.scrollX), y: Math.round(window.scrollY) });
    }

    // ── Keys ────────────────────────────────────────────────────────────────
    function onKey(e) {
        if (cfg.keys === 'off') return;
        const el = e.target;
        const mods = [e.ctrlKey && 'ctrl', e.metaKey && 'meta', e.altKey && 'alt', e.shiftKey && 'shift'].filter(Boolean);
        if (sensitive(el)) {
            // Record that typing happened, never what. The count is the point:
            // an absent event and a refused one must not look the same.
            redacted += 1;
            push({ t: now(), k: 'key', key: '•', redacted: true, el: describe(el) });
            return;
        }
        // A keystroke with ctrl/meta/alt held is a SHORTCUT, not typed content.
        // Masking it protects nothing — nobody types a password with Ctrl down —
        // and destroys exactly what a UX question is about: which shortcut was
        // reached for, and whether it was reached for instead of the menu.
        // Shift alone does not count: shift+a is just a capital A.
        const command = e.ctrlKey || e.metaKey || e.altKey;
        const printable = e.key && e.key.length === 1;
        const mask = printable && !command && cfg.keys !== 'text';
        if (mask) redacted += 1;
        push({ t: now(), k: 'key', key: mask ? '·' : e.key, mods: mods.length ? mods : undefined, el: describe(el) });
    }

    // ── The MAIN-world feeds (console, network, scripted probes) ────────────
    function onPageMessage(ev) {
        if (ev.source !== window || !ev.data || ev.data.__sgpr !== 'page') return;
        const d = ev.data.payload;
        if (d.k === 'console' && !cfg.console) return;
        if (d.k === 'net' && !cfg.network) return;
        push(d);
    }

    // ── Flush to the service worker ─────────────────────────────────────────
    function flush() {
        if (!buf.length && !dropped) return;
        const batch = buf; buf = [];
        try {
            chrome.runtime.sendMessage({ type: 'sgpr:batch', events: batch, dropped, redacted, url: location.href });
        } catch (_) { /* worker asleep or extension reloaded — the next flush retries */ }
    }
    let timer = null;

    function start(next = {}) {
        Object.assign(cfg, next);
        if (on) return report();
        on = true;
        addEventListener('mousemove', onMove, true);
        addEventListener('mousedown', onDown, true);
        addEventListener('mouseup', onUp, true);
        addEventListener('click', onClick, true);
        addEventListener('scroll', onScroll, true);
        addEventListener('keydown', onKey, true);
        addEventListener('message', onPageMessage);
        timer = setInterval(flush, FLUSH_MS);
        // Tell the MAIN world what to hook. It is already injected by the popup.
        window.postMessage({ __sgpr: 'cmd', cmd: 'start', cfg }, '*');
        return report();
    }

    function stop() {
        if (!on) return report();
        on = false;
        removeEventListener('mousemove', onMove, true);
        removeEventListener('mousedown', onDown, true);
        removeEventListener('mouseup', onUp, true);
        removeEventListener('click', onClick, true);
        removeEventListener('scroll', onScroll, true);
        removeEventListener('keydown', onKey, true);
        removeEventListener('message', onPageMessage);
        clearInterval(timer);
        window.postMessage({ __sgpr: 'cmd', cmd: 'stop' }, '*');
        flush();
        return report();
    }

    function report() {
        return { on, cfg: { ...cfg }, total, dropped, redacted, capped: total >= CAP, url: location.href, title: document.title };
    }

    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        if (!msg || !msg.type?.startsWith('sgpr:')) return undefined;
        if (msg.type === 'sgpr:start') { reply(start(msg.cfg)); return true; }
        if (msg.type === 'sgpr:stop') { reply(stop()); return true; }
        if (msg.type === 'sgpr:status') { reply(report()); return true; }
        if (msg.type === 'sgpr:run') {
            // Scripted probe — see page-hooks.js. The result comes back through
            // the same event stream, so it lands in the timeline in order.
            window.postMessage({ __sgpr: 'cmd', cmd: 'run', id: msg.id, js: msg.js, on: msg.on }, '*');
            reply({ queued: true, id: msg.id });
            return true;
        }
        return undefined;
    });

    window.__sgPageRecorder = { start, stop, report };
})();
