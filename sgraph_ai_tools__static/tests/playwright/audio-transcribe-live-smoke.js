/**
 * Audio Transcribe — Live (near-realtime) Smoke Test (Playwright)
 *
 * Drives the "🔴 Live" tab end-to-end against the REAL served page with a fake
 * mic and a mocked OpenRouter /chat/completions, so no network/key is needed:
 *   setApiKey → startLive → (poll fires at:live:update) → stopLive → Queue item.
 *
 * Validates:
 *   [1] startLive resolves { live:true } and at:live:started fires
 *   [2] at:live:update arrives (the growing-window poll ran) with the mocked text
 *   [3] stopLive resolves a new item id and the Queue gains one item
 *   [4] the saved take carries the transcript (the final pass)
 *
 * Requires the dev server + fake-media Chromium flags.
 *
 * Usage:
 *   node tests/playwright/audio-transcribe-live-smoke.js
 *
 * Optional env vars:
 *   AUDIO_TRANSCRIBE_URL  — default http://localhost:10063/en-gb/audio-transcribe/
 *   HEADLESS              — set to 'false' to watch (default true)
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.AUDIO_TRANSCRIBE_URL || 'http://localhost:10063/en-gb/audio-transcribe/';
const HEADLESS = process.env.HEADLESS !== 'false';
const MOCK_TEXT = 'live transcript from the fake mic';

let passed = 0, failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function assert(cond, label, detail = '') {
    if (cond) ok(label);
    else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function run() {
    console.log('\naudio-transcribe live smoke\n');
    const browser = await chromium.launch({
        headless: HEADLESS,
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();

    // Mock OpenRouter chat completions (non-streaming) — the transcribe path.
    await page.route('**/chat/completions', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: 'gen-live-mock',
                choices: [{ message: { role: 'assistant', content: MOCK_TEXT } }],
                usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
            }),
        });
    });

    try {
        await page.goto(TOOL_URL, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForFunction(() => !!window.__tool, { timeout: 10000 });

        // Collect live events on the page.
        await page.evaluate(() => {
            window.__live = { updates: [], started: null, stopped: null };
            window.addEventListener('at:live:started', (e) => { window.__live.started = e.detail; });
            window.addEventListener('at:live:update', (e) => { window.__live.updates.push(e.detail); });
            window.addEventListener('at:live:stopped', (e) => { window.__live.stopped = e.detail; });
        });

        await page.evaluate(() => window.__tool.setApiKey({ apiKey: 'sk-test-live' }));

        const itemsBefore = await page.evaluate(async () => (await window.__tool.getItems()).length);

        const startRes = await page.evaluate(() => window.__tool.startLive());
        assert(startRes && startRes.live === true, '[1] startLive resolves { live:true }');

        // Wait for at least one interim poll update.
        await page.waitForFunction(() => window.__live.updates.length >= 1, { timeout: 12000 }).catch(() => {});
        const sawUpdate = await page.evaluate(() => window.__live.updates.some((u) => (u.text || '').includes('live transcript from the fake mic')));
        assert(sawUpdate, '[2] at:live:update arrived with the mocked transcript');
        const sawStarted = await page.evaluate(() => !!window.__live.started);
        assert(sawStarted, '[1b] at:live:started fired');

        const stopRes = await page.evaluate(() => window.__tool.stopLive());
        assert(stopRes && stopRes.id, '[3] stopLive resolves a new item id', JSON.stringify(stopRes));

        const itemsAfter = await page.evaluate(async () => (await window.__tool.getItems()).length);
        assert(itemsAfter === itemsBefore + 1, '[3b] the Queue gained exactly one item', `before ${itemsBefore} after ${itemsAfter}`);

        const tx = await page.evaluate(async () => {
            const items = await window.__tool.getItems();
            const it = items[items.length - 1];
            return it && it.transcript;
        });
        assert(tx && tx.includes(MOCK_TEXT), '[4] the saved take carries the transcript', tx || '(none)');
    } catch (e) {
        console.error(`  ✗ live flow: ${e.message}`);
        failed++;
    } finally {
        await browser.close();
    }

    console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
