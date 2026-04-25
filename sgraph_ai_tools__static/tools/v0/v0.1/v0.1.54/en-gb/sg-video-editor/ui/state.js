/** state.js — pure project state container; no DOM. */

import { snapToFps, validateProject, getVideoTracks } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { splitClipOp } from './state-split.js';

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

function findTrack(p, trackId) { return p.tracks.find(t => t.id === trackId) || null; }

function findClipLocation(p, clipId) {
    for (const t of p.tracks) {
        const i = t.clips.findIndex(c => c.id === clipId);
        if (i >= 0) return { track: t, index: i };
    }
    return null;
}

function findAsset(p, assetId) { return p.assets.find(a => a.id === assetId) || null; }

function trackEnd(track) {
    let max = 0;
    for (const c of track.clips) {
        const end = c.timelineStart + (c.outPoint - c.inPoint);
        if (end > max) max = end;
    }
    return max;
}

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

        addClip({ trackId, assetId, timelineStart, inPoint, outPoint, clipId }) {
            const track = findTrack(project, trackId);
            if (!track) throw badArg(`unknown trackId: ${trackId}`);
            const asset = findAsset(project, assetId);
            if (!asset) throw badArg(`unknown assetId: ${assetId}`);
            const fps = project.project.fps;
            const inP = snapToFps(Number.isFinite(inPoint) ? inPoint : 0, fps);
            const outP = snapToFps(Number.isFinite(outPoint) ? outPoint : asset.duration, fps);
            if (outP <= inP) throw badArg('outPoint must be > inPoint');
            const tStart = snapToFps(Number.isFinite(timelineStart) ? timelineStart : trackEnd(track), fps);
            const id = clipId || genId('c');
            track.clips.push({ id, assetId, timelineStart: tStart, inPoint: inP, outPoint: outP });
            withOp({ op: 'addClip', clipId: id, trackId, assetId });
            emit();
            return id;
        },

        removeClip({ clipId }) {
            const loc = findClipLocation(project, clipId);
            if (!loc) throw badArg(`unknown clipId: ${clipId}`);
            loc.track.clips.splice(loc.index, 1);
            withOp({ op: 'removeClip', clipId });
            emit();
        },

        trimClip({ clipId, inPoint, outPoint }) {
            const loc = findClipLocation(project, clipId);
            if (!loc) throw badArg(`unknown clipId: ${clipId}`);
            const clip = loc.track.clips[loc.index];
            const asset = findAsset(project, clip.assetId);
            const fps = project.project.fps;
            const maxOut = asset ? asset.duration : Infinity;
            const inP = snapToFps(Math.max(0, Number.isFinite(inPoint) ? inPoint : clip.inPoint), fps);
            const outP = snapToFps(Math.min(maxOut, Number.isFinite(outPoint) ? outPoint : clip.outPoint), fps);
            if (outP <= inP) throw badArg('outPoint must be > inPoint');
            clip.inPoint = inP;
            clip.outPoint = outP;
            withOp({ op: 'trimClip', clipId, inPoint: inP, outPoint: outP });
            emit();
        },

        moveClip({ clipId, timelineStart }) {
            const loc = findClipLocation(project, clipId);
            if (!loc) throw badArg(`unknown clipId: ${clipId}`);
            const fps = project.project.fps;
            const t = snapToFps(Math.max(0, Number(timelineStart) || 0), fps);
            loc.track.clips[loc.index].timelineStart = t;
            withOp({ op: 'moveClip', clipId, timelineStart: t });
            emit();
        },

        splitClip({ clipId, atTime }) {
            const { newClipId, atTime: t } = splitClipOp(project, { clipId, atTime }, genId);
            withOp({ op: 'splitClip', clipId, atTime: t, newClipId });
            emit();
            return { newClipId };
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
