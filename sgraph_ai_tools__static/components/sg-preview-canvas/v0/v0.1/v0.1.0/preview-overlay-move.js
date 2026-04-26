// preview-overlay-move.js — move + scale drag logic for preview overlay (v0.1.0)

import { clampTransform } from '/core/video-composer/v0/v0.1/v0.1.0/composer-clip-fields.js';
import { makeMapper, activeClipCanvasRect, clamp, round } from './preview-overlay-utils.js';

const HANDLE_DEFS = [
    { id: 'nw', cursor: 'nwse-resize', sx: 0, sy: 0 },
    { id: 'n',  cursor: 'ns-resize',   sx: 0.5, sy: 0 },
    { id: 'ne', cursor: 'nesw-resize', sx: 1, sy: 0 },
    { id: 'e',  cursor: 'ew-resize',   sx: 1, sy: 0.5 },
    { id: 'se', cursor: 'nwse-resize', sx: 1, sy: 1 },
    { id: 's',  cursor: 'ns-resize',   sx: 0.5, sy: 1 },
    { id: 'sw', cursor: 'nesw-resize', sx: 0, sy: 1 },
    { id: 'w',  cursor: 'ew-resize',   sx: 0, sy: 0.5 },
];

/** Build the 8 corner/edge handles + the centre handle. */
function buildHandles(parent, onPointerDown) {
    const els = {};
    for (const def of HANDLE_DEFS) {
        const h = document.createElement('div');
        h.className = `pco-handle pco-handle--${def.id}`;
        h.style.cursor = def.cursor;
        h.dataset.role = def.id;
        h.addEventListener('pointerdown', (e) => onPointerDown(e, def.id));
        parent.appendChild(h);
        els[def.id] = h;
    }
    const centre = document.createElement('div');
    centre.className = 'pco-handle pco-handle--centre';
    centre.style.cursor = 'move';
    centre.dataset.role = 'centre';
    centre.addEventListener('pointerdown', (e) => onPointerDown(e, 'centre'));
    parent.appendChild(centre);
    els.centre = centre;
    return els;
}

/** Position handles in overlay-local pixel coords given the rendered rect. */
function placeHandles(els, ovrRect) {
    if (!ovrRect) {
        for (const k of Object.keys(els)) els[k].style.display = 'none';
        return;
    }
    for (const def of HANDLE_DEFS) {
        const el = els[def.id];
        el.style.display = 'block';
        el.style.left = `${ovrRect.dx + def.sx * ovrRect.drawW}px`;
        el.style.top = `${ovrRect.dy + def.sy * ovrRect.drawH}px`;
    }
    els.centre.style.display = 'block';
    els.centre.style.left = `${ovrRect.dx + ovrRect.drawW / 2}px`;
    els.centre.style.top = `${ovrRect.dy + ovrRect.drawH / 2}px`;
}

/** Read crop fractions from a drag's captured active clip; defaults to full. */
function dragCrop(start) {
    const c = (start && start.crop && typeof start.crop === 'object') ? start.crop : null;
    return {
        cx: (c && Number.isFinite(c.x)) ? c.x : 0,
        cy: (c && Number.isFinite(c.y)) ? c.y : 0,
        cw: (c && Number.isFinite(c.w) && c.w > 0) ? c.w : 1,
        ch: (c && Number.isFinite(c.h) && c.h > 0) ? c.h : 1,
    };
}

/** Compute new transform from a drag. Pure; takes canvas-pixel coords. */
function computeNextTransform(role, start, dxCv, dyCv, canvasW, canvasH) {
    const t = { ...start.transform };
    const { cx, cy, cw, ch } = dragCrop(start);
    if (role === 'centre') {
        // Centre handle moves the VISIBLE rect's centre; t.x/y are the FULL
        // image's centre. With a partial crop the two differ — convert via
        // `fullDrawW = drawW / cw` and the visible-centre's full-rect offset.
        const newVisCx = start.cxCv + dxCv;
        const newVisCy = start.cyCv + dyCv;
        const fullDrawW = start.drawW / cw;
        const fullDrawH = start.drawH / ch;
        const newCx = newVisCx + fullDrawW * (0.5 - cx - cw / 2);
        const newCy = newVisCy + fullDrawH * (0.5 - cy - ch / 2);
        t.x = clamp(newCx / canvasW, 0, 1);
        t.y = clamp(newCy / canvasH, 0, 1);
        return clampTransform(t);
    }
    // Resize from corner/edge — the dragged handle moves with the cursor and
    // the diagonally-opposite anchor stays put. `sx`/`sy` are the handle's
    // fractional position inside the rect (0=left/top, 1=right/bottom, 0.5=mid);
    // the anchor sits at `(1-sx, 1-sy)`.
    const sx = role.includes('w') ? 0 : (role.includes('e') ? 1 : 0.5);
    const sy = role.includes('n') ? 0 : (role.includes('s') ? 1 : 0.5);
    const handleX0 = start.dxCv + sx * start.drawW;
    const handleY0 = start.dyCv + sy * start.drawH;
    const anchorX  = start.dxCv + (1 - sx) * start.drawW;
    const anchorY  = start.dyCv + (1 - sy) * start.drawH;
    const newHX = handleX0 + dxCv;
    const newHY = handleY0 + dyCv;
    let newW = start.drawW;
    let newH = start.drawH;
    if (role === 'e' || role === 'w' || role.length === 2) newW = Math.abs(newHX - anchorX);
    if (role === 'n' || role === 's' || role.length === 2) newH = Math.abs(newHY - anchorY);
    const sxRatio = newW / Math.max(1, start.drawW);
    const syRatio = newH / Math.max(1, start.drawH);
    const ratio = (role === 'e' || role === 'w') ? sxRatio
                : (role === 'n' || role === 's') ? syRatio
                : Math.max(sxRatio, syRatio);
    t.scale = start.transform.scale * ratio;
    // Re-centre so the diagonally-opposite anchor stays put. With a non-default
    // crop the visible rect is a sub-rect of the full source rect, so we
    // recover the full rect dims (`newDraw / cw`) and use the anchor's
    // fractional position on the FULL rect (`cx + (1-sx) * cw`).
    const newFullDrawW = (start.drawW * ratio) / cw;
    const newFullDrawH = (start.drawH * ratio) / ch;
    const newCx = anchorX + newFullDrawW * (0.5 - cx - cw + sx * cw);
    const newCy = anchorY + newFullDrawH * (0.5 - cy - ch + sy * ch);
    t.x = clamp(newCx / canvasW, 0, 1);
    t.y = clamp(newCy / canvasH, 0, 1);
    return clampTransform(t);
}

/**
 * Mount move-mode pointer logic. The caller renders the handles via
 * `place(activeRect)` whenever the active clip / canvas changes.
 *
 * @param {{
 *   layer: HTMLElement,
 *   getCanvas: () => HTMLCanvasElement|null,
 *   getActive: () => object|null,
 *   dispatch: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function mountMoveOverlay(cfg) {
    let drag = null;

    function onPointerDown(e, role) {
        const canvas = cfg.getCanvas();
        const active = cfg.getActive();
        if (!canvas || !active) return;
        const rect = activeClipCanvasRect(canvas, active);
        if (!rect) return;
        e.preventDefault();
        e.stopPropagation();
        const m = makeMapper(canvas);
        drag = {
            role, m, canvas, active,
            startX: e.clientX, startY: e.clientY,
            transform: { ...active.transform },
            crop: active.crop ? { ...active.crop } : null,
            dxCv: rect.dx, dyCv: rect.dy, drawW: rect.drawW, drawH: rect.drawH,
            cxCv: rect.dx + rect.drawW / 2, cyCv: rect.dy + rect.drawH / 2,
            pointerId: e.pointerId,
        };
        try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
        if (!drag) return;
        const dxDisp = e.clientX - drag.startX;
        const dyDisp = e.clientY - drag.startY;
        const dxCv = dxDisp * drag.m.sx;
        const dyCv = dyDisp * drag.m.sy;
        const next = computeNextTransform(drag.role, drag, dxCv, dyCv, drag.canvas.width, drag.canvas.height);
        next.x = round(next.x, 4); next.y = round(next.y, 4); next.scale = round(next.scale, 4);
        drag.lastTransform = next;
        cfg.dispatch('transform-requested', { clipId: drag.active.clipId, transform: next, transient: true });
    }

    function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        if (drag && drag.lastTransform) {
            cfg.dispatch('transform-requested', {
                clipId: drag.active.clipId, transform: drag.lastTransform,
            });
        }
        drag = null;
        refresh();
    }

    const els = buildHandles(cfg.layer, onPointerDown);

    function refresh() {
        const canvas = cfg.getCanvas();
        const active = cfg.getActive();
        const rect = canvas && active ? activeClipCanvasRect(canvas, active) : null;
        const ovrRect = rect ? toOverlay(canvas, rect) : null;
        placeHandles(els, ovrRect);
    }
    function destroy() {
        for (const k of Object.keys(els)) els[k].remove();
        if (drag) onPointerUp();
    }
    return { refresh, destroy };
}

/** Convert a canvas-pixel rect into overlay-local pixels. */
function toOverlay(canvas, rect) {
    const m = makeMapper(canvas);
    const a = m.canvasToOverlay(rect.dx, rect.dy);
    const b = m.canvasToOverlay(rect.dx + rect.drawW, rect.dy + rect.drawH);
    return { dx: a.x, dy: a.y, drawW: b.x - a.x, drawH: b.y - a.y };
}
