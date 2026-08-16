/**
 * Narrated Review — Headless Pipeline Smoke (Playwright)
 *
 * Drives the whole tool with NO gestures and NO network:
 *   addRecording → markAt ×3 → transcribeAll → cleanAll → buildDocument → zip
 *
 * OpenRouter is mocked in-page. The mock distinguishes the two lanes by the
 * request body: an `input_audio`/`binary_file` part is a TRANSCRIPTION (returns
 * deliberately garbled text, mirroring the corpus's real failure — the product
 * name rendered as "Eskit"), an `image_url` part is the GROUNDED CLEANUP
 * (returns strict JSON that fixes the name from the screenshot and flags one
 * span as unsure).
 *
 * This covers the pack's acceptance criteria 2 (no lost first seconds),
 * 3 (ordered image+words pairs), 4 (grounded cleanup corrects + marks),
 * 5 (raw survives every operation) and 8 (full headless run).
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/narrated-review-pipeline-smoke.js
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.NARRATED_REVIEW_URL || 'http://localhost:10063/en-gb/narrated-review/';
const HEADLESS = process.env.HEADLESS !== 'false';

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
    console.log('\nnarrated-review headless pipeline smoke\n');
    const browser = await chromium.launch({
        headless: HEADLESS,
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    });
    const page = await browser.newPage();

    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !isExternalNoise(m.text())) errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    // ── Mock OpenRouter before any page script runs ──────────────────────────
    await page.addInitScript(() => {
        window.__calls = { transcribe: 0, cleanGrounded: 0, cleanTextOnly: 0, sawSummary: [] };
        const real = window.fetch.bind(window);
        window.fetch = async (url, opts) => {
            const u = typeof url === 'string' ? url : (url && url.url) || '';
            if (u.includes('/chat/completions')) {
                const body = JSON.parse((opts && opts.body) || '{}');
                const parts = (body.messages || []).flatMap(m => Array.isArray(m.content) ? m.content : []);
                const hasAudio = parts.some(p => p.type === 'input_audio' || p.type === 'binary_file');
                const hasImage = parts.some(p => p.type === 'image_url');

                if (hasAudio) {
                    const n = ++window.__calls.transcribe;
                    // Deliberately garbled: the recogniser mishears the product name.
                    return new Response(JSON.stringify({
                        id: `gen-t${n}`,
                        choices: [{ message: { content: `this is Eskit segment ${n} speaking about the login page` }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0002 },
                    }), { status: 200, headers: { 'content-type': 'application/json' } });
                }

                // Cleanup lane. Record the rolling summary the tool sent us.
                const userText = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
                window.__calls.sawSummary.push(userText.split('\n')[1] || '');
                if (hasImage) window.__calls.cleanGrounded++; else window.__calls.cleanTextOnly++;
                const n = window.__calls.cleanGrounded + window.__calls.cleanTextOnly;
                const fixed = hasImage
                    ? `This is SGraph segment ${n} speaking about the login page.`   // screenshot fixes the name
                    : `this is Eskit segment ${n} speaking about the login page.`;   // text-only cannot
                return new Response(JSON.stringify({
                    id: `gen-c${n}`,
                    choices: [{ message: { content: JSON.stringify({
                        cleanText: fixed,
                        marks: hasImage ? [{ span: 'login page', note: 'could be "log-in page"' }] : [],
                        summary: `Reviewing the SGraph login page. Segments so far: ${n}.`,
                    }) }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 20, completion_tokens: 10, cost: 0.0003 },
                }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (u.includes('/api/v1/generation')) {
                return new Response(JSON.stringify({ data: { total_cost: 0.0005 } }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (u.includes('/api/v1/key')) {
                return new Response(JSON.stringify({ data: { label: 'test', usage: 1, limit: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return real(url, opts);
        };

        /**
         * Build a WAV: speech bursts separated by real silence, so the VAD
         * boundary snap has something to find.
         *   0.0–0.5 silence · 0.5–3.0 speech · 3.0–4.0 silence
         *   4.0–7.0 speech   · 7.0–8.0 silence · 8.0–11.0 speech
         */
        window.__makeTestWav = function () {
            const rate = 16000, dur = 12, n = rate * dur;
            const data = new Float32Array(n);
            const bursts = [[0.5, 3.0], [4.0, 7.0], [8.0, 11.0]];
            for (const [a, b] of bursts) {
                for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++) {
                    data[i] = 0.25 * Math.sin(2 * Math.PI * 220 * (i / rate));
                }
            }
            const bytes = new ArrayBuffer(44 + n * 2);
            const v = new DataView(bytes);
            const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
            ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
            v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
            v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
            v.setUint16(32, 2, true); v.setUint16(34, 16, true);
            ws(36, 'data'); v.setUint32(40, n * 2, true);
            for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, data[i] * 0x7fff, true);
            return new File([bytes], 'narration.wav', { type: 'audio/wav' });
        };

        /** A 1×1 PNG blob standing in for a screenshot. */
        window.__makeTestPng = async function () {
            const c = document.createElement('canvas');
            c.width = 8; c.height = 8;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#14b8a6'; ctx.fillRect(0, 0, 8, 8);
            return new Promise(r => c.toBlob(r, 'image/png'));
        };
    });

    try {
        await page.goto(TOOL_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__tool, null, { timeout: 15000 });
        ok('window.__tool published');

        // ── The full headless run ────────────────────────────────────────────
        const result = await page.evaluate(async () => {
            const t = window.__tool;
            await t.setApiKey({ apiKey: 'sk-or-test' });
            const rec = await t.addRecording({ file: window.__makeTestWav() });

            const png = await window.__makeTestPng();
            // Press PARTWAY THROUGH each burst — the natural rhythm the brief
            // describes (people press after they have started speaking).
            await t.markAt({ t: 1800, image: png });   // burst 1 began at 500ms
            await t.markAt({ t: 5000, image: png });   // burst 2 began at 4000ms
            await t.markAt({ t: 9000, image: png });   // burst 3 began at 8000ms

            const trans = await t.transcribeAll();
            const clean = await t.cleanAll();
            const pairs = await t.getPairs();
            const doc = await t.buildDocument();
            const summary = await t.getSummary();
            const costs = await t.getCostSummary();
            return { rec, trans, clean, pairs, markdown: doc.markdown, images: doc.images, summary, costs, calls: window.__calls };
        });

        assert(Math.round(result.rec.durationMs / 1000) === 12, 'imported take spans 12s', `${result.rec.durationMs}ms`);
        assert(result.pairs.length === 3, 'three pairs from three marks');
        assert(result.trans.done === 3 && result.trans.failed === 0, 'all three segments transcribed in the parallel lane');
        assert(result.clean.done === 3 && result.clean.failed === 0, 'all three pairs cleaned in the sequential lane');

        // ── Acceptance criterion 2: no lost first seconds ────────────────────
        const p2 = result.pairs[1];
        assert(p2.tStart < 4000, 'boundary snapped BEFORE the sentence started (speak-before-press recovered)',
            `pressed at 5000, segment starts at ${p2.tStart}ms; burst began at 4000ms`);
        assert(p2.tStart > 2500, 'snap did not run away past the preceding pause', `tStart=${p2.tStart}`);

        // ── Ordering + alignment ─────────────────────────────────────────────
        assert(result.pairs.every((p, i) => p.seq === i), 'pairs carry press order');
        assert(result.pairs.every((p, i) => i === 0 || p.tStart >= result.pairs[i - 1].tStart), 'bounds are monotonic');
        assert(result.pairs.every(p => p.hasScreenshot), 'every pair holds its screenshot');
        assert(result.images.length === 3, 'document references three images');

        // ── Criterion 4: grounded cleanup corrects + marks ───────────────────
        assert(result.calls.cleanGrounded === 3 && result.calls.cleanTextOnly === 0,
            'cleanup ran in grounded mode — the screenshot went with every call');
        assert(result.pairs.every(p => p.clean.text.includes('SGraph')),
            'screenshot-grounded cleanup fixed the misheard product name');
        assert(result.pairs.every(p => p.clean.marks.length === 1),
            'uncertain spans are MARKED, not silently resolved');
        assert(result.markdown.includes('[unsure]') && result.markdown.includes('## Uncertain corrections'),
            'document surfaces the unsure marks');

        // ── Criterion 5: raw survives ────────────────────────────────────────
        assert(result.pairs.every(p => p.raw.text.includes('Eskit')),
            'raw transcript preserved unedited alongside the cleaned text');
        assert(result.markdown.includes('## Appendix — raw transcripts'), 'raw appendix ships in the document');

        // ── Rolling summary: sent, and advancing ─────────────────────────────
        assert(result.summary.summary.includes('SGraph'), 'rolling summary maintained across segments');
        assert(result.calls.sawSummary[0].includes('session start'), 'first cleanup call sent an empty summary');
        assert(result.calls.sawSummary[2].includes('SGraph'), 'later cleanup calls received the accumulated summary');

        // ── Cost roll-up ─────────────────────────────────────────────────────
        assert(result.costs.sessionUsd > 0 && result.costs.perPair.length === 3, 'per-pair costs rolled up');

        // ── Document shape ───────────────────────────────────────────────────
        assert(/^# Narrated review/m.test(result.markdown), 'document has a title');
        assert((result.markdown.match(/^## \d+\. At /gm) || []).length === 3, 'one heading per pair, in order');
        assert(result.markdown.includes('![Moment 1](images/pair-01.png)'), 'image references use the bundle layout');

        // ── Editing contract: setText touches clean only ─────────────────────
        const edited = await page.evaluate(async () => {
            const t = window.__tool;
            const [p] = await t.getPairs();
            await t.setText({ id: p.id, text: 'human edited text' });
            const after = await t.getPair({ id: p.id });
            return { raw: after.raw.text, clean: after.clean.text };
        });
        assert(edited.clean === 'human edited text' && edited.raw.includes('Eskit'),
            'setText edits clean text and leaves raw untouched');

        // ── Zip bundle assembles (JSZip from CDN is blocked, so inject) ──────
        const bundle = await page.evaluate(async () => {
            const mod = await import('/tools/../core/sg-zip/v0/v0.1/v0.1.0/sg-zip.js').catch(() => null);
            const nrZip = await import('./api/nr-zip.js');
            const seen = [];
            class FakeZip {
                file(path, payload) { seen.push({ path, kind: payload instanceof Blob ? 'blob' : 'text' }); }
                generateAsync() { return Promise.resolve(new Blob(['zip'], { type: 'application/zip' })); }
            }
            const { entries } = nrZip.buildSessionEntries({});
            const r = await nrZip.buildSessionZip({ JSZip: FakeZip });
            return { paths: entries.map(e => e.path), size: r.blob.size, name: r.name };
        });
        for (const want of ['review.md', 'images/pair-01.png', 'audio/p01.wav', 'raw/p01.txt', 'session.json']) {
            assert(bundle.paths.includes(want), `bundle contains ${want}`);
        }
        assert(bundle.paths.some(p => p.startsWith('audio/take.')), 'bundle contains the continuous take');

        // ── Spend cap halts the lanes ────────────────────────────────────────
        const capped = await page.evaluate(async () => {
            const t = window.__tool;
            await t.setSpendCap({ usd: 0.0000001 });
            try { await t.retranscribePair({ id: (await t.getPairs())[0].id }); return { threw: false }; }
            catch (e) { return { threw: true, code: e.code }; }
            finally { await t.setSpendCap({ usd: null }); }
        });
        assert(capped.threw && capped.code === 'budget-cap', 'spend cap halts work with {code:budget-cap}');

        assert(errors.length === 0, 'zero uncaught errors through the whole run', errors.join(' | '));
    } catch (err) {
        fail('pipeline smoke', err);
    } finally {
        await browser.close();
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run();
