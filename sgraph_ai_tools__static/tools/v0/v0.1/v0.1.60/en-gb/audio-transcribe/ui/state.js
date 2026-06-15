/**
 * state.js — in-memory queue + change emitter for the Audio Transcribe tool.
 *
 * Mirrors heic-converter's EventTarget-backed item-list store. No persistence
 * of audio/transcripts (the user is here to transcribe and download/send). The
 * OpenRouter key is persisted separately by the key UI, not here.
 *
 * Item shape:
 * {
 *   id, blob (Blob), name, sizeBytes, mimeType,
 *   durationMs?: number,
 *   origin: 'recording' | 'file',
 *   model: string,                 // per-item model (defaults to activeModel)
 *   status: 'queued' | 'transcribing' | 'done' | 'error',
 *   transcript?: string,
 *   latencyMs?: number,
 *   error?: string,
 * }
 *
 * @module audio-transcribe/state
 */

/**
 * Create the tool's state container.
 * @param {{ defaultModel?: string }} [opts]
 * @returns {object} state API (see methods below).
 */
export function createState(opts = {}) {
    /** @type {Array<object>} */
    const items = [];
    /** @type {Set<string>} dedupe key = `${name}::${size}` */
    const seen = new Set();
    const target = new EventTarget();

    let nextId = 1;
    let nextVid = 1;
    let activeModel = opts.defaultModel || '';
    let apiKeyPresent = false;

    /** Mirror a version's fields onto the item's top-level (the "selected" view
     *  the Queue row / downloadZip / getTranscript read). */
    function mirror(it, v) {
        it.transcript = v.text;
        it.model = v.model;
        it.status = v.status;
        it.costUsd = v.costUsd;
        it.costPending = v.costPending;
        it.promptTokens = v.promptTokens;
        it.completionTokens = v.completionTokens;
        it.latencyMs = v.latencyMs;
        it.generationId = v.generationId;
        it.error = v.error;
        it.errorCode = v.errorCode;
    }

    function emit(kind, extra) {
        target.dispatchEvent(new CustomEvent('change', { detail: { kind, ...(extra || {}) } }));
    }

    /** @returns {Array<object>} serialisable snapshot (no Blob). */
    function getItems() {
        return items.map((it) => {
            const { blob, ...rest } = it;
            return { ...rest };
        });
    }

    /** @returns {Array<object>} live items WITH blobs (internal use). */
    function getRawItems() { return items.slice(); }

    /** @param {string} id @returns {object|null} serialisable item or null. */
    function getItem(id) {
        const it = items.find((x) => x.id === id);
        if (!it) return null;
        const { blob, ...rest } = it;
        return { ...rest };
    }

    /** @param {string} id @returns {object|null} live item WITH blob. */
    function getRawItem(id) {
        return items.find((x) => x.id === id) || null;
    }

    /**
     * Add an audio blob as one queue item.
     * @param {Blob} blob
     * @param {{ name?: string, mimeType?: string, origin?: string, durationMs?: number, model?: string }} [meta]
     * @returns {string|null} the new item id, or null if deduped.
     */
    function addItem(blob, meta = {}) {
        if (!blob) return null;
        const name = meta.name || `audio-${nextId}`;
        const sizeBytes = blob.size || meta.sizeBytes || 0;
        const key = `${name}::${sizeBytes}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const id = `at-${nextId++}`;
        items.push({
            id,
            blob,
            name,
            sizeBytes,
            mimeType: meta.mimeType || blob.type || '',
            durationMs: meta.durationMs,
            origin: meta.origin || 'file',
            model: meta.model || activeModel,
            status: 'queued',
            versions: [],       // transcription history (advanced mode)
            selectedVid: null,
        });
        emit('added', { id });
        return id;
    }

    /**
     * Append a transcription version and select it (re-transcribe keeps history).
     * @param {string} id
     * @param {object} v  partial version (model, status, text?, …)
     * @returns {string|null} the new version id
     */
    function addVersion(id, v) {
        const it = items.find((x) => x.id === id);
        if (!it) return null;
        const vid = `tv-${nextVid++}`;
        const version = { vid, ts: Date.now(), ...v };
        (it.versions = it.versions || []).push(version);
        it.selectedVid = vid;
        mirror(it, version);
        emit('updated', { id, vid });
        return vid;
    }

    /** @param {string} id @param {string} vid @param {object} patch */
    function updateVersion(id, vid, patch) {
        const it = items.find((x) => x.id === id);
        if (!it || !it.versions) return;
        const v = it.versions.find((x) => x.vid === vid);
        if (!v) return;
        Object.assign(v, patch);
        if (it.selectedVid === vid) mirror(it, v);
        emit('updated', { id, vid });
    }

    /** Make a past version the selected (shown) one. @param {string} id @param {string} vid */
    function setSelectedVersion(id, vid) {
        const it = items.find((x) => x.id === id);
        if (!it) return;
        const v = (it.versions || []).find((x) => x.vid === vid);
        if (!v) return;
        it.selectedVid = vid;
        mirror(it, v);
        emit('updated', { id });
    }

    /** @param {string} id @param {object} patch */
    function updateItem(id, patch) {
        const idx = items.findIndex((x) => x.id === id);
        if (idx < 0) return;
        items[idx] = { ...items[idx], ...patch };
        emit('updated', { id });
    }

    /** @param {string} id */
    function removeItem(id) {
        const idx = items.findIndex((x) => x.id === id);
        if (idx < 0) return;
        const it = items[idx];
        seen.delete(`${it.name}::${it.sizeBytes}`);
        items.splice(idx, 1);
        emit('removed', { id });
    }

    function clear() {
        items.length = 0;
        seen.clear();
        emit('reset');
    }

    function getActiveModel() { return activeModel; }
    /** @param {string} model */
    function setActiveModel(model) {
        if (typeof model !== 'string' || !model) return;
        activeModel = model;
        emit('model', { model });
    }

    function getApiKeyPresent() { return apiKeyPresent; }
    /** @param {boolean} present */
    function setApiKeyPresent(present) {
        apiKeyPresent = !!present;
        emit('apiKey', { present: apiKeyPresent });
    }

    return {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        getItems, getRawItems, getItem, getRawItem,
        addItem, updateItem, removeItem, clear,
        addVersion, updateVersion, setSelectedVersion,
        getActiveModel, setActiveModel,
        getApiKeyPresent, setApiKeyPresent,
    };
}
