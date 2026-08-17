/**
 * Media Probe — Smoke Test (Playwright)
 *
 * Loads the REAL served page, asserts the action surface and the DOM contract,
 * then runs the whole analysis over a screencast the page records itself.
 *
 * THE LOAD-BEARING CASE is the noise floor. The clip is recorded twice: once over
 * true digital silence, and once over a room-tone hum ABOVE the old fixed 0.01
 * threshold. Synthetic silence is exactly what hid the defect this tool exists to
 * expose, so a probe tested only against it would prove nothing. The assertions
 * check that the calibrated threshold rises above the floor, that the threshold
 * table shows 0.01 failing, and that a genuinely unsegmentable recording gets
 * `strategy:'none'` rather than invented boundaries.
 *
 * Usage:
 *   bash scripts/run-locally.sh   (separate terminal)
 *   node tests/playwright/media-probe-smoke.js
 *
 * Env: MEDIA_PROBE_URL (default http://localhost:10063/en-gb/media-probe/),
 *      HEADLESS ('false' to watch), PW_CHROMIUM
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.MEDIA_PROBE_URL || 'http://localhost:10063/en-gb/media-probe/';
const HEADLESS = process.env.HEADLESS !== 'false';

const EXPECTED_ACTIONS = [
    'getStatus', 'loadVideo', 'estimateSweep',
    'analyseAudio', 'analyseFrames', 'cancelSweep', 'analyseAll',
    'setThreshold', 'replaySegmentation', 'findScenes', 'alignSignals',
    'plan', 'compare', 'estimateCost',
    'getProbe', 'getFindings', 'getSceneThumb', 'downloadProbe',
    'runFfmpegLane', 'ffmpegAvailable', 'setConfig', 'reset',
];

let passed = 0, failed = 0;
function ok(l) { console.log(`  ✓ ${l}`); passed++; }
function assert(cond, l, detail = '') { if (cond) ok(l); else throw new Error(`Assertion failed: ${l}${detail ? ' — ' + detail : ''}`); }
function isExternalNoise(t) { return /dev\.sgraph\.ai|unpkg\.com|net::ERR|Failed to load resource/.test(t); }

/**
 * Record a screencast in-page. `floor` adds a constant hum under everything —
 * the difference between a synthetic test and a realistic one.
 */
async function recordClip(page, slides, floor) {
    return page.evaluate(async ([SLIDES, FLOOR]) => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d');
        const paint = s => {
            ctx.fillStyle = s.bg; ctx.fillRect(0, 0, 640, 360);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 64px sans-serif';
            ctx.fillText(s.label, 40, 200);
        };
        paint(SLIDES[0]);

        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = actx.createMediaStreamDestination();
        const gain = actx.createGain(); gain.gain.value = 0;
        // "Speech" must be BROADBAND, not a tone. A sawtooth is a set of discrete
        // harmonics and measures as LESS spectrally flat than a 60 Hz hum, which
        // would make the flatness metric look broken when it is the test signal
        // that is unrepresentative. Real speech is broadband, so this is noise
        // plus a voiced component.
        const noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const noise = actx.createBufferSource();
        noise.buffer = noiseBuf; noise.loop = true;
        const nGain = actx.createGain(); nGain.gain.value = 0.7;
        noise.connect(nGain); nGain.connect(gain); noise.start();
        const osc = actx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
        const oGain = actx.createGain(); oGain.gain.value = 0.3;
        osc.connect(oGain); oGain.connect(gain); gain.connect(dest); osc.start();
        let nz = null;
        if (FLOOR) {
            nz = actx.createOscillator(); nz.type = 'sine'; nz.frequency.value = 60;
            const ng = actx.createGain(); ng.gain.value = FLOOR;
            nz.connect(ng); ng.connect(dest); nz.start();
        }
        const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
        const chunks = []; const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        rec.start(200);
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const on = () => gain.gain.setValueAtTime(0.35, actx.currentTime);
        const off = () => gain.gain.setValueAtTime(0, actx.currentTime);
        await wait(300);
        for (const s of SLIDES) {
            paint(s); await wait(s.leadMs); on(); await wait(s.speechMs); off(); await wait(s.pauseMs);
        }
        rec.stop(); await new Promise(r => { rec.onstop = r; });
        osc.stop(); noise.stop(); if (nz) nz.stop(); await actx.close();
        window.__clip = new Blob(chunks, { type: 'video/webm' });
        return { bytes: window.__clip.size };
    }, [slides, floor || 0]);
}

const SLIDES = [
    { label: 'ONE',   bg: '#123a63', leadMs: 500, speechMs: 1800, pauseMs: 1500 },
    { label: 'TWO',   bg: '#7a1e2e', leadMs: 600, speechMs: 1800, pauseMs: 1500 },
    { label: 'THREE', bg: '#1e6b3a', leadMs: 500, speechMs: 1800, pauseMs: 1200 },
];

async function run() {
    console.log('\nmedia-probe smoke\n');
    const browser = await chromium.launch({
        headless: HEADLESS,
        args: ['--autoplay-policy=no-user-gesture-required'],
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !isExternalNoise(m.text())) errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    try {
        await page.goto(TOOL_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__tool, null, { timeout: 15000 });
        ok('window.__tool published (tool:ready fired)');
        await page.waitForTimeout(800);
        assert(errors.length === 0, 'zero uncaught boot errors', errors.join(' | '));

        const rep = await page.evaluate(names => {
            const t = window.__tool;
            return { missing: names.filter(n => typeof t[n] !== 'function'), isPromise: t.getStatus({}) instanceof Promise };
        }, EXPECTED_ACTIONS);
        assert(rep.missing.length === 0, `all ${EXPECTED_ACTIONS.length} actions registered`, `missing: ${rep.missing.join(',')}`);
        assert(rep.isPromise, 'actions return Promises (SgToolApi contract)');

        for (const sel of ['#mp-drop', '#mp-file', '#mp-run-audio', '#mp-run-frames', '#mp-cancel',
                           '#mp-run-all', '#mp-plan', '#mp-thr', '#mp-canvas', '#mp-hist-energy',
                           '#mp-hist-gaps', '#mp-thr-table', '#mp-shots', '#mp-metric',
                           '#mp-align-plot', '#mp-compare-table', '#mp-findings-body',
                           '#mp-dl-json', '#mp-warnings']) {
            assert(await page.$(sel) !== null, `panel element present: ${sel}`);
        }

        const idle = await page.evaluate(() => window.__tool.getStatus());
        assert(idle.status === 'idle' && !idle.source, 'clean idle status');
        // The distinction the whole tool turns on: not-run is not the same as empty.
        assert(idle.notMeasured.includes('frames-not-run') && idle.notMeasured.includes('audio-not-run'),
            'unrun lanes are reported as unrun, not as empty results');
        const noSrc = await page.evaluate(async () => {
            try { await window.__tool.analyseAudio({}); return { threw: false }; }
            catch (e) { return { threw: true, code: e.code }; }
        });
        assert(noSrc.threw && noSrc.code === 'no-source', 'a lane before loadVideo rejects {code:no-source}');

        // ── Realistic clip: narration over a room-tone floor ──────────────────
        const noisy = await recordClip(page, SLIDES, 0.05);
        assert(noisy.bytes > 5000, 'recorded a screencast over a room-tone floor', `${noisy.bytes} bytes`);

        const loaded = await page.evaluate(() => window.__tool.loadVideo({
            file: new File([window.__clip], 'noisy.webm', { type: 'video/webm' }),
        }));
        assert(loaded.durationMs > 3000, 'duration recovered from a header-less MediaRecorder WebM', `${loaded.durationMs} ms`);
        assert(loaded.width === 640 && loaded.height === 360, 'picture dimensions read');
        assert(loaded.sweepEstimate.samples > 0 && loaded.sweepEstimate.estimatedMs > 0,
            'the sweep cost is estimated BEFORE committing to it');

        const aud = await page.evaluate(() => window.__tool.analyseAudio({}));
        assert(aud.method === 'calibrated from this recording', 'thresholds come from the recording, not a constant', aud.method);
        assert(aud.floor > 0.01, 'the room-tone floor really is above the old fixed 0.01', `floor=${aud.floor.toFixed(4)}`);
        assert(aud.threshold > aud.floor, 'the calibrated threshold sits ABOVE the floor — the whole bug');
        assert(aud.bimodal, 'the energy histogram is bimodal, so a threshold is meaningful');
        assert(aud.topicGaps > 0, 'topic-length gaps exist, so audio-led segmentation is viable', `${aud.topicGaps}`);

        // The table that makes the original failure a one-glance diagnosis.
        const probe1 = await page.evaluate(() => window.__tool.getProbe());
        const legacy = probe1.thresholds.find(t => t.value === 0.01);
        assert(legacy, 'the threshold table always includes the value that failed (0.01)');
        assert(legacy.topicGaps === 0, 'at 0.01 there are ZERO topic gaps on this recording', `${legacy.topicGaps}`);
        const calRow = probe1.thresholds.find(t => Math.abs(t.value - aud.threshold) < 1e-9);
        assert(calRow && calRow.topicGaps > 0, 'at the calibrated threshold topic gaps appear', JSON.stringify(calRow));
        assert(legacy.segments < calRow.segments,
            'at 0.01 segmentation collapses into fewer, undifferentiated blobs',
            `0.01→${legacy.segments} segments vs calibrated→${calRow.segments}`);

        // At this clip's length (~12 s) a blob never reaches the 30 s cap, so the
        // force-cut cannot appear — that is correct behaviour, not a pass. Shorten
        // the cap so the SAME condition bites, which is what happens naturally on
        // a recording longer than maxUtteranceMs (the real screencast was 4m21s).
        const scaled = await page.evaluate(async () => ({
            legacy: await window.__tool.replaySegmentation({ silenceThreshold: 0.01, speechThreshold: 0.02, maxUtteranceMs: 4000 }),
            calibrated: await window.__tool.replaySegmentation({ maxUtteranceMs: 4000 }),
        }));
        assert(scaled.legacy.capped > 0,
            'at 0.01, once a blob outlives the cap the VAD force-cuts — the reported failure, reproduced',
            `capped=${scaled.legacy.capped}`);
        assert(scaled.legacy.segments.some(s => s.tEnd - s.tStart === 4000),
            'and a segment is exactly the cap length — the tell-tale of an arbitrary boundary');
        assert(scaled.calibrated.capped < scaled.legacy.capped,
            'the calibrated threshold force-cuts less than the fixed one under the same cap',
            `${scaled.calibrated.capped} vs ${scaled.legacy.capped}`);
        assert(probe1.audio.flatness.floorMedian < probe1.audio.flatness.speechMedian,
            'spectral flatness separates narrow-band room tone from broadband speech',
            JSON.stringify(probe1.audio.flatness));

        // ── Frames: four metrics, scenes, agreement ───────────────────────────
        const fr = await page.evaluate(() => window.__tool.analyseFrames({ coarseFps: 4, fineFps: 10 }));
        assert(fr.samples > 10, 'the frame sweep produced a trace', `${fr.samples} samples`);
        assert(fr.passes === 2, 'two-pass sweeping ran');
        for (const m of ['meanAbs', 'blockMax', 'edgeDiff', 'histDist']) {
            assert(typeof fr.p95[m] === 'number', `per-recording p95 computed for ${m}`);
        }
        assert(fr.scenes >= 2, 'the slide changes were detected as scenes', `${fr.scenes}`);
        const probe2 = await page.evaluate(() => window.__tool.getProbe());
        assert(probe2.scenes.scenes.every(s => s.value > 0 && s.metric),
            'every scene carries the metric and value that produced it');
        assert(Object.keys(probe2.scenes.perMetric).length === 4,
            'all four metrics are compared against the reference');

        // Frame difference must see COLOUR, not only brightness. A greyscale-only
        // signature missed a #123a63 → #7a1e2e slide change: a violent colour
        // change whose luma differs by nine levels out of 255. In a screencast that
        // blind spot means a theme switch or a highlighted row passes unnoticed.
        const colour = await page.evaluate(async () => {
            const fm = await import('/core/sg-media-analysis/v0/v0.1/v0.1.0/frame-metrics.js');
            const plane = (r, g, b) => {
                const px = new Uint8ClampedArray(fm.SIG_W * fm.SIG_H * 4);
                for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; }
                return fm.signatureFrom(px);
            };
            const a = plane(0x12, 0x3a, 0x63);          // the two real slide colours
            const b = plane(0x7a, 0x1e, 0x2e);
            const luma = x => (x[0] * 0.299 + x[1] * 0.587 + x[2] * 0.114);
            return {
                d: fm.diff(a, b),
                lumaGap: Math.abs(luma([0x12, 0x3a, 0x63]) - luma([0x7a, 0x1e, 0x2e])) / 255,
            };
        });
        assert(colour.lumaGap < 0.05, 'the two slide colours really are near-identical in brightness',
            `luma gap ${colour.lumaGap.toFixed(3)}`);
        assert(colour.d.blockMax > 0.3 && colour.d.meanAbs > 0.3,
            'but the metrics see the COLOUR change — greyscale-only would have missed it',
            JSON.stringify(colour.d));

        const align = await page.evaluate(() => window.__tool.alignSignals({}));
        assert(align.count > 0, 'the picture-leads-words offset was measured', `${align.count} pairings`);
        assert(typeof align.suggestedLeadMs === 'number' && typeof align.suggestedLagMs === 'number',
            'a measured lead/lag window replaces the assumed 2500/1200');

        // ── The plan, and its evidence ────────────────────────────────────────
        const plan = await page.evaluate(() => window.__tool.plan({}));
        assert(plan.strategy === 'audio-led', 'a healthy recording selects audio-led', plan.strategy);
        assert(plan.cuts.length > 1, 'boundaries were proposed', `${plan.cuts.length}`);
        assert(plan.cuts.every(c => c.evidence), 'EVERY cut carries the evidence that produced it');
        assert(plan.cuts.filter(c => c.source === 'silence').length > 0, 'audio-led cuts are backed by real pauses');
        assert(plan.shots.length === plan.cuts.length, 'a shot is proposed per cut');
        assert(plan.estimate.totalUsd > 0 && /nr-video-n16w/.test(plan.basis),
            'the cost estimate names the real session its constants came from');

        const cmp = await page.evaluate(() => window.__tool.compare());
        assert(typeof cmp.today.captures === 'number' && typeof cmp.plan.captures === 'number',
            'compare reports today vs the plan in captures');
        assert(typeof cmp.delta.usd === 'number', 'compare states the difference in money');

        // ── Refusal: a recording with no usable signal at all ─────────────────
        // Forced by an impossible threshold, which is the same shape as a
        // recording whose floor no threshold can get under.
        const refusal = await page.evaluate(async () => {
            const t = window.__tool;
            t.setThreshold({ value: 0.0000001 });          // nothing is ever silent
            t.findScenes({ factor: 500 });                  // nothing is ever a scene
            return t.plan({});
        });
        assert(refusal.strategy === 'none', 'with no usable signal the plan REFUSES', refusal.strategy);
        assert(refusal.cuts.length === 0, 'a refusal proposes no boundaries at all');
        assert(/no usable signal/.test(refusal.reason), 'the refusal says why', refusal.reason);
        assert(refusal.warnings.some(w => w.code === 'no-usable-signal'), 'the refusal raises a warning');

        // ── The findings text is honest about what it did not measure ─────────
        const fnd = await page.evaluate(() => window.__tool.getFindings());
        assert(/Not measured/.test(fnd.markdown), 'the findings state what was NOT measured');
        assert(/ffmpeg-not-run/.test(fnd.markdown), 'an unrun lane is named, not silently omitted');

        // ── FFmpeg log parsers (pure — the lane itself needs a CDN) ───────────
        const parsed = await page.evaluate(async () => {
            const m = await import('/core/sg-media-analysis/v0/v0.1/v0.1.0/ffmpeg-lane.js');
            return {
                silence: m.parseSilence('[silencedetect @ x] silence_start: 41.9\n[silencedetect @ x] silence_end: 43.1 | silence_duration: 1.2'),
                scenes: m.parseSceneScores('[Parsed_showinfo_1 @ x] n:12 pts_time:41.2 scene:0.42'),
                loud: m.parseLoudness('  I:         -23.4 LUFS\n  LRA:         7.2 LU'),
                empty: m.parseSilence('nothing useful here'),
            };
        });
        assert(parsed.silence.length === 1 && parsed.silence[0].durationMs === 1200, 'silencedetect log parses');
        assert(parsed.scenes.length === 1 && parsed.scenes[0].score === 0.42, 'scene-score log parses');
        assert(parsed.loud.integratedLufs === -23.4, 'ebur128 log parses');
        assert(parsed.empty.length === 0, 'an unparsable log yields nothing (the caller turns that into ffmpeg-parse)');

        // ── Export shape ─────────────────────────────────────────────────────
        const probe3 = await page.evaluate(() => window.__tool.getProbe());
        assert(probe3.schema.name === 'media-probe/probe' && probe3.schema.version === 1, 'the probe declares its schema');
        assert(Array.isArray(probe3.gaps_in_analysis), 'gaps_in_analysis is always present');
        assert(probe3.frames.trace.every(t => t.sig === undefined), 'working signatures are stripped from the export');

        await page.evaluate(() => window.__tool.reset());
        const after = await page.evaluate(() => window.__tool.getStatus());
        assert(after.status === 'idle' && !after.source, 'reset clears the probe');

        assert(errors.length === 0, 'zero uncaught errors through the whole run', errors.join(' | '));
    } catch (err) {
        console.error(`  ✗ ${err.message}`);
        failed++;
    } finally {
        await browser.close();
    }
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run();
