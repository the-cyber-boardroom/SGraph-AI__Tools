/** state-init.js — initial-project factory + deepClone + validation helpers. */

import { validateProject } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';

const SCHEMA_VERSION = '0.1.0';
const DEFAULT_FPS = 30;
const DEFAULT_W = 1280;
const DEFAULT_H = 720;

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

/** Deep-clone a JSON-shaped project. */
export function deepClone(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

/** Wrap an Error with code 'invalid-arg'. */
export function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

/** Validate the inner composer-shaped projection of the wrapped state. */
export function validateWrapped(p) {
    if (!p || typeof p !== 'object') throw badArg('project must be an object');
    if (!p.project || typeof p.project !== 'object') throw badArg('project.project must be an object');
    if (!Array.isArray(p.tracks)) throw badArg('project.tracks must be an array');
    validateProject({ width: p.project.width, height: p.project.height, tracks: p.tracks });
    return p;
}

/** Generate a short prefixed id (asset/clip/project). */
export { genId };
