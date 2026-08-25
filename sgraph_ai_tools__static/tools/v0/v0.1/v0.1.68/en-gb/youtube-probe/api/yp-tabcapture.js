/**
 * yp-tabcapture.js
 * Route C, probed: can we capture a YouTube tab's PICTURE and its AUDIO?
 *
 * WHY THIS IS THE ONE THAT MATTERS FOR THIRD-PARTY VIDEOS. For a video you did
 * not upload, `captions.download` is owner-only and Studio has nothing to give
 * you. Tab capture is the only remaining route — it is screen recording of your
 * own viewing, which is what a screen recorder does. So if this probe fails, the
 * "other people's videos" half of the use case has no path at all, and that is
 * worth knowing in ten seconds rather than at the end of a build.
 *
 * THE THING THAT ACTUALLY FAILS. `getDisplayMedia({audio:true})` is a REQUEST, not
 * a guarantee: the user must pick a TAB (not a window or a screen) and tick "share
 * tab audio", and support outside Chromium is patchy. A returned stream with zero
 * audio tracks is the normal failure, and it is silent — so this probe checks the
 * track count first and measures real energy second. A stream that carries an
 * audio track of pure digital silence would pass a naive check and fail in
 * practice; that is precisely the class of mistake this project keeps paying for.
 *
 * @module yp-tabcapture
 */

/**
 * @param {{ seconds?: number, onProgress?: Function }} p
 * @returns {Promise<{ video, audio, frames, rms, verdict }>}
 */
export async function probeTabCapture(p = {}) {
    const seconds = Math.max(2, Math.min(30, p.seconds || 8));
    if (!navigator.mediaDevices?.getDisplayMedia) {
        throw Object.assign(new Error('getDisplayMedia is unavailable in this browser'), { code: 'unsupported' });
    }

    let stream;
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            // A hint only — the user can still pick a window or a whole screen,
            // and only a TAB can carry audio.
            preferCurrentTab: false,
        });
    } catch (err) {
        throw Object.assign(new Error(err.message || 'share cancelled'), { code: 'share-refused' });
    }

    const vTracks = stream.getVideoTracks();
    const aTracks = stream.getAudioTracks();
    const settings = vTracks[0]?.getSettings?.() || {};
    const surface = settings.displaySurface || vTracks[0]?.label || 'unknown';

    const out = {
        video: { tracks: vTracks.length, width: settings.width || 0, height: settings.height || 0, surface },
        audio: { tracks: aTracks.length, label: aTracks[0]?.label || null },
        frames: 0, rms: { max: 0, mean: 0, silentRatio: 1 }, verdict: null,
    };

    // A hidden <video> is the frame source, exactly as narrated-review's live path
    // uses one — this probe is deliberately the same shape as the real ingest.
    const el = document.createElement('video');
    el.muted = true; el.autoplay = true; el.playsInline = true;
    el.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
    el.srcObject = stream;
    document.body.appendChild(el);
    await new Promise(r => { if (el.readyState >= 2) r(); else { el.onloadeddata = r; el.play().catch(() => {}); } });

    // Audio energy, if there is any audio at all.
    let actx = null, analyser = null, buf = null;
    if (aTracks.length) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        const src = actx.createMediaStreamSource(new MediaStream(aTracks));
        analyser = actx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        buf = new Float32Array(analyser.fftSize);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 18;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastSig = null, changed = 0;
    const rmsSamples = [];
    const t0 = performance.now();

    while (performance.now() - t0 < seconds * 1000) {
        await new Promise(r => setTimeout(r, 100));
        if (el.videoWidth) {
            ctx.drawImage(el, 0, 0, 32, 18);
            const d = ctx.getImageData(0, 0, 32, 18).data;
            out.frames += 1;
            // Is the picture LIVE, or a frozen first frame? A still tab and a
            // dead stream look identical on a single grab.
            if (lastSig) {
                let sum = 0;
                for (let i = 0; i < d.length; i += 4) sum += Math.abs(d[i] - lastSig[i]);
                if (sum / (d.length / 4 * 255) > 0.002) changed += 1;
            }
            lastSig = d.slice();
        }
        if (analyser) {
            analyser.getFloatTimeDomainData(buf);
            let s = 0;
            for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
            rmsSamples.push(Math.sqrt(s / buf.length));
        }
        p.onProgress?.({ elapsedMs: Math.round(performance.now() - t0), totalMs: seconds * 1000 });
    }

    if (rmsSamples.length) {
        const max = Math.max(...rmsSamples);
        const mean = rmsSamples.reduce((a, b) => a + b, 0) / rmsSamples.length;
        out.rms = {
            max, mean,
            silentRatio: rmsSamples.filter(v => v < 0.0005).length / rmsSamples.length,
        };
    }
    out.frameChangeRatio = out.frames > 1 ? changed / (out.frames - 1) : 0;

    // Clean up before verdict — a probe that leaves a tab share running is rude.
    for (const t of stream.getTracks()) t.stop();
    try { el.srcObject = null; el.remove(); } catch (_) { /* */ }
    if (actx) { try { await actx.close(); } catch (_) { /* */ } }

    out.verdict = !vTracks.length ? 'no-video'
        : !aTracks.length ? 'no-audio-track'
            : out.rms.max < 0.001 ? 'audio-track-but-silent'
                : out.frameChangeRatio < 0.05 ? 'audio-ok-picture-static'
                    : 'ok';
    out.surfaceIsTab = /tab|browser/i.test(surface);
    return out;
}

/** What each verdict means for the pack — kept beside the codes that produce it. */
export const VERDICTS = Object.freeze({
    'ok': 'Route C works here: picture and audio both live. Third-party videos are reachable.',
    'no-video': 'No video track at all — the share was refused or produced nothing.',
    'no-audio-track': 'Picture only. You almost certainly shared a WINDOW or SCREEN rather than a TAB, or did not tick "share tab audio". Only a tab can carry audio.',
    'audio-track-but-silent': 'An audio track exists but carries no energy — the tab was muted, paused, or is not the one playing.',
    'audio-ok-picture-static': 'Audio is live but the picture never changed — the shared tab is probably not the one playing the video.',
});
