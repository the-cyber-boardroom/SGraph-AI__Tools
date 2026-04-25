/**
 * merge-vertical.js
 * Canvas compositor for the "Shorts" layout: 1080×1920 (9:16) vertical video.
 *
 * Layout (top → bottom):
 *   TOP_SAFE   — black zone so content clears YouTube's top playback controls
 *   Screen     — rounded border + same accent colour as camera
 *   Title      — centred between the two videos; font size adapts to text length
 *   Camera     — rounded border + glow
 *   Footer     — date · elapsed · attribution, inside a rounded bordered box
 *   BOT_SAFE   — remaining black (clears YouTube's bottom overlay)
 *
 * The compositor uses setInterval (not rAF) so it keeps drawing at the
 * configured fps even when the recording tab is in the background.
 *
 * @module merge-vertical
 */

// ── Layout constants ──────────────────────────────────────────────────────────

const W        = 1080;
const H        = 1920;
const SIDE_PAD = 24;
const VID_W    = W - SIDE_PAD * 2;   // 1032 px — shared width for screen, camera, footer
const VID_R    = 14;                  // corner radius for all rounded rects
const GAP      = 20;                  // vertical gap between sections
const TOP_SAFE = 180;                 // black above content (clears YouTube top controls)
const TITLE_H  = 72;                  // title zone height
const FOOTER_H = 96;                  // footer zone height
const ACCENT   = '#3b82f6';           // bright blue (borders + glows)
const MAX_VID_H = Math.round(H * 0.35); // cap each video zone to 35 % of canvas (~672 px)

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merge a screen stream and a camera stream into a 1080×1920 "Shorts" canvas.
 *
 * @param {MediaStream} screenStream
 * @param {MediaStream} cameraStream
 * @param {{ fps?: number, title?: string, startedAt?: number }} [options]
 * @returns {Promise<{ stream: MediaStream, stop: () => void }>}
 */
export async function mergeAsShorts(screenStream, cameraStream, options = {}) {
    const { fps = 30, title = '', startedAt = Date.now() } = options;

    const canvas  = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const sv = _videoEl(screenStream);
    const cv = _videoEl(cameraStream);
    await Promise.all([_ready(sv), _ready(cv)]);

    // ── Compute layout from actual track dimensions ────────────────────────────

    const sSet  = screenStream.getVideoTracks()[0]?.getSettings() ?? {};
    const sNatW = sSet.width  || 1920;
    const sNatH = sSet.height || 1080;

    // Screen: derive height from aspect ratio, cap at MAX_VID_H
    const SCREEN_H  = Math.min(Math.round(VID_W * sNatH / sNatW), MAX_VID_H);
    const SCREEN_Y  = TOP_SAFE;
    // Letterbox fit within clip rect (for screens whose aspect doesn't match)
    const sFit = _fitInto(sNatW, sNatH, VID_W, SCREEN_H);

    // Title sits between screen and camera
    const TITLE_Y = SCREEN_Y + SCREEN_H + GAP;

    // Camera: derive height from aspect ratio, cap at MAX_VID_H
    const cSet  = cameraStream.getVideoTracks()[0]?.getSettings() ?? {};
    const cNatW = cSet.width  || 1280;
    const cNatH = cSet.height || 720;

    const CAM_H = Math.min(Math.round(VID_W * cNatH / cNatW), MAX_VID_H);
    const CAM_Y = TITLE_Y + TITLE_H + GAP;
    const cFit  = _fitInto(cNatW, cNatH, VID_W, CAM_H);

    // Footer centred in the remaining space below camera
    const FOOTER_Y = CAM_Y + CAM_H + Math.round((H - CAM_Y - CAM_H - FOOTER_H) / 2);
    // Remaining canvas (FOOTER_Y + FOOTER_H → H) is the bottom safe zone

    // Precompute adaptive font size — title text never changes during recording
    const TITLE_TEXT = _clip(title || 'Recording', 60);
    const TITLE_FS   = _adaptFontSize(ctx, TITLE_TEXT, VID_W - 32);

    // Precompute SG/Send logo geometry for TOP_SAFE zone
    const LOGO_FS   = 52;
    ctx.font        = `bold ${LOGO_FS}px system-ui, -apple-system, sans-serif`;
    const LOGO_SG   = 'SG/';
    const LOGO_SEND = 'Send';
    const LOGO_SGW  = ctx.measureText(LOGO_SG).width;
    const LOGO_TOTW = LOGO_SGW + ctx.measureText(LOGO_SEND).width;
    const LOGO_X    = Math.round((W - LOGO_TOTW) / 2);
    const LOGO_Y    = Math.round(TOP_SAFE / 2);
    const BUILD_VER = window.SGRAPH_BUILD?.appVersion || window.SGRAPH_BUILD?.uiVersion || '';

    // ── Draw loop ─────────────────────────────────────────────────────────────

    function draw() {
        // Full background (covers safe zones + gaps)
        ctx.fillStyle = '#0a0a18';
        ctx.fillRect(0, 0, W, H);

        // ── Top branding (SG/Send logo + version in TOP_SAFE zone) ───────────
        ctx.font         = `bold ${LOGO_FS}px system-ui, -apple-system, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign    = 'left';
        ctx.fillStyle    = '#14b8a6';
        ctx.fillText(LOGO_SG, LOGO_X, LOGO_Y);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(LOGO_SEND, LOGO_X + LOGO_SGW, LOGO_Y);
        if (BUILD_VER) {
            ctx.font      = '20px ui-monospace, SFMono-Regular, monospace';
            ctx.fillStyle = 'rgba(148,163,184,0.65)';
            ctx.textAlign = 'center';
            ctx.fillText(BUILD_VER, W / 2, LOGO_Y + 40);
        }

        // ── Screen (rounded clip + border, no glow — keeps it "content") ─────
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(SIDE_PAD, SCREEN_Y, VID_W, SCREEN_H, VID_R);
        ctx.clip();
        ctx.fillStyle = '#05050f';   // dark bg behind any letterbox bars
        ctx.fillRect(SIDE_PAD, SCREEN_Y, VID_W, SCREEN_H);
        ctx.drawImage(sv,
            SIDE_PAD + sFit.dx, SCREEN_Y + sFit.dy,
            sFit.dw, sFit.dh);
        ctx.restore();
        // Border
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.roundRect(SIDE_PAD, SCREEN_Y, VID_W, SCREEN_H, VID_R);
        ctx.stroke();

        // ── Title (between screen and camera, adaptive size) ─────────────────
        ctx.fillStyle    = '#f1f5f9';
        ctx.font         = `bold ${TITLE_FS}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(TITLE_TEXT, W / 2, TITLE_Y + TITLE_H / 2);

        // ── Camera (rounded clip + border + blue glow) ────────────────────────
        ctx.save();
        ctx.shadowColor = 'rgba(59,130,246,0.4)';
        ctx.shadowBlur  = 24;
        ctx.beginPath();
        ctx.roundRect(SIDE_PAD, CAM_Y, VID_W, CAM_H, VID_R);
        ctx.clip();
        ctx.fillStyle = '#05050f';   // fallback if camera not ready
        ctx.fillRect(SIDE_PAD, CAM_Y, VID_W, CAM_H);
        ctx.drawImage(cv,
            SIDE_PAD + cFit.dx, CAM_Y + cFit.dy,
            cFit.dw, cFit.dh);
        ctx.restore();
        // Border
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.roundRect(SIDE_PAD, CAM_Y, VID_W, CAM_H, VID_R);
        ctx.stroke();

        // ── Footer (rounded rect with fill + border) ──────────────────────────
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.roundRect(SIDE_PAD, FOOTER_Y, VID_W, FOOTER_H, VID_R);
        ctx.fill();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.roundRect(SIDE_PAD, FOOTER_Y, VID_W, FOOTER_H, VID_R);
        ctx.stroke();

        // Footer text — all centred
        const elapsed = _dur(Date.now() - startedAt);
        const now     = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        const ROW1 = FOOTER_Y + Math.round(FOOTER_H * 0.33);
        const ROW2 = FOOTER_Y + Math.round(FOOTER_H * 0.72);

        ctx.textBaseline = 'middle';
        ctx.textAlign    = 'center';
        ctx.font         = '22px system-ui, -apple-system, sans-serif';
        ctx.fillStyle    = '#94a3b8';
        ctx.fillText(`${dateStr}  ${timeStr}  ·  ${elapsed}`, W / 2, ROW1);

        ctx.font      = '19px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('Recorded with tools.sgraph.ai', W / 2, ROW2);
    }

    const intervalId = setInterval(draw, Math.round(1000 / fps));
    draw();

    const canvasStream = canvas.captureStream(fps);
    const audioTracks  = [
        ...screenStream.getAudioTracks(),
        ...cameraStream.getAudioTracks(),
    ];
    const merged = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

    return {
        stream: merged,
        stop() {
            clearInterval(intervalId);
            sv.srcObject = null;
            cv.srcObject = null;
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Letterbox fit: scale srcW×srcH into boxW×boxH, return draw offsets + size.
 * @returns {{ dw:number, dh:number, dx:number, dy:number }}
 */
function _fitInto(srcW, srcH, boxW, boxH) {
    const scale = Math.min(boxW / srcW, boxH / srcH);
    const dw    = Math.round(srcW * scale);
    const dh    = Math.round(srcH * scale);
    return { dw, dh, dx: Math.round((boxW - dw) / 2), dy: Math.round((boxH - dh) / 2) };
}

/**
 * Find the largest font size (px) at which text fits within maxWidth.
 * Tries even sizes from maxSize down to minSize.
 * @returns {number}
 */
function _adaptFontSize(ctx, text, maxWidth, maxSize = 34, minSize = 14) {
    for (let size = maxSize; size >= minSize; size -= 2) {
        ctx.font = `bold ${size}px system-ui, sans-serif`;
        if (ctx.measureText(text).width <= maxWidth) return size;
    }
    return minSize;
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
