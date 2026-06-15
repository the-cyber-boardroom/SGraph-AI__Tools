/**
 * Live Transcribe (minimal variation) — Smoke Test (Playwright)
 *
 * Verifies the "big button" variation boots and drives end-to-end against the
 * REAL served page with a fake mic + mocked OpenRouter:
 *   [1] boots with window.__tool + the big Live button + drop zone, zero errors
 *   [2] setApiKey → startLive → at:live:update (mocked transcript) → stopLive
 *   [3] the take is saved (getItems is a non-empty array) + the transcript shows
 *   [4] drop/addFiles → transcribeAll transcribes a dropped sample
 *
 * Usage: node tests/playwright/live-transcribe-smoke.js
 */

const { chromium } = require('playwright');

const URL = process.env.LIVE_TRANSCRIBE_URL || 'http://localhost:10063/en-gb/live-transcribe/';
const HEADLESS = process.env.HEADLESS !== 'false';
const MOCK_TEXT = 'minimal live transcript';

let passed = 0, failed = 0;
function assert(cond, label, detail = '') { if (cond) { console.log(`  ✓ ${label}`); passed++; } else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; } }

async function run() {
    console.log('\nlive-transcribe smoke\n');
    const browser = await chromium.launch({ headless: HEADLESS, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route('**/chat/completions', (r) => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 'gen-lt', choices: [{ message: { role: 'assistant', content: MOCK_TEXT } }], usage: { prompt_tokens: 8, completion_tokens: 3 } }),
    }));
    await page.route('**/generation*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { total_cost: 0.0002 } }) }));

    try {
        await page.goto(URL, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForFunction(() => !!window.__tool, { timeout: 10000 });
        const boot = await page.evaluate(() => ({ tool: !!window.__tool, liveBtn: !!document.querySelector('[data-live-btn]'), drop: !!document.querySelector('[data-drop]') }));
        assert(boot.tool && boot.liveBtn && boot.drop, '[1] boots with __tool + big Live button + drop zone');
        assert(errors.length === 0, '[1b] zero console errors', errors.join(' | '));

        await page.evaluate(() => { window.__u = []; window.addEventListener('at:live:update', (e) => window.__u.push(e.detail)); });
        await page.evaluate(() => window.__tool.setApiKey({ apiKey: 'sk-test' }));

        const start = await page.evaluate(() => window.__tool.startLive());
        assert(start && start.live === true, '[2] startLive resolves { live:true }');
        await page.waitForFunction(() => window.__u.length >= 1, { timeout: 12000 }).catch(() => {});
        const sawUpdate = await page.evaluate(() => window.__u.some((u) => (u.text || '').includes('minimal live transcript')));
        assert(sawUpdate, '[2b] at:live:update arrived with the mocked transcript');
        const stop = await page.evaluate(() => window.__tool.stopLive());
        assert(stop && stop.id, '[2c] stopLive saved a take (id)');

        const arr = await page.evaluate(async () => { const it = await window.__tool.getItems(); return { isArr: Array.isArray(it), len: it.length, tx: it[it.length - 1] && it[it.length - 1].transcript }; });
        assert(arr.isArr && arr.len >= 1 && (arr.tx || '').includes(MOCK_TEXT), '[3] take saved; getItems array carries the transcript', JSON.stringify(arr));
        const listOk = await page.evaluate(() => /minimal live transcript/.test(document.querySelector('[data-list]').textContent));
        assert(listOk, '[3b] the transcripts list rendered the take');

        // [4] Drop path: add a WAV sample programmatically + transcribe.
        const dropOk = await page.evaluate(async () => {
            const bytes = new Uint8Array(64); // tiny WAV-ish blob; mock STT ignores content
            const file = new File([bytes], 'drop.wav', { type: 'audio/wav' });
            const before = (await window.__tool.getItems()).length;
            await window.__tool.addFiles({ files: [file] });
            await window.__tool.transcribeAll();
            const items = await window.__tool.getItems();
            return items.length === before + 1 && (items[items.length - 1].transcript || '').includes('minimal live transcript');
        });
        assert(dropOk, '[4] dropped file is added + transcribed');
    } catch (e) {
        console.error(`  ✗ flow: ${e.message}`); failed++;
    } finally {
        await browser.close();
    }
    console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}
run().catch((e) => { console.error(e); process.exit(1); });
