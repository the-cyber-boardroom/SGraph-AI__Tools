// slides.mjs — composes the slide images video-creator will record, in-page on a
// canvas. Each slide = header strip (title · date · author) + the screenshot +
// a caption band carrying the caption and the narration being spoken. Also
// builds the opening title slide and the closing "how this was made" slide.
// video-creator draws its own 48 px bar over the bottom of every slide with the
// File name in it, so the band leaves that strip alone and the File is named
// with the title/date/author line — the bar becomes a persistent footer.
//
// Everything here is a string of page-side code, evaluated with page.evaluate:
// the browser is the compositor.

export const compositorSource = `
(() => {
  const C = { bg: '#0a0a18', band: '#0f172a', ink: '#e6edf7', dim: '#94a3b8', teal: '#14b8a6', tealDark: '#0f766e' };
  const wrap = (ctx, text, maxW) => {
    const words = text.split(/\\s+/), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const toFile = (c, name) => new Promise(r => c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png'));

  // Layout per format. BAR is video-creator's own bottom bar (48 px, filename).
  function layout(W, H) {
    const vertical = H > W;
    const BAR = 48, header = vertical ? 96 : 56, band = vertical ? 400 : 168;
    return { W, H, vertical, BAR, header, band, fontBase: vertical ? 34 : 26, capFont: vertical ? 30 : 22, pad: vertical ? 48 : 40 };
  }

  function drawHeader(ctx, L, meta, right) {
    ctx.fillStyle = C.band; ctx.fillRect(0, 0, L.W, L.header);
    ctx.fillStyle = C.teal; ctx.fillRect(0, L.header - 3, L.W, 3);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '700 ' + (L.vertical ? 34 : 24) + 'px system-ui, sans-serif'; ctx.fillStyle = C.ink;
    if (L.vertical) {          // two rows: title, then date · author · n/N
      ctx.fillText(meta.title, L.pad, L.header * 0.32);
      ctx.font = '500 24px system-ui, sans-serif'; ctx.fillStyle = C.dim;
      ctx.fillText(right, L.pad, L.header * 0.72);
    } else {
      ctx.fillText(meta.title, L.pad, L.header / 2);
      ctx.textAlign = 'right'; ctx.font = '500 16px system-ui, sans-serif'; ctx.fillStyle = C.dim;
      ctx.fillText(right, L.W - L.pad, L.header / 2);
    }
  }

  function drawBand(ctx, L, caption, narration) {
    const top = L.H - L.BAR - L.band;
    ctx.fillStyle = C.band; ctx.fillRect(0, top, L.W, L.band);
    ctx.fillStyle = C.tealDark; ctx.fillRect(0, top, L.W, 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '700 ' + L.capFont + 'px system-ui, sans-serif'; ctx.fillStyle = C.teal;
    ctx.fillText(caption.toUpperCase(), L.pad, top + (L.vertical ? 28 : 18));
    ctx.font = '500 ' + L.fontBase + 'px system-ui, sans-serif'; ctx.fillStyle = C.ink;
    const lines = wrap(ctx, narration, L.W - 2 * L.pad);
    const lh = L.fontBase * 1.35; let y = top + (L.vertical ? 28 : 18) + L.capFont + (L.vertical ? 24 : 14);
    for (const ln of lines.slice(0, L.vertical ? 7 : 3)) { ctx.fillText(ln, L.pad, y); y += lh; }
    return lines.length;
  }

  // A scene slide: screenshot fitted into the space between header and band.
  async function sceneSlide(dataUrl, scene, meta, W, H, index, total, fileName) {
    const L = layout(W, H); const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const img = await loadImg(dataUrl);
    const areaY = L.header, areaH = H - L.BAR - L.band - L.header;
    if (L.vertical) {          // phone still: full width, anchored to the top, clipped by the band
      const s = W / img.width; ctx.drawImage(img, 0, 0, img.width, Math.min(img.height, areaH / s), 0, areaY, W, Math.min(img.height * s, areaH));
    } else {
      const s = Math.min((W - 2 * 16) / img.width, (areaH - 2 * 12) / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (W - dw) / 2, areaY + (areaH - dh) / 2, dw, dh);
    }
    drawHeader(ctx, L, meta, meta.date + ' · ' + meta.author + ' · ' + index + ' / ' + total);
    const lines = drawBand(ctx, L, scene.caption, scene.narration);
    return { file: await toFile(c, fileName), lines };
  }

  async function titleSlide(meta, W, H, total, fileName) {
    const L = layout(W, H); const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.teal; ctx.fillRect(L.pad, H * 0.30, L.vertical ? 120 : 96, 6);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = C.ink;
    const big = L.vertical ? 84 : 72; ctx.font = '800 ' + big + 'px system-ui, sans-serif';
    let y = H * 0.30 + 30; for (const ln of wrap(ctx, meta.title, W - 2 * L.pad)) { ctx.fillText(ln, L.pad, y); y += big * 1.15; }
    ctx.font = '500 ' + (L.vertical ? 40 : 32) + 'px system-ui, sans-serif'; ctx.fillStyle = C.dim; y += 16;
    for (const ln of wrap(ctx, meta.subtitle, W - 2 * L.pad)) { ctx.fillText(ln, L.pad, y); y += (L.vertical ? 40 : 32) * 1.3; }
    ctx.font = '500 ' + (L.vertical ? 28 : 22) + 'px system-ui, sans-serif'; ctx.fillStyle = C.teal; y += 28;
    ctx.fillText(meta.date + '  ·  made by ' + meta.author + '  ·  ' + total + ' scenes', L.pad, y);
    return { file: await toFile(c, fileName), lines: 0 };
  }

  // Closing slide: a table of how the video was made. rows = [[label, value], …]
  async function closingSlide(meta, rows, W, H, fileName, outro) {
    const L = layout(W, H); const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    drawHeader(ctx, L, meta, meta.date + ' · ' + meta.author);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const f = L.vertical ? 30 : 22, lh = f * 1.5; let y = L.header + (L.vertical ? 48 : 24);
    const limit = H - L.BAR - L.band - lh;
    ctx.font = '700 ' + (L.vertical ? 40 : 30) + 'px system-ui, sans-serif'; ctx.fillStyle = C.ink;
    ctx.fillText(outro.caption, L.pad, y); y += (L.vertical ? 40 : 30) * 1.6;
    const col = L.vertical ? W * 0.42 : W * 0.30;
    for (const [k, v] of rows) {
      ctx.font = '600 ' + f + 'px system-ui, sans-serif'; ctx.fillStyle = C.dim; ctx.fillText(k, L.pad, y);
      ctx.font = '500 ' + f + 'px system-ui, sans-serif'; ctx.fillStyle = C.ink;
      const vl = wrap(ctx, String(v), W - col - L.pad);
      if (y + vl.length * lh > limit) break;                 // never run into the caption band
      for (const ln of vl) { ctx.fillText(ln, col, y); y += lh; }
    }
    drawBand(ctx, L, outro.caption, outro.narration);
    return { file: await toFile(c, fileName), lines: 0 };
  }

  return { sceneSlide, titleSlide, closingSlide };
})()`;
