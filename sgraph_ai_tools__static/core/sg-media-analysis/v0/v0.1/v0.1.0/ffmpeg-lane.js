/**
 * ffmpeg-lane — the same measurements, computed by FFmpeg, for cross-checking.
 *
 * WHY BOTHER. FFmpeg's `silencedetect` and `select='gt(scene,N)'` filters do
 * exactly what this module's siblings hand-roll, at the recording's NATIVE frame
 * rate rather than at our sampling rate. Having got a hand-rolled silence
 * threshold badly wrong once already, plotting a second independent
 * implementation on the same axis is worth a multi-megabyte WASM load — even if
 * the shipped default never uses it.
 *
 * It also covers what the browser cannot: HEVC `.mov` has no decodable picture in
 * a `<video>` on Chrome/Firefox outside macOS.
 *
 * LOG PARSING IS FRAGILE, AND TREATED AS SUCH. These filters report through
 * stderr, whose format is not a contract. So the raw log is always retained, and
 * a run that parses to nothing reports `ffmpeg-parse` — NEVER "found nothing".
 * Those are different claims, and conflating them is the exact failure mode this
 * whole tool exists to prevent.
 *
 * NOT VERIFIED IN A BROWSER: the FFmpeg WASM build needs the unpkg CDN, which is
 * unreachable from the build container, so these three functions have never been
 * run end to end. The parsers are unit-testable against captured log text and are
 * covered that way.
 *
 * @module sg-media-analysis/ffmpeg-lane
 * @version 0.1.0
 */

const VIDEO_MODULE = '/core/video/v1/v1.0/v1.0.2/sg-video.js';

/** `[silencedetect @ …] silence_start: 41.9` / `silence_end: 43.1 | silence_duration: 1.2` */
export function parseSilence(log) {
    const rows = [];
    let open = null;
    for (const line of String(log).split('\n')) {
        const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
        if (s) { open = { startMs: Math.round(parseFloat(s[1]) * 1000) }; continue; }
        const e = /silence_end:\s*([\d.]+)(?:.*silence_duration:\s*([\d.]+))?/.exec(line);
        if (e) {
            const endMs = Math.round(parseFloat(e[1]) * 1000);
            const durationMs = e[2] ? Math.round(parseFloat(e[2]) * 1000) : (open ? endMs - open.startMs : null);
            rows.push({ startMs: open ? open.startMs : endMs - (durationMs || 0), endMs, durationMs });
            open = null;
        }
    }
    return rows;
}

/** `[Parsed_showinfo_1 @ …] n: 12 pts_time:41.2 … scene:0.42` (scene only when tagged) */
export function parseSceneScores(log) {
    const rows = [];
    for (const line of String(log).split('\n')) {
        const t = /pts_time:\s*([\d.]+)/.exec(line);
        if (!t) continue;
        const s = /scene(?:_score)?:\s*([\d.]+)/.exec(line);
        rows.push({ atMs: Math.round(parseFloat(t[1]) * 1000), score: s ? parseFloat(s[1]) : null });
    }
    return rows;
}

/** `I:  -23.4 LUFS` / `LRA:  7.2 LU` from ebur128's summary block. */
export function parseLoudness(log) {
    const i = /I:\s*(-?[\d.]+)\s*LUFS/.exec(String(log));
    const lra = /LRA:\s*([\d.]+)\s*LU/.exec(String(log));
    const peak = /Peak:\s*(-?[\d.]+)\s*dBFS/.exec(String(log));
    if (!i && !lra && !peak) return null;
    return {
        integratedLufs: i ? parseFloat(i[1]) : null,
        loudnessRangeLu: lra ? parseFloat(lra[1]) : null,
        truePeakDbfs: peak ? parseFloat(peak[1]) : null,
    };
}

/** Run one FFmpeg analysis pass and capture its log. */
async function runPass(file, args, onProgress) {
    const { loadFFmpeg } = await import(VIDEO_MODULE);
    const ffmpeg = await loadFFmpeg(onProgress);
    const lines = [];
    const collect = ({ message }) => lines.push(message);
    ffmpeg.on('log', collect);
    const name = file.name || 'input.mp4';
    try {
        await ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));
        await ffmpeg.exec(['-i', name, ...args, '-f', 'null', '-']);
    } finally {
        try { ffmpeg.off('log', collect); } catch (_) { /* older builds */ }
        try { await ffmpeg.deleteFile(name); } catch (_) { /* */ }
    }
    return lines.join('\n');
}

/**
 * @param {Blob} file
 * @param {{ what: 'silence'|'scene'|'loudness', noiseDb?, minSilenceS?, sceneThreshold?, onProgress? }} p
 * @returns {Promise<{ what, rows, parsed, raw }>}
 */
export async function runFfmpegLane(file, p = {}) {
    const what = p.what || 'silence';
    const args = {
        silence: ['-af', `silencedetect=n=${p.noiseDb ?? -30}dB:d=${p.minSilenceS ?? 0.5}`, '-vn'],
        scene: ['-vf', `select='gt(scene,${p.sceneThreshold ?? 0.05})',showinfo`, '-an'],
        loudness: ['-af', 'ebur128', '-vn'],
    }[what];
    if (!args) throw Object.assign(new Error(`unknown lane: ${what}`), { code: 'bad-params' });

    const raw = await runPass(file, args, p.onProgress);
    const parsed = what === 'silence' ? parseSilence(raw)
        : what === 'scene' ? parseSceneScores(raw)
            : parseLoudness(raw);
    const rows = Array.isArray(parsed) ? parsed.length : (parsed ? 1 : 0);
    if (!rows) {
        // The distinction that matters: FFmpeg ran and we could not read it.
        throw Object.assign(
            new Error(`FFmpeg produced no parsable ${what} output — this is a PARSE failure, not an empty result`),
            { code: 'ffmpeg-parse', raw });
    }
    return { what, rows, parsed, raw };
}
