/**
 * nr-video.js
 * Video import — the third way into the capture list.
 *
 * Narrated review has always been "a screenshot, the words about it, and the
 * alignment between them". There are three ways to produce that pair and only
 * the first differs:
 *
 *   1. LIVE   — share a screen, talk, press NEXT   (nr-capture + nr-marker)
 *   2. AUTHOR — write one by hand                  (nr-edit insertPair)
 *   3. VIDEO  — hand over a recording and let the pauses do the pressing (here)
 *
 * Everything after the capture list is identical: transcribe, clean, edit,
 * reorder, chat, document, PDF, zip, vault. That is why this is an INGEST MODE
 * and not a second tool.
 *
 * The pipeline:
 *   audio out of the video  → PCM store (nr-capture.importRecording)
 *   pauses → segments       → core/sg-live-capture createVad over the RMS log
 *   segment → frame         → nr-frames.findFrame (lead/lag window + settle)
 *   same frame twice        → one capture (grouping)
 *   captures                → the ordinary transcribe/clean lanes
 *
 * The boundaries here are STRUCTURAL — they come from cutting the audio at real
 * silences, not from asking a model where the sentences are. That is the same
 * discipline as the live path, where a press is snapped back to a sustained
 * pause rather than trusted verbatim.
 *
 * @module nr-video
 */

import { createVad } from '/core/sg-live-capture/v0/v0.1/v0.1.0/live-vad.js';
import { state, getPairById } from './nr-state.js';
import * as Cap from './nr-capture.js';
import * as Frames from './nr-frames.js';

const VIDEO_MODULE = '/core/video/v1/v1.0/v1.0.2/sg-video.js';

/** Defaults for the whole ingest — every one is overridable per call. */
export const VIDEO_DEFAULTS = Object.freeze({
    // Segmentation. Longer than a live VAD's endpoint (600 ms) on purpose: we
    // want topic-sized segments, not sentence-sized ones, because a capture is a
    // screen the speaker dwelt on. Over-cutting is recoverable — the grouping
    // step below merges neighbours that turned out to share a frame.
    endpointMs: 900,
    speechThreshold: 0.02,
    silenceThreshold: 0.01,
    preRollMs: 250,
    minSpeechMs: 400,
    maxUtteranceMs: 30000,
    // Frame search. The picture LEADS the words, so the window starts well
    // before speech and only trails it a little.
    leadMs: 2500,
    lagMs: 1200,
    stepMs: 400,
    changeThreshold: 0.02,   // signature diff that counts as "the screen changed"
    mergeThreshold: 0.01,    // below this, two segments are about the same screen
});

/**
 * Get the video's audio into the PCM store.
 *
 * Fast path first: browsers will happily `decodeAudioData` the audio track of a
 * plain `.mp4`/`.webm`, which costs nothing. Only when that fails do we pay for
 * FFmpeg WASM (a multi-megabyte CDN load and a slow decode) — which is the case
 * for containers the Web Audio decoder won't touch.
 */
async function extractAudioToStore(file, emit) {
    try {
        const info = await Cap.importRecording(file);
        return { info, audio: null, via: 'web-audio' };
    } catch (_) { /* not directly decodable — fall through to FFmpeg */ }

    emit('nr:video:progress', { step: 'audio', message: 'Loading FFmpeg to extract the audio track…' });
    const { loadFFmpeg, extractAudio } = await import(VIDEO_MODULE);
    let blob;
    try {
        const ffmpeg = await loadFFmpeg(r => emit('nr:video:progress', { step: 'audio', ratio: r && r.ratio }));
        ({ blob } = await extractAudio(ffmpeg, file));
    } catch (err) {
        throw Object.assign(new Error(`Could not extract audio from this video: ${err.message}`), { code: 'not-audio' });
    }
    const info = await Cap.importRecording(blob);
    return { info, audio: blob, via: 'ffmpeg' };
}

/**
 * Cut the loaded audio at its silences.
 *
 * We push the RMS log through the promoted VAD with EMPTY sample frames on
 * purpose: the state machine only needs the energy to decide where the
 * utterances are, and the audio itself is already in the PCM store, sliced
 * later by `[tStart, tEnd]`. Feeding it the real samples would just build (and
 * throw away) a second copy of the whole recording.
 *
 * @returns {Array<{ tStart: number, tEnd: number }>}
 */
function segmentSpeech(opts) {
    const frameMs = Cap.getFrameMs();
    const empty = new Float32Array(0);
    const segments = [];
    const vad = createVad({
        frameMs,
        speechThreshold: opts.speechThreshold, silenceThreshold: opts.silenceThreshold,
        endpointMs: opts.endpointMs, preRollMs: opts.preRollMs,
        minSpeechMs: opts.minSpeechMs, maxUtteranceMs: opts.maxUtteranceMs,
        onUtterance: (_pcm, meta) => segments.push({ tStart: meta.startMs, tEnd: meta.startMs + meta.durationMs }),
    });
    for (const rms of Cap.rmsLog()) vad.pushFrame(rms, empty);
    vad.flush();
    return segments;
}

/**
 * Merge neighbouring segments that landed on the same picture.
 *
 * A speaker pausing for breath mid-explanation produces two segments about one
 * screen. Splitting the document there would be an artefact of the VAD, not of
 * the review — so when two adjacent segments chose visually identical frames,
 * they become one capture spanning both.
 */
function groupBySameFrame(picked, mergeThreshold) {
    const groups = [];
    for (const seg of picked) {
        const last = groups[groups.length - 1];
        if (last && Frames.sigDiff(last.sig, seg.sig) <= mergeThreshold) {
            last.tEnd = seg.tEnd;
            last.merged += 1;
            continue;
        }
        groups.push({ tStart: seg.tStart, tEnd: seg.tEnd, at: seg.at, sig: seg.sig, candidates: seg.candidates, merged: 1 });
    }
    return groups;
}

/**
 * Import a video as a set of captures.
 *
 * @param {{ file: Blob }} p  plus any VIDEO_DEFAULTS override
 * @param {Function} emit
 * @param {{ markSpan: Function }} marker
 * @returns {Promise<{ pairs: number, segments: number, durationMs: number, via: string }>}
 */
export async function importVideo(p = {}, emit = () => {}, marker) {
    const file = p.file;
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw Object.assign(new Error('importVideo needs { file }'), { code: 'bad-params' });
    }
    const opts = { ...VIDEO_DEFAULTS, ...p };

    state.reset();
    Frames.closeVideo();
    const meta = await Frames.openVideo(file);
    emit('nr:video:started', { name: file.name || 'video', ...meta });

    emit('nr:video:progress', { step: 'audio', message: 'Extracting the audio…' });
    const { info, audio, via } = await extractAudioToStore(file, emit);
    meta.durationMs = Frames.setDurationMs(info.durationMs);

    state.sessionId = `nr-video-${Math.random().toString(36).slice(2, 6)}`;
    state.startedAt = Date.now();
    state.status = 'processing';
    state.durationMs = Math.max(info.durationMs, meta.durationMs);
    state.screen = { width: meta.width, height: meta.height };
    state.takeSource = 'video';
    state.take = audio ? { blob: audio, mimeType: audio.type || 'audio/mp4' } : null;
    state.video = { name: file.name || 'video', size: file.size || 0, ...meta };

    const segments = segmentSpeech(opts);
    emit('nr:video:progress', { step: 'segments', done: segments.length, total: segments.length, message: `${segments.length} spoken segments` });
    if (!segments.length) {
        throw Object.assign(new Error('No speech found in this video — nothing to build captures from'), { code: 'no-speech' });
    }

    // One frame search per segment. This is the slow part (a seek + two draws
    // per sample), so it reports progress per segment.
    const picked = [];
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const found = await Frames.findFrame(seg.tStart, opts);
        picked.push({ ...seg, at: found.candidates[found.chosen].at, sig: found.sig, candidates: found.candidates });
        emit('nr:video:progress', { step: 'frames', done: i + 1, total: segments.length });
    }

    const groups = groupBySameFrame(picked, opts.mergeThreshold);
    emit('nr:video:progress', { step: 'captures', done: 0, total: groups.length, message: `${groups.length} captures` });

    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const image = await Frames.grabAt(g.at);
        const pair = marker.markSpan({ tStart: g.tStart, tEnd: g.tEnd, tPress: g.at, image, source: 'video' });
        pair.videoAt = g.at;
        pair.frameCandidates = g.candidates;
        emit('nr:video:progress', { step: 'captures', done: i + 1, total: groups.length });
    }

    state.status = 'reviewing';
    const out = { pairs: state.pairs.length, segments: segments.length, durationMs: state.durationMs, via };
    emit('nr:video:complete', out);
    return out;
}

/**
 * The frames that were considered for a capture, so the pick can be overridden.
 * @param {{ id: string }} p
 * @returns {{ id, chosenAt, candidates: Array<{at, thumb}> }}
 */
export function getFrameCandidates(p = {}) {
    const pair = getPairById(p.id);
    if (!pair) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
    return { id: pair.id, chosenAt: pair.videoAt ?? null, candidates: pair.frameCandidates || [] };
}

/**
 * Replace a capture's screenshot with the frame at another point in the video.
 * Any `at` is allowed, not just a sampled candidate — the strip is a shortcut,
 * not a menu.
 * @param {{ id: string, at: number }} p
 * @param {Function} emit
 */
export async function setFrame(p = {}, emit = () => {}) {
    const pair = getPairById(p.id);
    if (!pair) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
    if (typeof p.at !== 'number' || !(p.at >= 0)) throw Object.assign(new Error('setFrame needs { at } in ms'), { code: 'bad-params' });
    if (!Frames.hasVideo()) throw Object.assign(new Error('The source video is no longer loaded — re-import it to change frames'), { code: 'no-video' });
    pair.screenshot = await Frames.grabAt(p.at);
    pair.videoAt = Math.round(p.at);
    emit('nr:pair:updated', { id: pair.id, field: 'screenshot' });
    return { id: pair.id, at: pair.videoAt };
}

/** Drop the video frame source (reset). */
export function clearVideo() { Frames.closeVideo(); }

/** @returns {object|null} the attached video, if any. */
export function videoInfo() { return Frames.videoInfo(); }
