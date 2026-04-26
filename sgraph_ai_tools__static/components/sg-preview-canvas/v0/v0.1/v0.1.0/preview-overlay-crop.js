// preview-overlay-crop.js — crop drag logic for preview overlay (v0.1.0)

import { clampCrop, defaultCrop, getClipCrop } from '/core/video-composer/v0/v0.1/v0.1.0/composer-clip-fields.js';
import { computeClipDestRect } from '/core/video-composer/v0/v0.1/v0.1.0/composer-draw.js';
import { defaultTransform } from '/core/video-composer/v0/v0.1/v0.1.0/composer-clip-fields.js';
import { makeMapper, clamp, round } from './preview-overlay-utils.js';

const HANDLE_DEFS = [
    { id: 'nw', cursor: 'nwse-resize' }, { id: 'n', cursor: 'ns-resize' },
    { id: 'ne', cursor: 'nesw-resize' }, { id: 'e', cursor: 'ew-resize' },
    { id: 'se', cursor: 'nwse-resize' }, { id: 's', cursor: 'ns-resize' },
    { id: 'sw', cursor: 'nesw-resize' }, { id: 'w', cursor: 'ew-resize' },
];

function buildDom(parent, onDown) {
    const mask = document.createElement('div');
    mask.className = 'pco-crop-mask';
    parent.appendChild(mask);
    const box = document.createElement('div');
    box.className = 'pco-crop-box';
    box.dataset.role = 'box';
    box.addEventListener('pointerdown', (e) => onDown(e, 'box'));
    parent.appendChild(box);
    const handles = {};
    for (const def of HANDLE_DEFS) {
        const h = document.createElement('div');
        h.className = `pco-handle pco-handle--${def.id} pco-crop-handle`;
        h.style.cursor = def.cursor;
        h.dataset.role = def.id;
        h.addEventListener('pointerdown', (e) => onDown(e, def.id));
        parent.appendChild(h);
        handles[def.id] = h;
    }
    return { mask, box, handles };
}

/** Compute the on-canvas destination rect that includes the FULL source frame
 *  (i.e. the area that the source pixels would map to before cropping). The
 *  crop rectangle is rendered as a sub-rect of this box. */
function fullSourceRect(canvas, active) {
    const t = active.transform || defaultTransform();
    const sw = active.srcWidth, sh = active.srcHeight;
    if (!sw || !sh) return null;
    const fullCrop = defaultCrop();
    return computeClipDestRect(canvas.width, canvas.height, sw, sh, t, fullCrop);
}

/** Crop fraction → on-canvas rect (canvas-pixel coords). */
function cropToCanvasRect(canvas, active) {
    const full = fullSourceRect(canvas, active);
    if (!full) return null;
    const c = active.crop || defaultCrop();
    return {
        dx: full.dx + c.x * full.drawW,
        dy: full.dy + c.y * full.drawH,
        drawW: c.w * full.drawW,
        drawH: c.h * full.drawH,
    };
}

function place(els, canvas, active) {
    const full = canvas && active ? fullSourceRect(canvas, active) : null;
    const cropC = canvas && active ? cropToCanvasRect(canvas, active) : null;
    const visible = !!(full && cropC);
    els.mask.style.display = visible ? 'block' : 'none';
    els.box.style.display = visible ? 'block' : 'none';
    for (const k of Object.keys(els.handles)) els.handles[k].style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const m = makeMapper(canvas);
    const a = m.canvasToOverlay(cropC.dx, cropC.dy);
    const b = m.canvasToOverlay(cropC.dx + cropC.drawW, cropC.dy + cropC.drawH);
    const w = b.x - a.x, h = b.y - a.y;
    els.box.style.left = `${a.x}px`; els.box.style.top = `${a.y}px`;
    els.box.style.width = `${w}px`; els.box.style.height = `${h}px`;
    const fa = m.canvasToOverlay(full.dx, full.dy);
    const fb = m.canvasToOverlay(full.dx + full.drawW, full.dy + full.drawH);
    els.mask.style.left = `${fa.x}px`; els.mask.style.top = `${fa.y}px`;
    els.mask.style.width = `${fb.x - fa.x}px`;
    els.mask.style.height = `${fb.y - fa.y}px`;
    els.mask.style.setProperty('--cx', `${a.x - fa.x}px`);
    els.mask.style.setProperty('--cy', `${a.y - fa.y}px`);
    els.mask.style.setProperty('--cw', `${w}px`);
    els.mask.style.setProperty('--ch', `${h}px`);
    const corners = {
        nw: [a.x, a.y], n: [a.x + w / 2, a.y], ne: [b.x, a.y],
        e: [b.x, a.y + h / 2], se: [b.x, b.y], s: [a.x + w / 2, b.y],
        sw: [a.x, b.y], w: [a.x, a.y + h / 2],
    };
    for (const id of Object.keys(corners)) {
        els.handles[id].style.left = `${corners[id][0]}px`;
        els.handles[id].style.top = `${corners[id][1]}px`;
    }
}

/** Compute next crop fractions from a drag. */
function computeNextCrop(role, start, dxCv, dyCv) {
    let { x, y, w, h } = start.crop;
    const fx = dxCv / start.full.drawW;
    const fy = dyCv / start.full.drawH;
    if (role === 'box') { x += fx; y += fy; }
    else {
        if (role.includes('w')) { x += fx; w -= fx; }
        if (role.includes('e')) { w += fx; }
        if (role.includes('n')) { y += fy; h -= fy; }
        if (role.includes('s')) { h += fy; }
    }
    if (w < 0.02) w = 0.02;
    if (h < 0.02) h = 0.02;
    x = clamp(x, 0, 1 - w);
    y = clamp(y, 0, 1 - h);
    return clampCrop({ x, y, w, h });
}

/**
 * Mount crop-mode pointer logic. Builds a translucent dim mask around the
 * crop rect (with a cut-out window over the crop itself) plus 8 handles
 * and a draggable interior box.
 *
 * @param {{
 *   layer: HTMLElement,
 *   getCanvas: () => HTMLCanvasElement|null,
 *   getActive: () => object|null,
 *   dispatch: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function mountCropOverlay(cfg) {
    let drag = null;
    function onDown(e, role) {
        const canvas = cfg.getCanvas();
        const active = cfg.getActive();
        if (!canvas || !active) return;
        const full = fullSourceRect(canvas, active);
        if (!full) return;
        e.preventDefault(); e.stopPropagation();
        const m = makeMapper(canvas);
        drag = {
            role, m, canvas, active, full,
            crop: getClipCrop({ crop: active.crop }),
            startX: e.clientX, startY: e.clientY,
        };
        try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }
    function onMove(e) {
        if (!drag) return;
        const dxCv = (e.clientX - drag.startX) * drag.m.sx;
        const dyCv = (e.clientY - drag.startY) * drag.m.sy;
        const next = computeNextCrop(drag.role, drag, dxCv, dyCv);
        next.x = round(next.x, 4); next.y = round(next.y, 4);
        next.w = round(next.w, 4); next.h = round(next.h, 4);
        drag.lastCrop = next;
        cfg.dispatch('crop-requested', { clipId: drag.active.clipId, crop: next, transient: true });
    }
    function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (drag && drag.lastCrop) {
            cfg.dispatch('crop-requested', { clipId: drag.active.clipId, crop: drag.lastCrop });
        }
        drag = null;
        place(els, cfg.getCanvas(), cfg.getActive());
    }
    const els = buildDom(cfg.layer, onDown);
    return {
        refresh() {
            place(els, cfg.getCanvas(), cfg.getActive());
        },
        destroy() {
            els.mask.remove(); els.box.remove();
            for (const k of Object.keys(els.handles)) els.handles[k].remove();
            if (drag) onUp();
        },
    };
}
