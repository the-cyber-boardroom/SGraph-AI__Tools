/**
 * WhatsApp Desk — Boot Smoke Test (Playwright)
 *
 * Loads the REAL served page (run scripts/run-locally.sh first) and fails on
 * anything that throws during boot, then exercises the credential-free demo
 * surface end-to-end: loadDemo → conversations render → open a chat tab →
 * demo send lands in the thread → out-of-window conversation flips the
 * composer to template-only.
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/whatsapp-desk-boot-smoke.js
 *
 * Env: WHATSAPP_DESK_URL (default http://localhost:10063/en-gb/whatsapp-desk/),
 *      HEADLESS ('false' to watch), PW_CHROMIUM (explicit browser binary)
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.WHATSAPP_DESK_URL || 'http://localhost:10063/en-gb/whatsapp-desk/';
const HEADLESS = process.env.HEADLESS !== 'false';

const EXPECTED_ACTIONS = [
    'setCreds', 'connect', 'connectBridge', 'bridgeStatus', 'disconnect', 'setOpenRouterKey',
    'syncInbound', 'listConversations', 'openConversation', 'getMessages', 'markRead',
    'sendText', 'sendTemplate', 'sendMedia', 'listTemplates',
    'transcribeVoiceNote', 'draftReply', 'listDraftModels', 'getCostSummary',
    'downloadMedia', 'loadDemo', 'getStatus', 'health',
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
    console.log('\nwhatsapp-desk boot smoke\n');
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
            const r = t.getStatus({});
            return { missing, isPromise: r instanceof Promise };
        }, EXPECTED_ACTIONS);
        assert(rep.missing.length === 0, `all ${EXPECTED_ACTIONS.length} actions registered`, `missing: ${rep.missing.join(',')}`);
        assert(rep.isPromise, 'actions return Promises (SgToolApi contract)');

        for (const sel of ['#wa-demo-btn', 'sg-conversation-list', '#wa-acc-token', '#wa-acc-relay-url', '#wa-acc-bridge-url', '#wa-acc-bridge-connect', '#wa-acc-or-key']) {
            assert(await page.$(sel) !== null, `panel element present: ${sel}`);
        }

        // Demo flow — no credentials, no network sends.
        const demo = await page.evaluate(async () => {
            const t = window.__tool;
            const d = await t.loadDemo();
            const rows = await t.listConversations();
            const status = await t.getStatus();
            return { d, rows, status };
        });
        assert(demo.d.conversations === 2, 'loadDemo creates 2 conversations');
        assert(demo.status.demo === true && demo.status.connected === true, 'demo mode flagged connected');
        assert(demo.rows.some(r => r.chip?.tone === 'ok') && demo.rows.some(r => r.chip?.tone === 'warn'),
            'window chips: one open (⏱), one template-only (📋)');

        // Playwright's selector engine pierces the open shadow root
        // (in-page document.querySelector would not).
        await page.waitForSelector('sg-conversation-list .sgcl-row[data-cid="447700900001"]', { timeout: 5000 });
        ok('conversation rows rendered');

        // Open Ana's chat via the component row (shadow-piercing click).
        await page.click('sg-conversation-list .sgcl-row[data-cid="447700900001"]');
        await page.waitForSelector('sg-chat-thread .sgct-row[data-mid="demo-a1"]', { timeout: 5000 });
        ok('chat tab opened with thread bubbles');
        assert(await page.$('sg-chat-thread [data-transcribe]') !== null, 'voice note shows a Transcribe button');
        assert(await page.$eval('sg-chat-composer', el => el.getAttribute('mode') || 'free') === 'free',
            'composer in free mode inside the window');

        // Demo send lands in the thread, network untouched.
        const send = await page.evaluate(async () => {
            const t = window.__tool;
            const r = await t.sendText({ conversationId: '447700900001', body: 'demo reply' });
            const { messages } = await t.getMessages({ conversationId: '447700900001' });
            return { r, last: messages.at(-1) };
        });
        assert(send.r.demo === true, 'demo send never hits the network');
        assert(send.last.direction === 'out' && send.last.text === 'demo reply', 'demo send recorded in thread');

        // Out-of-window conversation → template-only composer.
        await page.click('sg-conversation-list .sgcl-row[data-cid="447700900002"]');
        await page.waitForFunction(() => {
            const composers = [...document.querySelectorAll('sg-chat-composer')];
            return composers.some(c => c.getAttribute('mode') === 'template-only');
        }, null, { timeout: 5000 });
        ok('expired-window conversation flips composer to template-only');

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
