/**
 * audio-zip — session bundle → .zip (audio + transcripts + manifest).
 *
 * Reuses the established repo pattern: JSZip lazy-loaded from CDN (copied from
 * heic-converter/api/api-output.js loadJSZip). The bundle contains, per the
 * `include` flags: the original audio files and/or the `.txt` transcripts, plus
 * always a structured `manifest.json` and a human-readable `index.txt` listing
 * per item: original filename, model, durationMs, transcript filename.
 *
 * `buildBundle` is the pure bundler (testable with an injected JSZip); the
 * default `loadJSZip` pulls JSZip from the CDN.
 *
 * @module audio-transcribe/audio-zip
 */

const JSZIP_CDN_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

/** @type {Promise<void>|null} */
let _jszipLoad = null;

/**
 * Lazy-load JSZip via classic <script> tag injection (publishes globalThis.JSZip).
 * @returns {Promise<void>}
 */
export function loadJSZip() {
    if (typeof globalThis !== 'undefined' && globalThis.JSZip) return Promise.resolve();
    if (_jszipLoad) return _jszipLoad;
    _jszipLoad = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${JSZIP_CDN_URL}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load JSZip: ${JSZIP_CDN_URL}`)), { once: true });
            return;
        }
        const tag = document.createElement('script');
        tag.src = JSZIP_CDN_URL;
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error(`Failed to load JSZip: ${JSZIP_CDN_URL}`));
        document.head.appendChild(tag);
    });
    return _jszipLoad;
}

/**
 * Make a filesystem-safe base name for a transcript file from an audio name.
 * @param {string} name @param {string} id @returns {string}
 */
function transcriptBase(name, id) {
    const stem = String(name || id).replace(/\.[a-z0-9]+\s*$/i, '');
    const safe = stem.replace(/[\\/:*?"<>|]+/g, '_').trim();
    return safe || id;
}

/**
 * Build the in-memory bundle structure (audio files / transcript texts / manifest).
 * Pure — does not touch JSZip. Returns the data the zipper writes.
 *
 * @param {object[]} items - raw items (with `blob`) that are `done`.
 * @param {{ audio?: boolean, transcripts?: boolean }} include
 * @returns {{ files: Array<{ name: string, blob?: Blob, text?: string }>, manifest: object, indexTxt: string, transcriptNames: Map<string,string> }}
 */
export function buildBundle(items, include = {}) {
    const wantAudio = include.audio !== false && !!include.audio;
    const wantTranscripts = include.transcripts !== false; // default true
    const files = [];
    const manifestItems = [];
    const indexLines = [];
    const namesSeen = new Map();
    const transcriptNames = new Map();

    /** Disambiguate duplicate names by appending an index before the extension. */
    function uniqueName(name) {
        if (!namesSeen.has(name)) { namesSeen.set(name, 1); return name; }
        const i = namesSeen.get(name) + 1;
        namesSeen.set(name, i);
        const dot = name.lastIndexOf('.');
        return dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
    }

    for (const it of items) {
        const audioName = wantAudio ? uniqueName(it.name) : null;
        if (wantAudio && it.blob) files.push({ name: audioName, blob: it.blob });

        let transcriptName = null;
        if (wantTranscripts) {
            transcriptName = uniqueName(`${transcriptBase(it.name, it.id)}.txt`);
            transcriptNames.set(it.id, transcriptName);
            files.push({ name: transcriptName, text: it.transcript || '' });
        }

        manifestItems.push({
            id: it.id,
            originalFilename: it.name,
            model: it.model,
            durationMs: it.durationMs ?? null,
            audioFilename: audioName,
            transcriptFilename: transcriptName,
        });
        indexLines.push(
            `${it.name}\tmodel=${it.model}\tdurationMs=${it.durationMs ?? ''}\ttranscript=${transcriptName || '(excluded)'}`
        );
    }

    const manifest = {
        tool: 'audio-transcribe',
        created: new Date().toISOString(),
        include: { audio: wantAudio, transcripts: wantTranscripts },
        count: items.length,
        items: manifestItems,
    };
    const indexTxt = `audio-transcribe session — ${manifest.created}\n\n${indexLines.join('\n')}\n`;
    files.push({ name: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
    files.push({ name: 'index.txt', text: indexTxt });

    return { files, manifest, indexTxt, transcriptNames };
}

/**
 * Build a .zip Blob from the bundle. JSZip is injectable for tests.
 *
 * @param {object[]} items - raw `done` items (with `blob`).
 * @param {{ audio?: boolean, transcripts?: boolean }} include
 * @param {{ JSZip?: Function }} [opts] - inject a JSZip constructor (default: load from CDN).
 * @returns {Promise<{ blob: Blob, count: number, manifest: object }>}
 */
export async function buildZip(items, include = {}, opts = {}) {
    const { files, manifest } = buildBundle(items, include);
    let JSZip = opts.JSZip;
    if (!JSZip) {
        await loadJSZip();
        JSZip = globalThis.JSZip;
    }
    if (!JSZip) throw new Error('JSZip not available after load');
    const zip = new JSZip();
    for (const f of files) {
        if (f.blob) zip.file(f.name, f.blob);
        else zip.file(f.name, f.text ?? '');
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    return { blob, count: items.length, manifest };
}
