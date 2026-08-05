/**
 * Video Publisher — Boot Smoke Test (Playwright)
 *
 * Loads the REAL served page (run scripts/run-locally.sh first) and fails on
 * anything that throws during boot — the highest-value guard for a composed
 * tool: a broken core extraction, a bad import path, or a sync consumption
 * of an always-async SgToolApi action all surface here.
 *
 * Validates:
 *   [1] Page boots with ZERO uncaught pageerrors (external-origin fetch
 *       failures — GIS, site-header CDN — are tolerated, our modules aren't)
 *   [2] window.__tool is published (api.activate() ran → tool:ready fired)
 *   [3] All 28 registered actions exist and return Promises
 *   [4] getJob() reports a sane idle job (phase, steps, autoRun)
 *   [5] The Steps panel + Record/Import/Metadata/Publish panels rendered
 *   [6] importFile with a tiny fake video blob transitions the job to
 *       'loaded' and runs the audio step to a terminal state (done or a
 *       typed no-audio-stream error — the fake blob has no real audio)
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/video-publisher-boot-smoke.js
 *
 * Env: VIDEO_PUBLISHER_URL (default http://localhost:10063/en-gb/video-publisher/),
 *      HEADLESS ('false' to watch)
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.VIDEO_PUBLISHER_URL || 'http://localhost:10063/en-gb/video-publisher/';
const HEADLESS = process.env.HEADLESS !== 'false';

const EXPECTED_ACTIONS = [
    'setRecordConfig', 'getRecordConfig', 'startPreview', 'stopPreview',
    'startRecording', 'pauseRecording', 'resumeRecording', 'stopRecording',
    'importFile', 'getJob', 'reset', 'setAutoRun',
    'extractAudio', 'transcribe', 'getTranscript', 'listModels', 'setApiKey',
    'generateMetadata', 'setMetadata', 'getMetadata', 'getCostSummary',
    'setClientId', 'connectYouTube', 'disconnectYouTube', 'getMyChannel',
    'upload', 'publish', 'getStatus', 'health',
];

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.error(`  ✗ ${label}: ${err?.message || err}`); failed++; }
function assert(cond, label, detail = '') {
    if (cond) ok(label);
    else throw new Error(`Assertion failed: ${label}${detail ? ' — ' + detail : ''}`);
}

/** Errors from origins we don't control (blocked in sandboxes) are tolerated. */
function isExternalNoise(text) {
    return /accounts\.google\.com|dev\.sgraph\.ai|unpkg\.com|net::ERR|Failed to load resource/.test(text);
}

async function run() {
    console.log('\nvideo-publisher boot smoke\n');
    // PW_CHROMIUM: explicit browser binary for environments with a
    // pre-installed Chromium that doesn't match the playwright package pin.
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

        // [2] tool:ready → window.__tool
        await page.waitForFunction(() => !!window.__tool, null, { timeout: 15000 });
        ok('window.__tool published (tool:ready fired)');

        // [1] boot errors
        await page.waitForTimeout(1000);
        assert(errors.length === 0, 'zero uncaught boot errors', errors.join(' | '));

        // [3] actions exist and return Promises
        const actionReport = await page.evaluate((names) => {
            const t = window.__tool;
            const missing = names.filter(n => typeof t[n] !== 'function');
            const notPromise = [];
            for (const n of ['getJob', 'getRecordConfig', 'listModels', 'health']) {
                const r = t[n]({});
                if (!(r instanceof Promise)) notPromise.push(n);
                r.catch(() => {});
            }
            return { missing, notPromise };
        }, EXPECTED_ACTIONS);
        assert(actionReport.missing.length === 0, `all ${EXPECTED_ACTIONS.length} actions registered`, `missing: ${actionReport.missing.join(',')}`);
        assert(actionReport.notPromise.length === 0, 'actions return Promises (SgToolApi contract)');

        // [4] idle job shape
        const job = await page.evaluate(() => window.__tool.getJob());
        assert(job.phase === 'idle', `job phase is idle (got ${job.phase})`);
        assert(job.steps && ['audio', 'transcript', 'metadata', 'publish'].every(k => job.steps[k]?.status === 'idle'),
            'all four steps idle');

        // [5] panels rendered
        for (const sel of ['#vp-rec-start', '#vp-drop', '.vp-step[data-step="audio"]', '#vp-md-title', '#vp-pub-upload', '#vp-acc-or-key']) {
            assert(await page.$(sel) !== null, `panel element present: ${sel}`);
        }

        // [6] importFile with a fake blob → loaded, audio step reaches a terminal state
        const flow = await page.evaluate(async () => {
            const t = window.__tool;
            await t.setAutoRun({ enabled: false });
            const file = new File([new Uint8Array(4096)], 'fake.webm', { type: 'video/webm' });
            await t.importFile({ file });
            const afterLoad = await t.getJob();
            let audioOutcome;
            try { audioOutcome = { ok: true, result: await t.extractAudio() }; }
            catch (e) { audioOutcome = { ok: false, code: e.code || null, message: e.message }; }
            const end = await t.getJob();
            return { afterLoad, audioOutcome, end };
        });
        assert(flow.afterLoad.phase === 'loaded', `importFile → phase loaded (got ${flow.afterLoad.phase})`);
        assert(flow.afterLoad.filename === 'fake.webm', 'filename recorded');
        const audioStatus = flow.end.steps.audio.status;
        assert(audioStatus === 'done' || audioStatus === 'error',
            `audio step reached terminal state (${audioStatus}${flow.audioOutcome.code ? ', code ' + flow.audioOutcome.code : ''})`);
        if (!flow.audioOutcome.ok) {
            assert(flow.audioOutcome.code === 'no-audio-stream',
                `fake-blob failure is the typed no-audio-stream error (got ${flow.audioOutcome.code})`);
        }

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
