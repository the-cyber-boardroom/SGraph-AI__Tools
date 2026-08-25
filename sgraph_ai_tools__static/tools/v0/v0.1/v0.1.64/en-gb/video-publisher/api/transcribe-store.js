/**
 * transcribe-store.js
 * Minimal single-item implementation of the state contract that
 * core/sg-transcribe's buildTranscribeMethods() expects (the audio-transcribe
 * queue state, reduced to one item: the job's audio). Versions accumulate on
 * re-transcribe exactly as in audio-transcribe; metadata generations are
 * tracked as aux costs for the roll-up.
 * No DOM, no side-effects.
 * @module transcribe-store
 */

let _vidSeq = 0;

export const itemStore = {
    items: [],                   // [{ id, name, mimeType, sizeBytes, blob, model, versions: [] }]
    auxCosts: [],                // [{ kind, usd, generationId }]
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

    clear() {
        this.items = [];
        this.auxCosts = [];
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
