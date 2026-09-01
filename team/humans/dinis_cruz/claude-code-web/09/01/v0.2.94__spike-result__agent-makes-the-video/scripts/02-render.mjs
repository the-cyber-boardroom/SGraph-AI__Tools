// 02-render.mjs — drive video-creator's JS API to turn images/ + reel.json into a WebM.
// Usage: FORMAT=landscape|shorts POOL=2 node 02-render.mjs   (env as in 01-capture.mjs)
// Records: TTS time (cold = first call in a fresh page; warm = second call), intended
// vs actual record() duration, and the whole wall clock.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, context, sleep } from './browser.mjs';

const ROOT = path.resolve('..');
const reel = JSON.parse(fs.readFileSync(path.join(ROOT, 'reel.json'), 'utf8'));
const FORMAT = process.env.FORMAT || 'landscape';
const POOL = Number(process.env.POOL || 2);
const WARM = !!process.env.WARM;
const HEARTBEAT = process.env.HEARTBEAT !== '0';  // repaint the recording canvas every frame; see below   // second generateAudio() pass, to measure whether anything is cached (nothing is)
const FF = process.env.FFMPEG || 'ffmpeg';
const scenes = FORMAT === 'shorts' ? reel.shorts.map(id => reel.scenes.find(s => s.id === id)) : reel.scenes;
const size = FORMAT === 'shorts' ? { width: 1080, height: 1920 } : { width: 1280, height: 720 };
const T0 = Date.now();
const out = { format: FORMAT, pool: POOL, sceneCount: scenes.length, started: new Date().toISOString() };

// Slides go in as {name, dataUrl}; name doubles as the caption because
// video-creator's _drawSlide prints `${slide.name} • i/n` in its bottom bar.
const slides = scenes.map(s => ({
  id: s.id, name: s.caption, narration: s.narration, focus: s.shot.focus || null,
  dataUrl: 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'images', `${s.id}.png`)).toString('base64'),
}));

const browser = await launch();
const ctx = await context(browser, { acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));
page.on('crash', () => console.log('  [CRASH]'));
await page.goto('http://localhost:10063/en-gb/video-creator/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tool, null, { timeout: 30000 });
out.toolReadyMs = Date.now() - T0;

// Load slides — cropping to 9:16 around the focus rect for shorts, in-page (the browser is the compositor).
out.crop = await page.evaluate(async ([slides, size]) => {
  const files = []; const report = [];
  for (const s of slides) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s.dataUrl; });
    let blob;
    if (size.width < size.height) {                       // vertical: crop a 9:16 window that contains the focus rect
      const W = img.width, H = img.height, winW = Math.round(H * 9 / 16);
      const f = s.focus || [0, 0, 1, 1];
      const fx = f[0] * W, fw = f[2] * W;
      const lossy = fw > winW + 1;                         // the focus rect is wider than a 9:16 window of full height
      let x = Math.round(fx + fw / 2 - winW / 2); x = Math.max(0, Math.min(W - winW, x));
      const c = document.createElement('canvas'); c.width = size.width; c.height = size.height;
      c.getContext('2d').drawImage(img, x, 0, winW, H, 0, 0, size.width, size.height);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
      report.push({ id: s.id, focus: f, windowPx: [x, 0, winW, H], lossy });
    } else {
      blob = await (await fetch(s.dataUrl)).blob();
    }
    files.push(new File([blob], s.name, { type: 'image/png' }));
  }
  const t = window.__tool;
  await t.loadSlides({ files });
  slides.forEach((s, i) => t.setNarration({ slideIndex: i, text: s.narration }));
  return report;
}, [slides, size]);

// TTS: pre-load a pool of our chosen size (sg-tts is a module singleton shared with video-creator).
const tts = await page.evaluate(async ([POOL, WARM]) => {
  const mod = await import('/core/sg-tts/v0/v0.1/v0.1.0/sg-tts.js');
  const t0 = performance.now();
  await mod.loadTTS({ poolSize: POOL });
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  const r1 = await window.__tool.generateAudio({ voice: 'af_bella', speed: 1.0 });
  const coldMs = performance.now() - t1;
  if (!WARM) return { modelLoadMs: loadMs, coldGenMs: coldMs, durations: r1.durations };
  const t2 = performance.now();
  const r2 = await window.__tool.generateAudio({ voice: 'af_bella', speed: 1.0 });
  const warmMs = performance.now() - t2;
  return { modelLoadMs: loadMs, coldGenMs: coldMs, warmGenMs: warmMs, durations: r2.durations, sameDurations: JSON.stringify(r1.durations) === JSON.stringify(r2.durations) };
}, [POOL, WARM]);
out.tts = tts;
out.intendedMs = Math.round(tts.durations.reduce((a, b) => a + (b > 0 ? b : 3), 0) * 1000);
console.log('tts', JSON.stringify({ ...tts, durations: tts.durations.map(d => +d.toFixed(2)) }));

// Record — real time. Then hand the blob to Chromium's downloader (no big body over CDP).
await page.evaluate((size) => window.__tool.setConfig(size), size);
const recordStart = Date.now();
const rec = await page.evaluate(async (HEARTBEAT) => {
  const t = window.__tool;
  const started = performance.now();
  const done = t.record({ fps: 30, bitrateKbps: 2500 });
  // Finding from run 1: canvas.captureStream(30) only emits a frame when the
  // canvas is painted, and video-creator paints once per slide, so a 128 s
  // video came out with 13 frames, each a single P-frame the encoder never
  // refined (text illegible). This loop repaints the recording canvas onto
  // itself every animation frame so MediaRecorder sees a real 30 fps stream.
  // It lives here, outside the tool, because the spike must not change tools/.
  let heartbeats = 0, canvas = null, running = true;
  if (HEARTBEAT) {
    const tick = () => {
      if (!running) return;
      canvas = canvas || [...document.querySelectorAll('canvas')].find(c => c.style.display === 'none' && c.width === t.getConfig().width);
      if (canvas) { canvas.getContext('2d').drawImage(canvas, 0, 0); heartbeats++; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const { webmBlob } = await done;
  running = false;
  window.__out = webmBlob;
  return { actualMs: performance.now() - started, size: webmBlob.size, type: webmBlob.type, status: t.getStatus().status, heartbeat: HEARTBEAT, heartbeats };
}, HEARTBEAT);
out.record = rec;
out.record.wallMs = Date.now() - recordStart;
console.log('record', JSON.stringify(rec), 'intended', out.intendedMs, 'drift ms', Math.round(rec.actualMs - out.intendedMs));
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.evaluate(() => window.__tool.download({ blob: window.__out, filename: 'out.webm' })),
]);
const raw = path.join(ROOT, `${FORMAT}.raw.webm`);
await download.saveAs(raw);
await browser.close();

// MediaRecorder WebMs carry no duration header; a copy-remux writes one.
const final = path.join(ROOT, `${FORMAT}.webm`);
execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-i', raw, '-c', 'copy', final]);
fs.unlinkSync(raw);
let info = ''; try { execFileSync(FF, ['-i', final], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { info = e.stderr.toString(); }
out.file = { path: `${FORMAT}.webm`, bytes: fs.statSync(final).size, duration: (/Duration: ([\d:.]+)/.exec(info) || [])[1], streams: (info.match(/Stream #.*/g) || []).map(s => s.trim()) };
out.totalMs = Date.now() - T0;
fs.writeFileSync(path.join(ROOT, `render-log.${FORMAT}.json`), JSON.stringify(out, null, 2));
console.log('done', JSON.stringify(out.file), 'total', out.totalMs, 'ms');
