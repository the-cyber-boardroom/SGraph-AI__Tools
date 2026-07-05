/**
 * sg-video-composer.js — public entry for the video composer module.
 * @module sg-video-composer
 * @version 0.1.1
 *
 * v0.1.1 — export blank-video fix. composer-export-setup.js keyed its
 * video-element map by clip.assetId while the export tick looked up by
 * clip.id, so exports containing video clips rendered black with no clip
 * audio. The map is now keyed by clip.id (one element per clip), matching
 * both the export tick and the playback path. No API changes.
 */

import {
    snapToFps,
    clipDuration,
    getProjectDuration,
    validateProject,
} from './composer-schema.js';
import { createPlayback } from './composer-playback.js';
import { exportProject } from './composer-export.js';
import { pickMp4MimeType, ensureMp4 } from './composer-mp4.js';
import {
    isSupported,
    getBestMimeType,
} from '../../../../sg-video-recorder/v0/v0.1/v0.1.2/sg-video-recorder.js';

export { snapToFps, clipDuration, getProjectDuration, validateProject };

/**
 * Build a playback handle bound to a canvas.
 * @param {{ project: object, assets: Map<string, Blob>, canvas: HTMLCanvasElement, fps: number }} opts
 * @returns {object} playback handle
 */
export function createComposer({ project, assets, canvas, fps }) {
    validateProject(project);
    return createPlayback({ project, assets, canvas, fps });
}

/**
 * Export a project to a Blob, preferring MP4 output.
 * @param {{ project: object, assets: Map<string, Blob>, fps: number, preferMp4?: boolean, bitsPerSecond?: number, onProgress?: Function }} opts
 * @returns {Promise<Blob>}
 */
export async function exportComposerProject({ project, assets, fps, preferMp4, bitsPerSecond, onProgress }) {
    if (!isSupported()) {
        const err = new Error('MediaRecorder/canvas.captureStream not supported');
        err.code = 'recorder-unsupported';
        throw err;
    }
    validateProject(project);
    const wantsMp4 = preferMp4 !== false;
    const mimeType = (wantsMp4 ? pickMp4MimeType() : null) ?? getBestMimeType();
    const blob = await exportProject({ project, assets, fps, mimeType, bitsPerSecond, onProgress });
    if (wantsMp4) return ensureMp4(blob, onProgress);
    return blob;
}
