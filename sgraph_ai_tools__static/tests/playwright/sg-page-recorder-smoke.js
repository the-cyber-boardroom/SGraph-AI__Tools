/**
 * SG Page Recorder — extension smoke (Playwright)
 *
 * WHAT THIS COVERS AND WHAT IT CANNOT.
 *
 * The extension arms a tab with `chrome.scripting.executeScript` under
 * `activeTab`, which the browser grants **only** in response to a real click on
 * the extension's own icon. Playwright cannot synthesise that click, and the
 * service worker cannot message itself, so the arming handshake is NOT covered
 * here — it is verified by using the extension. Adding `<all_urls>` host
 * permissions would make it testable and would also hand the extension access to
 * every site the user visits, which is a bad trade for a green tick.
 *
 * So this test loads the two recorder scripts into a real page exactly as the
 * service worker injects them, with a stub standing in for `chrome.runtime`, and
 * drives real mouse, keyboard, console, fetch and XHR at them. That is where the
 * risk actually lives: redaction, throttling, what network metadata is kept, and
 * whether a probe can be made to run.
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/sg-page-recorder-smoke.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '../../extension/sg-page-recorder/v0.1.0');
const PAGE_URL = process.env.NR_TARGET || 'http://localhost:10063/en-gb/';
const HEADLESS = process.env.HEADLESS !== 'false';

let passed = 0, failed = 0;
function ok(l) { console.log(`  ✓ ${l}`); passed++; }
function assert(c, l, d = '') { if (c) ok(l); else throw new Error(`Assertion failed: ${l}${d ? ' — ' + d : ''}`); }

async function run() {
    console.log('\nsg-page-recorder smoke\n');
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
        assert(manifest.manifest_version === 3, 'MV3 manifest');
        assert(!manifest.permissions.includes('tabs') && !manifest.host_permissions,
            'no blanket tabs or host permissions — activeTab only, granted per click',
            JSON.stringify(manifest.permissions));
        assert(manifest.content_scripts[0].matches.every(m => /sgraph\.ai|localhost/.test(m)),
            'the only always-on content script is the bridge, scoped to the tool origins');

        await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });

        // Stand in for the extension: a chrome.runtime stub that collects batches.
        await page.evaluate(() => {
            window.__batches = [];
            window.chrome = window.chrome || {};
            window.chrome.runtime = {
                sendMessage: msg => { window.__batches.push(msg); },
                onMessage: { addListener: fn => { window.__onMsg = fn; } },
            };
        });
        // MAIN world first, exactly as service-worker.js orders it.
        await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, 'page-hooks.js'), 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, 'content-input.js'), 'utf8') });
        ok('both recorder scripts load into a real page');

        const started = await page.evaluate(() =>
            window.__sgPageRecorder.start({ mouse: true, keys: 'keys', console: true, network: true, scroll: true }));
        assert(started.on === true, 'the recorder starts');

        // ── Real input ──────────────────────────────────────────────────────
        await page.mouse.move(50, 50);
        for (let i = 0; i < 60; i++) await page.mouse.move(50 + i * 6, 50 + Math.sin(i / 5) * 60);
        await page.mouse.click(300, 200);
        await page.keyboard.type('hello');
        await page.keyboard.press('Control+s');

        // A password field must never give up its characters.
        await page.evaluate(() => {
            const i = document.createElement('input');
            i.type = 'password'; i.id = 'pw'; document.body.appendChild(i); i.focus();
        });
        await page.keyboard.type('hunter2');

        await page.evaluate(() => { console.log('a log', { n: 1 }); console.error('boom'); });
        await page.evaluate(() => fetch('/en-gb/?probe=1&token=SECRET').then(r => r.text()).catch(() => {}));
        await page.evaluate(() => new Promise(res => {
            const x = new XMLHttpRequest();
            x.open('GET', '/en-gb/?xhr=1'); x.addEventListener('loadend', res); x.send();
        }));
        await page.waitForTimeout(1400);

        const events = await page.evaluate(() => window.__batches.flatMap(b => b.events || []));
        const kinds = events.reduce((m, e) => (m[e.k] = (m[e.k] || 0) + 1, m), {});

        assert(kinds.move > 5, 'mouse movement is recorded', JSON.stringify(kinds));
        assert(kinds.move < 60, 'and throttled — not one event per pixel', `${kinds.move} for 60 moves`);
        assert(kinds.click >= 1, 'clicks are recorded');
        const click = events.find(e => e.k === 'click');
        assert(click && click.el && typeof click.el.sel === 'string',
            'a click names the element it hit, so a replay can say WHAT was clicked');

        // ── The redaction rules, which are the whole reason keys are opt-in ──
        const keys = events.filter(e => e.k === 'key');
        assert(keys.length > 0, 'keystrokes are recorded when asked for');
        const typed = keys.filter(k => !k.redacted).map(k => k.key).join('');
        assert(!/hello/.test(typed), "in 'keys' mode the characters typed are NOT recoverable", typed);
        assert(keys.some(k => k.key === 's' && k.mods?.includes('ctrl')),
            'but shortcuts survive — Ctrl-S is visible, which is what a UX question asks about');
        assert(!/hunter2/.test(JSON.stringify(events)), 'a PASSWORD FIELD leaks nothing at all');
        assert(keys.some(k => k.redacted === true), 'and the refusal is recorded as a refusal');

        // ── Console ─────────────────────────────────────────────────────────
        const logs = events.filter(e => e.k === 'console');
        assert(logs.some(l => l.level === 'log'), 'console.log is captured');
        assert(logs.some(l => l.level === 'error'), 'console.error is captured');
        assert(await page.evaluate(() => typeof console.log === 'function'),
            'and the page still has a working console afterwards');

        // ── Network: metadata only ──────────────────────────────────────────
        const net = events.filter(e => e.k === 'net');
        assert(net.some(n => n.via === 'fetch'), 'fetch is captured');
        assert(net.some(n => n.via === 'xhr'), 'XHR is captured');
        assert(net.every(n => n.status !== undefined && n.ms !== undefined), 'with status and duration');
        assert(!/SECRET/.test(JSON.stringify(net)),
            'query strings are stripped — that is where tokens hide', JSON.stringify(net.slice(0, 2)));
        assert(net.every(n => !('headers' in n) && !('body' in n)),
            'and no headers or bodies are recorded, at any setting');

        // ── Scripted probes ─────────────────────────────────────────────────
        await page.evaluate(() => window.postMessage(
            { __sgpr: 'cmd', cmd: 'run', id: 'p1', js: 'document.title', on: 'manual' }, '*'));
        await page.waitForTimeout(400);
        await page.evaluate(() => window.postMessage(
            { __sgpr: 'cmd', cmd: 'run', id: 'p2', js: 'window.__nope.boom', on: 'manual' }, '*'));
        await page.waitForTimeout(1400);
        const probes = await page.evaluate(() => window.__batches.flatMap(b => b.events || []).filter(e => e.k === 'probe'));
        assert(probes.some(p => p.id === 'p1' && typeof p.value === 'string'),
            'a probe runs in the page and its result is recorded');
        assert(probes.some(p => p.id === 'p2' && p.error),
            'and a probe that throws records the error rather than taking the recorder down');

        const stopped = await page.evaluate(() => window.__sgPageRecorder.stop());
        assert(stopped.on === false, 'the recorder stops');
        assert(stopped.redacted > 0, 'the final report counts the redactions', JSON.stringify(stopped));

        const after = await page.evaluate(() => {
            const n = window.__batches.flatMap(b => b.events || []).length;
            return { n };
        });
        await page.mouse.move(10, 10); await page.mouse.move(20, 20);
        await page.waitForTimeout(600);
        const afterStop = await page.evaluate(() => window.__batches.flatMap(b => b.events || []).length);
        assert(afterStop === after.n, 'and records nothing once stopped', `${after.n} → ${afterStop}`);
    } catch (err) {
        console.error(`  ✗ ${err.message}`);
        failed++;
    } finally {
        await browser.close();
    }
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run();
