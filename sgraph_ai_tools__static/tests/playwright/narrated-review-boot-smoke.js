/**
 * Narrated Review — Boot Smoke Test (Playwright)
 *
 * Loads the REAL served page (run scripts/run-locally.sh first) and fails on
 * anything that throws during boot, then asserts the JS API surface, the
 * capture-panel DOM contract (the stable ids SKILL-browser documents), and the
 * keyless behaviour (capture UI works with no OpenRouter key).
 *
 * No gestures, no network: startSession() is NOT exercised here (it needs a
 * real screen-picker gesture) — see narrated-review-pipeline-smoke.js for the
 * fully headless import path.
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/narrated-review-boot-smoke.js
 *
 * Env: NARRATED_REVIEW_URL (default http://localhost:10063/en-gb/narrated-review/),
 *      HEADLESS ('false' to watch), PW_CHROMIUM (explicit browser binary)
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.NARRATED_REVIEW_URL || 'http://localhost:10063/en-gb/narrated-review/';
const HEADLESS = process.env.HEADLESS !== 'false';

const EXPECTED_ACTIONS = [
    'setApiKey', 'listModels', 'getStatus',
    'startSession', 'markMoment', 'endSession', 'reset',
    'addRecording', 'markAt', 'transcribeAll',
    'getSession', 'getPairs', 'getPair', 'getPairImage',
    'setBoundary', 'setText', 'removePair', 'retranscribePair',
    'cleanPair', 'cleanAll', 'getSummary',
    'buildDocument', 'getDocument', 'downloadZip',
    'setCleanupMode', 'getCostSummary', 'setSpendCap',
];

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.error(`  ✗ ${label}: ${err?.message || err}`); failed++; }
function assert(cond, label, detail = '') {
    if (cond) ok(label);
    else throw new Error(`Assertion failed: ${label}${detail ? ' — ' + detail : ''}`);
}

function isExternalNoise(text) {
    return /dev\.sgraph\.ai|openrouter\.ai|net::ERR|Failed to load resource/.test(text);
}

async function run() {
    console.log('\nnarrated-review boot smoke\n');
    const browser = await chromium.launch({
        headless: HEADLESS,
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    });
    const page = await browser.newPage();

    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !isExternalNoise(m.text())) errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    try {
        await page.goto(TOOL_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__tool, null, { timeout: 15000 });
        ok('window.__tool published (tool:ready fired)');

        await page.waitForTimeout(1000);
        assert(errors.length === 0, 'zero uncaught boot errors', errors.join(' | '));

        const rep = await page.evaluate((names) => {
            const t = window.__tool;
            const missing = names.filter(n => typeof t[n] !== 'function');
            return { missing, isPromise: t.getStatus({}) instanceof Promise };
        }, EXPECTED_ACTIONS);
        assert(rep.missing.length === 0, `all ${EXPECTED_ACTIONS.length} actions registered`, `missing: ${rep.missing.join(',')}`);
        assert(rep.isPromise, 'actions return Promises (SgToolApi contract)');

        // The DOM contract SKILL-browser promises.
        for (const sel of ['#nr-share', '#nr-finish', '#nr-mark', '#nr-key', '#nr-key-save',
                           '#nr-cleanup-mode', '#nr-doc-build', '#nr-ex-zip', '#nr-ex-send']) {
            assert(await page.$(sel) !== null, `panel element present: ${sel}`);
        }

        const status = await page.evaluate(() => window.__tool.getStatus());
        assert(status.status === 'idle' && status.pairs === 0, 'clean idle status before any session');
        assert(status.cleanup === 'grounded', 'cleanup defaults to screenshot-grounded');

        // Keyless: capture must still be usable; only the model lanes need a key.
        assert(await page.$eval('#nr-share', el => !el.disabled), 'share button enabled without a key');
        assert(await page.$eval('#nr-finish', el => el.disabled), 'finish disabled before a session');

        // markMoment without a session is a typed refusal, not a crash.
        const noSession = await page.evaluate(async () => {
            try { await window.__tool.markMoment(); return { threw: false }; }
            catch (e) { return { threw: true, code: e.code }; }
        });
        assert(noSession.threw && noSession.code === 'no-session', 'markMoment without a session rejects {code:no-session}');

        // Cleanup mode is settable + persisted through the API.
        const mode = await page.evaluate(async () => {
            await window.__tool.setCleanupMode({ mode: 'text-only' });
            const s = await window.__tool.getStatus();
            await window.__tool.setCleanupMode({ mode: 'grounded' });
            return s.cleanup;
        });
        assert(mode === 'text-only', 'setCleanupMode switches the privacy mode');

        // An empty document still assembles (never blocks on model output).
        const doc = await page.evaluate(() => window.__tool.buildDocument());
        assert(typeof doc.markdown === 'string' && doc.markdown.includes('# Narrated review'),
            'buildDocument works with zero pairs');

        assert(errors.length === 0, 'zero uncaught errors after exercise', errors.join(' | '));
    } catch (err) {
        fail('smoke', err);
    } finally {
        await browser.close();
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run();
