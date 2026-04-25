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

/** Compute new transform from a drag. Pure; takes canvas-pixel coords. */
function computeNextTransform(role, start, dxCv, dyCv, canvasW, canvasH) {
    const t = { ...start.transform };
    if (role === 'centre') {
        t.x = clamp((start.cxCv + dxCv) / canvasW, 0, 1);
        t.y = clamp((start.cyCv + dyCv) / canvasH, 0, 1);
        return clampTransform(t);
    }
    // Resize from corner/edge — scale relative to the diagonal anchor.
    const ax = role.includes('w') ? 1 : (role.includes('e') ? 0 : 0.5);
    const ay = role.includes('n') ? 1 : (role.includes('s') ? 0 : 0.5);
    const handleX0 = start.dxCv + ax * start.drawW;
    const handleY0 = start.dyCv + ay * start.drawH;
    const newHX = handleX0 + dxCv;
    const newHY = handleY0 + dyCv;
    let newW = start.drawW;
    let newH = start.drawH;
    if (role === 'e' || role === 'w' || role.length === 2) {
        newW = Math.abs((newHX - (start.dxCv + (1 - ax) * start.drawW)));
    }
    if (role === 'n' || role === 's' || role.length === 2) {
        newH = Math.abs((newHY - (start.dyCv + (1 - ay) * start.drawH)));
    }
    const sxRatio = newW / Math.max(1, start.drawW);
    const syRatio = newH / Math.max(1, start.drawH);
    const ratio = (role === 'e' || role === 'w') ? sxRatio
                : (role === 'n' || role === 's') ? syRatio
                : Math.max(sxRatio, syRatio);
    t.scale = start.transform.scale * ratio;
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
        cfg.dispatch('transform-requested', { clipId: drag.active.clipId, transform: next });
    }

    function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        drag = null;
        refresh();
    }

    const els = buildHandles(cfg.layer, onPointerDown);

    function refresh() {
        if (drag) return; // do not jump handles mid-drag
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
