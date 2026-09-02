// 02-render.mjs — drive video-creator's JS API to turn images/ + reel.json into a WebM.
// Usage: FORMAT=landscape|shorts POOL=2 node 02-render.mjs   (env as in 01-capture.mjs)
// Records: TTS time (cold = first call in a fresh page; warm = second call), intended
// vs actual record() duration, and the whole wall clock.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, context, sleep } from './browser.mjs';
import { compositorSource } from './slides.mjs';

const ROOT = path.resolve('..');
const reel = JSON.parse(fs.readFileSync(path.join(ROOT, 'reel.json'), 'utf8'));
const FORMAT = process.env.FORMAT || 'landscape';
const POOL = Number(process.env.POOL || 2);
const WARM = !!process.env.WARM;
const HEARTBEAT = process.env.HEARTBEAT !== '0';  // repaint the recording canvas every frame; see below   // second generateAudio() pass, to measure whether anything is cached (nothing is)
const FF = process.env.FFMPEG || 'ffmpeg';
const scenes = FORMAT === 'shorts' ? reel.shorts.map(id => reel.scenes.find(s => s.id === id)) : reel.scenes;
// Shorts: CROP=1 crops the desktop stills to 9:16 around the focus rect (output
// shorts-crop.webm); otherwise stills re-shot at a phone viewport are used from
// images-shorts/ as they are (output shorts.webm).
const CROP = FORMAT === 'shorts' && !!process.env.CROP;
const IMG = FORMAT === 'shorts' && !CROP ? 'images-shorts' : 'images';
const OUT = CROP ? 'shorts-crop' : FORMAT;
const size = FORMAT === 'shorts' ? { width: 1080, height: 1920 } : { width: 1280, height: 720 };
const T0 = Date.now();
const out = { format: FORMAT, crop: CROP, images: IMG, pool: POOL, sceneCount: scenes.length, started: new Date().toISOString() };

// Slides go in as {name, dataUrl}. video-creator's _drawSlide prints
// `${slide.name} • i/n` in its own 48 px bottom bar, so every File is named with
// the title/date/author line and that bar becomes a persistent footer.
const meta = { title: reel.title, subtitle: reel.subtitle, author: reel.author, date: reel.date };
const FILE_NAME = `${meta.title} · ${meta.date} · made by ${meta.author}`;
const slides = scenes.map(s => ({
  id: s.id, name: FILE_NAME, caption: s.caption, narration: s.narration, focus: s.shot.focus || null,
  dataUrl: 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, IMG, `${s.id}.png`)).toString('base64'),
}));
const captureLog = JSON.parse(fs.readFileSync(path.join(ROOT, FORMAT === 'shorts' ? 'capture-log.shorts.json' : 'capture-log.json'), 'utf8'));
const words = scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0) + reel.intro.narration.split(/\s+/).length + reel.outro.narration.split(/\s+/).length;

const browser = await launch();
const ctx = await context(browser, { acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));
page.on('crash', () => console.log('  [CRASH]'));
await page.goto('http://localhost:10063/en-gb/video-creator/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tool, null, { timeout: 30000 });
out.toolReadyMs = Date.now() - T0;

// Compose the slides in-page: title slide, one composed slide per scene (header,
// screenshot, caption band), and a placeholder closing slide that is replaced
// after TTS, when the timings it shows are known.
out.compose = await page.evaluate(async ([slides, size, CROP, meta, intro, outro, FILE_NAME, src]) => {
  const K = eval(src);
  const files = []; const report = [];
  const total = slides.length + 2;
  files.push((await K.titleSlide(meta, size.width, size.height, slides.length, FILE_NAME)).file);
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    let dataUrl = s.dataUrl;
    if (CROP) {                                            // 9:16 crop of a desktop still around the focus rect (comparison mode)
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = s.dataUrl; });
      const W = img.width, H = img.height, winW = Math.round(H * 9 / 16);
      const f = s.focus || [0, 0, 1, 1]; const fx = f[0] * W, fw = f[2] * W;
      let x = Math.round(fx + fw / 2 - winW / 2); x = Math.max(0, Math.min(W - winW, x));
      const c = document.createElement('canvas'); c.width = winW; c.height = H;
      c.getContext('2d').drawImage(img, x, 0, winW, H, 0, 0, winW, H);
      dataUrl = c.toDataURL('image/png');
      report.push({ id: s.id, focus: f, windowPx: [x, 0, winW, H], lossy: fw > winW + 1 });
    }
    const r = await K.sceneSlide(dataUrl, s, meta, size.width, size.height, i + 2, total, FILE_NAME);
    files.push(r.file); report.push({ id: s.id, narrationLines: r.lines });
  }
  files.push((await K.closingSlide(meta, [['Status', 'rendering…']], size.width, size.height, FILE_NAME, outro)).file);
  // Keep a reference to the tool's slide objects: the event carries the same array.
  window.__slidesRef = null;
  window.addEventListener('tool:slides:loaded', e => { window.__slidesRef = e.detail.slides; }, { once: true });
  const t = window.__tool;
  await t.loadSlides({ files });
  t.setNarration({ slideIndex: 0, text: intro.narration });
  slides.forEach((s, i) => t.setNarration({ slideIndex: i + 1, text: s.narration }));
  t.setNarration({ slideIndex: slides.length + 1, text: outro.narration });
  return { report, gotSlidesRef: Array.isArray(window.__slidesRef), count: files.length };
}, [slides, size, CROP, meta, reel.intro, reel.outro, FILE_NAME, compositorSource]);
console.log('compose', JSON.stringify({ count: out.compose.count, gotSlidesRef: out.compose.gotSlidesRef }));

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

// Closing slide with the real numbers: everything measured up to here, plus the
// record, which runs in real time and so is known before it starts.
const audioS = tts.durations.reduce((a, b) => a + b, 0);
const soFarS = (Date.now() - T0) / 1000;
const rows = [
  ['Made by', meta.author],
  ['When', meta.date],
  ['Script', `${scenes.length} scenes + title and closing · ${words} words · reel.json written first`],
  ['Screenshots', `${captureLog.captured} shot, ${captureLog.used} used · Playwright, headless · ${(captureLog.totalMs / 1000).toFixed(0)} s`],
  ['Narration', `Kokoro-82M in the browser (${POOL} workers) · ${audioS.toFixed(1)} s of speech in ${(tts.coldGenMs / 1000).toFixed(0)} s · model load ${(tts.modelLoadMs / 1000).toFixed(1)} s`],
  ['Render', `video-creator, canvas + MediaRecorder, real time · ${audioS.toFixed(0)} s`],
  ['Pipeline wall clock', `${(captureLog.totalMs / 1000 + soFarS + audioS).toFixed(0)} s: capture ${(captureLog.totalMs / 1000).toFixed(0)} + compose and narrate ${soFarS.toFixed(0)} + render ${audioS.toFixed(0)}`],
  ['API cost', '$0.00 · no LLM, TTS or image API calls'],
  ['Compute', 'one 4-core container · agent session tokens not metered here'],
];
out.closingRows = rows;
const swapped = await page.evaluate(async ([rows, meta, size, FILE_NAME, outro, src]) => {
  const K = eval(src);
  const { file } = await K.closingSlide(meta, rows, size.width, size.height, FILE_NAME, outro);
  const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
  const ref = window.__slidesRef; if (!ref) return false;
  ref[ref.length - 1].dataUrl = dataUrl; return true;
}, [rows, meta, size, FILE_NAME, reel.outro, compositorSource]);
console.log('closing slide swapped:', swapped);

// Record — real time. Then hand the blob to Chromium's downloader (no big body over CDP).
await page.evaluate((size) => window.__tool.setConfig(size), size);
const recordStart = Date.now();
const rec = await page.evaluate(async ([HEARTBEAT, size]) => {
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
      // Note: every window.__tool method returns a Promise, sync ones included
      // (SgToolApi._invoke is async), so t.getConfig().width is undefined here.
      canvas = canvas || [...document.querySelectorAll('canvas')].find(c => c.style.display === 'none' && c.width === size.width && c.height === size.height);
      if (canvas) { canvas.getContext('2d').drawImage(canvas, 0, 0); heartbeats++; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const { webmBlob } = await done;
  running = false;
  window.__out = webmBlob;
  return { actualMs: performance.now() - started, size: webmBlob.size, type: webmBlob.type, status: (await t.getStatus()).status, heartbeat: HEARTBEAT, heartbeats };
}, [HEARTBEAT, size]);
out.record = rec;
out.record.wallMs = Date.now() - recordStart;
console.log('record', JSON.stringify(rec), 'intended', out.intendedMs, 'drift ms', Math.round(rec.actualMs - out.intendedMs));
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.evaluate(() => window.__tool.download({ blob: window.__out, filename: 'out.webm' })),
]);
const raw = path.join(ROOT, `${OUT}.raw.webm`);
await download.saveAs(raw);
await browser.close();

// MediaRecorder WebMs carry no duration header; a copy-remux writes one.
const final = path.join(ROOT, `${OUT}.webm`);
execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-i', raw, '-c', 'copy', final]);
fs.unlinkSync(raw);
let info = ''; try { execFileSync(FF, ['-i', final], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { info = e.stderr.toString(); }
out.file = { path: `${OUT}.webm`, bytes: fs.statSync(final).size, duration: (/Duration: ([\d:.]+)/.exec(info) || [])[1], streams: (info.match(/Stream #.*/g) || []).map(s => s.trim()) };
out.totalMs = Date.now() - T0;
fs.writeFileSync(path.join(ROOT, `render-log.${OUT}.json`), JSON.stringify(out, null, 2));
console.log('done', JSON.stringify(out.file), 'total', out.totalMs, 'ms');
