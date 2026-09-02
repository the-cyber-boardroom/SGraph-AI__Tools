// 00-probe.mjs — does Kokoro load, does MediaRecorder record, under headless Playwright?
// Usage: NODE_PATH=/opt/node22/lib/node_modules node 00-probe.mjs
import { launch, context } from './browser.mjs';
import fs from 'node:fs';

const BASE = 'http://localhost:10063';
const browser = await launch({ headless: !process.env.HEADFUL });
const ctx = await context(browser);
const page = await ctx.newPage();
page.on('console', m => { const t = m.text(); if (!/favicon/.test(t)) console.log('  [page]', t.slice(0, 200)); });
page.on('pageerror', e => console.log('  [pageerror]', e.message));
page.on('crash', () => console.log('  [CRASH] page crashed'));
browser.on('disconnected', () => console.log('  [browser disconnected]'));
const POOL = Number(process.env.POOL || 1);

const t0 = Date.now();
await page.goto(`${BASE}/en-gb/video-creator/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tool, null, { timeout: 30000 });
console.log('tool ready after', Date.now() - t0, 'ms');

// Two tiny slides, generated in-page (no disk access needed)
await page.evaluate(async () => {
  const mk = (label, color) => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 1280, 720);
    x.fillStyle = '#fff'; x.font = 'bold 80px system-ui'; x.fillText(label, 100, 360);
    return new Promise(r => c.toBlob(b => r(new File([b], label + '.png', { type: 'image/png' })), 'image/png'));
  };
  const files = [await mk('one', '#1d4ed8'), await mk('two', '#0f766e')];
  await window.__tool.loadSlides({ files });
  window.__tool.setNarration({ slideIndex: 0, text: 'A vault is a folder that encrypts itself before anything leaves your machine.' });
  window.__tool.setNarration({ slideIndex: 1, text: 'The server only ever sees ciphertext.' });
});

// Pre-load the pool ourselves so its size is ours to choose (sg-tts is a module
// singleton: same URL as video-creator imports, so it shares the pool).
const cold = await page.evaluate(async (POOL) => {
  const t = performance.now();
  const tts = await import('/core/sg-tts/v0/v0.1/v0.1.0/sg-tts.js');
  const log = [];
  await tts.loadTTS({ poolSize: POOL, onProgress: ({ workerIndex, message }) => log.push(`${(performance.now() - t) | 0}ms w${workerIndex}: ${message}`) });
  const loadMs = performance.now() - t;
  const r = await window.__tool.generateAudio({ voice: 'af_bella', speed: 1.0 });
  return { loadMs, ms: performance.now() - t, durations: r.durations, log };
}, POOL);
console.log('TTS cold:', JSON.stringify(cold));
const warm = await page.evaluate(async () => {
  const t = performance.now();
  const r = await window.__tool.generateAudio({ voice: 'af_bella', speed: 1.0 });
  return { ms: performance.now() - t, durations: r.durations };
});
console.log('TTS warm:', JSON.stringify(warm));

const rec = await page.evaluate(async () => {
  const t = window.__tool;
  const intended = t.getStatus().audioDurations?.reduce((a, b) => a + b, 0);
  const started = performance.now();
  const { webmBlob } = await t.record({ fps: 30, bitrateKbps: 2500 });
  const actual = performance.now() - started;
  const buf = new Uint8Array(await webmBlob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { intendedMs: intended * 1000, actualMs: actual, size: webmBlob.size, type: webmBlob.type, b64: btoa(s) };
});
console.log('record:', JSON.stringify({ intendedMs: rec.intendedMs, actualMs: rec.actualMs, size: rec.size, type: rec.type }));
fs.writeFileSync(process.env.PROBE_OUT || '/tmp/probe.webm', Buffer.from(rec.b64, 'base64'));
await browser.close();
