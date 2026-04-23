/**
 * Infographic Generator — Playwright Smoke Test
 *
 * Validates the full JS API Primitive contract end-to-end:
 *   connect() → generate() → imageSrc present → events fired
 *
 * Usage:
 *   npm install playwright
 *   OPENROUTER_API_KEY=sk-or-v1-... node tests/playwright/infographic-gen-smoke.js
 *
 * Optional env vars:
 *   PAGE_URL   — default http://localhost:10063/en-gb/infographic-gen/
 *   MODEL      — override model (default google/gemini-2.0-flash-exp:free)
 *   HEADLESS   — set to 'false' to watch the browser (default true)
 */

const { chromium } = require('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:10063/en-gb/infographic-gen/';
const API_KEY  = process.env.OPENROUTER_API_KEY;
const MODEL    = process.env.MODEL || 'google/gemini-2.0-flash-exp:free';
const HEADLESS = process.env.HEADLESS !== 'false';

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.error(`  ✗ ${label}: ${err?.message || err}`); failed++; }

function assert(condition, label, detail = '') {
    if (condition) ok(label);
    else throw new Error(`Assertion failed: ${label}${detail ? ' — ' + detail : ''}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testWindowToolReady(page) {
    console.log('\n[1] window.__tool ready');
    await page.waitForFunction(() => window.__tool?.meta?.health()?.status === 'ready', { timeout: 10_000 });
    const health = await page.evaluate(() => window.__tool.meta.health());
    assert(health.status === 'ready', 'health.status is ready');
    assert(health.methodCount >= 9, `methodCount >= 9 (got ${health.methodCount})`);
    assert(Array.isArray(health.methods), 'health.methods is array');
    ok('health snapshot looks good');
}

async function testSgaToolConstants(page) {
    console.log('\n[2] window.SGA_TOOL constants');
    const keys = await page.evaluate(() => Object.keys(window.SGA_TOOL || {}));
    assert(keys.length >= 7, `SGA_TOOL has >= 7 keys (got ${keys.length})`);
    for (const expected of ['TOOL_READY', 'TOOL_CONNECTED', 'GENERATION_STARTED', 'GENERATION_COMPLETE', 'GENERATION_ERROR', 'GENERATION_CANCELLED']) {
        assert(keys.includes(expected), `SGA_TOOL.${expected} exists`);
    }
}

async function testMetaMethods(page) {
    console.log('\n[3] meta API');
    const methods = await page.evaluate(() => window.__tool.meta.getMethods());
    for (const m of ['connect', 'generate', 'getState', 'setPrompt', 'getPrompt', 'setModel', 'getModel', 'setTemplate', 'stop']) {
        assert(methods.includes(m), `meta.getMethods() includes ${m}`);
    }

    const version = await page.evaluate(() => window.__tool.meta.getVersion());
    assert(typeof version.api === 'string',     'version.api is string');
    assert(typeof version.ui  === 'string',     'version.ui is string');

    const manifest = await page.evaluate(() => window.__tool.meta.getManifest());
    assert(manifest && typeof manifest === 'object', 'getManifest() returns object');

    const skills = await page.evaluate(() => window.__tool.meta.getSkills());
    assert(typeof skills.human   === 'string', 'skills.human loaded');
    assert(typeof skills.browser === 'string', 'skills.browser loaded');
    assert(typeof skills.api     === 'string', 'skills.api loaded');
}

async function testGetState(page) {
    console.log('\n[4] getState()');
    const state = await page.evaluate(() => window.__tool.getState());
    assert(typeof state.mode              === 'string',  'state.mode is string');
    assert(typeof state.connected         === 'boolean', 'state.connected is boolean');
    assert(typeof state.activeGenerations === 'number',  'state.activeGenerations is number');
    assert(typeof state.model             === 'string',  'state.model is string');
    assert(typeof state.systemPrompt      === 'string',  'state.systemPrompt is string');
}

async function testNoKeyFlash(page) {
    console.log('\n[5] no-key flash guard');
    // Clear the API key input and click Send — should flash red, not throw
    await page.evaluate(() => {
        const el = document.getElementById('api-key');
        if (el) el.value = '';
    });
    // generate() should reject with a meaningful error
    const err = await page.evaluate(() =>
        window.__tool.generate({ prompt: 'test' }).then(() => null).catch(e => e.message)
    );
    assert(err && err.includes('connect'), `generate() with no key rejects with helpful message (got: "${err}")`);
}

async function testSetTemplateAndPrompt(page) {
    console.log('\n[6] setTemplate / setPrompt / getPrompt');
    const templatePrompt = await page.evaluate(() => window.__tool.setTemplate('executive'));
    assert(typeof templatePrompt === 'string' && templatePrompt.length > 10, 'setTemplate returns prompt string');

    const fetched = await page.evaluate(() => window.__tool.getPrompt());
    assert(fetched === templatePrompt, 'getPrompt() matches template text');

    await page.evaluate(() => window.__tool.setPrompt('Custom prompt for testing'));
    const custom = await page.evaluate(() => window.__tool.getPrompt());
    assert(custom === 'Custom prompt for testing', 'setPrompt() round-trips correctly');

    // Unknown template throws
    const tmplErr = await page.evaluate(() =>
        Promise.resolve().then(() => window.__tool.setTemplate('definitely-does-not-exist'))
            .catch(e => e.message)
    );
    assert(tmplErr && tmplErr.includes('Unknown template'), 'unknown template throws with helpful message');
}

async function testModelGetSet(page) {
    console.log('\n[7] setModel / getModel');
    const original = await page.evaluate(() => window.__tool.getModel());
    assert(typeof original === 'string' && original.length > 0, 'getModel() returns string');
    await page.evaluate(m => window.__tool.setModel(m), MODEL);
    const after = await page.evaluate(() => window.__tool.getModel());
    assert(after === MODEL, `setModel(${MODEL}) applied`);
}

async function testConnect(page) {
    if (!API_KEY) { console.log('\n[8] connect() — SKIPPED (no OPENROUTER_API_KEY)'); return; }
    console.log('\n[8] connect()');

    const events = await page.evaluate(() => {
        window.__smokeEvents = [];
        window.addEventListener('tool:connected', e => window.__smokeEvents.push({ type: 'connected', detail: e.detail }));
    });

    const conn = await page.evaluate(async (key) => {
        return await window.__tool.connect({ apiKey: key });
    }, API_KEY);

    assert(conn.provider === 'openrouter',   'connect() provider is openrouter');
    assert(typeof conn.model === 'string',    'connect() returns model');

    const fired = await page.evaluate(() => window.__smokeEvents);
    assert(fired.some(e => e.type === 'connected'), 'tool:connected event fired');
}

async function testGenerate(page) {
    if (!API_KEY) { console.log('\n[9] generate() — SKIPPED (no OPENROUTER_API_KEY)'); return; }
    console.log('\n[9] generate()');

    // Collect events
    await page.evaluate(() => {
        window.__genEvents = [];
        window.addEventListener('tool:generation:started',  e => window.__genEvents.push({ type: 'started',  detail: e.detail }));
        window.addEventListener('tool:generation:complete', e => window.__genEvents.push({ type: 'complete', detail: e.detail }));
        window.addEventListener('tool:generation:error',    e => window.__genEvents.push({ type: 'error',    detail: e.detail }));
    });

    const result = await page.evaluate(async (model) => {
        return await window.__tool.generate({
            prompt: 'A simple 3-step process: Plan → Build → Ship',
            model,
        });
    }, MODEL);

    assert(result.instanceId === 'infographic-generator:root', 'result.instanceId correct');
    assert(typeof result.model    === 'string', 'result.model is string');
    assert(typeof result.duration === 'number' && result.duration > 0, `result.duration > 0 (got ${result.duration})`);

    const events = await page.evaluate(() => window.__genEvents);
    assert(events.some(e => e.type === 'started'),  'tool:generation:started event fired');
    assert(events.some(e => e.type === 'complete'), 'tool:generation:complete event fired');

    if (result.imageSrc) {
        assert(result.imageSrc.startsWith('data:') || result.imageSrc.startsWith('https://'), 'imageSrc is valid URL');
        ok(`imageSrc present (${result.imageSrc.substring(0, 50)}...)`);
    } else {
        ok('imageSrc is null (SVG/text model — expected for some models)');
    }
}

async function testLog(page) {
    console.log('\n[10] execution log');
    const log = await page.evaluate(() => window.__tool.meta.getLog());
    assert(Array.isArray(log), 'getLog() returns array');
    if (log.length > 0) {
        const entry = log[0];
        assert(typeof entry.method    === 'string', 'log entry has method');
        assert(typeof entry.timestamp === 'string', 'log entry has timestamp');
        ok(`log has ${log.length} entries`);
    } else {
        ok('log empty (acceptable if no methods called)');
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
    if (!API_KEY) {
        console.warn('⚠ OPENROUTER_API_KEY not set — connect/generate tests will be skipped');
    }

    const browser = await chromium.launch({ headless: HEADLESS });
    const page    = await browser.newPage();

    try {
        console.log(`Loading ${PAGE_URL} ...`);
        await page.goto(PAGE_URL, { waitUntil: 'networkidle' });

        await testWindowToolReady(page);
        await testSgaToolConstants(page);
        await testMetaMethods(page);
        await testGetState(page);
        await testNoKeyFlash(page);
        await testSetTemplateAndPrompt(page);
        await testModelGetSet(page);
        await testConnect(page);
        await testGenerate(page);
        await testLog(page);

    } finally {
        await browser.close();
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        console.error(`\n✗ ${failed} test(s) failed`);
        process.exit(1);
    } else {
        console.log(`\n✓ All tests passed`);
    }
})();
