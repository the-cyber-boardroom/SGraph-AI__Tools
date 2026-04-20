/**
 * sg-audio-viz-draw.js
 * Pure canvas rendering functions for sg-audio-viz.
 * No DOM, no Web Audio, no side-effects — just ctx + data → pixels.
 *
 * Each exported function: drawXxx(ctx, W, H, opts)
 * opts always includes { primary, secondary } plus mode-specific fields.
 *
 * @module sg-audio-viz-draw
 */

// ── Public constants ──────────────────────────────────────────────────────────

export const AUDIO_VIZ_MODES = Object.freeze([
    'waveform', 'bars', 'mirror-bars', 'mirror-wave',
    'circular-wave', 'circular-bars', 'blob',
    'eq-bands', 'mirror-eq', 'smooth-eq',
]);

export const AUDIO_VIZ_EVENTS = Object.freeze({
    SOURCE_SET:   'sg-audio-viz:source-set',
    MODE_CHANGED: 'sg-audio-viz:mode-changed',
    ERROR:        'sg-audio-viz:error',
});

// ── Draw functions ────────────────────────────────────────────────────────────

/** Pulsing ring shown while no source is connected. */
export function drawIdle(ctx, W, H, { primary }) {
    const t = performance.now() / 1000;
    const r = Math.min(W, H) * 0.18 + Math.sin(t * 1.2) * Math.min(W, H) * 0.015;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = primary + '44';
    ctx.lineWidth   = 1.5 * (devicePixelRatio || 1);
    ctx.stroke();
}

/** Classic oscilloscope line — time-domain waveform, gradient coloured. */
export function drawWaveform(ctx, W, H, { timeData, primary, secondary }) {
    const data = timeData;
    const dpr  = devicePixelRatio || 1;

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   primary);
    grad.addColorStop(0.5, secondary);
    grad.addColorStop(1,   primary);

    ctx.beginPath();
    ctx.lineWidth   = 2 * dpr;
    ctx.strokeStyle = grad;
    ctx.lineJoin    = 'round';

    const sliceW = W / data.length;
    for (let i = 0; i < data.length; i++) {
        const y = (data[i] / 128) * (H / 2);
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sliceW, y);
    }
    ctx.stroke();
}

/** Vertical frequency bars. mirror=true reflects symmetrically around centre. */
export function drawBars(ctx, W, H, { freqData, primary, secondary, mirror }) {
    const data  = freqData;
    const dpr   = devicePixelRatio || 1;
    const count = Math.min(data.length, Math.floor(W / (3 * dpr)));
    const barW  = W / count;
    const gap   = Math.max(1, barW * 0.15);
    const step  = Math.floor(data.length / count);

    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0,   primary);
    grad.addColorStop(0.6, secondary);
    grad.addColorStop(1,   '#ffffffcc');

    for (let i = 0; i < count; i++) {
        const v  = data[i * step] / 255;
        const bH = Math.max(2 * dpr, v * (mirror ? H / 2 : H));
        const x  = i * barW + gap / 2;
        ctx.fillStyle = grad;
        if (mirror) {
            ctx.fillRect(x, H / 2 - bH, barW - gap, bH);
            ctx.fillRect(x, H / 2,       barW - gap, bH);
        } else {
            ctx.fillRect(x, H - bH, barW - gap, bH);
        }
    }
}

/**
 * Filled waveform ribbon — time-domain data mapped symmetrically above and
 * below the centre line.
 *
 * Formula: v = |data[i]/128 - 1|  →  y_top = cy − v·amp,  y_bot = cy + v·amp
 */
export function drawMirrorWave(ctx, W, H, { timeData, primary, secondary }) {
    const data = timeData;
    const cy   = H / 2;
    const amp  = H * 0.44;
    const dpr  = devicePixelRatio || 1;
    const len  = data.length;

    ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const v = Math.abs(data[i] / 128 - 1);
        const x = (i / (len - 1)) * W;
        i === 0 ? ctx.moveTo(x, cy - v * amp) : ctx.lineTo(x, cy - v * amp);
    }
    for (let i = len - 1; i >= 0; i--) {
        const v = Math.abs(data[i] / 128 - 1);
        ctx.lineTo((i / (len - 1)) * W, cy + v * amp);
    }
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, 0, 0, H);
    fillGrad.addColorStop(0,   secondary + 'aa');
    fillGrad.addColorStop(0.5, primary   + 'dd');
    fillGrad.addColorStop(1,   secondary + 'aa');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,   primary);
    lineGrad.addColorStop(0.5, secondary);
    lineGrad.addColorStop(1,   primary);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth   = 1.5 * dpr;
    ctx.lineJoin    = 'round';

    for (const sign of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < len; i++) {
            const v = Math.abs(data[i] / 128 - 1);
            const x = (i / (len - 1)) * W;
            const y = cy + sign * v * amp;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

/** Time-domain waveform mapped to a closed circle — voice-bubble shape. */
export function drawCircularWave(ctx, W, H, { timeData, primary, secondary }) {
    const data  = timeData;
    const cx    = W / 2;
    const cy    = H / 2;
    const baseR = Math.min(W, H) * 0.28;
    const ampR  = Math.min(W, H) * 0.16;
    const dpr   = devicePixelRatio || 1;

    const grad = ctx.createRadialGradient(cx, cy, baseR * 0.5, cx, cy, baseR + ampR);
    grad.addColorStop(0, primary);
    grad.addColorStop(1, secondary);

    ctx.beginPath();
    ctx.lineWidth   = 2 * dpr;
    ctx.strokeStyle = grad;

    for (let i = 0; i <= data.length; i++) {
        const v     = data[i % data.length] / 128 - 1;
        const angle = (i / data.length) * Math.PI * 2 - Math.PI / 2;
        const r     = baseR + v * ampR;
        const x     = cx + Math.cos(angle) * r;
        const y     = cy + Math.sin(angle) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
}

/** 128 frequency bars radiating outward from a central disc. */
export function drawCircularBars(ctx, W, H, { freqData, primary, secondary }) {
    const data    = freqData;
    const cx      = W / 2;
    const cy      = H / 2;
    const innerR  = Math.min(W, H) * 0.18;
    const maxBarH = Math.min(W, H) * 0.30;
    const count   = 128;
    const dpr     = devicePixelRatio || 1;
    const step    = Math.floor(data.length / count);

    ctx.lineCap = 'round';

    for (let i = 0; i < count; i++) {
        const v     = data[i * step] / 255;
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const barH  = Math.max(2 * dpr, v * maxBarH);

        ctx.strokeStyle = _blend(primary, secondary, v);
        ctx.lineWidth   = Math.max(dpr, (2 * Math.PI * innerR / count) * 0.65);

        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR,          cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle) * (innerR + barH), cy + Math.sin(angle) * (innerR + barH));
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, innerR * 0.88, 0, Math.PI * 2);
    ctx.fillStyle = primary + '22';
    ctx.fill();
}

/** Organic morphing blob — bass energy drives size, waveform drives outline. */
export function drawBlob(ctx, W, H, { freqData, timeData, primary, secondary }) {
    const cx    = W / 2;
    const cy    = H / 2;
    const baseR = Math.min(W, H) * 0.22;
    const PTS   = 64;

    const bass = _avg(freqData, 0, 8) / 255;
    const R    = baseR * (1 + bass * 0.38);

    const pts = [];
    for (let i = 0; i < PTS; i++) {
        const idx   = Math.floor(i / PTS * timeData.length);
        const v     = timeData[idx] / 128 - 1;
        const angle = (i / PTS) * Math.PI * 2 - Math.PI / 2;
        const r     = Math.max(R * 0.4, R + v * R * 0.45);
        pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }

    ctx.beginPath();
    for (let i = 0; i < PTS; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % PTS];
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        i === 0 ? ctx.moveTo(mx, my) : ctx.quadraticCurveTo(x0, y0, mx, my);
    }
    ctx.closePath();

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
    grad.addColorStop(0,   secondary + 'dd');
    grad.addColorStop(0.6, primary   + 'aa');
    grad.addColorStop(1,   primary   + '11');

    ctx.fillStyle   = grad;
    ctx.fill();
    ctx.strokeStyle = primary + 'bb';
    ctx.lineWidth   = 1.5 * (devicePixelRatio || 1);
    ctx.stroke();
}

/**
 * 64-band logarithmic EQ display — bars spaced log across 20 Hz–22 kHz.
 * mirror=true reflects bars symmetrically above and below the centre line.
 */
export function drawEqBands(ctx, W, H, { freqData, primary, secondary, sampleRate, fftSize, mirror }) {
    const COUNT  = 128;
    const data   = freqData;
    const dpr    = devicePixelRatio || 1;
    const MIN_HZ = 20;
    const MAX_HZ = Math.min(sampleRate / 2, 22050);
    const ratio  = MAX_HZ / MIN_HZ;

    const padX    = W * 0.015;
    const usableW = W - padX * 2;
    const barW    = usableW / COUNT;
    const gap     = Math.max(0.5 * dpr, barW * 0.12);
    const maxBarH = mirror ? H * 0.42 : H * 0.78;
    const baseY   = mirror ? H / 2 : H - H * 0.08;

    for (let i = 0; i < COUNT; i++) {
        const lo  = MIN_HZ * Math.pow(ratio, i / COUNT);
        const hi  = MIN_HZ * Math.pow(ratio, (i + 1) / COUNT);
        const loB = Math.max(0, Math.round(lo * fftSize / sampleRate));
        const hiB = Math.min(data.length - 1, Math.round(hi * fftSize / sampleRate));
        const v   = (hiB >= loB) ? _avg(data, loB, hiB + 1) / 255 : 0;

        const bH = Math.max(1 * dpr, v * maxBarH);
        const x  = padX + i * barW + gap / 2;
        const bW = Math.max(1 * dpr, barW - gap);

        ctx.fillStyle = _blend(primary, secondary, i / (COUNT - 1));

        if (mirror) {
            ctx.fillRect(x, baseY - bH, bW, bH);
            ctx.fillRect(x, baseY,       bW, bH);
        } else {
            ctx.fillRect(x, baseY - bH, bW, bH);
        }
    }
}

/**
 * Smooth EQ — frequency spectrum rendered as a filled smooth bezier ribbon,
 * mirrored symmetrically above and below the centre line.
 *
 * Uses 256 log-spaced sample points for dense frequency resolution, giving
 * an EQ-like frequency profile with the organic flowing feel of mirror-wave.
 * Driven by FFT data (not time-domain waveform).
 */
export function drawSmoothEq(ctx, W, H, { freqData, primary, secondary, sampleRate, fftSize }) {
    const N      = 512;
    const data   = freqData;
    const cy     = H / 2;
    const amp    = H * 0.44;
    const dpr    = devicePixelRatio || 1;
    const MIN_HZ = 20;
    const MAX_HZ = Math.min(sampleRate / 2, 22050);
    const ratio  = MAX_HZ / MIN_HZ;

    // Sample FFT at N log-spaced frequencies
    const vals = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const f   = MIN_HZ * Math.pow(ratio, i / (N - 1));
        const bin = Math.min(data.length - 1, Math.max(0, Math.round(f * fftSize / sampleRate)));
        vals[i]   = data[bin] / 255;
    }

    // Build top/bottom point arrays with centre-line anchors at both ends
    const M   = N + 2;
    const top = new Array(M);
    const bot = new Array(M);
    top[0] = bot[0] = [0, cy];
    top[M - 1] = bot[M - 1] = [W, cy];
    for (let i = 0; i < N; i++) {
        const x   = (i / (N - 1)) * W;
        const off = vals[i] * amp;
        top[i + 1] = [x, cy - off];
        bot[i + 1] = [x, cy + off];
    }

    // ── Filled bezier ribbon ──────────────────────────────────────────────────
    ctx.beginPath();
    _smoothBezier(ctx, top, true,  false);   // top edge: left → right
    _smoothBezier(ctx, bot, false, true);    // bottom edge: right → left
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, 0, 0, H);
    fillGrad.addColorStop(0,   secondary + 'aa');
    fillGrad.addColorStop(0.5, primary   + 'dd');
    fillGrad.addColorStop(1,   secondary + 'aa');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // ── Smooth outline edges ──────────────────────────────────────────────────
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,   primary);
    lineGrad.addColorStop(0.5, secondary);
    lineGrad.addColorStop(1,   primary);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth   = 1.5 * dpr;
    ctx.lineJoin    = 'round';

    ctx.beginPath(); _smoothBezier(ctx, top, true, false); ctx.stroke();
    ctx.beginPath(); _smoothBezier(ctx, bot, true, false); ctx.stroke();
}

// ── Module-private helpers ────────────────────────────────────────────────────

/**
 * Smooth quadratic bezier path through pts using midpoint-as-anchor technique.
 * Each sample is a bezier control point; midpoints between adjacent samples
 * are the anchors. Avoids array allocation by supporting reverse traversal.
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number,number][]} pts
 * @param {boolean} move - true: moveTo first mid; false: lineTo first mid
 * @param {boolean} rev  - traverse pts in reverse order without copying
 */
function _smoothBezier(ctx, pts, move, rev) {
    const n = pts.length;
    if (n < 2) return;
    const p   = rev ? (i => pts[n - 1 - i]) : (i => pts[i]);
    const mx0 = (p(0)[0] + p(1)[0]) / 2;
    const my0 = (p(0)[1] + p(1)[1]) / 2;
    move ? ctx.moveTo(mx0, my0) : ctx.lineTo(mx0, my0);
    for (let i = 1; i < n - 1; i++) {
        const mx = (p(i)[0] + p(i + 1)[0]) / 2;
        const my = (p(i)[1] + p(i + 1)[1]) / 2;
        ctx.quadraticCurveTo(p(i)[0], p(i)[1], mx, my);
    }
    ctx.lineTo(p(n - 1)[0], p(n - 1)[1]);
}

function _avg(arr, start, end) {
    const n = Math.min(end, arr.length) - start;
    if (n <= 0) return 0;
    let sum = 0;
    for (let i = start; i < start + n; i++) sum += arr[i];
    return sum / n;
}

function _blend(hex1, hex2, t) {
    const a = _parseHex(hex1);
    const b = _parseHex(hex2);
    if (!a || !b) return hex1;
    const r  = Math.round(a[0] + (b[0] - a[0]) * t);
    const g  = Math.round(a[1] + (b[1] - a[1]) * t);
    const bv = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bv})`;
}

function _parseHex(hex) {
    let h = (hex ?? '').trim().replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
