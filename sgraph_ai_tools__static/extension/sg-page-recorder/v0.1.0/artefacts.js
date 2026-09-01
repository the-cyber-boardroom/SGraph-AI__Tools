/**
 * artefacts.js — turn a recorded session into a bundle, with no tool attached.
 *
 * The extension was built to feed narrated-review, but everything needed to make
 * a useful artefact is already here: the events, their timing, the elements hit,
 * and (on request) screenshots. So it also stands alone — point it at a page, do
 * the thing that is broken, press Export, and hand someone a zip.
 *
 * That is a different job from a narrated review and the bundle says so. There
 * is no audio and no narration; what it has instead is precision about *what
 * happened*, which is exactly what a bug report usually lacks.
 *
 * @module artefacts
 */

import { zipStore, dataUrlToBytes } from './zip-store.js';

const fmt = ms => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

/** Counts, timings and the things a reader should look at first. */
export function summarise(session) {
    const evs = session.events || [];
    const t0 = session.startedAt || (evs[0]?.t ?? Date.now());
    const byKind = {};
    for (const e of evs) byKind[e.k] = (byKind[e.k] || 0) + 1;
    const errors = evs.filter(e => e.k === 'console' && e.level === 'error');
    const failed = evs.filter(e => e.k === 'net' && e.ok === false);
    const clicks = evs.filter(e => e.k === 'click');
    const net = evs.filter(e => e.k === 'net' && typeof e.ms === 'number');
    const slowest = net.slice().sort((a, b) => b.ms - a.ms).slice(0, 5);
    return {
        url: session.url, title: session.title,
        startedAt: t0 ? new Date(t0).toISOString() : null,
        durationMs: evs.length ? (evs[evs.length - 1].t - t0) : 0,
        counts: byKind, total: evs.length,
        redacted: session.redacted || 0, dropped: session.dropped || 0,
        clicks: clicks.length, errors: errors.length, failedRequests: failed.length,
        slowestRequests: slowest.map(e => ({ url: e.url, ms: e.ms, status: e.status })),
        screenshots: (session.shots || []).length,
    };
}

/** The report a person reads. Leads with what went wrong, because that is why they opened it. */
export function buildReport(session) {
    const s = summarise(session);
    const t0 = session.startedAt || (session.events?.[0]?.t ?? 0);
    const rel = t => fmt(Math.max(0, t - t0));
    const evs = session.events || [];
    const L = [];

    L.push(`# Page recording — ${s.title || s.url || 'session'}`);
    L.push('');
    L.push(`\`${s.url || ''}\``);
    L.push('');
    L.push(`${s.total} events over ${fmt(s.durationMs)} · ${s.clicks} clicks · ${s.errors} console errors · `
        + `${s.failedRequests} failed requests`);
    if (s.redacted) L.push(`\n*${s.redacted} keystrokes were redacted and are not in this bundle.*`);
    if (s.dropped) L.push(`\n*${s.dropped} events were dropped at the buffer cap — the recording is incomplete.*`);
    L.push('');

    const errors = evs.filter(e => e.k === 'console' && e.level === 'error');
    const failed = evs.filter(e => e.k === 'net' && e.ok === false);
    if (errors.length || failed.length) {
        L.push('## What went wrong');
        L.push('');
        for (const e of errors.slice(0, 25)) {
            L.push(`- \`${rel(e.t)}\` **console error** — ${JSON.stringify(e.args?.[0] ?? '').slice(0, 300)}`
                + (e.at ? ` *(${e.at})*` : ''));
        }
        for (const e of failed.slice(0, 25)) {
            L.push(`- \`${rel(e.t)}\` **${e.method} ${e.status || 'failed'}** — ${e.url}`);
        }
        L.push('');
    }

    L.push('## What was done');
    L.push('');
    // Clicks and keys only: a move-by-move list is noise, and events.json has it
    // for anyone who genuinely wants to replay the path.
    const acted = evs.filter(e => e.k === 'click' || e.k === 'key' || e.k === 'probe');
    for (const e of acted.slice(0, 300)) {
        if (e.k === 'click') {
            const on = e.el ? (e.el.text || e.el.label || e.el.sel) : `(${e.x}, ${e.y})`;
            L.push(`- \`${rel(e.t)}\` click — **${on}**`);
        } else if (e.k === 'key') {
            const combo = [...(e.mods || []), e.key].join('+');
            L.push(`- \`${rel(e.t)}\` key — \`${combo}\`${e.redacted ? ' *(redacted)*' : ''}`);
        } else {
            L.push(`- \`${rel(e.t)}\` probe \`${e.id}\` → ${JSON.stringify(e.error ? { error: e.error } : e.value).slice(0, 200)}`);
        }
    }
    if (acted.length > 300) L.push(`- …and ${acted.length - 300} more (see \`events.json\`)`);
    L.push('');

    if (s.slowestRequests.length) {
        L.push('## Slowest requests');
        L.push('');
        L.push('| ms | status | url |');
        L.push('|---:|---:|---|');
        for (const r of s.slowestRequests) L.push(`| ${r.ms} | ${r.status} | ${r.url} |`);
        L.push('');
    }

    if ((session.shots || []).length) {
        L.push('## Screenshots');
        L.push('');
        for (const [i, sh] of session.shots.entries()) {
            L.push(`### ${i + 1} · ${rel(sh.t)}${sh.note ? ` — ${sh.note}` : ''}`);
            L.push('');
            L.push(`![shot ${i + 1}](images/shot-${String(i + 1).padStart(2, '0')}.png)`);
            L.push('');
        }
    }

    L.push('## What this bundle is not');
    L.push('');
    L.push('There is no audio and no narration — this is a recording of *actions*, not an explanation');
    L.push('of them. Times are wall-clock. Keystrokes in password and payment fields were never');
    L.push('recorded; network entries carry no headers and no bodies at any setting.');
    L.push('');
    return L.join('\n');
}

/** The machine-readable half, shaped like narrated-review's input.json. */
export function buildJson(session) {
    return {
        schema: {
            name: 'sg-page-recorder/session',
            version: 1,
            note: 'A standalone recording of what someone did on a page: mouse, clicks, keys, console, '
                + 'network and scripted probes. Produced without narrated-review, so there is no audio '
                + 'and no narration — precision about WHAT happened, in place of an explanation of why.',
            privacy: 'Password and payment fields are never recorded in any mode; `redacted` counts what '
                + 'was refused, so an absent event can be told from a withheld one. Network is metadata '
                + 'only — no headers, no bodies — and query strings are stripped unless fullUrls was set.',
            clock: 'wall — event `t` is Date.now(); `startedAt` is the origin to subtract.',
        },
        source: { url: session.url, title: session.title },
        startedAt: session.startedAt,
        summary: summarise(session),
        shots: (session.shots || []).map((sh, i) => ({
            index: i + 1, t: sh.t, note: sh.note || null, image: `images/shot-${String(i + 1).padStart(2, '0')}.png`,
        })),
        events: session.events || [],
    };
}

/** The bundle. Same shape as narrated-review's, so the two are readable side by side. */
export function buildBundle(session) {
    const entries = [
        { path: 'report.md', text: buildReport(session) },
        { path: 'session.json', text: JSON.stringify(buildJson(session), null, 2) },
        { path: 'events.json', text: JSON.stringify(session.events || [], null, 2) },
    ];
    for (const [i, sh] of (session.shots || []).entries()) {
        entries.push({ path: `images/shot-${String(i + 1).padStart(2, '0')}.png`, bytes: dataUrlToBytes(sh.dataUrl) });
    }
    return { blob: zipStore(entries), entries: entries.map(e => e.path) };
}
