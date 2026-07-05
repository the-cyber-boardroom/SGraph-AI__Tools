/**
 * merge-infographic.js
 * Canvas compositor for the "Infographic" vertical layout: 1080×1920 (9:16).
 *
 * Purpose: shorts-style videos where the *shared tab is itself vertical* — e.g.
 * narrating a portrait infographic. TITLE, SCREEN card (shrink-wrapped to its fitted
 * content — no internal letterbox bars), and CAMERA are stacked with uniform gaps
 * and vertically centred as one block, over a date · elapsed · attribution footer
 * pinned at the very bottom. Unnamed recordings drop the title row entirely.
 *
 * Deliberate non-goal — we do NOT stretch/upscale the screen to force it to fill the
 * region. It is drawn "contain" (aspect preserved, letterboxed if it doesn't match).
 * Sizing the recorded tab/window to a tall shape so it fills the frame is left to the
 * user; the live preview renders this exact composite so they can adjust their tab
 * before or during recording.
 *
 * Pumped by startBackgroundSafeTicker + requestFrame (see merge-vertical.js) so it
 * keeps drawing at fps while the recorder tab is hidden.
 *
 * @module merge-infographic
 */

import { startBackgroundSafeTicker, captureCanvasStream } from '/core/sg-capture/v0/v0.1/v0.1.1/sg-capture.js';

// ── Layout constants ────────────────────────────────────────────────────────────

const W           = 1080;
const H           = 1920;
const SIDE_PAD    = 20;
const TOP_PAD     = 28;
const BOT_PAD     = 20;
const GAP         = 16;                // footer breathing room
const EL_GAP      = 24;                // uniform gap between title / screen / camera
const MAX_TITLE_H = 240;               // wrap box for the title (up to ~4 lines at max size)
const CAM_H       = 300;               // centred camera height
const FOOTER_H    = 40;                // date · elapsed · attribution line at the very bottom
const RADIUS      = 14;
const ACCENT      = '#3b82f6';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merge a (vertical) screen stream and a camera stream into a 1080×1920 canvas.
 * Title, screen card (shrink-wrapped to the fitted content — contain, no upscaling,
 * no letterbox bars inside the card), and camera are stacked with uniform gaps and
 * the whole block is vertically centred in the frame, above a small
 * date · elapsed · attribution footer pinned at the very bottom.
 *
 * @param {MediaStream} screenStream
 * @param {MediaStream} cameraStream
 * @param {{ fps?: number, title?: string, startedAt?: number, getElapsedMs?: () => number }} [options]
 *   getElapsedMs — optional live source of the footer clock (excludes paused time).
 * @returns {Promise<{ stream: MediaStream, stop: () => void }>}
 */
export async function mergeAsInfographic(screenStream, cameraStream, options = {}) {
    const { fps = 30, title = '', startedAt = Date.now(), getElapsedMs = null } = options;
    const _elapsedMs = typeof getElapsedMs === 'function'
        ? () => Math.max(0, getElapsedMs())
        : () => Date.now() - startedAt;

    const canvas  = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const sv = _videoEl(screenStream);
    const cv = _videoEl(cameraStream);
    await Promise.all([_ready(sv), _ready(cv)]);

    // ── Fixed geometry (computed once) ─────────────────────────────────────────
    // No placeholder — leave the title blank (and give its space to the screen) when unnamed.
    const TITLE_TXT = title ? _clip(title, 120) : '';
    const hasTitle  = TITLE_TXT.length > 0;

    // Footer pinned at the very bottom; camera keeps its own aspect at CAM_H tall.
    const FOOTER_TOP = H - BOT_PAD - FOOTER_H;
    const cSet       = cameraStream.getVideoTracks()[0]?.getSettings() ?? {};
    const cNatW      = cSet.width  || 1280;
    const cNatH      = cSet.height || 720;
    const CAM_W      = Math.round(CAM_H * (cNatW / cNatH));
    const CAM_X      = Math.round((W - CAM_W) / 2);          // centred horizontally
    const cFit       = _fitInto(cNatW, cNatH, CAM_W, CAM_H);

    // Vertical region available to the title+screen+camera block.
    const SCREEN_MAX_W = W - SIDE_PAD * 2;
    const AVAIL_TOP    = TOP_PAD;
    const AVAIL_BOT    = FOOTER_TOP - GAP;

    // ── Draw loop ──────────────────────────────────────────────────────────────
    // All geometry is recomputed per frame: the screen's natural size can change
    // mid-recording (window resize), which re-fits the card and re-centres the block.
    function draw() {
        ctx.fillStyle = '#0a0a18';
        ctx.fillRect(0, 0, W, H);

        // Measure the title at its final wrap/size so the block uses its real height.
        const titleLayout = hasTitle
            ? _layoutTitle(ctx, TITLE_TXT, W - SIDE_PAD * 2, MAX_TITLE_H)
            : null;
        const titleH = titleLayout ? titleLayout.height : 0;

        // Fit the screen (contain — no upscaling/distortion) into what the block
        // can give it after the title and camera take their share.
        const sSet  = screenStream.getVideoTracks()[0]?.getSettings() ?? {};
        const sNatW = sSet.width  || sv.videoWidth  || 1080;
        const sNatH = sSet.height || sv.videoHeight || 1920;
        const maxScreenH = (AVAIL_BOT - AVAIL_TOP) - CAM_H - EL_GAP - (hasTitle ? titleH + EL_GAP : 0);
        const sFit  = _fitInto(sNatW, sNatH, SCREEN_MAX_W, maxScreenH);

        // Stack title / screen / camera with uniform EL_GAP and centre the whole
        // block vertically — balanced margins instead of a floating title above a
        // bottom-pinned screen+camera.
        const contentH = (hasTitle ? titleH + EL_GAP : 0) + sFit.dh + EL_GAP + CAM_H;
        let y = AVAIL_TOP + Math.max(0, Math.round(((AVAIL_BOT - AVAIL_TOP) - contentH) / 2));

        // ── Title ──
        if (titleLayout) {
            _drawTitle(ctx, titleLayout, W / 2, y);
            y += titleH + EL_GAP;
        }

        // ── Screen — card shrink-wrapped to the fitted content ──
        const SX = Math.round((W - sFit.dw) / 2);
        const SY = y;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(SX, SY, sFit.dw, sFit.dh, RADIUS);
        ctx.clip();
        ctx.fillStyle = '#05050f';                            // shows until first video frame
        ctx.fillRect(SX, SY, sFit.dw, sFit.dh);
        ctx.drawImage(sv, SX, SY, sFit.dw, sFit.dh);
        ctx.restore();
        ctx.strokeStyle = 'rgba(59,130,246,0.35)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.roundRect(SX, SY, sFit.dw, sFit.dh, RADIUS);
        ctx.stroke();
        y = SY + sFit.dh + EL_GAP;

        // ── Camera (centred, directly below the screen) — clip + border + glow ──
        const camY = y;
        ctx.save();
        ctx.shadowColor = 'rgba(59,130,246,0.4)';
        ctx.shadowBlur  = 20;
        ctx.beginPath();
        ctx.roundRect(CAM_X, camY, CAM_W, CAM_H, 12);
        ctx.clip();
        ctx.fillStyle = '#05050f';
        ctx.fillRect(CAM_X, camY, CAM_W, CAM_H);
        ctx.drawImage(cv, CAM_X + cFit.dx, camY + cFit.dy, cFit.dw, cFit.dh);
        ctx.restore();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.roundRect(CAM_X, camY, CAM_W, CAM_H, 12);
        ctx.stroke();

        // ── Footer line (centred, very bottom) ──
        const now     = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        ctx.font         = '20px system-ui, -apple-system, sans-serif';
        ctx.fillStyle    = '#64748b';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${dateStr}  ·  ${_dur(_elapsedMs())}  ·  tools.sgraph.ai`,
                     W / 2, FOOTER_TOP + FOOTER_H / 2);
    }

    // ── Background-safe pump (same mechanism as merge-vertical / sg-capture) ──
    const { stream: canvasStream, videoTrack, pushFrame } = captureCanvasStream(canvas, fps);
    draw();
    pushFrame();
    const stopTicker = startBackgroundSafeTicker(fps, () => { draw(); pushFrame(); });

    // Compositor emits video only; the pipeline attaches the raw audio tracks itself.
    const merged = new MediaStream([videoTrack]);

    return {
        stream: merged,
        stop() {
            stopTicker();
            sv.srcObject = null;
            cv.srcObject = null;
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wrap the title to fit maxW, largest font first, within a box of at most maxBoxH.
 * Falls back to fewer lines / smaller font, ellipsising if it still overflows.
 * Returns the measured layout so the caller can stack it precisely.
 * @returns {{ rows: string[], size: number, lineH: number, height: number }}
 */
function _layoutTitle(ctx, text, maxW, maxBoxH) {
    for (const size of [46, 40, 34, 28, 24]) {
        ctx.font = `bold ${size}px system-ui, -apple-system, sans-serif`;
        const lineH    = Math.round(size * 1.18);
        const maxLines = Math.max(1, Math.floor(maxBoxH / lineH));
        const lines    = _wrap(ctx, text, maxW, maxLines);
        if (lines.overflow && size > 24) continue;   // try a smaller size before ellipsising
        return { rows: lines.rows, size, lineH, height: lines.rows.length * lineH };
    }
}

/** Render a title layout from _layoutTitle, horizontally centred on centerX. */
function _drawTitle(ctx, layout, centerX, topY) {
    ctx.fillStyle    = '#f1f5f9';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${layout.size}px system-ui, -apple-system, sans-serif`;
    let ty = topY;
    for (const row of layout.rows) { ctx.fillText(row, centerX, ty); ty += layout.lineH; }
}

/** Greedy word-wrap into at most maxLines; ellipsises the last line on overflow. */
function _wrap(ctx, text, maxW, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const rows  = [];
    let line = '';
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width <= maxW || !line) {
            line = test;
        } else {
            rows.push(line); line = w;
            if (rows.length === maxLines) break;
        }
    }
    let overflow = false;
    if (rows.length < maxLines && line) { rows.push(line); line = ''; }
    if (line) overflow = true;                       // words remained after the last line
    // Ellipsise the final row if it (plus remainder) didn't all fit.
    if (overflow && rows.length) {
        let last = rows[rows.length - 1];
        while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
        rows[rows.length - 1] = last + '…';
    }
    return { rows, overflow };
}

/** Letterbox fit: scale srcW×srcH into boxW×boxH, return draw offsets + size. */
function _fitInto(srcW, srcH, boxW, boxH) {
    const scale = Math.min(boxW / srcW, boxH / srcH);
    const dw    = Math.round(srcW * scale);
    const dh    = Math.round(srcH * scale);
    return { dw, dh, dx: Math.round((boxW - dw) / 2), dy: Math.round((boxH - dh) / 2) };
}

function _videoEl(stream) {
    const v = document.createElement('video');
    v.srcObject   = stream;
    v.muted       = true;
    v.playsInline = true;
    v.play().catch(() => {});
    return v;
}

function _ready(v) {
    return new Promise(resolve => {
        if (v.readyState >= 2) { resolve(); return; }
        v.addEventListener('canplay', resolve, { once: true });
    });
}

function _dur(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function _clip(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
