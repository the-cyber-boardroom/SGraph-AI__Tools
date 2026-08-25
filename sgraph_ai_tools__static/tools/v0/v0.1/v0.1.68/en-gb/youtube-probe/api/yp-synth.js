/**
 * yp-synth.js
 * A synthetic TALK, recorded in-page — the fixture the mask hypothesis needs.
 *
 * WHY A NEW FIXTURE AND NOT THE SCREENCAST ONE. Synthetic clips have now hidden
 * two real defects in this project, both times by lacking the very property the
 * code had to survive:
 *
 *   digital silence hid the absolute-threshold bug   → fixed by a room-tone floor
 *   a greyscale-equal palette hid the colour blindness → fixed by real colour change
 *
 * The corresponding trap here is a STILL SPEAKER. A "talk" whose only motion is
 * the slide changing is just a screencast with a picture of a person on it, and
 * masking would test as unnecessary. So the speaker region moves on every single
 * frame — that is the whole point of the fixture, and the assertions in yp-suite
 * are worthless without it.
 *
 * Layouts mirror the three real cases from the pack:
 *   'side'   speaker left, slides right   (the common conference framing)
 *   'pip'    slides full, speaker inset    (screen share with a webcam corner)
 *   'cut'    camera cuts between the two   (the case a fixed mask CANNOT save)
 *
 * @module yp-synth
 */

export const LAYOUTS = Object.freeze(['side', 'pip', 'cut']);

/** Where the slides live in each layout, as fractions — the answer the mask should find. */
export const TRUE_SLIDE_REGION = Object.freeze({
    side: { x: 0.38, y: 0.10, w: 0.58, h: 0.68 },
    pip:  { x: 0.04, y: 0.06, w: 0.92, h: 0.76 },
    cut:  null,                                     // there isn't one, by construction
});

const SLIDES = [
    { label: 'Risk chains',  bg: '#123a63', fg: '#dbeafe' },
    { label: 'The estate',   bg: '#7a1e2e', fg: '#fee2e2' },
    { label: 'Stop control', bg: '#1e6b3a', fg: '#dcfce7' },
    { label: 'Reach',        bg: '#5b2a86', fg: '#f3e8ff' },
];

/**
 * Record a talk-shaped clip.
 *
 * @param {{ layout?, slideCount?, slideMs?, w?, h?, floor?, onProgress? }} opts
 *   `floor` is the room-tone level (default 0.05 — deliberately ABOVE the old
 *   fixed 0.01 threshold, so a run over this clip exercises the calibration).
 * @returns {Promise<{ blob, durationMs, layout, slideChangesMs, trueRegion, w, h }>}
 */
export async function recordTalk(opts = {}) {
    const layout = LAYOUTS.includes(opts.layout) ? opts.layout : 'side';
    const slideCount = Math.min(SLIDES.length, opts.slideCount || 4);
    const slideMs = opts.slideMs || 4000;
    const W = opts.w || 960, H = opts.h || 540;
    const floor = opts.floor != null ? opts.floor : 0.05;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ── Audio: broadband "speech" over a narrow-band room tone ────────────────
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = actx.createMediaStreamDestination();
    const speech = actx.createGain(); speech.gain.value = 0;

    // Speech must be BROADBAND. A tone measures as less spectrally flat than a
    // 60 Hz hum, which would make the flatness metric look broken when it is the
    // fixture that is wrong.
    const nb = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = actx.createBufferSource();
    noise.buffer = nb; noise.loop = true;
    const ng = actx.createGain(); ng.gain.value = 0.7;
    noise.connect(ng); ng.connect(speech); noise.start();
    const voiced = actx.createOscillator();
    voiced.type = 'sawtooth'; voiced.frequency.value = 190;
    const vg = actx.createGain(); vg.gain.value = 0.3;
    voiced.connect(vg); vg.connect(speech); voiced.start();
    speech.connect(dest);

    const hum = actx.createOscillator();
    hum.type = 'sine'; hum.frequency.value = 60;
    const hg = actx.createGain(); hg.gain.value = floor;
    hum.connect(hg); hg.connect(dest); hum.start();

    // ── Painting ──────────────────────────────────────────────────────────────
    let slideIdx = 0;
    let shot = 'wide';                 // 'cut' layout alternates wide ↔ slide
    const t0 = performance.now();

    function paint() {
        const t = performance.now() - t0;
        ctx.fillStyle = '#0b0f18'; ctx.fillRect(0, 0, W, H);
        const s = SLIDES[slideIdx % SLIDES.length];

        const drawSlide = (x, y, w, h) => {
            ctx.fillStyle = s.bg; ctx.fillRect(x, y, w, h);
            ctx.fillStyle = s.fg;
            ctx.font = `bold ${Math.round(h * 0.16)}px system-ui, sans-serif`;
            ctx.fillText(s.label, x + w * 0.06, y + h * 0.42);
            ctx.font = `${Math.round(h * 0.07)}px system-ui, sans-serif`;
            ctx.fillText(`slide ${slideIdx + 1} of ${slideCount}`, x + w * 0.06, y + h * 0.60);
        };
        // The speaker: an ellipse that bobs and gestures EVERY frame. Continuous
        // low-level change is the entire reason this fixture exists.
        const drawSpeaker = (x, y, w, h) => {
            ctx.fillStyle = '#1c2740'; ctx.fillRect(x, y, w, h);
            const bob = Math.sin(t / 380) * h * 0.03;
            const arm = Math.sin(t / 210) * w * 0.22;
            ctx.fillStyle = '#c8a97e';
            ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.34 + bob, w * 0.13, h * 0.12, 0, 0, 7); ctx.fill();
            ctx.fillStyle = '#334155';
            ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.72 + bob, w * 0.24, h * 0.26, 0, 0, 7); ctx.fill();
            ctx.strokeStyle = '#c8a97e'; ctx.lineWidth = Math.max(3, w * 0.035);
            ctx.beginPath();
            ctx.moveTo(x + w / 2, y + h * 0.62 + bob);
            ctx.lineTo(x + w / 2 + arm, y + h * 0.50 + bob);
            ctx.stroke();
        };

        if (layout === 'side') {
            drawSpeaker(W * 0.02, H * 0.10, W * 0.32, H * 0.80);
            const r = TRUE_SLIDE_REGION.side;
            drawSlide(W * r.x, H * r.y, W * r.w, H * r.h);
        } else if (layout === 'pip') {
            const r = TRUE_SLIDE_REGION.pip;
            drawSlide(W * r.x, H * r.y, W * r.w, H * r.h);
            drawSpeaker(W * 0.72, H * 0.60, W * 0.24, H * 0.34);
        } else {
            // 'cut': the camera leaves the slide entirely. No fixed rectangle can
            // work, and the tool is expected to SAY so rather than emit rubbish.
            if (shot === 'wide') drawSpeaker(W * 0.20, H * 0.08, W * 0.60, H * 0.84);
            else drawSlide(W * 0.04, H * 0.08, W * 0.92, H * 0.80);
        }
    }

    const stream = new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...dest.stream.getAudioTracks(),
    ]);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    const paintTimer = setInterval(paint, 33);        // the speaker moves constantly
    paint();
    rec.start(200);

    const wait = ms => new Promise(r => setTimeout(r, ms));
    const slideChangesMs = [];
    const start = performance.now();
    await wait(400);

    for (let i = 0; i < slideCount; i++) {
        if (i > 0) {
            slideIdx = i;
            slideChangesMs.push(Math.round(performance.now() - start));
        }
        // 'cut' alternates shots mid-slide — the picture changes without the
        // slide changing, which is exactly what breaks a naive detector.
        if (layout === 'cut') shot = 'slide';
        speech.gain.setValueAtTime(0.35, actx.currentTime);
        await wait(slideMs * 0.55);
        if (layout === 'cut') shot = 'wide';
        await wait(slideMs * 0.2);
        speech.gain.setValueAtTime(0, actx.currentTime);
        await wait(slideMs * 0.25);                    // a real pause between slides
        opts.onProgress?.({ done: i + 1, total: slideCount });
    }

    clearInterval(paintTimer);
    rec.stop();
    await new Promise(r => { rec.onstop = r; });
    const durationMs = Math.round(performance.now() - start);
    voiced.stop(); noise.stop(); hum.stop();
    try { await actx.close(); } catch (_) { /* */ }

    return {
        blob: new Blob(chunks, { type: 'video/webm' }),
        durationMs, layout, slideChangesMs,
        trueRegion: TRUE_SLIDE_REGION[layout], w: W, h: H,
    };
}
