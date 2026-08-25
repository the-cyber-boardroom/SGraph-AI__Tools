/**
 * YouTube Probe — Smoke Test (Playwright)
 *
 * Asserts the HARNESS, not the hypotheses.
 *
 * That distinction is the whole point. A1/A2 are ordinary correctness and must be
 * green. A3–A6 are open questions: asserting a direction on them would bake
 * today's guess into the suite and hide the day it stops being true. So this test
 * checks that the comparison was actually MADE — both traces present, ground truth
 * scored, headroom computed — and leaves the verdict to the reader.
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/youtube-probe-smoke.js
 *
 * Env: YOUTUBE_PROBE_URL, HEADLESS ('false' to watch), PW_CHROMIUM
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.YOUTUBE_PROBE_URL || 'http://localhost:10063/en-gb/youtube-probe/';
const HEADLESS = process.env.HEADLESS !== 'false';

const EXPECTED_ACTIONS = [
    'listTests', 'runTest', 'runAuto', 'runAll',
    'setContext', 'getContext', 'getResults', 'getReport', 'downloadReport',
    'setToken', 'signIn', 'hasToken', 'getStatus', 'reset',
];

let passed = 0, failed = 0;
function ok(l) { console.log(`  ✓ ${l}`); passed++; }
function assert(c, l, d = '') { if (c) ok(l); else throw new Error(`Assertion failed: ${l}${d ? ' — ' + d : ''}`); }
function noise(t) { return /dev\.sgraph\.ai|accounts\.google|gsi\/client|net::ERR|Failed to load resource/.test(t); }

async function run() {
    console.log('\nyoutube-probe smoke\n');
    const browser = await chromium.launch({
        headless: HEADLESS,
        args: ['--autoplay-policy=no-user-gesture-required'],
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    try {
        await page.goto(TOOL_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__tool, null, { timeout: 15000 });
        ok('window.__tool published (tool:ready fired)');
        await page.waitForTimeout(800);
        assert(errors.length === 0, 'zero uncaught boot errors', errors.join(' | '));

        const rep = await page.evaluate(names => {
            const t = window.__tool;
            return { missing: names.filter(n => typeof t[n] !== 'function'), isPromise: t.getStatus({}) instanceof Promise };
        }, EXPECTED_ACTIONS);
        assert(rep.missing.length === 0, `all ${EXPECTED_ACTIONS.length} actions registered`, `missing: ${rep.missing.join(',')}`);
        assert(rep.isPromise, 'actions return Promises (SgToolApi contract)');

        for (const sel of ['#yp-token', '#yp-token-save', '#yp-client', '#yp-signin', '#yp-mine', '#yp-other',
                           '#yp-talks', '#yp-caps', '#yp-secs', '#yp-run-auto', '#yp-run-all', '#yp-reset',
                           '#yp-list', '#yp-progress', '#yp-report-body', '#yp-dl-md', '#yp-dl-json']) {
            assert(await page.$(sel) !== null, `panel element present: ${sel}`);
        }

        const listed = await page.evaluate(() => window.__tool.listTests());
        assert(listed.tests.length >= 15, 'the suite registers every test', `${listed.tests.length}`);
        assert(listed.tests.every(t => t.hypothesis && t.title), 'every test states a hypothesis, not just a title');
        assert(listed.tests.filter(t => !t.needs).length >= 7, 'at least seven tests need no token and no gesture');

        // A token must never come back out of the tool.
        await page.evaluate(() => window.__tool.setToken({ token: 'ya29.super-secret-value' }));
        const leak = await page.evaluate(async () => JSON.stringify([
            await window.__tool.getStatus(), await window.__tool.getContext(), await window.__tool.hasToken(),
        ]));
        assert(!leak.includes('super-secret-value'), 'no action leaks the access token', leak.slice(0, 200));
        assert(JSON.parse(leak)[2].present === true, 'hasToken reports presence without the value');
        await page.evaluate(() => window.__tool.setToken({ token: '' }));

        // A manual test with no token is BLOCKED, never a silent pass.
        const blocked = await page.evaluate(() => window.__tool.runTest({ id: 'M1' }));
        assert(blocked.status === 'blocked', 'a manual test without a token reports blocked', blocked.status);
        assert(/token/i.test(blocked.detail), 'and says why', blocked.detail);

        // ── The offline battery, for real. Records a synthetic talk in-page. ──
        console.log('  … running the offline battery (~1 min)');
        const summary = await page.evaluate(() => window.__tool.runAuto());
        const by = Object.fromEntries(summary.results.map(r => [r.id, r]));

        assert(summary.total === 7, 'seven offline tests ran', `${summary.total}`);
        assert(by.A1.status === 'pass', 'A1 — caption parsers agree across VTT, SRT and SBV');
        assert(by.A2.status === 'pass', 'A2 — cues group by midpoint with none lost');

        // A3/A4 are QUESTIONS. Assert the comparison happened; do not assert its answer.
        assert(by.A3.evidence.truth === 3 && typeof by.A3.evidence.matched === 'number',
            'A3 scored the control against known ground truth');
        assert(by.A4.evidence.masked && by.A4.evidence.unmasked,
            'A4 compared masked and unmasked traces from the SAME clip');
        assert(by.A4.evidence.headroomMasked && by.A4.evidence.headroomUnmasked,
            'A4 reports headroom for both, so a pass can be told from an easy fixture');
        assert(by.A4.evidence.headroomMasked.ratio > by.A4.evidence.headroomUnmasked.ratio,
            'masking widens the gap between a slide change and the background',
            `masked ${by.A4.evidence.headroomMasked.ratio}x vs unmasked ${by.A4.evidence.headroomUnmasked.ratio}x`);

        assert(by.A5.evidence.iou > 0.5, 'A5 — the suggester finds the slide region, not the speaker',
            `IoU ${by.A5.evidence.iou}`);
        assert(by.A6.status === 'pass', 'A6 — intercut footage is detectable rather than silently mis-segmented');
        assert(by.A7.status === 'info' && by.A7.evidence.captionsAndClean.totalUsd < by.A7.evidence.transcribeAndClean.totalUsd,
            'A7 — captions are the cheaper route, from the measured cost basis');

        // The report must name what did NOT run.
        const report = await page.evaluate(() => window.__tool.getReport());
        assert(/## Not run/.test(report.markdown), 'the report has a "Not run" section');
        assert(/M4/.test(report.markdown), 'the report names M4, the question the pack hinges on');
        assert(/blocked|not run/i.test(report.markdown), 'and states the manual tests were not run');

        // ------------------------------------------------------------------
        // Regressions from the first LIVE run (25 Aug 2026). Each of these was a
        // real defect that the offline battery could not have caught, because
        // each needed either a Google token or a browser that misbehaved.
        // ------------------------------------------------------------------

        // 1. trackKind is returned lowercase 'asr'. A `=== 'ASR'` test reported a
        //    video's only (auto-generated) track as "0 auto-generated", while M4
        //    downloaded that same track and called it asr. They must agree.
        const asrCases = await page.evaluate(async () => {
            const m = await import('./api/yp-youtube.js');
            return {
                lower: m.isAsr({ trackKind: 'asr' }),
                upper: m.isAsr({ trackKind: 'ASR' }),
                standard: m.isAsr({ trackKind: 'standard' }),
                missing: m.isAsr({}),
            };
        });
        assert(asrCases.lower && asrCases.upper, 'an ASR track is recognised in either case');
        assert(!asrCases.standard && !asrCases.missing, 'and a standard or absent trackKind is not');

        // 2. An empty 200 from the undocumented timedtext endpoint is a refusal
        //    wearing a success code. It read as "Reachable: HTTP 200" — which is
        //    true and useless. It must not be a pass.
        const m7 = await page.evaluate(async () => {
            const real = window.fetch;
            window.fetch = async (u, ...rest) => (String(u).includes('/api/timedtext')
                ? new Response('', { status: 200 })
                : real(u, ...rest));
            try {
                await window.__tool.setContext({ otherVideoId: 'dQw4w9WgXcQ' });
                return await window.__tool.runTest({ id: 'M7' });
            } finally { window.fetch = real; }
        });
        assert(m7.status === 'info', 'M7 — an empty 200 is recorded, not passed', `got ${m7.status}`);
        assert(/ZERO bytes/.test(m7.detail), 'and the detail says the body was empty');

        // 3. THE one that matters. A fixture that will not record must report
        //    `error` — the harness broke — and never `fail`, which would print
        //    the hypothesis-failed narrative about a measurement never taken.
        const broken = await page.evaluate(async () => {
            await window.__tool.reset();
            const real = HTMLCanvasElement.prototype.captureStream;
            HTMLCanvasElement.prototype.captureStream = function () { throw new Error('no capture in this browser'); };
            try {
                const r = await window.__tool.runTest({ id: 'A6' });
                const rep = await window.__tool.getReport();
                return { r, markdown: rep.markdown };
            } finally { HTMLCanvasElement.prototype.captureStream = real; }
        });
        assert(broken.r.status === 'error', 'a fixture that cannot record reports ERROR, not fail', `got ${broken.r.status}`);
        assert(broken.r.evidence?.attempts?.length === 2, 'and it retried once before giving up');
        assert(!/confident, wrong document/.test(broken.markdown),
            'the report does NOT print the hypothesis-failed narrative for a broken instrument');
        assert(/measured nothing/i.test(broken.markdown), 'it says the test measured nothing');
        assert(!/Every test in the suite ran/.test(broken.markdown),
            'and an errored test is never counted as having run');

        // 4. The third-party DOWNLOAD question M5 raised but never asked.
        const ids = await page.evaluate(async () => (await window.__tool.listTests()).tests.map(t => t.id));
        assert(ids.includes('M9'), 'M9 asks whether a third-party caption BODY can be downloaded');
        assert(ids.length === 16, 'sixteen tests registered', `got ${ids.length}`);

        // 5. Signing in must be acknowledged where it happened, with the account.
        const status = await page.evaluate(() => window.__tool.getStatus());
        assert('channel' in status && 'token' in status,
            'getStatus reports the signed-in channel and scopes, not just presence');
        assert(status.channel === null && status.token === null,
            'and both are null with no token, rather than absent');

        await page.evaluate(() => window.__tool.reset());
        const after = await page.evaluate(() => window.__tool.getResults());
        assert(after.total === 0, 'reset clears the results');

        assert(errors.length === 0, 'zero uncaught errors through the whole run', errors.join(' | '));
    } catch (err) {
        console.error(`  ✗ ${err.message}`);
        failed++;
    } finally {
        await browser.close();
    }
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run();
