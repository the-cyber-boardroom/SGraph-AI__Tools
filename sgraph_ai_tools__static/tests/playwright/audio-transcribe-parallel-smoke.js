/**
 * Audio Transcribe — Parallel / no-cross-talk smoke test (Playwright)
 *
 * Reproduces the "two files, same transcript, only ONE /chat/completions
 * request" bug at the browser level and proves the isolated transport fixes it.
 *
 * Root cause (pre-0.1.5): a single shared <sg-llm-request> drops a second
 * concurrent llm:send (its _busy guard), yet both waiting promises resolve on
 * the one response — so two overlapping transcriptions return the same text.
 * The isolated transport gives each request its own engine, so two concurrent
 * transcribeItem() calls must produce TWO completions requests and TWO distinct
 * transcripts.
 *
 * OpenRouter is mocked (no key / network needed). Requires the dev server.
 *
 * Usage:  AUDIO_TRANSCRIBE_URL=http://localhost:10063/en-gb/audio-transcribe/ \
 *         node tests/playwright/audio-transcribe-parallel-smoke.js
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.AUDIO_TRANSCRIBE_URL || 'http://localhost:10063/en-gb/audio-transcribe/';
const HEADLESS = process.env.HEADLESS !== 'false';

let passed = 0, failed = 0;
function assert(cond, label, detail = '') {
    if (cond) { console.log(`  ✓ ${label}`); passed++; }
    else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function run() {
    console.log('\naudio-transcribe parallel / no-cross-talk smoke\n');
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();

    // Mock OpenRouter before any page script runs: each /chat/completions call
    // gets a DISTINCT body + id, with a delay so the two requests overlap.
    await page.addInitScript(() => {
        window.__completions = 0;
        let counter = 0;
        const real = window.fetch.bind(window);
        window.fetch = async (url, opts) => {
            const u = typeof url === 'string' ? url : (url && url.url) || '';
            if (u.includes('/chat/completions')) {
                const n = ++counter;
                window.__completions++;
                await new Promise((r) => setTimeout(r, 60)); // force overlap
                return new Response(JSON.stringify({
                    id: `gen-${n}`,
                    choices: [{ message: { content: `TRANSCRIPT_${n}` }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 10, completion_tokens: 5 },
                }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (u.includes('/api/v1/key')) {
                return new Response(JSON.stringify({ data: { label: 'test', usage: 1, limit: 10, is_free_tier: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (u.includes('/api/v1/generation')) {
                return new Response(JSON.stringify({ data: { total_cost: 0.001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return real(url, opts);
        };
    });

    try {
        await page.goto(TOOL_URL, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForFunction(() => !!window.__tool, { timeout: 10000 });

        const r = await page.evaluate(async () => {
            await window.__tool.connect({ apiKey: 'sk-or-test', model: 'google/gemini-3.5-flash' });
            const mk = (name, n) => new File([new Uint8Array(n).fill(7)], name, { type: 'audio/mpeg' });
            await window.__tool.addFiles({ files: [mk('one.mp3', 4000), mk('two.mp3', 8000)] });
            const ids = (await window.__tool.getItems()).map((i) => i.id);
            // The bug scenario: two transcriptions fired concurrently.
            await Promise.all([
                window.__tool.transcribeItem({ id: ids[0] }),
                window.__tool.transcribeItem({ id: ids[1] }),
            ]);
            const after = await window.__tool.getItems();
            return { completions: window.__completions, transcripts: after.map((i) => i.transcript) };
        });

        assert(r.completions === 2, 'two concurrent transcriptions made TWO /chat/completions requests', `got ${r.completions}`);
        assert(r.transcripts[0] !== r.transcripts[1], 'the two items got DISTINCT transcripts (no cross-talk)', JSON.stringify(r.transcripts));
        assert(r.transcripts.every((t) => /^TRANSCRIPT_\d+$/.test(t || '')), 'both transcripts are real per-request responses', JSON.stringify(r.transcripts));
    } catch (e) {
        assert(false, 'run completed', e.message);
    } finally {
        await browser.close();
    }

    console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
