// 04-doc.mjs — the reel as a document: one row per scene, artefact on the left
// (the annotated still, or the clip where one was shot) and the words on the
// right (caption, narration, what the shot is). Writes reel.html next to the
// images (relative paths, small, commit-friendly) and prints it to reel.pdf via
// Chromium. INLINE=1 writes reel.inline.html with images and clips embedded as
// data URIs, for publishing as a single file.
import fs from 'node:fs';
import path from 'node:path';
import { launch, context } from './browser.mjs';

const ROOT = path.resolve('..');
const reel = JSON.parse(fs.readFileSync(path.join(ROOT, 'reel.json'), 'utf8'));
const INLINE = !!process.env.INLINE;
const logs = {};
for (const f of ['landscape', 'shorts', 'landscape-openrouter']) { try { logs[f] = JSON.parse(fs.readFileSync(path.join(ROOT, `render-log.${f}.json`), 'utf8')); } catch {} }
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64 = (p, mime) => `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
const src = (rel, mime) => INLINE ? b64(path.join(ROOT, rel), mime) : rel;

// Timecodes: the landscape render's TTS durations, in order title · scenes · closing.
const durs = logs.landscape?.tts?.durations || [];
const tc = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const starts = []; let acc = 0; for (const d of durs) { starts.push(acc); acc += d; }
const fmtDur = (d) => d ? `${d.toFixed(1)} s` : '';

const rows = reel.scenes.map((s, i) => {
  const clip = s.shot.kind === 'clip' && fs.existsSync(path.join(ROOT, 'clips', `${s.id}.webm`));
  const media = clip
    ? `<video controls muted playsinline preload="metadata" poster="${src(`images/${s.id}.png`, 'image/png')}" src="${src(`clips/${s.id}.webm`, 'video/webm')}"></video><img class="poster-print" src="${src(`images/${s.id}.png`, 'image/png')}" alt="${esc(s.caption)} (last frame of the clip)">`
    : `<img src="${src(`images/${s.id}.png`, 'image/png')}" alt="${esc(s.caption)}">`;
  const ann = Array.isArray(s.shot.annotate) ? s.shot.annotate : (s.shot.annotate?.landscape || []);
  const what = [s.shot.kind === 'clip' ? 'clip' : 'still', s.shot.url.replace(/^vault:/, 'published vault “') + (s.shot.url.startsWith('vault:') ? '”' : ''),
    s.shot.scrollTo?.startsWith('text:') ? `scroll to “${s.shot.scrollTo.slice(5)}”` : '',
    ...ann.map(a => a.spot ? 'spot ' + (typeof a.spot === 'string' ? a.spot.replace(/^el:/, '') : 'rect') : a.blur ? 'blur ' + a.blur.replace(/^el:/, '') : a.label ? `label “${a.label}”` : '')].filter(Boolean);
  const k = i + 1;   // slide index: 0 is the title slide
  return `
  <article class="scene" id="${s.id}">
    <div class="art">${media}</div>
    <div class="words">
      <p class="slug"><span class="tc">${starts[k] != null ? tc(starts[k]) : '—'}</span><span>scene ${i + 1} of ${reel.scenes.length}</span><span>${s.id}</span><span>${fmtDur(durs[k])}</span></p>
      <h2>${esc(s.caption)}</h2>
      <blockquote class="say">${esc(s.narration)}</blockquote>
      <p class="shot">${what.map(esc).join('<span class="sep"> · </span>')}</p>
    </div>
  </article>`;
}).join('\n');

const renderRow = (f, label) => { const l = logs[f]; if (!l) return ''; return `<tr><th>${label}</th><td>${l.file.duration.replace(/^00:/, '')}</td><td>${(l.file.bytes / 1e6).toFixed(1)} MB</td><td>${l.sceneCount + 2}</td><td>${(l.tts.coldGenMs / 1000).toFixed(0)} s</td><td>${(l.record.actualMs / 1000).toFixed(1)} s</td><td>${Math.round(l.record.actualMs - l.intendedMs)} ms</td><td>${(l.totalMs / 1000).toFixed(0)} s</td></tr>`; };
const closingRows = logs.landscape?.closingRows || [];
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(reel.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">
<style>
  :root { --bg:#f6f7f5; --panel:#ffffff; --ink:#111827; --dim:#5b6472; --rule:#d7dde2; --accent:#0f766e; --accent-ink:#ffffff; --mark:#14b8a6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0a0e1a; --panel:#111827; --ink:#e6edf7; --dim:#97a3b6; --rule:#243044; --accent:#14b8a6; --accent-ink:#04110f; --mark:#14b8a6; } }
  :root[data-theme="dark"] { --bg:#0a0e1a; --panel:#111827; --ink:#e6edf7; --dim:#97a3b6; --rule:#243044; --accent:#14b8a6; --accent-ink:#04110f; --mark:#14b8a6; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Source Serif 4", Georgia, serif; font-size:17px; line-height:1.5; }
  main { max-width:1180px; margin:0 auto; padding:40px 28px 72px; }
  .display { font-family:"IBM Plex Sans Condensed", "Arial Narrow", sans-serif; }
  .mono { font-family:"IBM Plex Mono", ui-monospace, Menlo, monospace; }
  header.sheet { display:grid; grid-template-columns: 1fr auto; gap:24px; align-items:end; padding-bottom:20px; border-bottom:3px solid var(--accent); }
  header.sheet h1 { font-family:"IBM Plex Sans Condensed", "Arial Narrow", sans-serif; font-weight:700; font-size:clamp(34px, 5vw, 56px); line-height:1; letter-spacing:-.01em; margin:0 0 10px; text-wrap:balance; }
  header.sheet .sub { font-size:19px; margin:0; max-width:60ch; }
  header.sheet .meta { font-family:"IBM Plex Mono", monospace; font-size:13px; color:var(--dim); text-align:right; line-height:1.7; }
  header.sheet .meta b { color:var(--ink); font-weight:500; }
  .intro, .outro { padding:26px 0; border-bottom:1px solid var(--rule); }
  .intro h2, .outro h2, .scene h2 { font-family:"IBM Plex Sans Condensed", "Arial Narrow", sans-serif; font-weight:600; font-size:27px; line-height:1.15; margin:6px 0 10px; text-wrap:balance; }
  .slug { display:flex; gap:14px; flex-wrap:wrap; font-family:"IBM Plex Mono", monospace; font-size:12.5px; color:var(--dim); margin:0; letter-spacing:.02em; text-transform:uppercase; }
  .slug .tc { color:var(--accent-ink); background:var(--accent); padding:1px 8px; border-radius:3px; font-weight:500; font-variant-numeric:tabular-nums; }
  .say { margin:0; font-size:22px; line-height:1.45; background:var(--panel); border:1px solid var(--rule); border-left:5px solid var(--accent); border-radius:6px; padding:16px 20px; }
  .shot { font-family:"IBM Plex Mono", monospace; font-size:12.5px; color:var(--dim); margin:14px 0 0; line-height:1.7; }
  /* Fixed image column: every frame is the same width and sits at the same x, whatever the text beside it does. */
  .scene { display:grid; grid-template-columns: 620px minmax(0, 1fr); gap:32px; padding:30px 0; border-bottom:1px solid var(--rule); align-items:start; break-inside:avoid; }
  .art { width:620px; }
  .art img, .art video { display:block; width:100%; height:auto; border:1px solid var(--rule); background:#0a0a18; }
  .art > img, .art > video { border-radius:4px; }
  .outro ul { margin:12px 0 0; padding-left:0; list-style:none; display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:8px 28px; }
  .outro li { font-size:15px; border-top:1px solid var(--rule); padding:8px 0; }
  .outro li b { font-family:"IBM Plex Sans Condensed", sans-serif; font-weight:600; color:var(--accent); margin-right:8px; text-transform:uppercase; font-size:13px; letter-spacing:.04em; }
  .renders { margin-top:34px; }
  .renders h3 { font-family:"IBM Plex Sans Condensed", sans-serif; font-weight:600; font-size:20px; margin:0 0 8px; }
  .renders .wrap { overflow-x:auto; }
  .renders table { border-collapse:collapse; width:100%; font-family:"IBM Plex Mono", monospace; font-size:12.5px; font-variant-numeric:tabular-nums; }
  .renders th, .renders td { text-align:left; padding:7px 12px 7px 0; border-bottom:1px solid var(--rule); white-space:nowrap; }
  .renders thead th { color:var(--dim); font-weight:500; text-transform:uppercase; letter-spacing:.04em; font-size:11px; }
  .renders p { font-size:14px; color:var(--dim); margin:12px 0 0; }
  .renders code { font-family:"IBM Plex Mono", monospace; font-size:13px; }
  .poster-print { display:none; }
  a { color:var(--accent); }
  :focus-visible { outline:2px solid var(--mark); outline-offset:2px; }
  .transcript { margin-top:40px; padding-top:24px; border-top:3px solid var(--accent); }
  .transcript h3 { font-family:"IBM Plex Sans Condensed", sans-serif; font-weight:600; font-size:24px; margin:0 0 6px; }
  .transcript p.hint { color:var(--dim); font-size:14px; margin:0 0 14px; }
  .transcript pre { white-space:pre-wrap; font-family:"Source Serif 4", Georgia, serif; font-size:18px; line-height:1.6; background:var(--panel); border:1px solid var(--rule); border-radius:6px; padding:20px 24px; margin:0; }
  .transcript button { font:inherit; font-size:14px; padding:6px 12px; border:1px solid var(--rule); background:var(--panel); color:var(--ink); border-radius:4px; cursor:pointer; margin-bottom:12px; }
  @media (max-width: 1000px) { .scene { grid-template-columns: 1fr; } .art { width:100%; } header.sheet { grid-template-columns: 1fr; } header.sheet .meta { text-align:left; } }
  @page { size: A4 landscape; margin: 12mm; }
  @media print { :root { --bg:#fff; --panel:#fff; --ink:#111827; --dim:#5b6472; --rule:#d7dde2; --accent:#0f766e; --accent-ink:#fff; } body { font-size:12px; } main { padding:0; max-width:none; } .scene { page-break-inside:avoid; gap:18px; padding:16px 0; grid-template-columns: 150mm minmax(0,1fr); } .art { width:150mm; } .say { font-size:14px; padding:10px 14px; } .scene h2 { font-size:19px; } video { display:none; } .poster-print { display:block; } header.sheet h1 { font-size:34px; } .transcript button { display:none; } .transcript pre { font-size:12px; } }
</style></head>
<body><main>
  <header class="sheet">
    <div>
      <h1>${esc(reel.title)}</h1>
      <p class="sub">${esc(reel.subtitle)}</p>
    </div>
    <div class="meta"><b>${esc(reel.date)}</b><br>made by ${esc(reel.author)}<br>${reel.scenes.length} scenes · ${durs.length ? tc(acc) + ' landscape' : 'not yet rendered'}<br>source: reel.json</div>
  </header>
  <section class="intro">
    <p class="slug"><span class="tc">${durs.length ? tc(0) : '—'}</span><span>opening</span><span>${fmtDur(durs[0])}</span></p>
    <h2>${esc(reel.intro.caption)}</h2>
    <blockquote class="say">${esc(reel.intro.narration)}</blockquote>
  </section>
  ${rows}
  <section class="outro">
    <p class="slug"><span class="tc">${starts.length ? tc(starts[starts.length - 1]) : '—'}</span><span>closing</span><span>${fmtDur(durs[durs.length - 1])}</span></p>
    <h2>${esc(reel.outro.caption)}</h2>
    <blockquote class="say">${esc(reel.outro.narration)}</blockquote>
    ${closingRows.length ? `<ul>${closingRows.map(([k, v]) => `<li><b>${esc(k)}</b>${esc(v)}</li>`).join('')}</ul>` : ''}
  </section>
  <section class="transcript">
    <h3>Transcript</h3>
    <p class="hint">The narration in order, as plain text, ready to paste next to the video.</p>
    <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('transcript-text').textContent).then(() => { this.textContent = 'Copied'; })">Copy transcript</button>
    <pre id="transcript-text">${esc([reel.intro.narration, ...reel.scenes.map(x => x.narration), reel.outro.narration].join('\n\n'))}</pre>
  </section>
  <section class="renders">
    <h3>Renders</h3>
    <div class="wrap"><table><thead><tr><th>cut</th><th>length</th><th>size</th><th>slides</th><th>TTS</th><th>record</th><th>drift</th><th>pipeline</th></tr></thead>
    <tbody>${renderRow('landscape', 'landscape 1280×720 · Kokoro')}${renderRow('shorts', 'shorts 1080×1920 · Kokoro')}${renderRow('landscape-openrouter', 'landscape 1280×720 · OpenRouter gpt-audio')}</tbody></table></div>
    <p>Source of truth is <code>reel.json</code>. Stills in <code>images/</code> (desktop) and <code>images-shorts/</code> (phone); clips in <code>clips/</code>. Timecodes are the landscape cut's TTS durations.</p>
  </section>
</main></body></html>`;
const outName = INLINE ? 'reel.inline.html' : 'reel.html';
fs.writeFileSync(path.join(ROOT, outName), html);
console.log('wrote', outName, (fs.statSync(path.join(ROOT, outName)).size / 1e6).toFixed(2), 'MB');
if (!INLINE) {
  const browser = await launch(); const ctx = await context(browser); const page = await ctx.newPage();   // bridged, so the web fonts load into the PDF
  await page.goto('file://' + path.join(ROOT, 'reel.html'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(ROOT, 'reel.pdf'), format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  await browser.close();
  console.log('wrote reel.pdf', (fs.statSync(path.join(ROOT, 'reel.pdf')).size / 1e6).toFixed(2), 'MB');
}
