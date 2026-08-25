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

    // Mock OpenRouter chat completions. Two shapes share this endpoint:
    //  - transcription → JSON (non-streaming)
    //  - TTS (modalities:['audio']) → SSE stream of delta.audio pcm16 chunks
    await page.route('**/chat/completions', async (route) => {
        let isTts = false;
        try { isTts = (JSON.parse(route.request().postData() || '{}').modalities || []).includes('audio'); } catch (_) { /* */ }
        if (isTts) {
            await route.fulfill({
                status: 200, headers: { 'content-type': 'text/event-stream' },
                body: 'data: {"id":"gen-tts","choices":[{"delta":{"audio":{"data":"AQIDBA=="}}}]}\n\ndata: [DONE]\n\n',
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: 'gen-live-mock',
                choices: [{ message: { role: 'assistant', content: MOCK_TEXT } }],
                usage: { prompt_tokens: 10, completion_tokens: 5 }, // no inline cost → exact cost comes from the generation lookup (real paid path)
            }),
        });
    });
    // Mock the deferred per-generation cost lookup (each live segment is billed).
    await page.route('**/generation*', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { total_cost: 0.00031 } }) });
    });

    try {
        await page.goto(TOOL_URL, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForFunction(() => !!window.__tool, { timeout: 10000 });

        // Collect live events on the page.
        await page.evaluate(() => {
            window.__live = { updates: [], segments: [], started: null, stopped: null };
            window.addEventListener('at:live:started', (e) => { window.__live.started = e.detail; });
            window.addEventListener('at:live:update', (e) => { window.__live.updates.push(e.detail); });
            window.addEventListener('at:live:segment', (e) => { window.__live.segments.push(e.detail); });
            window.addEventListener('at:live:stopped', (e) => { window.__live.stopped = e.detail; });
        });

        await page.evaluate(() => window.__tool.setApiKey({ apiKey: 'sk-test-live' }));

        const itemsBefore = await page.evaluate(async () => (await window.__tool.getItems()).length);

        // The fake mic is a continuous tone (no pauses) → force periodic VAD cuts
        // (tiny threshold so the tone is "speech"; short max-utterance to endpoint).
        const startRes = await page.evaluate(() => window.__tool.startLive({ vad: { speechThreshold: 0.0001, silenceThreshold: 0, endpointMs: 99999, minSpeechMs: 0, preRollMs: 0, maxUtteranceMs: 700 } }));
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

        // [5] Segments were reported (request/response provenance) with size + seq.
        const segOk = await page.evaluate(() => {
            const s = window.__live.segments;
            return s.length >= 1 && s.every((x) => x.seq >= 1 && x.sizeBytes > 0);
        });
        assert(segOk, '[5] at:live:segment events arrived with seq + size');

        // [6] The exact per-segment cost resolves (deferred /generation lookup).
        await page.waitForFunction(() => window.__live.segments.some((x) => typeof x.costUsd === 'number'), { timeout: 8000 }).catch(() => {});
        const costOk = await page.evaluate(() => window.__live.segments.some((x) => x.costUsd === 0.00031));
        assert(costOk, '[6] per-segment cost resolved via the generation lookup');

        // [7] The Live panel rendered the segment rows + a running total.
        const domOk = await page.evaluate(() => {
            const rows = document.querySelectorAll('[data-live-segs] .at-live__seg').length;
            const tot = (document.querySelector('[data-live-segtot]') || {}).textContent || '';
            return rows >= 1 && /clip/.test(tot);
        });
        assert(domOk, '[7] Live panel shows segment rows + running total');

        // [8] Headless chat API (ask) is scriptable and returns text + usage.
        const askRes = await page.evaluate(() => window.__tool.ask({ text: 'what was said?' }));
        assert(askRes && askRes.text && askRes.text.includes(MOCK_TEXT) && askRes.generationId && askRes.usage,
            '[8] ask({text}) returns reply + generationId + usage', JSON.stringify(askRes));

        // [9] Read API on the SERVED page is a non-empty ARRAY (deploy-drift guard,
        //     vault dev-brief Finding 4 — the Node contract test can't catch a
        //     stale served bundle; this assertion runs against the real page).
        const arrOk = await page.evaluate(async () => {
            const it = await window.__tool.getItems();
            return Array.isArray(it) && it.length >= 1 && typeof it[0].id === 'string';
        });
        assert(arrOk, '[9] getItems() is a non-empty ARRAY on the served page');

        // [10] OpenRouter TTS emits audio bytes on the served page (Finding 2/4).
        const ttsOk = await page.evaluate(async () => {
            const r = await window.__tool.synthesize({ text: 'hi there', mode: 'openrouter', voice: 'alloy' });
            return r && r.sizeBytes > 0;
        });
        assert(ttsOk, '[10] OpenRouter TTS returns audio bytes (>0) on the served page');
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
