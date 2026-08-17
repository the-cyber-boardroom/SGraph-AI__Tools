/**
 * Narrated Review — Video Import Smoke Test (Playwright)
 *
 * Exercises the THIRD ingest path end to end with no network and no gestures:
 * the page records a synthetic screencast in-browser (a canvas that switches
 * between coloured "slides", plus an oscillator gated on and off to stand in for
 * speech and pauses), hands it to `importVideo()`, and asserts that the pauses
 * became capture boundaries and each capture picked up the slide it is about.
 *
 * What this CANNOT prove: that the lead/lag frame heuristic is tuned for real
 * narration. Synthetic slides change instantly and completely; a real screencast
 * fades, scrolls and animates. The thresholds still need a probe against a real
 * recording — see the v0.2.87 pack, Phase 0.
 *
 * Usage:
 *   node tests/playwright/narrated-review-video-smoke.js
 *
 * Env: NARRATED_REVIEW_URL, HEADLESS ('false' to watch), PW_CHROMIUM
 */

const { chromium } = require('playwright');

const TOOL_URL = process.env.NARRATED_REVIEW_URL || 'http://localhost:10063/en-gb/narrated-review/';
const HEADLESS = process.env.HEADLESS !== 'false';

let passed = 0, failed = 0;
function ok(l) { console.log(`  ✓ ${l}`); passed++; }
function assert(cond, l, detail = '') { if (cond) ok(l); else throw new Error(`Assertion failed: ${l}${detail ? ' — ' + detail : ''}`); }

/**
 * Build a screencast in the page: three slides, each narrated by a burst of
 * tone, separated by real silence. Runs in the browser, returns a webm Blob
 * parked on `window.__clip`.
 */
async function recordClip(page, slides) {
    return page.evaluate(async (SLIDES) => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d');
        const paint = (s) => {
            ctx.fillStyle = s.bg; ctx.fillRect(0, 0, 640, 360);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 64px sans-serif';
            ctx.fillText(s.label, 40, 200);
        };
        paint(SLIDES[0]);

        const AC = window.AudioContext || window.webkitAudioContext;
        const actx = new AC();
        const dest = actx.createMediaStreamDestination();
        const gain = actx.createGain();
        gain.gain.value = 0;
        const osc = actx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = 220;
        osc.connect(gain); gain.connect(dest);
        osc.start();

        const stream = new MediaStream([
            ...canvas.captureStream(30).getVideoTracks(),
            ...dest.stream.getAudioTracks(),
        ]);
        const chunks = [];
        const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        rec.start(200);

        const wait = ms => new Promise(r => setTimeout(r, ms));
        await wait(300);
        const on = () => gain.gain.setValueAtTime(0.35, actx.currentTime);
        const off = () => gain.gain.setValueAtTime(0, actx.currentTime);
        for (const s of SLIDES) {
            if (s.leadMs >= 0) {
                paint(s);                   // the picture LEADS the words…
                await wait(s.leadMs);
                on();                       // …then the words
                await wait(s.speechMs);
            } else {
                on();                       // the speaker starts, THEN switches
                await wait(-s.leadMs);
                paint(s);
                await wait(s.speechMs + s.leadMs);
            }
            off();
            await wait(s.pauseMs);          // a real pause: the segment boundary
            if (s.secondSpeechMs) {         // …but a pause with NO slide change
                gain.gain.setValueAtTime(0.35, actx.currentTime);
                await wait(s.secondSpeechMs);
                gain.gain.setValueAtTime(0, actx.currentTime);
                await wait(s.pauseMs);
            }
        }
        rec.stop();
        await new Promise(r => { rec.onstop = r; });
        osc.stop(); await actx.close();
        window.__clip = new Blob(chunks, { type: 'video/webm' });
        return { bytes: window.__clip.size };
    }, slides);
}

async function run() {
    console.log('\nnarrated-review video-import smoke\n');
    const browser = await chromium.launch({
        headless: HEADLESS,
        args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    try {
        await page.goto(TOOL_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__tool, null, { timeout: 15000 });
        ok('tool booted');

        const slides = [
            { label: 'ONE',   bg: '#123a63', leadMs: 500, speechMs: 1800, pauseMs: 1400 },
            // TWO is the DISCRIMINATING case: the speaker starts talking about it
            // 700 ms BEFORE switching to it. A naive "grab the frame where the
            // words start" would hand this capture slide ONE. Only the lag half
            // of the search window finds the right picture.
            { label: 'TWO',   bg: '#7a1e2e', leadMs: -700, speechMs: 1800, pauseMs: 1400 },
            // THREE is narrated in two bursts with a breath between and NO slide
            // change — two segments that must collapse into one capture.
            { label: 'THREE', bg: '#1e6b3a', leadMs: 400, speechMs: 1500, pauseMs: 1200, secondSpeechMs: 1500 },
        ];
        const clip = await recordClip(page, slides);
        assert(clip.bytes > 5000, 'recorded a synthetic screencast in-page', `${clip.bytes} bytes`);

        assert(await page.$('#nr-video-drop') !== null, 'panel element present: #nr-video-drop');
        assert(await page.$('#nr-video-file') !== null, 'panel element present: #nr-video-file');

        const progress = await page.evaluate(() => new Promise(res => {
            const seen = [];
            const on = e => seen.push(e.detail.step);
            window.addEventListener('nr:video:progress', on);
            window.__tool.importVideo({ file: new File([window.__clip], 'clip.webm', { type: 'video/webm' }) })
                .then(r => { window.removeEventListener('nr:video:progress', on); res({ r, seen }); })
                .catch(err => { window.removeEventListener('nr:video:progress', on); res({ error: err.message, code: err.code, seen }); });
        }));
        assert(!progress.error, 'importVideo completed', `${progress.code}: ${progress.error}`);
        const r = progress.r;
        assert(r.via === 'web-audio', 'audio came out via the free Web Audio path (no FFmpeg needed)', `via=${r.via}`);
        assert(new Set(progress.seen).has('frames'), 'progress reported the frame search');
        assert(r.segments === 4, 'the pauses cut the audio into four spoken segments', `segments=${r.segments}`);
        assert(r.pairs === 3, 'the two segments on one slide became ONE capture', `pairs=${r.pairs}`);

        const pairs = await page.evaluate(() => window.__tool.getPairs());
        assert(pairs.every(p => p.source === 'video'), 'captures are marked source:video');
        assert(pairs.every(p => p.hasScreenshot), 'every capture carries a frame');
        assert(pairs.every(p => p.tEnd > p.tStart), 'every capture has closed, non-empty bounds');
        assert(pairs.every((p, i) => i === 0 || p.tStart >= pairs[i - 1].tStart), 'captures are in time order');
        assert(pairs.every(p => typeof p.videoAt === 'number'), 'every capture records which frame it took');

        // The point of the whole heuristic: the frame must show the slide the
        // words that follow are about, NOT the one before it.
        const labels = await page.evaluate(async () => {
            const out = [];
            for (const p of await window.__tool.getPairs()) {
                const { dataUrl } = await window.__tool.getPairImage({ id: p.id });
                const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = dataUrl; });
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
                // Sample a background pixel well away from the white label text.
                const d = c.getContext('2d').getImageData(600, 330, 1, 1).data;
                out.push([d[0], d[1], d[2]].join(','));
            }
            return out;
        });
        const expected = ['18,58,99', '122,30,46', '30,107,58'];   // the three slide backgrounds
        const near = (a, b) => a.split(',').every((v, i) => Math.abs(Number(v) - Number(b.split(',')[i])) < 40);
        for (let i = 0; i < expected.length; i++) {
            assert(near(labels[i], expected[i]), `capture ${i + 1} shows slide ${i + 1}, not its neighbour`, `got ${labels[i]}, wanted ~${expected[i]}`);
        }
        assert(pairs[1].videoAt > pairs[1].tStart,
            'capture 2 reached FORWARD past the words to find its picture (the naive seek would have failed)',
            `videoAt=${pairs[1].videoAt} tStart=${pairs[1].tStart}`);

        // Candidates are kept so the pick is overridable.
        const cands = await page.evaluate(async () => {
            const ps = await window.__tool.getPairs();
            const c = await window.__tool.getFrameCandidates({ id: ps[1].id });
            const before = ps[1].videoAt;
            const other = c.candidates.find(x => x.at !== before) || c.candidates[0];
            await window.__tool.setFrame({ id: ps[1].id, at: other.at });
            const after = (await window.__tool.getPair({ id: ps[1].id })).videoAt;
            return {
                n: c.candidates.length, chosenAt: c.chosenAt, before, after, wanted: other.at,
                thumbs: c.candidates.filter(x => typeof x.thumb === 'string' && x.thumb.startsWith('data:image/')).length,
            };
        });
        assert(cands.n > 1, 'the frames considered are kept for review', `${cands.n} candidates`);
        assert(cands.thumbs === cands.n, 'every candidate carries a thumbnail', `${cands.thumbs}/${cands.n}`);
        assert(cands.chosenAt === cands.before, 'getFrameCandidates reports which one was picked');
        assert(cands.after === cands.wanted, 'setFrame swaps the capture to another frame', `${cands.before} → ${cands.after}`);

        // And from here it is an ordinary review: the document builds.
        const doc = await page.evaluate(() => window.__tool.buildDocument());
        assert(doc.images.length === 3, 'the document carries all three images');

        assert(errors.length === 0, 'zero uncaught errors', errors.join(' | '));
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
