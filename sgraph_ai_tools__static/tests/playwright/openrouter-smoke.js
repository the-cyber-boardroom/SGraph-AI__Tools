/**
 * OpenRouter Dashboard — Playwright Smoke Test
 *
 * Validates the JS API Primitive contract:
 *   window.__tool ready → methods present → manifest/SKILL files loaded →
 *   getState() shape → connect() → getKeyStats() → getModels() →
 *   listKeys() (admin, if OPENROUTER_MANAGEMENT_KEY is set)
 *
 * Tests [1]–[5] run without any API key.
 * Tests [6]–[8] require OPENROUTER_API_KEY.
 * Test [9] requires OPENROUTER_MANAGEMENT_KEY in addition.
 *
 * Usage:
 *   npm install playwright
 *   node tests/playwright/openrouter-smoke.js
 *
 * Optional env vars:
 *   PAGE_URL                  — default http://localhost:10063/en-gb/openrouter/
 *   OPENROUTER_API_KEY        — sk-or-v1-… (enables live API tests)
 *   OPENROUTER_MANAGEMENT_KEY — sk-or-v1-mgmt-… (enables admin tests)
 *   HEADLESS                  — set to 'false' to watch the browser (default true)
 */

const { chromium } = require('playwright');

const PAGE_URL = process.env.PAGE_URL || 'http://localhost:10063/en-gb/openrouter/';
const API_KEY  = process.env.OPENROUTER_API_KEY;
const MGMT_KEY = process.env.OPENROUTER_MANAGEMENT_KEY;
const HEADLESS = process.env.HEADLESS !== 'false';

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label)          { console.log(`  \u2713 ${label}`); passed++; }
function fail(label, err)   { console.error(`  \u2717 ${label}: ${err?.message || err}`); failed++; }
function skip(label, why)   { console.log(`  \u2014 ${label} (skipped: ${why})`); }

function assert(condition, label, detail = '') {
    if (condition) ok(label);
    else throw new Error(`Assertion failed: ${label}${detail ? ' \u2014 ' + detail : ''}`);
}

// ── Test groups ───────────────────────────────────────────────────────────────

async function testWindowToolReady(page) {
    console.log('\n[1] window.__tool ready');
    await page.waitForFunction(() => window.__tool?.meta?.health()?.status === 'ready', { timeout: 10_000 });
    const health = await page.evaluate(() => window.__tool.meta.health());
    assert(health.status === 'ready', 'health.status is ready');
    assert(health.methodCount >= 11, `methodCount >= 11 (got ${health.methodCount})`);
    ok('health snapshot looks good');
}

async function testMethods(page) {
    console.log('\n[2] meta.getMethods() — all expected methods present');
    const methods = await page.evaluate(() => window.__tool.meta.getMethods());
    const required = [
        'connect', 'disconnect', 'getState', 'getKeyStats', 'getModels',
        'getModelDetail', 'getUsage', 'getSpending', 'getActivity',
        'listKeys', 'createKey', 'deleteKey',
    ];
    for (const m of required) {
        assert(methods.includes(m), `method '${m}' registered`);
    }
    ok(`all ${required.length} required methods present`);
}

async function testManifest(page) {
    console.log('\n[3] meta.getManifest() — manifest loaded, api: section present');
    const manifest = await page.evaluate(() => window.__tool.meta.getManifest());
    assert(manifest !== null,                    'manifest not null');
    assert(manifest.slug === 'openrouter',        'manifest.slug is openrouter');
    assert(!!manifest.api,                        'manifest.api section present');
    assert(!!manifest.api.actions,                'manifest.api.actions present');
    assert(manifest.api.version === '0.1.0',      'manifest.api.version is 0.1.0');
    const actionNames = Object.keys(manifest.api.actions);
    assert(actionNames.includes('connect'),       'manifest.api.actions.connect present');
    assert(actionNames.includes('listKeys'),      'manifest.api.actions.listKeys present');
    ok(`manifest loaded — ${actionNames.length} actions documented`);
}

async function testSkills(page) {
    console.log('\n[4] meta.getSkills() — all 3 SKILL files returned');
    const skills = await page.evaluate(() => window.__tool.meta.getSkills());
    assert(typeof skills.human   === 'string' && skills.human.length   > 100, 'SKILL-human.md loaded');
    assert(typeof skills.browser === 'string' && skills.browser.length > 100, 'SKILL-browser.md loaded');
    assert(typeof skills.api     === 'string' && skills.api.length     > 100, 'SKILL-api.md loaded');
    ok('all SKILL files loaded with content');
}

async function testGetState(page) {
    console.log('\n[5] getState() — correct initial shape (no key)');
    const s = await page.evaluate(() => window.__tool.getState());
    assert(typeof s.userConnected  === 'boolean', 'userConnected is boolean');
    assert(typeof s.adminConnected === 'boolean', 'adminConnected is boolean');
    assert(typeof s.apiKey         === 'string',  'apiKey is string');
    assert(typeof s.currency       === 'string',  'currency is string');
    assert('balance' in s,                        'balance key present');
    assert('limit'   in s,                        'limit key present');
    ok(`getState() shape correct — userConnected=${s.userConnected}`);
}

async function testConnect(page, apiKey) {
    console.log('\n[6] connect() — validate API key');
    const result = await page.evaluate(k => window.__tool.connect({ apiKey: k }), apiKey);
    assert(result.provider === 'openrouter', `provider === 'openrouter' (got '${result.provider}')`);
    assert('balance' in result, 'balance in result');
    assert('limit'   in result, 'limit in result');
    ok(`connect() resolved — balance=${result.balance}, limit=${result.limit}`);

    // Confirm state updated
    const state = await page.evaluate(() => window.__tool.getState());
    assert(state.userConnected === true, 'getState().userConnected is true after connect');
    assert(state.apiKey === '\u2022\u2022\u2022\u2022', 'apiKey is masked in getState');
    ok('state updated after connect');
}

async function testGetKeyStats(page) {
    console.log('\n[7] getKeyStats()');
    const stats = await page.evaluate(() => window.__tool.getKeyStats());
    assert(typeof stats === 'object' && stats !== null, 'getKeyStats() returns object');
    assert('usage' in stats || typeof stats.usage !== 'undefined', 'stats.usage present');
    ok(`getKeyStats() resolved — usage=${stats.usage}, limit=${stats.limit}`);
}

async function testGetModels(page) {
    console.log('\n[8] getModels()');

    // Full list
    const all = await page.evaluate(() => window.__tool.getModels());
    assert(Array.isArray(all) && all.length > 0, `getModels() returns non-empty array (got ${all.length})`);
    ok(`getModels() returned ${all.length} models`);

    // Filtered
    const filtered = await page.evaluate(() => window.__tool.getModels({ query: 'gpt', top: 3 }));
    assert(Array.isArray(filtered) && filtered.length <= 3, 'getModels({ top: 3 }) respects limit');
    ok('getModels() filter and top options work');
}

async function testListKeys(page, mgmtKey) {
    console.log('\n[9] listKeys() — admin required');
    // Inject management key via document event (admin connect)
    await page.evaluate(k => {
        document.dispatchEvent(new CustomEvent('or:admin-connected', { detail: { managementKey: k } }));
    }, mgmtKey);
    await page.waitForFunction(() => window.__tool.getState().adminConnected, { timeout: 5_000 });
    ok('admin connected via or:admin-connected event');

    const keys = await page.evaluate(() => window.__tool.listKeys());
    assert(Array.isArray(keys), 'listKeys() returns array');
    ok(`listKeys() returned ${keys.length} provisioned keys`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
    const browser = await chromium.launch({ headless: HEADLESS });
    const page    = await browser.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') console.error('  [page error]', msg.text());
    });

    console.log(`\nOpenRouter Smoke Test`);
    console.log(`URL: ${PAGE_URL}`);
    console.log(`API key: ${API_KEY ? 'set' : 'not set'}`);
    console.log(`Management key: ${MGMT_KEY ? 'set' : 'not set'}`);

    await page.goto(PAGE_URL);

    // Tests that run without any API key
    try { await testWindowToolReady(page); } catch (e) { fail('[1] window.__tool ready', e); }
    try { await testMethods(page);         } catch (e) { fail('[2] methods',              e); }
    try { await testManifest(page);        } catch (e) { fail('[3] manifest',             e); }
    try { await testSkills(page);          } catch (e) { fail('[4] skills',               e); }
    try { await testGetState(page);        } catch (e) { fail('[5] getState',             e); }

    // Live API tests (require OPENROUTER_API_KEY)
    if (!API_KEY) {
        skip('[6] connect()',     'OPENROUTER_API_KEY not set');
        skip('[7] getKeyStats()', 'OPENROUTER_API_KEY not set');
        skip('[8] getModels()',   'OPENROUTER_API_KEY not set');
        skip('[9] listKeys()',    'OPENROUTER_API_KEY not set');
    } else {
        try { await testConnect(page, API_KEY);     } catch (e) { fail('[6] connect',      e); }
        try { await testGetKeyStats(page);           } catch (e) { fail('[7] getKeyStats',  e); }
        try { await testGetModels(page);             } catch (e) { fail('[8] getModels',    e); }

        if (!MGMT_KEY) {
            skip('[9] listKeys()', 'OPENROUTER_MANAGEMENT_KEY not set');
        } else {
            try { await testListKeys(page, MGMT_KEY); } catch (e) { fail('[9] listKeys', e); }
        }
    }

    // Summary
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Passed: ${passed}  Failed: ${failed}`);
    await browser.close();

    if (failed > 0) process.exit(1);
})().catch(err => {
    console.error('\nFatal:', err);
    process.exit(1);
});
