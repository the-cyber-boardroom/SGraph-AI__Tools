/**
 * yp-suite.js
 * The registry and runner — a probe suite, not a pass/fail suite.
 *
 * THE DIFFERENCE MATTERS. A normal test asserts known-correct behaviour. Most of
 * these are asking a question nobody has answered: *will* the API return an ASR
 * track, *does* a talk need a region mask. So a result carries a `status` AND its
 * `evidence`, and `info` is a first-class outcome — "we watched it refuse, here is
 * the exact status and reason" is a finding, not a failure.
 *
 *   pass     the hypothesis held, with numbers
 *   fail     the hypothesis did not hold — often the more useful result
 *   info     a fact was recorded; there was no right answer to have
 *   blocked  could not run (no token, no gesture, no browser support)
 *
 * Every test states what a pass and a fail each MEAN for the v0.2.92 pack, so a
 * result changes the plan rather than just colouring a row.
 *
 * @module yp-suite
 */

import { AUTO_TESTS } from './yp-tests-auto.js';
import { MANUAL_TESTS } from './yp-tests-manual.js';

export const TESTS = [...AUTO_TESTS, ...MANUAL_TESTS];

export function getTest(id) { return TESTS.find(t => t.id === id) || null; }

/**
 * Run one test. Never throws — a thrown error IS a result, and losing it to an
 * unhandled rejection would be the worst possible outcome for a diagnostic.
 *
 * @param {string} id
 * @param {object} ctx  shared context (videoId, layout, emit, …)
 */
export async function runTest(id, ctx = {}) {
    const test = getTest(id);
    if (!test) throw Object.assign(new Error(`Unknown test: ${id}`), { code: 'bad-params' });
    const started = Date.now();
    ctx.emit?.('yp:test:started', { id, title: test.title });
    let result;
    try {
        result = await test.run(ctx) || {};
    } catch (err) {
        result = {
            status: err.code === 'no-token' || err.code === 'no-client-id' ? 'blocked' : 'fail',
            detail: `${err.code || 'error'}: ${err.message}`,
            evidence: { code: err.code, status: err.status, reason: err.reason },
        };
    }
    const out = {
        id, title: test.title, group: test.group, needs: test.needs || null,
        hypothesis: test.hypothesis, meaning: test.meaning || null,
        status: result.status || 'info',
        detail: result.detail || '',
        evidence: result.evidence ?? null,
        ms: Date.now() - started,
        at: new Date().toISOString(),
    };
    // RECORD BEFORE EMITTING. A listener that re-reads state on the event must
    // find the result already there; emitting first leaves any UI driven purely
    // by events one result behind, and a panel that only refreshes because a
    // button handler happened to re-render is stale the moment the JS API is used
    // instead. That exact bug has now appeared three times in this repo — the
    // narrated-review key chip, the media-probe source panel, and here.
    ctx.record?.(out);
    ctx.emit?.('yp:test:complete', out);
    return out;
}

/**
 * Run a set, sequentially.
 *
 * Sequential on purpose: several of these record a tab, drive one `<video>`
 * element, or hold an AudioContext, and running them at once would have them
 * fight over the same singleton hardware and produce results that are artefacts
 * of the harness.
 */
export async function runMany(ids, ctx = {}) {
    const results = [];
    for (const id of ids) results.push(await runTest(id, ctx));
    ctx.emit?.('yp:suite:complete', summarise(results));
    return results;
}

/** Everything that needs no token and no gesture. */
export const AUTO_IDS = AUTO_TESTS.map(t => t.id);

export function summarise(results) {
    const by = s => results.filter(r => r.status === s).length;
    return {
        total: results.length,
        pass: by('pass'), fail: by('fail'), info: by('info'), blocked: by('blocked'),
        results,
    };
}

/**
 * The report — written for a person in a hurry and for an agent, and stating what
 * was NOT run. A suite where half the tests were blocked on a missing token, read
 * as "3 passed", would be a lie of omission of exactly the kind this project keeps
 * building guards against.
 */
export function reportMarkdown(results, ctx = {}) {
    const s = summarise(results);
    const L = [];
    L.push('# YouTube probe — findings');
    L.push('');
    L.push(`*${s.pass} passed · ${s.fail} failed · ${s.info} recorded · ${s.blocked} blocked — ${new Date().toISOString()}*`);
    if (ctx.videoId) L.push(`*Video under test: \`${ctx.videoId}\`*`);
    L.push('');

    const key = results.find(r => r.id === 'M4');
    if (key) {
        L.push('## The question the pack hinges on');
        L.push('');
        L.push(key.status === 'pass'
            ? '**ASR captions CAN be downloaded.** Route B is the primary ingest for your own videos: the words are free and already timestamped, and no VAD or silence threshold is involved anywhere on that path.'
            : key.status === 'blocked'
                ? '**Not answered yet** — this needs an access token with `youtube.force-ssl` and one of your own video ids.'
                : `**ASR captions could NOT be downloaded.** ${key.detail}. Route B degrades to manually-uploaded tracks only; the corpus has to run on route A (Studio download) or C (tab capture) with real transcription.`);
        L.push('');
    }

    for (const group of [...new Set(results.map(r => r.group))]) {
        L.push(`## ${group}`);
        L.push('');
        for (const r of results.filter(x => x.group === group)) {
            const icon = { pass: '✅', fail: '❌', info: 'ℹ️', blocked: '⏸️' }[r.status] || '·';
            L.push(`### ${icon} ${r.id} — ${r.title}`);
            L.push('');
            L.push(`*Hypothesis:* ${r.hypothesis}`);
            L.push('');
            L.push(`**${r.status.toUpperCase()}** — ${r.detail}`);
            if (r.meaning) { L.push(''); L.push(`*What this means:* ${r.meaning[r.status] || r.meaning.default || ''}`); }
            if (r.evidence != null) {
                L.push('');
                L.push('```json');
                L.push(JSON.stringify(r.evidence, null, 1));
                L.push('```');
            }
            L.push('');
        }
    }

    const notRun = TESTS.filter(t => !results.some(r => r.id === t.id));
    L.push('## Not run');
    L.push('');
    if (!notRun.length && !s.blocked) L.push('*Every test in the suite ran.*');
    else {
        for (const t of notRun) L.push(`- \`${t.id}\` ${t.title} — not run${t.needs ? ` (needs ${t.needs})` : ''}`);
        for (const r of results.filter(x => x.status === 'blocked')) L.push(`- \`${r.id}\` ${r.title} — blocked: ${r.detail}`);
    }
    L.push('');
    return { markdown: L.join('\n') };
}
