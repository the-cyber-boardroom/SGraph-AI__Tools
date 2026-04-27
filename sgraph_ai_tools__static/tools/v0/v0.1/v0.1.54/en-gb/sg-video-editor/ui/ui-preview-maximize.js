// ui-preview-maximize.js — fullscreen preview overlay for sg-video-editor

import { fmtMmss } from '/components/sg-preview-canvas/v0/v0.1/v0.1.0/preview-transport.js';

const BAR_H = 56;
const BTN_STYLE = 'background:none;color:#fff;border:none;font-size:20px;cursor:pointer;padding:4px 8px;line-height:1;';

function mkBtn(text, title) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = title; b.textContent = text;
    b.style.cssText = BTN_STYLE;
    return b;
}

function buildOverlay({ srcCanvas, getComposer, onClose }) {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:9999;background:#000',
        'display:flex;flex-direction:column;align-items:center',
    ].join(';');

    // ── Mirror canvas ─────────────────────────────────────────────────────
    const mirrorWrap = document.createElement('div');
    mirrorWrap.style.cssText = [
        'flex:1;min-height:0;width:100%',
        'display:flex;align-items:center;justify-content:center;overflow:hidden',
    ].join(';');
    const mirror = document.createElement('canvas');
    mirror.width  = srcCanvas.width  || 1280;
    mirror.height = srcCanvas.height || 720;
    const mCtx = mirror.getContext('2d');
    mirrorWrap.appendChild(mirror);
    overlay.appendChild(mirrorWrap);

    // ── Control bar ───────────────────────────────────────────────────────
    const bar = document.createElement('div');
    bar.style.cssText = [
        `height:${BAR_H}px;flex-shrink:0;width:100%;box-sizing:border-box`,
        'background:rgba(15,8,35,.95);border-top:1px solid rgba(124,58,237,.4)',
        'display:flex;align-items:center;gap:6px;padding:0 12px',
    ].join(';');

    const closeBtn = mkBtn('✕', 'Close (Esc)');
    closeBtn.style.cssText = BTN_STYLE + 'font-size:16px;margin-right:4px;';
    const divider = document.createElement('span');
    divider.style.cssText = 'width:1px;height:20px;background:rgba(255,255,255,.2);flex-shrink:0;';
    const backBtn = mkBtn('⏮', 'Skip to start');
    const playBtn = mkBtn('▶', 'Play / Pause');
    const fwdBtn  = mkBtn('⏭', 'Skip to end');

    const timeEl = document.createElement('span');
    timeEl.style.cssText = 'color:#aaa;font-size:12px;font-family:monospace;white-space:nowrap;min-width:96px;padding:0 4px;';
    timeEl.textContent = '00:00 / 00:00';

    const scrubber = document.createElement('input');
    scrubber.type = 'range'; scrubber.min = '0'; scrubber.max = '10000'; scrubber.value = '0';
    scrubber.style.cssText = 'flex:1;accent-color:#7c3aed;cursor:pointer;height:4px;';

    bar.append(closeBtn, divider, backBtn, playBtn, fwdBtn, timeEl, scrubber);
    overlay.appendChild(bar);

    // ── Letterbox sizing ──────────────────────────────────────────────────
    function resizeMirror() {
        const avW = overlay.clientWidth  || window.innerWidth;
        const avH = Math.max(1, (overlay.clientHeight || window.innerHeight) - BAR_H);
        const sw = mirror.width  || 1;
        const sh = mirror.height || 1;
        const scale = Math.min(avW / sw, avH / sh);
        mirror.style.width  = Math.round(sw * scale) + 'px';
        mirror.style.height = Math.round(sh * scale) + 'px';
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeMirror) : null;
    if (ro) ro.observe(overlay);

    // ── rAF mirror loop ───────────────────────────────────────────────────
    let rafId = null;
    let scrubDragging = false;

    function updateDisplay(cur, dur) {
        timeEl.textContent = `${fmtMmss(cur)} / ${fmtMmss(dur)}`;
        if (!scrubDragging && dur > 0) scrubber.value = String(Math.round((cur / dur) * 10000));
    }

    function tick() {
        rafId = requestAnimationFrame(tick);
        if (srcCanvas.width !== mirror.width || srcCanvas.height !== mirror.height) {
            mirror.width  = srcCanvas.width;
            mirror.height = srcCanvas.height;
            resizeMirror();
        }
        mCtx.drawImage(srcCanvas, 0, 0);
        const c = getComposer();
        if (c && !scrubDragging) {
            updateDisplay(c.getCurrentTime() || 0, c.getDuration() || 0);
            playBtn.textContent = c.isPlaying() ? '⏸' : '▶';
        }
    }

    function onPlayhead(e) {
        const c = getComposer();
        if (!c || scrubDragging) return;
        const t = e && e.detail && Number.isFinite(e.detail.time) ? e.detail.time : 0;
        updateDisplay(t, c.getDuration() || 0);
        playBtn.textContent = c.isPlaying() ? '⏸' : '▶';
    }
    srcCanvas.addEventListener('composer:playhead-changed', onPlayhead);
    srcCanvas.addEventListener('composer:state-changed', onPlayhead);

    // ── Button handlers ───────────────────────────────────────────────────
    closeBtn.addEventListener('click', onClose);
    backBtn.addEventListener('click', () => { const c = getComposer(); if (c) c.seek(0); });
    fwdBtn.addEventListener('click',  () => { const c = getComposer(); if (c) c.seek(c.getDuration()); });
    playBtn.addEventListener('click', () => {
        const c = getComposer(); if (!c) return;
        if (c.isPlaying()) { c.pause(); playBtn.textContent = '▶'; }
        else { c.play(); playBtn.textContent = '⏸'; }
    });

    scrubber.addEventListener('pointerdown', () => { scrubDragging = true; });
    scrubber.addEventListener('input', () => {
        const c = getComposer(); if (!c) return;
        const dur = c.getDuration() || 0;
        timeEl.textContent = `${fmtMmss((Number(scrubber.value) / 10000) * dur)} / ${fmtMmss(dur)}`;
    });
    scrubber.addEventListener('change', () => {
        scrubDragging = false;
        const c = getComposer(); if (!c) return;
        c.seek((Number(scrubber.value) / 10000) * (c.getDuration() || 0));
    });
    scrubber.addEventListener('pointerup', () => { scrubDragging = false; });

    return {
        el: overlay,
        start() { resizeMirror(); rafId = requestAnimationFrame(tick); },
        stop() {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            if (ro) ro.disconnect();
            srcCanvas.removeEventListener('composer:playhead-changed', onPlayhead);
            srcCanvas.removeEventListener('composer:state-changed', onPlayhead);
        },
    };
}

/**
 * Mount an expand button on the preview panel and manage the fullscreen overlay.
 * @param {{ previewPanel: HTMLElement, previewEl: HTMLElement, getComposer: () => object|null }} cfg
 * @returns {{ destroy: () => void }}
 */
export function mountPreviewMaximize({ previewPanel, previewEl, getComposer }) {
    if (!previewPanel || !previewEl) return { destroy() {} };

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.title = 'Expand preview to fullscreen';
    expandBtn.textContent = '⛶';
    expandBtn.style.cssText = [
        'position:absolute;top:6px;right:6px;z-index:10',
        'background:rgba(0,0,0,.6);color:#fff',
        'border:1px solid rgba(255,255,255,.25);border-radius:4px',
        'padding:2px 7px;cursor:pointer;font-size:13px;line-height:1.4',
    ].join(';');
    previewPanel.style.position = 'relative';
    previewPanel.appendChild(expandBtn);

    let overlayHandle = null;

    function openOverlay() {
        if (overlayHandle) return;
        const srcCanvas = previewEl.getCanvas();
        if (!srcCanvas) return;
        overlayHandle = buildOverlay({ srcCanvas, getComposer, onClose: closeOverlay });
        document.body.appendChild(overlayHandle.el);
        overlayHandle.start();
    }
    function closeOverlay() {
        if (!overlayHandle) return;
        overlayHandle.stop();
        try { overlayHandle.el.remove(); } catch (_) {}
        overlayHandle = null;
    }
    expandBtn.addEventListener('click', openOverlay);
    function onKey(e) { if (e.key === 'Escape' && overlayHandle) closeOverlay(); }
    window.addEventListener('keydown', onKey);

    return {
        destroy() {
            closeOverlay();
            window.removeEventListener('keydown', onKey);
            try { expandBtn.remove(); } catch (_) {}
        },
    };
}
