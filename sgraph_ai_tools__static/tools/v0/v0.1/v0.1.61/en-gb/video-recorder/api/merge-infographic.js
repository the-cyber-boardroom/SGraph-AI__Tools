/**
 * merge-infographic.js
 * Canvas compositor for the "Infographic" vertical layout: 1080×1920 (9:16).
 *
 * Purpose: shorts-style videos where the *shared tab is itself vertical* — e.g.
 * narrating a portrait infographic. Layout top→bottom: TITLE band (reclaims the space
 * a wide-ish tab would otherwise letterbox above the screen), SCREEN maximised in the
 * middle, and the CAMERA centred along the bottom with a date · elapsed · attribution
 * footer. When the recording is unnamed the title band collapses so the screen grows.
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

const W          = 1080;
const H          = 1920;
const SIDE_PAD   = 20;
const TOP_PAD    = 28;
const BOT_PAD    = 20;
const GAP        = 16;
const TITLE_H    = 210;                // top band reserved for the title (when present)
const CAM_H      = 300;                // centred camera height at the bottom
const FOOTER_H   = 40;                 // date · elapsed · attribution line at the very bottom
const RADIUS     = 14;
const ACCENT     = '#3b82f6';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merge a (vertical) screen stream and a camera stream into a 1080×1920 canvas laid
 * out top→bottom as: title (top band — uses the space a tall screen would otherwise
 * letterbox), screen maximised in the middle (contain, no upscaling/distortion), and
 * the camera centred along the bottom, with a small date · elapsed · attribution
 * footer. When the recording is unnamed the title band collapses and the screen grows.
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
    // No placeholder — leave the title blank (and collapse its band) when unnamed.
    const TITLE_TXT = title ? _clip(title, 120) : '';
    const hasTitle  = TITLE_TXT.length > 0;

    // Title band at the top (collapses to nothing when there is no title).
    const TITLE_Y      = TOP_PAD;
    const TITLE_BAND_H = hasTitle ? TITLE_H : 0;

    // Footer + centred camera along the bottom.
    const FOOTER_TOP = H - BOT_PAD - FOOTER_H;
    const cSet       = cameraStream.getVideoTracks()[0]?.getSettings() ?? {};
    const cNatW      = cSet.width  || 1280;
    const cNatH      = cSet.height || 720;
    const CAM_W      = Math.round(CAM_H * (cNatW / cNatH));  // camera keeps its own aspect
    const CAM_X      = Math.round((W - CAM_W) / 2);          // centred horizontally
    const CAM_Y      = FOOTER_TOP - GAP - CAM_H;
    const cFit       = _fitInto(cNatW, cNatH, CAM_W, CAM_H);

    // Screen fills everything between the title band and the camera.
    const SCREEN_X = SIDE_PAD;
    const SCREEN_Y = TITLE_Y + TITLE_BAND_H + (hasTitle ? GAP : 0);
    const SCREEN_W = W - SIDE_PAD * 2;
    const SCREEN_H = (CAM_Y - GAP) - SCREEN_Y;

    // ── Draw loop ──────────────────────────────────────────────────────────────
    function draw() {
        ctx.fillStyle = '#0a0a18';
        ctx.fillRect(0, 0, W, H);

        // ── Title (top band, centred, wrapped, adaptive) ──
        if (hasTitle) {
            _drawWrappedTitle(ctx, TITLE_TXT, W / 2, TITLE_Y, W - SIDE_PAD * 2, TITLE_BAND_H, 'center');
        }

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

        // ── Camera (bottom, centred) — rounded clip + border + glow ──
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
 * Draw a title wrapped to fit maxW, largest font first, vertically centred within
 * boxH. Falls back to fewer lines / smaller font, ellipsising if it still overflows.
 */
function _drawWrappedTitle(ctx, text, x, y, maxW, boxH, align = 'left') {
    if (!text) return;   // no placeholder when the recording is unnamed
    ctx.fillStyle    = '#f1f5f9';
    ctx.textAlign    = align;   // when 'center', x is the centre X
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
