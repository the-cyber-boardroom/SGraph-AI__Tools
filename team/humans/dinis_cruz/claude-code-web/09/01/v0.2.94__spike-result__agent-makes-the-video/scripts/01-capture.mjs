// 01-capture.mjs — shoot every scene in reel.json: stills with DOM-injected
// annotations, plus Playwright recordVideo clips where shot.kind is "clip".
// Usage: NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_PATH=/opt/node22/lib/node_modules node 01-capture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, context, sleep } from './browser.mjs';
import { annotate } from './annotate.mjs';

const ROOT = path.resolve('..');
const reel = JSON.parse(fs.readFileSync(path.join(ROOT, 'reel.json'), 'utf8'));
const FF = process.env.FFMPEG || 'ffmpeg';
// FORMAT=shorts re-shoots the shorts scenes at a phone viewport (540x960 @2x =
// 1080x1920) instead of cropping desktop stills: the page's own responsive
// layout is the "focus rect". Clips are shot as stills in this mode.
const FORMAT = process.env.FORMAT || 'landscape';
const VIEW = FORMAT === 'shorts' ? { viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } };
const IMG = FORMAT === 'shorts' ? 'images-shorts' : 'images';
const ONLY = process.env.SCENES ? process.env.SCENES.split(',') : null;   // e.g. SCENES=s10 to re-shoot one scene
const SCENES = (FORMAT === 'shorts' ? reel.shorts.map(id => reel.scenes.find(s => s.id === id)) : reel.scenes).filter(s => !ONLY || ONLY.includes(s.id));
for (const d of [IMG, 'clips']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
const log = { format: FORMAT, started: new Date().toISOString(), scenes: [], captured: 0, used: 0 };
const T0 = Date.now();

const browser = await launch();
let vaultLinks = null;
async function resolveUrl(page, url) {
  if (!url.startsWith('vault:')) return url;
  if (!vaultLinks) {                       // scrape the published read keys page once; nothing is written to disk
    await page.goto('https://sgit.ai/demos/vaults/index.html', { waitUntil: 'networkidle', timeout: 60000 });
    vaultLinks = await page.evaluate(() => [...document.querySelectorAll('a')].filter(a => /open live/i.test(a.textContent))
      .map(a => ({ name: a.closest('tr')?.querySelector('td')?.textContent?.trim(), href: a.href })));
  }
  const hit = vaultLinks.find(l => l.name?.startsWith(url.slice(6)));
  if (!hit) throw new Error(`no published vault named ${url}`);
  return hit.href;
}

async function settle(page, scene) {
  const s = scene.shot;
  await page.goto(await resolveUrl(page, s.url), { waitUntil: 'networkidle', timeout: 90000 });
  await sleep(s.url.startsWith('vault:') ? 4000 : 800);
  let anchor = null;
  if (s.scrollTo?.startsWith('text:')) {
    anchor = s.scrollTo.slice(5);
    const ok = await page.evaluate((t) => {
      // sgit.ai sets scroll-behavior: smooth; scrollIntoView then returns before
      // the scroll happens and the screenshot shows the top of the page.
      document.documentElement.style.scrollBehavior = 'auto';
      const els = [...document.querySelectorAll('h1,h2,h3,h4,p,button,summary,th,td,div,span,a')].filter(e => e.textContent.replace(/\s+/g, ' ').includes(t));
      const el = els.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!el) return false;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: 'instant' }); return true;
    }, anchor);
    if (!ok) console.log(`  ! scrollTo not found: ${anchor}`);
    await sleep(500);
  }
  return anchor;
}

for (const scene of SCENES) {
  const t = Date.now();
  const entry = { id: scene.id, kind: scene.shot.kind, url: scene.shot.url };
  try {
    if (scene.shot.kind === 'clip' && FORMAT !== 'shorts') {
      const ctx = await context(browser, { ...VIEW, recordVideo: { dir: path.join(ROOT, 'clips'), size: { width: 1280, height: 720 } } });
      const page = await ctx.newPage();
      const anchor = await settle(page, scene);
      await sleep(1200);
      for (const tab of scene.shot.clickTabs || []) { await page.locator('button,[role=tab],a,label').filter({ hasText: tab }).first().click({ timeout: 10000 }); await sleep(1400); }
      for (const sel of scene.shot.click || []) {
        const target = page.getByText(sel.replace(/^text:/, ''), { exact: false }).first();
        const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), target.click({ timeout: 10000 })]);
        entry.clickOpenedNewPage = !!popup;
        await sleep(4000);
        if (popup) { await popup.waitForLoadState('networkidle').catch(() => {}); await sleep(3000); await popup.screenshot({ path: path.join(ROOT, IMG, `${scene.id}.png`) }); entry.stillFrom = 'popup-screenshot'; }
      }
      entry.annotations = await annotate(page, scene, anchor, FORMAT);
      await sleep(800);
      if (!entry.stillFrom) { await page.screenshot({ path: path.join(ROOT, IMG, `${scene.id}.png`) }); entry.stillFrom = 'last-frame-screenshot'; }
      const vpath = await page.video().path();
      await ctx.close();
      const dst = path.join(ROOT, 'clips', `${scene.id}.webm`);
      fs.renameSync(vpath, dst);
      let dur = ''; try { execFileSync(FF, ['-i', dst], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { dur = e.stderr.toString(); }  // ffmpeg -i always exits 1
      entry.clip = { file: `clips/${scene.id}.webm`, bytes: fs.statSync(dst).size, duration: (/Duration: ([\d:.]+)/.exec(dur) || [])[1] };
      log.captured += 2; log.used += 1;
    } else {
      const ctx = await context(browser, VIEW);
      const page = await ctx.newPage();
      const anchor = await settle(page, scene);
      for (const sel of (FORMAT === 'shorts' ? scene.shot.click || [] : [])) { await page.getByText(sel.replace(/^text:/, ''), { exact: false }).first().click({ timeout: 10000 }); await sleep(5000); }
      entry.annotations = await annotate(page, scene, anchor, FORMAT);
      await sleep(300);
      await page.screenshot({ path: path.join(ROOT, IMG, `${scene.id}.png`) });
      await ctx.close();
      log.captured += 1; log.used += 1;
    }
    entry.ms = Date.now() - t;
    console.log(`${scene.id} ${scene.shot.kind} ${entry.ms}ms`, JSON.stringify(entry.annotations || []), entry.clip ? JSON.stringify(entry.clip) : '');
  } catch (e) {
    entry.error = e.message.split('\n')[0];
    console.log(`${scene.id} ERROR ${entry.error}`);
  }
  log.scenes.push(entry);
}
await browser.close();
log.totalMs = Date.now() - T0;
if (!ONLY) fs.writeFileSync(path.join(ROOT, FORMAT === 'shorts' ? 'capture-log.shorts.json' : 'capture-log.json'), JSON.stringify(log, null, 2));
console.log('done', log.totalMs, 'ms; captured', log.captured, 'used', log.used);
