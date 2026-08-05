/**
 * publisher-state.js
 * Mutable state for the video-publisher: one PublishJob per loaded video,
 * plus a minimal item/version store implementing the state contract that
 * core/sg-transcribe's buildTranscribeMethods() expects (single-item flavour
 * of the audio-transcribe queue state).
 * No DOM, no side-effects.
 * @module publisher-state
 */

/**
 * Job step statuses: 'idle' | 'running' | 'done' | 'error'.
 * Job flow: idle → recording → loaded → (audio → transcript → metadata auto-run)
 *           → ready-to-publish → uploading → published.
 */
export const state = {
    /** 'idle'|'recording'|'loaded'|'ready-to-publish'|'uploading'|'published' */
    phase:      'idle',
    autoRun:    true,

    /** Loaded video. */
    videoBlob:  null,
    /** Separate audio stream from the recorder (route 1), when present. */
    audioBlob:  null,
    filename:   null,
    source:     null,            // 'record' | 'import' | 'handoff'

    /** Audio routing result: { blob, route: 'native'|'remux'|'decode', mime }. */
    audio:      null,

    /** Per-step status + info: { status, error?, code?, info? }. */
    steps: {
        audio:      { status: 'idle' },
        transcript: { status: 'idle' },
        metadata:   { status: 'idle' },
        publish:    { status: 'idle' },
    },

    transcript:  null,           // last successful transcript text
    metadata:    { title: '', description: '', tags: [], privacy: 'unlisted' },

    /** YouTube session (mirrors youtube-editor state shape). */
    youtube: {
        connected: false, accessToken: null, expiresAt: null, channel: null,
        uploadStatus: 'idle', uploadProgress: 0, lastUploadId: null, lastUrl: null,
    },

    lastError:   null,
};

export function resetJob() {
    state.phase      = 'idle';
    state.videoBlob  = null;
    state.audioBlob  = null;
    state.filename   = null;
    state.source     = null;
    state.audio      = null;
    state.transcript = null;
    state.metadata   = { title: '', description: '', tags: [], privacy: 'unlisted' };
    state.lastError  = null;
    for (const k of Object.keys(state.steps)) state.steps[k] = { status: 'idle' };
    state.youtube.uploadStatus   = 'idle';
    state.youtube.uploadProgress = 0;
    state.youtube.lastUploadId   = null;
    state.youtube.lastUrl        = null;
    itemStore.items = [];
    itemStore.auxCosts = [];
}

// ── Transcribe-state adapter ─────────────────────────────────────────────────
// Minimal implementation of the contract core/sg-transcribe's
// buildTranscribeMethods() uses: one item (the job's audio), versions kept so
// re-transcribes with other models accumulate exactly like audio-transcribe.

let _vidSeq = 0;

export const itemStore = {
    items: [],                   // [{ id, name, mimeType, sizeBytes, blob, model, versions: [] }]
    auxCosts: [],                // [{ kind, usd, generationId }] — metadata generations etc.
    activeModel: null,

    /** Replace the single item with the current job audio. */
    setAudioItem({ blob, name }) {
        this.items = [{
            id: 'job-audio', name, blob,
            mimeType: blob.type || 'application/octet-stream',
            sizeBytes: blob.size, model: null, versions: [],
        }];
        return this.items[0];
    },

    getItems()      { return this.items; },
    getRawItem(id)  { return this.items.find(i => i.id === id) || null; },
    updateItem(id, patch) {
        const it = this.getRawItem(id);
        if (it) Object.assign(it, patch);
    },
    addVersion(id, obj) {
        const it = this.getRawItem(id);
        if (!it) return null;
        const vid = `v${++_vidSeq}`;
        it.versions.push({ vid, ...obj });
        return vid;
    },
    updateVersion(id, vid, patch) {
        const it = this.getRawItem(id);
        const v  = it && it.versions.find(x => x.vid === vid);
        if (v) Object.assign(v, patch);
    },
    setActiveModel(m) { this.activeModel = m; },
    getActiveModel()  { return this.activeModel; },
    getAuxCosts()     { return this.auxCosts; },
    addAuxCost(entry) { this.auxCosts.push(entry); },
    getSpendCap()     { return null; },
};
