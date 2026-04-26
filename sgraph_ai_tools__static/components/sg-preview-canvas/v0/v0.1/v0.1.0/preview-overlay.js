// preview-overlay.js — overlay layer that renders move/crop handles (v0.1.0)

import { mountMoveOverlay } from './preview-overlay-move.js';
import { mountCropOverlay } from './preview-overlay-crop.js';
import { activeClipCanvasRect, makeMapper } from './preview-overlay-utils.js';

/**
 * Build the overlay DOM (a div absolutely positioned to match the canvas
 * display rect) and switch between Select / Move / Crop sub-renders. The
 * overlay layer itself is `pointer-events: none`; only handles inside it
 * opt back into pointer events so that clicks pass through in select-mode.
 *
 * @param {{
 *   parent: HTMLElement,
 *   host: HTMLElement,
 *   getCanvas: () => HTMLCanvasElement|null,
 *   getMode: () => string,
 *   getActive: () => object|null,
 * }} cfg
 * @returns {{ root: HTMLElement, refresh: () => void, destroy: () => void }}
 */
export function mountOverlay(cfg) {
    const root = document.createElement('div');
    root.className = 'pco-overlay';
    cfg.parent.appendChild(root);

    // Selection outline — visible whenever a clip is selected (any mode) so
    // the user can always see WHICH clip is being edited / shown in the
    // Properties panel. In Move/Crop mode the handles add to the cue; in
    // Select mode this is the only visual indicator.
    const selectLayer = document.createElement('div');
    selectLayer.className = 'pco-layer pco-layer--select';
    const selectBox = document.createElement('div');
    selectBox.className = 'pco-select-box';
    selectLayer.appendChild(selectBox);
    root.appendChild(selectLayer);

    const moveLayer = document.createElement('div');
    moveLayer.className = 'pco-layer pco-layer--move';
    root.appendChild(moveLayer);

    const cropLayer = document.createElement('div');
    cropLayer.className = 'pco-layer pco-layer--crop';
    root.appendChild(cropLayer);

    function dispatch(name, detail) {
        cfg.host.dispatchEvent(new CustomEvent(`sg-preview:${name}`, {
            detail, bubbles: true, composed: true,
        }));
    }

    const move = mountMoveOverlay({
        layer: moveLayer,
        getCanvas: cfg.getCanvas,
        getActive: cfg.getActive,
        dispatch,
    });
    const crop = mountCropOverlay({
        layer: cropLayer,
        getCanvas: cfg.getCanvas,
        getActive: cfg.getActive,
        dispatch,
    });

    function syncSize() {
        const canvas = cfg.getCanvas();
        if (!canvas) return;
        const r = canvas.getBoundingClientRect();
        const parentRect = cfg.parent.getBoundingClientRect();
        root.style.left = `${r.left - parentRect.left}px`;
        root.style.top = `${r.top - parentRect.top}px`;
        root.style.width = `${r.width}px`;
        root.style.height = `${r.height}px`;
    }

    function placeSelect(active) {
        const canvas = cfg.getCanvas();
        const rect = canvas && active ? activeClipCanvasRect(canvas, active) : null;
        if (!rect || !canvas) { selectBox.style.display = 'none'; return; }
        const m = makeMapper(canvas);
        const a = m.canvasToOverlay(rect.dx, rect.dy);
        const b = m.canvasToOverlay(rect.dx + rect.drawW, rect.dy + rect.drawH);
        selectBox.style.display = 'block';
        selectBox.style.left = `${a.x}px`;
        selectBox.style.top = `${a.y}px`;
        selectBox.style.width = `${b.x - a.x}px`;
        selectBox.style.height = `${b.y - a.y}px`;
    }

    function refresh() {
        syncSize();
        const mode = cfg.getMode();
        const active = cfg.getActive();
        const showMove = mode === 'move' && !!active;
        const showCrop = mode === 'crop' && !!active;
        const showSelect = !!active;
        selectLayer.style.display = showSelect ? 'block' : 'none';
        moveLayer.style.display = showMove ? 'block' : 'none';
        cropLayer.style.display = showCrop ? 'block' : 'none';
        if (showSelect) placeSelect(active);
        if (showMove) move.refresh();
        if (showCrop) crop.refresh();
    }

    let resizeObs = null;
    if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(() => refresh());
        resizeObs.observe(cfg.parent);
        const c = cfg.getCanvas();
        if (c) resizeObs.observe(c);
    }
    const onWinResize = () => refresh();
    window.addEventListener('resize', onWinResize);

    function destroy() {
        if (resizeObs) { try { resizeObs.disconnect(); } catch (_) {} resizeObs = null; }
        window.removeEventListener('resize', onWinResize);
        try { move.destroy(); } catch (_) {}
        try { crop.destroy(); } catch (_) {}
        root.remove();
    }

    refresh();
    return { root, refresh, destroy };
}
