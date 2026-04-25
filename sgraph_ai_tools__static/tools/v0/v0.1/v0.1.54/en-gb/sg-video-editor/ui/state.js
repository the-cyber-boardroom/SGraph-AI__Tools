/** state.js — pure project state container; no DOM. */

import { validateProject, getVideoTracks } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { splitClipOp } from './state-split.js';
import {
    addClipOp, trimClipOp, moveClipOp, removeClipOp, setClipColorOp,
} from './state-clip-ops.js';

const SCHEMA_VERSION = '0.1.0';
const DEFAULT_FPS = 30;
const DEFAULT_W = 1280;
const DEFAULT_H = 720;

/** Generate a short prefixed id. */
function genId(prefix) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(16).slice(2, 10);
    return `${prefix}_${rand}`;
}

/** Build a fresh project wrapper matching the documented schema. */
export function createInitialProject(opts = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        project: {
            id: genId('p'),
            name: opts.name || 'Untitled',
            fps: DEFAULT_FPS,
            width: DEFAULT_W,
            height: DEFAULT_H,
            createdAt: Date.now(),
        },
        assets: [],
        tracks: [{ id: 't-video-1', kind: 'video', index: 0, muted: false, clips: [] }],
        operations: [],
    };
}

function deepClone(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

/** Validate the inner composer-shaped projection of the wrapped state. */
function validateWrapped(p) {
    if (!p || typeof p !== 'object') throw badArg('project must be an object');
    if (!p.project || typeof p.project !== 'object') throw badArg('project.project must be an object');
    if (!Array.isArray(p.tracks)) throw badArg('project.tracks must be an array');
    validateProject({
        width: p.project.width, height: p.project.height, tracks: p.tracks,
    });
    return p;
}

/** Create a state container with mutation helpers; emits 'change' on every mutation. */
export function createState(initialProject) {
    let project = validateWrapped(deepClone(initialProject));
    const assetRegistry = new Map();
    const target = new EventTarget();

    function emit() {
        target.dispatchEvent(new CustomEvent('change', { detail: { project: deepClone(project) } }));
    }

    function withOp(op) { project.operations.push({ ...op, t: Date.now() }); }

    return {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),

        getProject() { return deepClone(project); },

        setProject(next) {
            project = validateWrapped(deepClone(next));
            emit();
        },

        getAssetRegistry() { return assetRegistry; },

        addAsset({ assetId, name, mime, duration, width, height, bytes, blob }) {
            if (!assetId || typeof assetId !== 'string') throw badArg('assetId required');
            if (!(blob instanceof Blob)) throw badArg('blob must be a Blob');
            if (!Number.isFinite(duration) || duration <= 0) throw badArg('duration must be > 0');
            project.assets.push({ id: assetId, name, mime, duration, width, height, bytes });
            assetRegistry.set(assetId, blob);
            withOp({ op: 'addAsset', assetId });
            emit();
            return assetId;
        },

        addClip(params) {
            const id = addClipOp(project, params, genId);
            withOp({ op: 'addClip', clipId: id, trackId: params.trackId, assetId: params.assetId });
            emit();
            return id;
        },

        removeClip(params) {
            removeClipOp(project, params);
            withOp({ op: 'removeClip', clipId: params.clipId });
            emit();
        },

        trimClip(params) {
            const { inPoint, outPoint } = trimClipOp(project, params);
            withOp({ op: 'trimClip', clipId: params.clipId, inPoint, outPoint });
            emit();
        },

        moveClip(params) {
            const { timelineStart } = moveClipOp(project, params);
            withOp({ op: 'moveClip', clipId: params.clipId, timelineStart });
            emit();
        },

        splitClip({ clipId, atTime }) {
            const { newClipId, atTime: t } = splitClipOp(project, { clipId, atTime }, genId);
            withOp({ op: 'splitClip', clipId, atTime: t, newClipId });
            emit();
            return { newClipId };
        },

        setClipColor(params) {
            const { clipId, color } = setClipColorOp(project, params);
            withOp({ op: 'setClipColor', clipId, color });
            emit();
        },

        /** Project the wrapped state into a composer-shaped project. */
        toComposerProject() {
            return {
                width: project.project.width,
                height: project.project.height,
                fps: project.project.fps,
                tracks: deepClone(project.tracks),
                assets: deepClone(project.assets),
            };
        },
    };
}

export { getVideoTracks };
