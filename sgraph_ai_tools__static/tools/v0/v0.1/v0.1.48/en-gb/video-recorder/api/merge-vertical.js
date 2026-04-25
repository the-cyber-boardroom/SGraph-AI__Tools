/**
 * merge-vertical.js
 * Canvas compositor for the "Shorts" layout: 1080×1920 (9:16) vertical video.
 *
 * Layout (top → bottom):
 *   Title bar   — recording name, indigo accent line
 *   Screen zone — screen content letterboxed to full canvas width
 *   Camera zone — camera centred with rounded border and glow
 *   Footer      — date · elapsed time · tools.sgraph.ai attribution
 *
 * The compositor uses setInterval (not rAF) so it keeps drawing at the
 * configured fps even when the recording tab is in the background.
 *
 * @module merge-vertical
 */

// ── Layout constants ──────────────────────────────────────────────────────────

const W         = 1080;
const H         = 1920;
const TITLE_H   = 88;
const FOOTER_H  = 130;
const GAP       = 16;
const SIDE_PAD  = 24;
const CAM_R     = 16;    // camera corner radius (px)
const ACCENT    = '#6366f1';

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

    const sTrack = screenStream.getVideoTracks()[0];
    const sSet   = sTrack?.getSettings() ?? {};
    const sNatW  = sSet.width  || 1920;
    const sNatH  = sSet.height || 1080;

    // Screen zone: fit to full canvas width, cap at 40 % of canvas height
    const screenMaxH  = Math.round(H * 0.40);
    const screenFit   = _fit(sNatW, sNatH, W, screenMaxH);
    const SCREEN_ZONE_H = screenFit.dh;   // actual rendered height (≤ screenMaxH)
    const SCREEN_Y    = TITLE_H + GAP;
    const SCREEN_DX   = Math.round((W - screenFit.dw) / 2);  // letterbox x-offset

    // Camera zone: everything between screen and footer
    const CAM_ZONE_Y  = SCREEN_Y + SCREEN_ZONE_H + GAP;
    const CAM_ZONE_H  = H - CAM_ZONE_Y - FOOTER_H - GAP;

    const cTrack = cameraStream.getVideoTracks()[0];
    const cSet   = cTrack?.getSettings() ?? {};
    const cNatW  = cSet.width  || 1280;
    const cNatH  = cSet.height || 720;

    const camMaxW = W - SIDE_PAD * 2;
    const camMaxH = CAM_ZONE_H - SIDE_PAD * 2;
    const camFit  = _fit(cNatW, cNatH, camMaxW, camMaxH);
    const CAM_X   = SIDE_PAD + Math.round((camMaxW - camFit.dw) / 2);
    const CAM_Y   = CAM_ZONE_Y + Math.round((CAM_ZONE_H - camFit.dh) / 2);

    // ── Draw loop ─────────────────────────────────────────────────────────────

    function draw() {
        // Background
        ctx.fillStyle = '#0a0a18';
        ctx.fillRect(0, 0, W, H);

        // ── Title bar ─────────────────────────────────────────────────────────
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, W, TITLE_H);
        // Indigo bottom accent
        ctx.fillStyle = ACCENT;
        ctx.fillRect(0, TITLE_H - 3, W, 3);
        // Title text
        ctx.fillStyle    = '#f1f5f9';
        ctx.font         = 'bold 30px system-ui, -apple-system, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(_clip(title || 'Recording', 44), W / 2, TITLE_H / 2);

        // ── Screen ────────────────────────────────────────────────────────────
        ctx.fillStyle = '#05050f';
        ctx.fillRect(0, SCREEN_Y, W, SCREEN_ZONE_H);
        ctx.drawImage(sv, SCREEN_DX, SCREEN_Y, screenFit.dw, screenFit.dh);

        // ── Camera (glow + clip + border) ─────────────────────────────────────
        ctx.save();
        ctx.shadowColor = 'rgba(99,102,241,0.35)';
        ctx.shadowBlur  = 22;
        ctx.beginPath();
        ctx.roundRect(CAM_X, CAM_Y, camFit.dw, camFit.dh, CAM_R);
        ctx.clip();
        ctx.drawImage(cv, CAM_X, CAM_Y, camFit.dw, camFit.dh);
        ctx.restore();
        // Border (drawn outside clip so it sits on top)
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.roundRect(CAM_X, CAM_Y, camFit.dw, camFit.dh, CAM_R);
        ctx.stroke();

        // ── Footer ────────────────────────────────────────────────────────────
        const FY = H - FOOTER_H;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, FY, W, FOOTER_H);
        // Indigo top accent
        ctx.fillStyle = ACCENT;
        ctx.fillRect(0, FY, W, 2);

        const elapsed = _dur(Date.now() - startedAt);
        const now     = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        const ROW1 = FY + Math.round(FOOTER_H * 0.33);
        const ROW2 = FY + Math.round(FOOTER_H * 0.70);

        ctx.textBaseline = 'middle';

        // Row 1: date (left) + elapsed (right)
        ctx.font      = '22px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText(`${dateStr}  ${timeStr}`, SIDE_PAD, ROW1);
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'right';
        ctx.fillText(elapsed, W - SIDE_PAD, ROW1);

        // Row 2: attribution (centred)
        ctx.font      = '19px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'center';
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
 * Letterbox fit: scale srcW×srcH to fill as much of maxW×maxH as possible
 * while maintaining aspect ratio. Returns destination width/height only
 * (source is always drawn in full via the 3-arg drawImage form).
 * @returns {{ dw: number, dh: number }}
 */
function _fit(srcW, srcH, maxW, maxH) {
    const scale = Math.min(maxW / srcW, maxH / srcH);
    return { dw: Math.round(srcW * scale), dh: Math.round(srcH * scale) };
}

function _videoEl(stream) {
    const v = document.createElement('video');
    v.srcObject  = stream;
    v.muted      = true;
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
