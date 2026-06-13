/**
 * api-source — queue ingest: addFiles / removeItem / clearAll + mic recording.
 *
 * Files added here go through the same path for human and headless callers.
 * Recording uses core/sg-audio as a single continuous take (one large segment;
 * any delivered chunks are concatenated into one blob on stop).
 *
 * @module audio-transcribe/api-source
 */

import { isAudioFile } from './audio-format.js';
import { AT_EVENTS } from './audio-transcribe-events.js';

/** Soft per-item size cap (~25 MB; base64 inflates the request ~33%). */
export const MAX_ITEM_BYTES = 25 * 1024 * 1024;

/**
 * Build the source/ingest methods.
 *
 * @param {object} ctx
 * @param {object} ctx.state - the tool state container.
 * @param {(name: string, detail?: object) => void} ctx.emit - window-event emitter.
 * @param {{ startRecording: Function, stopRecording: Function }} [ctx.recorder]
 *        - injectable recorder (defaults to core/sg-audio at runtime).
 * @returns {object} the ingest methods.
 */
export function buildSourceMethods({ state, emit, recorder }) {
    /** @type {{ session: object, chunks: Blob[], mimeType: string, startedAt: number }|null} */
    let active = null;

    /** Normalise a FileList / File[] / single File into an array. */
    function toFileArray(files) {
        if (!files) return [];
        if (Array.isArray(files)) return files;
        if (typeof files.length === 'number') return Array.from(files);
        return [files];
    }

    /**
     * Batch ingest audio files (incl. .opus). Non-audio and oversize files are
     * rejected per file.
     * @param {{ files: (File[]|FileList) }} params
     * @returns {Promise<{ added: object[], rejected: object[] }>}
     */
    async function addFiles(params = {}) {
        const files = toFileArray(params.files);
        const added = [];
        const rejected = [];
        for (const f of files) {
            if (!isAudioFile(f)) {
                rejected.push({ name: f.name || 'file', code: 'not-audio' });
                continue;
            }
            if ((f.size || 0) > MAX_ITEM_BYTES) {
                rejected.push({ name: f.name || 'file', code: 'too-large' });
                continue;
            }
            const id = state.addItem(f, { name: f.name, mimeType: f.type, origin: 'file' });
            if (id) {
                emit(AT_EVENTS.ITEM_ADDED, { id });
                const it = state.getItem(id);
                added.push({ id, name: it.name, sizeBytes: it.sizeBytes, mimeType: it.mimeType });
            }
        }
        return { added, rejected };
    }

    /**
     * Lazily resolve the recorder (core/sg-audio) unless one was injected.
     * @returns {Promise<{ startRecording: Function, stopRecording: Function }>}
     */
    async function getRecorder() {
        if (recorder) return recorder;
        return import('/core/sg-audio/v0/v0.1/v0.1.0/sg-audio.js');
    }

    /**
     * Begin a single-take mic recording.
     * @param {{ deviceId?: string, mimeType?: string }} [params]
     * @returns {Promise<{ recording: true, mimeType: string }>}
     */
    async function startRecording(params = {}) {
        if (active) throw Object.assign(new Error('Already recording'), { code: 'busy' });
        const rec = await getRecorder();
        const chunks = [];
        const session = await rec.startRecording({
            // One continuous take: large segment so chunks aren't split mid-record.
            segmentDurationMs: 60 * 60 * 1000,
            mimeType: params.mimeType,
            onSegment: (seg) => { if (seg && seg.blob) chunks.push(seg.blob); },
            onError: () => {},
        });
        active = { session, chunks, mimeType: session.mimeType, startedAt: Date.now() };
        emit(AT_EVENTS.RECORDING_STARTED, { mimeType: session.mimeType });
        return { recording: true, mimeType: session.mimeType };
    }

    /**
     * Stop recording, assemble one blob, add it as a queue item.
     * @returns {Promise<{ id: string, name: string, sizeBytes: number, mimeType: string, durationMs: number }>}
     */
    async function stopRecording() {
        if (!active) throw Object.assign(new Error('Not recording'), { code: 'not-recording' });
        const rec = await getRecorder();
        const { session, chunks, mimeType, startedAt } = active;
        active = null;
        await rec.stopRecording(session);
        const durationMs = Date.now() - startedAt;
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : (mimeType.includes('ogg') ? 'opus' : 'webm');
        const name = `recording-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
        const id = state.addItem(blob, { name, mimeType, origin: 'recording', durationMs });
        emit(AT_EVENTS.RECORDING_STOPPED, { id });
        if (id) emit(AT_EVENTS.ITEM_ADDED, { id });
        const it = state.getItem(id);
        return { id, name: it.name, sizeBytes: it.sizeBytes, mimeType: it.mimeType, durationMs };
    }

    /** @param {{ id: string }} params @returns {{ removed: true }} */
    function removeItem(params = {}) {
        state.removeItem(params.id);
        emit(AT_EVENTS.ITEM_REMOVED, { id: params.id });
        return { removed: true };
    }

    /** @returns {Array<object>} serialisable queue snapshot. */
    function getItems() { return state.getItems(); }

    /** @param {{ id: string }} params @returns {object|null} */
    function getItem(params = {}) { return state.getItem(params.id); }

    /** @returns {{}} clears the queue + session. */
    function clearAll() {
        state.clear();
        emit(AT_EVENTS.RESET, {});
        return {};
    }

    return { addFiles, startRecording, stopRecording, removeItem, getItems, getItem, clearAll };
}
