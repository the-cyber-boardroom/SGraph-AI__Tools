// 04-doc.mjs — the reel as a document: one row per scene, artefact on the left
// (the annotated still, or the clip where one was shot) and the words on the
// right (caption, narration, what the shot is). Writes reel.html next to the
// images (relative paths, small, commit-friendly) and prints it to reel.pdf via
// Chromium. INLINE=1 writes reel.inline.html with images and clips embedded as
// data URIs, for publishing as a single file.
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser.mjs';

const ROOT = path.resolve('..');
const reel = JSON.parse(fs.readFileSync(path.join(ROOT, 'reel.json'), 'utf8'));
const INLINE = !!process.env.INLINE;
const logs = {};
for (const f of ['landscape', 'shorts']) { try { logs[f] = JSON.parse(fs.readFileSync(path.join(ROOT, `render-log.${f}.json`), 'utf8')); } catch {} }
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64 = (p, mime) => `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
const src = (rel, mime) => INLINE ? b64(path.join(ROOT, rel), mime) : rel;

const rows = reel.scenes.map((s, i) => {
  const clip = s.shot.kind === 'clip' && fs.existsSync(path.join(ROOT, 'clips', `${s.id}.webm`));
  const media = clip
    ? `<video controls muted playsinline preload="metadata" poster="${src(`images/${s.id}.png`, 'image/png')}" src="${src(`clips/${s.id}.webm`, 'video/webm')}"></video>`
    : `<img src="${src(`images/${s.id}.png`, 'image/png')}" alt="${esc(s.caption)}">`;
  const phone = fs.existsSync(path.join(ROOT, 'images-shorts', `${s.id}.png`))
    ? `<img class="phone" src="${src(`images-shorts/${s.id}.png`, 'image/png')}" alt="${esc(s.caption)} (phone)">` : '';
  const ann = Array.isArray(s.shot.annotate) ? s.shot.annotate : (s.shot.annotate?.landscape || []);
  const what = [s.shot.kind === 'clip' ? 'clip' : 'still', s.shot.url.replace(/^vault:/, 'published vault: '), s.shot.scrollTo?.replace(/^text:/, 'scrolled to “') + (s.shot.scrollTo?.startsWith('text:') ? '”' : ''),
    ...ann.map(a => a.spot ? 'spotlight ' + (typeof a.spot === 'string' ? a.spot.replace(/^el:/, 'on ') : 'rect') : a.blur ? 'blur ' + a.blur.replace(/^el:/, '') : a.label ? `label “${a.label}”` : '')].filter(Boolean);
  return `
  <section class="scene" id="${s.id}">
    <div class="media">${media}${phone}</div>
    <div class="words">
      <div class="n">${i + 1} / ${reel.scenes.length} · ${s.id}</div>
      <h2>${esc(s.caption)}</h2>
      <p class="narration">${esc(s.narration)}</p>
      <p class="shot">${what.map(esc).join(' · ')}</p>
    </div>
  </section>`;
}).join('\n');

const meta = (f) => { const l = logs[f]; if (!l) return ''; return `<li><b>${f}</b>: ${l.file.duration} · ${(l.file.bytes / 1e6).toFixed(1)} MB · ${l.sceneCount} scenes · TTS ${(l.tts.coldGenMs / 1000).toFixed(0)} s · record ${(l.record.actualMs / 1000).toFixed(1)} s (intended ${(l.intendedMs / 1000).toFixed(1)} s) · pipeline ${(l.totalMs / 1000).toFixed(0)} s</li>`; };
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(reel.title)} — reel</title>
<style>
  :root { --ink:#0f172a; --dim:#64748b; --teal:#0f766e; --line:#e2e8f0; --bg:#ffffff; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e6edf7; --dim:#94a3b8; --teal:#14b8a6; --line:#1e293b; --bg:#0a0a18; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:1200px; margin:0 auto; padding:32px 24px 64px; }
  header.top { border-bottom:3px solid var(--teal); padding-bottom:16px; margin-bottom:8px; }
  header.top h1 { font-size:34px; margin:0 0 4px; }
  header.top p { margin:0; color:var(--dim); }
  .scene { display:grid; grid-template-columns: 1.35fr 1fr; gap:28px; padding:28px 0; border-bottom:1px solid var(--line); align-items:start; break-inside:avoid; page-break-inside:avoid; }
  .media img, .media video { width:100%; height:auto; border-radius:8px; border:1px solid var(--line); background:#000; display:block; }
  .media img.phone { width:32%; margin-top:12px; }
  .words .n { color:var(--dim); font-size:13px; letter-spacing:.06em; text-transform:uppercase; }
  .words h2 { font-size:22px; margin:4px 0 10px; color:var(--teal); }
  .words .narration { font-size:18px; margin:0 0 12px; }
  .words .shot { color:var(--dim); font-size:13px; margin:0; }
  footer { margin-top:28px; color:var(--dim); font-size:14px; }
  footer ul { padding-left:18px; }
  @media (max-width: 760px) { .scene { grid-template-columns: 1fr; } }
  @page { size: A4 landscape; margin: 12mm; }
  @media print { body { background:#fff; color:#0f172a; } .scene { page-break-inside:avoid; } video { display:none; } }
</style></head>
<body><main>
  <header class="top">
    <h1>${esc(reel.title)}</h1>
    <p>${esc(reel.subtitle)} · ${esc(reel.date)} · made by ${esc(reel.author)} · ${reel.scenes.length} scenes</p>
  </header>
  <section class="scene">
    <div class="words" style="grid-column: 1 / -1">
      <div class="n">opening</div><h2>${esc(reel.intro.caption)}</h2><p class="narration">${esc(reel.intro.narration)}</p>
    </div>
  </section>
  ${rows}
  <section class="scene">
    <div class="words" style="grid-column: 1 / -1">
      <div class="n">closing</div><h2>${esc(reel.outro.caption)}</h2><p class="narration">${esc(reel.outro.narration)}</p>
      ${logs.landscape ? `<ul>${logs.landscape.closingRows.map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>
  <footer>
    <p>Source of truth: <code>reel.json</code>. Stills in <code>images/</code> (desktop, 1280×720) and <code>images-shorts/</code> (phone, 1080×1920); clips in <code>clips/</code>. Renders:</p>
    <ul>${meta('landscape')}${meta('shorts')}</ul>
  </footer>
</main></body></html>`;
const outName = INLINE ? 'reel.inline.html' : 'reel.html';
fs.writeFileSync(path.join(ROOT, outName), html);
console.log('wrote', outName, (fs.statSync(path.join(ROOT, outName)).size / 1e6).toFixed(2), 'MB');
if (!INLINE) {
  const browser = await launch(); const page = await browser.newPage();
  await page.goto('file://' + path.join(ROOT, 'reel.html'), { waitUntil: 'load' });
  await page.pdf({ path: path.join(ROOT, 'reel.pdf'), format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  await browser.close();
  console.log('wrote reel.pdf', (fs.statSync(path.join(ROOT, 'reel.pdf')).size / 1e6).toFixed(2), 'MB');
}
