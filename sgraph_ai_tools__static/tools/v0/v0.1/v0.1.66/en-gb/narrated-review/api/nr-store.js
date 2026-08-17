/**
 * nr-store.js
 * Save a session and pick it up later.
 *
 * Sessions live in `core/sg-vfs` on the IndexedDB provider, so they survive a
 * reload, a crash and closing the tab — which matters most once you can reorder
 * and edit captures, because that work is not in the transcript and cannot be
 * recovered by re-running anything.
 *
 * Layout (one folder per session, mirroring the zip and vault shapes):
 *
 *   /narrated-review/<sessionId>/meta.json       index entry (cheap to list)
 *                               /session.json    the full serialisable session
 *                               /images/pXX.png  screenshots
 *                               /audio/take.webm the continuous take (optional)
 *
 * NOTE ON BINARY: `core/sg-vfs` is text-only — its IndexedDB provider stores
 * `String(content)`, so a Blob written straight in becomes "[object Blob]".
 * Screenshots and the take are therefore stored as base64 data URLs (~33%
 * larger). That is the honest cost of reusing the VFS; a future provider that
 * keeps Blobs natively would drop it with no change here beyond these two
 * helpers.
 *
 * @module nr-store
 */

import { state, config, makePair, resequence } from './nr-state.js';

const VFS_MODULE = '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-core.js';
const IDB_MODULE = '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-provider-indexeddb.js';
const ROOT = '/narrated-review';

let _vfs = null;

/** Lazily open the VFS (IndexedDB). */
async function vfs() {
    if (_vfs) return _vfs;
    const [{ VirtualFileSystem }, { IndexedDbProvider }] = await Promise.all([
        import(VFS_MODULE), import(IDB_MODULE),
    ]);
    // VirtualFileSystem takes the provider positionally.
    const fs = new VirtualFileSystem(new IndexedDbProvider({ dbName: 'sg-narrated-review' }));
    await fs.init();
    _vfs = fs;
    return fs;
}

/** Best-effort folder create (providers differ on "already exists"). */
async function ensureFolder(fs, path) {
    try { await fs.createFolder(path); } catch (_) { /* exists */ }
}

function imageName(p) { return `${p.id}.png.b64`; }

/** Blob → data URL (the VFS stores text only — see the note above). */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error || new Error('read failed'));
        fr.readAsDataURL(blob);
    });
}

/** data URL → Blob. */
async function dataUrlToBlob(dataUrl) {
    return (await fetch(dataUrl)).blob();
}

/**
 * Write the current session to storage.
 * @param {{ name?: string, includeAudio?: boolean }} p
 * @param {Function} emit
 */
export async function saveSession(p = {}, emit = () => {}) {
    if (!state.pairs.length) throw Object.assign(new Error('Nothing to save — no captures'), { code: 'no-session' });
    // Captures can exist without a recording session ever having run (authored
    // with insertPair, or a restored document being re-saved) — mint an id.
    if (!state.sessionId) {
        state.sessionId = `nr-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
        state.startedAt = state.startedAt || Date.now();
    }
    const fs = await vfs();
    const base = `${ROOT}/${state.sessionId}`;
    await ensureFolder(fs, ROOT);
    await ensureFolder(fs, base);
    await ensureFolder(fs, `${base}/images`);

    const includeAudio = p.includeAudio === true;   // the take is by far the largest part
    emit('nr:store:saving', { sessionId: state.sessionId });

    // The full session, with everything the UI needs to come back exactly as it was.
    const doc = {
        version: 1,
        savedAt: Date.now(),
        name: p.name || state.name || state.sessionId,
        sessionId: state.sessionId,
        startedAt: state.startedAt,
        durationMs: state.durationMs,
        sampleRate: state.sampleRate,
        screen: state.screen,
        takeSource: state.takeSource,
        rollingSummary: state.rollingSummary,
        summaryAtSeq: state.summaryAtSeq,
        suggestions: state.suggestions.slice(),
        chatCosts: state.chatCosts.slice(),
        config: { cleanup: config.cleanup, transcribeModel: config.transcribeModel, cleanupModel: config.cleanupModel },
        pairs: state.pairs.map(x => ({
            id: x.id, seq: x.seq, tPress: x.tPress, tStart: x.tStart, tEnd: x.tEnd,
            source: x.source, status: x.status, notes: x.notes || '',
            raw: x.raw, rawVersions: x.rawVersions, clean: x.clean,
            hasImage: !!x.screenshot,
        })),
    };
    await fs.writeFile(`${base}/session.json`, JSON.stringify(doc));

    for (const pair of state.pairs) {
        if (pair.screenshot) {
            await fs.writeFile(`${base}/images/${imageName(pair)}`, await blobToDataUrl(pair.screenshot));
        }
    }
    if (includeAudio && state.take && state.take.blob) {
        await ensureFolder(fs, `${base}/audio`);
        await fs.writeFile(`${base}/audio/take.b64`, await blobToDataUrl(state.take.blob));
    }

    // A small index entry so listSessions() never has to read the big files.
    const meta = {
        sessionId: state.sessionId, name: doc.name, savedAt: doc.savedAt,
        pairs: state.pairs.length, durationMs: state.durationMs, hasAudio: includeAudio,
    };
    await fs.writeFile(`${base}/meta.json`, JSON.stringify(meta));

    emit('nr:store:saved', meta);
    return meta;
}

/** @returns {Promise<Array<object>>} saved sessions, newest first. */
export async function listSessions() {
    const fs = await vfs();
    await ensureFolder(fs, ROOT);
    let entries = [];
    try { entries = await fs.listFolder(ROOT); } catch (_) { return []; }
    const names = entries.map(e => (typeof e === 'string' ? e : e.name || e.path || '')).filter(Boolean);
    const out = [];
    for (const n of names) {
        const id = String(n).replace(/^.*\//, '');
        try {
            const raw = await fs.readFile(`${ROOT}/${id}/meta.json`, { encoding: 'utf8' });
            out.push(JSON.parse(typeof raw === 'string' ? raw : await new Response(raw).text()));
        } catch (_) { /* partial write — skip */ }
    }
    return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/**
 * Restore a saved session over the current state.
 *
 * Audio is NOT restored into the PCM store: transcription and boundary editing
 * need the samples, which are not kept. So a loaded session is fully editable
 * as a document (text, notes, order, images, chat, export) but re-transcribing
 * a capture needs the original take. `canRetranscribe` says which you have.
 */
export async function loadSession(p = {}, emit = () => {}) {
    if (!p.sessionId) throw Object.assign(new Error('loadSession needs { sessionId }'), { code: 'bad-params' });
    const fs = await vfs();
    const base = `${ROOT}/${p.sessionId}`;
    const rawDoc = await fs.readFile(`${base}/session.json`, { encoding: 'utf8' })
        .catch(() => { throw Object.assign(new Error(`No saved session ${p.sessionId}`), { code: 'unknown-session' }); });
    const doc = JSON.parse(typeof rawDoc === 'string' ? rawDoc : await new Response(rawDoc).text());

    state.reset();
    state.sessionId = doc.sessionId;
    state.name = doc.name;
    state.startedAt = doc.startedAt;
    state.durationMs = doc.durationMs;
    state.sampleRate = doc.sampleRate || 16000;
    state.screen = doc.screen || null;
    state.takeSource = doc.takeSource || 'restored';
    state.rollingSummary = doc.rollingSummary || '';
    state.summaryAtSeq = doc.summaryAtSeq ?? -1;
    state.suggestions = doc.suggestions || [];
    state.chatCosts = doc.chatCosts || [];
    state.status = 'reviewing';
    if (doc.config) {
        for (const k of ['cleanup', 'transcribeModel', 'cleanupModel']) {
            if (doc.config[k] !== undefined) config[k] = doc.config[k];
        }
    }

    for (const s of doc.pairs || []) {
        const pair = makePair({ seq: s.seq, tPress: s.tPress, tStart: s.tStart, source: s.source || 'capture' });
        pair.id = s.id;                       // keep ids stable across a reload
        pair.tEnd = s.tEnd;
        pair.raw = s.raw || null;
        pair.rawVersions = s.rawVersions || [];
        pair.clean = s.clean || null;
        pair.notes = s.notes || '';
        pair.status = s.status || (s.clean ? 'clean' : s.raw ? 'raw' : 'marked');
        if (s.hasImage) {
            try {
                const dataUrl = await fs.readFile(`${base}/images/${s.id}.png.b64`);
                if (dataUrl && String(dataUrl).startsWith('data:')) pair.screenshot = await dataUrlToBlob(String(dataUrl));
            } catch (_) { /* image lost — the capture still restores */ }
        }
        state.pairs.push(pair);
    }
    resequence();

    let take = null;
    try {
        const dataUrl = await fs.readFile(`${base}/audio/take.b64`);
        if (dataUrl && String(dataUrl).startsWith('data:')) {
            const blob = await dataUrlToBlob(String(dataUrl));
            take = { blob, mimeType: blob.type || 'audio/webm' };
        }
    } catch (_) { /* saved without audio */ }
    state.take = take;

    const info = { sessionId: state.sessionId, pairs: state.pairs.length, canRetranscribe: false, hasAudio: !!take };
    emit('nr:store:loaded', info);
    return info;
}

/** Forget a saved session. */
export async function deleteSession(p = {}, emit = () => {}) {
    if (!p.sessionId) throw Object.assign(new Error('deleteSession needs { sessionId }'), { code: 'bad-params' });
    const fs = await vfs();
    const base = `${ROOT}/${p.sessionId}`;
    for (const path of [`${base}/session.json`, `${base}/meta.json`, `${base}/audio/take.b64`]) {
        try { await fs.deleteFile(path); } catch (_) { /* */ }
    }
    try {
        for (const e of await fs.listFolder(`${base}/images`)) {
            const n = typeof e === 'string' ? e : e.name || e.path;
            if (n) await fs.deleteFile(`${base}/images/${String(n).replace(/^.*\//, '')}`).catch(() => {});
        }
    } catch (_) { /* */ }
    emit('nr:store:deleted', { sessionId: p.sessionId });
    return { deleted: p.sessionId };
}
