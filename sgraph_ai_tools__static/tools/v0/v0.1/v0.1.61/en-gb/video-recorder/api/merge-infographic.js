/**
 * merge-infographic.js
 * Canvas compositor for the "Infographic" vertical layout: 1080×1920 (9:16).
 *
 * Purpose: shorts-style videos where the *shared tab is itself vertical* — e.g.
 * narrating a portrait infographic. Unlike the Shorts layout (which caps the screen
 * at ~35 % and stacks screen / title / camera vertically), this hands the screen the
 * maximum possible area at the top and puts the title + camera SIDE BY SIDE in a
 * compact bottom bar.
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

const W        = 1080;
const H        = 1920;
const SIDE_PAD = 20;
const TOP_PAD  = 20;
const GAP      = 16;
const BAR_H    = 300;                  // bottom camera + title strip
const BAR_PAD  = 16;
const RADIUS   = 14;
const ACCENT   = '#3b82f6';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merge a (vertical) screen stream and a camera stream into a 1080×1920 canvas with
 * the screen maximised on top and title + camera side by side along the bottom.
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
    // Screen region: the whole frame above the bottom bar.
    const SCREEN_X = SIDE_PAD;
    const SCREEN_Y = TOP_PAD;
    const SCREEN_W = W - SIDE_PAD * 2;
    const SCREEN_H = H - TOP_PAD - BAR_H - GAP;

    // Bottom bar: camera (left, aspect-preserved) + title (right).
    const BAR_Y     = H - BAR_H;
    const cSet      = cameraStream.getVideoTracks()[0]?.getSettings() ?? {};
    const cNatW     = cSet.width  || 1280;
    const cNatH     = cSet.height || 720;
    const CAM_H     = BAR_H - BAR_PAD * 2;
    const CAM_W     = Math.round(CAM_H * (cNatW / cNatH));   // camera keeps its own aspect
    const CAM_X     = SIDE_PAD;
    const CAM_Y     = BAR_Y + BAR_PAD;
    const cFit      = _fitInto(cNatW, cNatH, CAM_W, CAM_H);

    const TITLE_X   = CAM_X + CAM_W + GAP;
    const TITLE_W   = W - SIDE_PAD - TITLE_X;
    // No placeholder — leave the title blank when the user didn't name the recording.
    const TITLE_TXT = title ? _clip(title, 120) : '';

    // ── Draw loop ──────────────────────────────────────────────────────────────
    function draw() {
        ctx.fillStyle = '#0a0a18';
        ctx.fillRect(0, 0, W, H);

        // ── Screen — contain (no upscaling/distortion), clipped to a rounded card ──
        // Read natural size each frame; a shared window can be resized mid-recording.
        const sSet  = screenStream.getVideoTracks()[0]?.getSettings() ?? {};
        const sNatW = sSet.width  || sv.videoWidth  || 1080;
        const sNatH = sSet.height || sv.videoHeight || 1920;
        const sFit  = _fitInto(sNatW, sNatH, SCREEN_W, SCREEN_H);

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, RADIUS);
        ctx.clip();
        ctx.fillStyle = '#05050f';                       // letterbox bars behind the fit
        ctx.fillRect(SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H);
        ctx.drawImage(sv, SCREEN_X + sFit.dx, SCREEN_Y + sFit.dy, sFit.dw, sFit.dh);
        ctx.restore();
        ctx.strokeStyle = 'rgba(59,130,246,0.35)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.roundRect(SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, RADIUS);
        ctx.stroke();

        // ── Camera (bottom-left) — rounded clip + border + glow ──
        ctx.save();
        ctx.shadowColor = 'rgba(59,130,246,0.4)';
        ctx.shadowBlur  = 20;
        ctx.beginPath();
        ctx.roundRect(CAM_X, CAM_Y, CAM_W, CAM_H, 12);
        ctx.clip();
        ctx.fillStyle = '#05050f';
        ctx.fillRect(CAM_X, CAM_Y, CAM_W, CAM_H);
        ctx.drawImage(cv, CAM_X + cFit.dx, CAM_Y + cFit.dy, cFit.dw, cFit.dh);
        ctx.restore();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.roundRect(CAM_X, CAM_Y, CAM_W, CAM_H, 12);
        ctx.stroke();

        // ── Title (bottom-right of camera) — wrapped, adaptive size ──
        const FOOTER_H = 30;
        const titleTop = CAM_Y;
        const titleBot = CAM_Y + CAM_H - FOOTER_H;
        _drawWrappedTitle(ctx, TITLE_TXT, TITLE_X, titleTop, TITLE_W, titleBot - titleTop);

        // ── Footer line under the title ──
        const now     = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        ctx.font         = '20px system-ui, -apple-system, sans-serif';
        ctx.fillStyle    = '#64748b';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`${dateStr}  ·  ${_dur(_elapsedMs())}  ·  tools.sgraph.ai`,
                     TITLE_X, CAM_Y + CAM_H - 6);
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
 * Draw a title wrapped to fit maxW, largest font first, vertically centred within
 * boxH. Falls back to fewer lines / smaller font, ellipsising if it still overflows.
 */
function _drawWrappedTitle(ctx, text, x, y, maxW, boxH) {
    if (!text) return;   // no placeholder when the recording is unnamed
    ctx.fillStyle    = '#f1f5f9';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';

    for (const size of [46, 40, 34, 28, 24]) {
        ctx.font = `bold ${size}px system-ui, -apple-system, sans-serif`;
        const lineH   = Math.round(size * 1.18);
        const maxLines = Math.max(1, Math.floor(boxH / lineH));
        const lines    = _wrap(ctx, text, maxW, maxLines);
        if (lines.overflow && size > 24) continue;   // try a smaller size before ellipsising
        const blockH = lines.rows.length * lineH;
        let ty = y + Math.round((boxH - blockH) / 2);
        for (const row of lines.rows) { ctx.fillText(row, x, ty); ty += lineH; }
        return;
    }
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
