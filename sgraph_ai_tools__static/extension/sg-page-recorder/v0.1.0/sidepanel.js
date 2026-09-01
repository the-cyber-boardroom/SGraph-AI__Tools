/**
 * sidepanel.js — the panel that lives beside the page rather than on it.
 *
 * A popup closes the moment you click into the page, which makes it useless for
 * watching a recording: the interesting moment is always the one where the popup
 * has just vanished. The side panel stays open while you work, so the counts,
 * the console errors and the failed requests appear *as they happen*, next to the
 * thing that caused them.
 *
 * It is also where this extension stops being a companion and becomes a tool in
 * its own right: **Export bundle** writes a zip of `report.md`, `session.json`,
 * `events.json` and any screenshots, with no narrated-review anywhere in the
 * loop. Point it at a broken page, do the broken thing, export, hand it over.
 *
 * @module sidepanel
 */

import { buildBundle, summarise } from './artefacts.js';

const $ = s => document.querySelector(s);
let tabId = null;
let session = { events: [], shots: [] };
let seen = 0;

const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || {})));

function stat(label, value, cls = '') {
    return `<div class="stat ${cls}"><b>${value}</b><span class="muted">${label}</span></div>`;
}

function renderStats() {
    const s = summarise(session);
    const c = s.counts || {};
    $('#stats').innerHTML = [
        stat('moves', c.move || 0),
        stat('clicks', c.click || 0),
        stat('keys', c.key || 0),
        stat('console', c.console || 0),
        stat('network', c.net || 0),
        stat('probes', c.probe || 0),
        stat('errors', s.errors, s.errors ? 'bad' : ''),
        stat('failed reqs', s.failedRequests, s.failedRequests ? 'bad' : ''),
        stat('shots', s.screenshots),
    ].join('');
    const bits = [];
    if (s.redacted) bits.push(`${s.redacted} keystrokes redacted (never recorded)`);
    if (s.dropped) bits.push(`${s.dropped} events dropped at the buffer cap — this recording is incomplete`);
    $('#privacy').textContent = bits.join(' · ');
}

/** One line per event, newest last, capped — this is a monitor, not a store. */
function renderFeed() {
    const feed = $('#feed');
    const fresh = session.events.slice(seen);
    if (!fresh.length && seen) return;
    seen = session.events.length;
    if (!session.events.length) { feed.innerHTML = '<div class="muted">nothing yet</div>'; return; }
    for (const e of fresh) {
        const d = document.createElement('div');
        const t = new Date(e.t).toLocaleTimeString();
        let body, cls = '';
        if (e.k === 'click') body = `click ${e.el?.text || e.el?.label || e.el?.sel || `${e.x},${e.y}`}`;
        else if (e.k === 'key') body = `key ${[...(e.mods || []), e.key].join('+')}${e.redacted ? ' (redacted)' : ''}`;
        else if (e.k === 'console') { body = `${e.level}: ${JSON.stringify(e.args?.[0] ?? '').slice(0, 90)}`; cls = e.level === 'error' ? 'err' : ''; }
        else if (e.k === 'net') { body = `${e.method || e.kind} ${e.status} ${String(e.url).slice(-60)}`; cls = e.ok === false ? 'err' : ''; }
        else if (e.k === 'probe') { body = `probe ${e.id} → ${JSON.stringify(e.error ? { error: e.error } : e.value).slice(0, 80)}`; cls = e.error ? 'err' : 'ok'; }
        else return;                                     // moves and scrolls would drown the feed
        d.className = cls;
        d.innerHTML = `<span class="k">${t}</span> ${body.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}`;
        feed.appendChild(d);
    }
    while (feed.children.length > 300) feed.removeChild(feed.firstChild);
    feed.scrollTop = feed.scrollHeight;
}

async function tick() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    const list = await send({ type: 'sgpr:list' });
    const mine = (list.tabs || []).find(t => t.tabId === tabId);
    $('#where').textContent = mine?.url || tab?.title || '(open a tab and arm it from the toolbar icon)';
    $('#status').innerHTML = mine?.armed
        ? '<span class="rec">● recording</span>'
        : (session.events.length ? 'stopped — the recording is still here' : 'not recording');

    if (tabId != null) {
        const d = await send({ type: 'sgpr:drain', tabId });
        if (d.events?.length) session.events.push(...d.events);
        session.url = d.url || session.url;
        session.title = mine?.title || tab?.title || session.title;
        session.startedAt = session.startedAt || d.startedAt;
        session.redacted = d.redacted ?? session.redacted;
        session.dropped = d.dropped ?? session.dropped;
    }
    renderStats(); renderFeed();
    $('#export').disabled = !session.events.length && !session.shots.length;
}

$('#run').addEventListener('click', async () => {
    const js = $('#probe').value.trim();
    if (!js || tabId == null) return;
    await send({ type: 'sgpr:run', tabId, id: `p${Date.now().toString(36)}`, js, on: 'manual' });
});
$('#onclick').addEventListener('click', async () => {
    const js = $('#probe').value.trim();
    if (!js || tabId == null) return;
    await send({ type: 'sgpr:run', tabId, id: `click-${Date.now().toString(36)}`, js, on: 'click' });
    $('#exported').textContent = 'probe armed — it will run on every click until the tab is reloaded';
});

$('#shot').addEventListener('click', async () => {
    const r = await send({ type: 'sgpr:shot' });
    if (r.dataUrl) {
        session.shots.push({ t: Date.now(), dataUrl: r.dataUrl, note: null });
        renderStats();
    } else {
        $('#exported').textContent = `screenshot failed: ${r.error || 'unknown'}`;
    }
});

$('#export').addEventListener('click', async () => {
    const { blob, entries } = buildBundle(session);
    const url = URL.createObjectURL(blob);
    const name = `sg-page-recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    $('#exported').textContent = `${name} — ${entries.length} files, ${(blob.size / 1024).toFixed(0)} KB`;
});

$('#clear').addEventListener('click', () => {
    session = { events: [], shots: [] };
    seen = 0;
    $('#feed').innerHTML = '<div class="muted">nothing yet</div>';
    $('#exported').textContent = '';
    renderStats();
});

renderStats();
tick();
setInterval(tick, 1200);
