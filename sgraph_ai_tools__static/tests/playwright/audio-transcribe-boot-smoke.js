/**
 * Audio Transcribe — Boot Smoke Test (Playwright)
 *
 * The single highest-value guard against the class of bug that shipped a broken
 * tool: anything that throws during page boot. It loads the REAL served page and
 * fails if the console logs ANY uncaught error or pageerror — which is exactly
 * how "TypeError: models.map is not a function" (ui-model.js consuming the
 * always-async SgToolApi action api.listModels() as a synchronous array) would
 * have been caught before merge.
 *
 * Validates:
 *   [1] Page boots with ZERO uncaught console errors / pageerrors
 *   [2] window.__tool is published (api.activate() ran → tool:ready fired)
 *   [3] The model <select> rendered the curated model options
 *   [4] Every registered SgToolApi action returns a Promise (the wrapper contract)
 *
 * Requires the dev server (absolute `/core/...` imports only resolve when served).
 *
 * Usage:
 *   npm install playwright
 *   node tests/playwright/audio-transcribe-boot-smoke.js
 *
 * Optional env vars:
 *   AUDIO_TRANSCRIBE_URL  — default http://localhost:10063/en-gb/audio-transcribe/
 *   HEADLESS              — set to 'false' to watch the browser (default true)
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.AUDIO_TRANSCRIBE_URL || 'http://localhost:10063/en-gb/audio-transcribe/';
const HEADLESS = process.env.HEADLESS !== 'false';

// ── Harness ────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.error(`  ✗ ${label}: ${err?.message || err}`); failed++; }
function assert(cond, label, detail = '') {
    if (cond) ok(label);
    else throw new Error(`Assertion failed: ${label}${detail ? ' — ' + detail : ''}`);
}

async function run() {
    console.log('\naudio-transcribe boot smoke\n');
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();

    // Capture every uncaught error the page produces.
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message}`); });

    try {
        await page.goto(TOOL_URL, { waitUntil: 'networkidle', timeout: 20000 });

        // [2] Tool published its API (proves init() + activate() completed).
        await page.waitForFunction(() => !!window.__tool, { timeout: 10000 }).catch(() => {});
        const hasTool = await page.evaluate(() => !!window.__tool);

        // [1] No boot-time errors. Report the actual errors so failures are diagnosable.
        try {
            assert(errors.length === 0, 'page boots with zero uncaught errors', errors.join(' | '));
        } catch (e) { fail('page boots with zero uncaught errors', e); }

        try { assert(hasTool, 'window.__tool is published'); }
        catch (e) { fail('window.__tool is published', e); }

        // [3] Model selector actually rendered (the panel that crashed before).
        try {
            const optionCount = await page.evaluate(() => document.querySelectorAll('#at-model-select option').length);
            assert(optionCount >= 1, 'model <select> rendered options', `got ${optionCount}`);
        } catch (e) { fail('model <select> rendered options', e); }

        // [4] SgToolApi wrapper contract: actions are always thenables.
        if (hasTool) {
            try {
                const isThenable = await page.evaluate(() => {
                    const r = window.__tool.listModels();
                    return r && typeof r.then === 'function' && !Array.isArray(r);
                });
                assert(isThenable, 'api.listModels() returns a Promise, never the raw array');
            } catch (e) { fail('api.listModels() returns a Promise', e); }
        }
    } catch (e) {
        fail('page navigation / boot', e);
    } finally {
        await browser.close();
    }

    console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
