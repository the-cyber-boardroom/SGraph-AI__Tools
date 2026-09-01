// annotate.mjs — the "browser as compositor" trick from 2__the-run.md, step 3.
// Resolves a target (a viewport-fraction rect, or a named element) to a rect,
// then injects spotlight / label / blur overlays into the live page. Nothing
// here renders pixels: the page does, and the screenshot captures it.

/** Runs in the page. Returns {x,y,w,h} in viewport px for a spec, or null. */
export function resolveInPage(spec, anchorText) {
  const vw = innerWidth, vh = innerHeight;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const union = (els) => { const rs = els.map(rect); const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
    return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y }; };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh; };
  const byText = (sel, text) => [...document.querySelectorAll(sel)].filter(e => e.textContent.replace(/\s+/g, ' ').includes(text) && visible(e));
  const after = (sel) => { // first visible <sel> at or below the anchor
    const anchor = anchorText ? byText('h1,h2,h3,h4,p,summary,button', anchorText)[0] : null;
    const ay = anchor ? anchor.getBoundingClientRect().top - 1 : -1;
    return [...document.querySelectorAll(sel)].find(e => visible(e) && e.getBoundingClientRect().top >= ay) || null;
  };
  if (Array.isArray(spec)) return { x: spec[0] * vw, y: spec[1] * vh, w: spec[2] * vw, h: spec[3] * vh };
  if (typeof spec !== 'string' || !spec.startsWith('el:')) return null;
  const name = spec.slice(3);
  if (name.startsWith('heading:')) { const h = byText('h1,h2,h3', name.slice(8))[0]; return h ? rect(h) : null; }
  if (name.startsWith('text:')) { const e = byText('*', name.slice(5)).sort((a, b) => a.textContent.length - b.textContent.length)[0]; return e ? rect(e) : null; }
  if (name === 'code') { const e = after('pre'); return e ? rect(e) : null; }
  if (name === 'table') { const e = after('table'); return e ? rect(e) : null; }
  if (name === 'terminal') { const e = byText('pre,code,div', 'sgit create my-vault').sort((a, b) => a.textContent.length - b.textContent.length)[0];
    let b = e; while (b && b.getBoundingClientRect().width < vw * 0.4) b = b.parentElement; return b ? rect(b) : null; }
  if (name === 'right-column') { const h = byText('h3,h4,strong,div', 'The server').sort((a, b) => a.textContent.length - b.textContent.length)[0];
    let b = h; while (b && b.getBoundingClientRect().height < 120) b = b.parentElement; return b ? rect(b) : null; }
  if (name === 'keys') { const cells = [...document.querySelectorAll('td,code')].filter(e => /sgit_rk1_/.test(e.textContent) && visible(e)).filter(e => !e.querySelector('td'));
    return cells.length ? { multi: cells.map(rect) } : null; }
  if (name === 'badges') { const els = [...document.querySelectorAll('button,span,div,a')].filter(e => visible(e) && /^(R1 W0|Read-only|.{0,3}Read-only|.{0,3}R1 W0)$/.test(e.textContent.trim()));
    return els.length ? union(els) : null; }
  if (name === 'pip') { const e = byText('*', 'pip install sgit-ai').sort((a, b) => a.textContent.length - b.textContent.length)[0];
    let b = e; while (b && b.getBoundingClientRect().width < 200) b = b.parentElement; return b ? rect(b) : null; }
  return null;
}

/** Runs in the page. Injects overlays for resolved annotations. */
export function injectInPage(items) {
  const z = 2147483647;
  for (const it of items) {
    if (it.kind === 'spot' && it.rect) {
      const pad = 8, r = it.rect, d = document.createElement('div');
      d.className = 'spike-annot';
      d.style.cssText = `position:fixed;left:${r.x - pad}px;top:${r.y - pad}px;width:${r.w + 2 * pad}px;height:${r.h + 2 * pad}px;
        border:3px solid #14b8a6;border-radius:8px;box-shadow:0 0 0 9999px rgba(3,7,18,.55);z-index:${z};pointer-events:none;`;
      document.body.appendChild(d);
    }
    if (it.kind === 'blur') for (const r of (it.rect?.multi || [it.rect]).filter(Boolean)) {
      const d = document.createElement('div'); d.className = 'spike-annot';
      d.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;backdrop-filter:blur(10px);
        background:rgba(120,120,120,.35);border-radius:4px;z-index:${z};pointer-events:none;`;
      document.body.appendChild(d);
    }
    if (it.kind === 'label') {
      const d = document.createElement('div'); d.className = 'spike-annot'; d.textContent = it.text;
      let left = 0, top = 0;
      if (Array.isArray(it.at)) { left = it.at[0] * innerWidth; top = it.at[1] * innerHeight; }
      else if (it.anchorRect) {  // 'below' | 'above' the spotlight, clamped to the viewport
        const r = it.anchorRect, h = 44;
        left = Math.max(8, Math.min(r.x, innerWidth - 480));
        top = it.at === 'above' ? Math.max(8, r.y - h - 20) : Math.min(innerHeight - h - 8, r.y + r.h + 20);
      }
      d.style.cssText = `position:fixed;left:${left}px;top:${top}px;z-index:${z};
        font:600 22px system-ui,sans-serif;color:#e6edf7;background:#0f766e;padding:8px 14px;border-radius:8px;
        box-shadow:0 4px 18px rgba(0,0,0,.4);pointer-events:none;max-width:60vw;`;
      document.body.appendChild(d);
    }
  }
}

/** Node side: resolve + inject one scene's annotations on a page. Returns what was used. */
export async function annotate(page, scene, anchorText) {
  const used = [];
  let lastSpot = null;
  for (const a of scene.shot.annotate || []) {
    const kind = a.spot ? 'spot' : a.blur ? 'blur' : a.label ? 'label' : null;
    if (!kind) continue;
    const spec = a.spot ?? a.blur;
    const rect = kind === 'label' ? null : await page.evaluate(([s, t, fn]) => (new Function('return ' + fn)())(s, t), [spec, anchorText, resolveInPage.toString()]);
    if (kind !== 'label' && !rect) { used.push({ kind, spec, resolved: false }); continue; }
    if (kind === 'spot') lastSpot = rect;
    used.push({ kind, spec, resolved: true, rect: rect?.multi ? { multi: rect.multi.length } : rect, text: a.label, at: a.at });
    await page.evaluate(([items, fn]) => (new Function('return ' + fn)())(items), [[{ kind, rect, text: a.label, at: a.at, anchorRect: lastSpot }], injectInPage.toString()]);
  }
  return used;
}
