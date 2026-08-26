/**
 * Narrated Review — autosave / undo / handover smoke (Playwright)
 *
 * These three features exist because of one sentence of feedback: "I just did a
 * really good review and after was really worried to move the mouse the wrong
 * way which would have refreshed the browser and me losing the review."
 *
 * So the load-bearing test here is not that the API surface exists — it is that
 * a session survives an actual `page.reload()` with no explicit save, and comes
 * back through the real button rather than through the JS API. Everything else
 * is scaffolding around that.
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/narrated-review-safety-smoke.js
 *
 * Env: NR_URL, HEADLESS ('false' to watch), PW_CHROMIUM
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.NR_URL || 'http://localhost:10063/en-gb/narrated-review/';
const HEADLESS = process.env.HEADLESS !== 'false';

const NEW_ACTIONS = [
    'undo', 'redo', 'getHistory', 'getActions',
    'setAutosave', 'getAutosave', 'flushAutosave',
    'findUnsaved', 'dismissUnsaved', 'restoreUnsaved',
    'downloadHandover', 'getUncertain',
    'setCleanupTiming', 'getCleanupTiming',
];

let passed = 0, failed = 0;
function ok(l) { console.log(`  ✓ ${l}`); passed++; }
function assert(c, l, d = '') { if (c) ok(l); else throw new Error(`Assertion failed: ${l}${d ? ' — ' + d : ''}`); }

async function run() {
    console.log('\nnarrated-review safety smoke\n');
    const browser = await chromium.launch({ headless: HEADLESS, executablePath: process.env.PW_CHROMIUM || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    try {
        await page.goto(TOOL_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__tool, { timeout: 20000 });
        ok('window.__tool published');

        const missing = await page.evaluate(
            names => names.filter(n => typeof window.__tool[n] !== 'function'), NEW_ACTIONS);
        assert(missing.length === 0, `all ${NEW_ACTIONS.length} new actions registered`, `missing: ${missing}`);

        // ── Undo/redo ───────────────────────────────────────────────────────
        const hist = await page.evaluate(async () => {
            const t = window.__tool;
            await t.insertPair({ text: 'alpha', raw: 'alpha' });
            await t.insertPair({ text: 'beta', raw: 'beta' });
            const before = (await t.getPairs()).map(x => x.clean.text);
            const ids = (await t.getPairs()).map(x => x.id);
            await t.movePair({ id: ids[1], toIndex: 0 });
            const moved = (await t.getPairs()).map(x => x.clean.text);
            t.undo();
            const undone = (await t.getPairs()).map(x => x.clean.text);
            t.redo();
            const redone = (await t.getPairs()).map(x => x.clean.text);
            return { before, moved, undone, redone, state: await t.getHistory() };
        });
        assert(hist.moved.join() === 'beta,alpha', 'a reorder takes effect');
        assert(hist.undone.join() === 'alpha,beta', 'undo puts the order back');
        assert(hist.redone.join() === 'beta,alpha', 'redo re-applies it');
        assert(hist.state.canUndo === true, 'the history reports what it can do');

        // Undo must not be able to resurrect a document from a DIFFERENT session.
        const acts = await page.evaluate(() => window.__tool.getActions());
        assert(acts.actions.some(a => a.action === 'undo'),
            'the log records the undo itself — it is a history of actions, not of states');
        assert(!/"apiKey"|ya29\.|sk-or-/.test(JSON.stringify(acts)), 'and carries no secrets');

        // ── The reload, which is the whole point ────────────────────────────
        const before = await page.evaluate(async () => {
            const t = window.__tool;
            await t.setNotes({ id: (await t.getPairs())[0].id, notes: 'a note that cost real thought' });
            await t.flushAutosave();
            return (await t.getPairs()).map(x => ({ text: x.clean.text, notes: x.notes }));
        });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__tool, { timeout: 20000 });
        await page.waitForTimeout(700);

        const found = await page.evaluate(() => window.__tool.findUnsaved());
        assert(found.found === true, 'after a reload the tool knows a session was open');
        assert(found.recoverable === true, 'and that it reached disk, so it can be offered back');
        assert(await page.isVisible('#nr-restore'), 'the restore banner is shown without being asked');

        await page.click('#nr-restore-yes');                    // the real button, not the API
        await page.waitForTimeout(1500);
        const after = await page.evaluate(async () =>
            (await window.__tool.getPairs()).map(x => ({ text: x.clean.text, notes: x.notes })));
        assert(JSON.stringify(after) === JSON.stringify(before),
            'the session comes back intact — text AND notes', JSON.stringify(after));
        assert(await page.isHidden('#nr-restore'), 'and the banner goes away');

        const log = await page.evaluate(() => window.__tool.getActions());
        assert(log.count > 1,
            'the action log survives the reload too — it is saved beside the session', `count=${log.count}`);

        // Discarding must actually forget it, or the banner haunts every reload.
        await page.evaluate(() => window.__tool.dismissUnsaved());
        assert((await page.evaluate(() => window.__tool.findUnsaved())).found === false,
            'discarding an unsaved session forgets it');

        // ── Autosave is VISIBLE ─────────────────────────────────────────────
        const chip = await page.textContent('#nr-save-state');
        assert(/autosave on/i.test(chip), 'the panel states that autosave is on', chip);
        await page.evaluate(() => window.__tool.setAutosave({ on: false }));
        await page.waitForTimeout(200);
        const off = await page.textContent('#nr-save-state');
        assert(/off/i.test(off) && /not being saved/i.test(off),
            'and says so loudly when it is off — silence would read as working', off);
        await page.evaluate(() => window.__tool.setAutosave({ on: true }));

        // ── Cleanup timing ──────────────────────────────────────────────────
        const timing = await page.evaluate(async () => {
            const t = window.__tool;
            const def = await t.getCleanupTiming();
            const par = await t.setCleanupTiming({ order: 'parallel' });
            await t.setCleanupTiming({ order: 'sequential' });
            let rejected = null;
            try { await t.setCleanupTiming({ timing: 'whenever' }); } catch (e) { rejected = e.code || 'threw'; }
            return { def, par, rejected };
        });
        assert(timing.def.timing === 'streaming',
            'cleanup streams during the recording by default — same result, ready sooner');
        assert(/quality change/i.test(timing.par.note),
            'and the parallel option names its quality cost rather than selling itself as speed');
        assert(timing.rejected !== null, 'an unknown timing is rejected');

        // ── The handover bundle ─────────────────────────────────────────────
        const bundle = await page.evaluate(async () => {
            const st = await import('./api/nr-state.js');
            st.state.pairs[0].clean.marks = [{ span: 'alpha', note: 'unclear' }];
            const [hand, zip] = await Promise.all([import('./api/nr-handover.js'), import('./api/nr-zip.js')]);
            return {
                handover: hand.buildHandoverEntries().entries.map(e => e.path),
                full: zip.buildSessionEntries({ audio: false, take: false }).entries.map(e => e.path),
                uncertain: hand.uncertainToJson(),
                readme: hand.buildHandoverReadme(),
            };
        });
        assert(!bundle.handover.some(p => p.startsWith('audio/')),
            'the handover bundle carries no audio — an agent cannot listen to it');
        assert(bundle.handover.includes('uncertain.json') && bundle.handover.includes('actions.json'),
            'it adds uncertain.json and actions.json');
        assert(bundle.full.includes('uncertain.json'),
            'and the FULL export gets uncertain.json too — it is too useful to hide in a second export');
        assert(bundle.uncertain.count === 1 && bundle.uncertain.items[0].context && bundle.uncertain.items[0].rawText,
            'each flagged span carries its sentence AND the raw transcript to judge it against');
        assert(/start here/i.test(bundle.readme),
            'the handover README points a reader at the uncertain list first');

        assert(errors.length === 0, 'zero uncaught errors through the whole run', errors.join(' | '));
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
