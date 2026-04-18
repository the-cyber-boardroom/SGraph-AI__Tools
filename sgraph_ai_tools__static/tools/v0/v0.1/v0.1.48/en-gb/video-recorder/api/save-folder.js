/**
 * save-folder.js
 * Save a recording as a folder: video file + thumbnail + metadata JSON.
 *
 * Uses the File System Access API (showDirectoryPicker) to write files locally.
 * Falls back to a zip-and-download approach if the API is unavailable.
 *
 * @module save-folder
 */

import { SGA_RECORDER } from './recorder-events.js';

/**
 * Save video blob + thumbnail + metadata as a local folder.
 *
 * @param {Blob} blob
 * @param {{
 *   folderName?:   string,
 *   screenshots?:  boolean,
 *   durationMs?:   number,
 *   mode?:         string,
 * }} [opts]
 * @returns {Promise<{ folderId: string }>}
 */
export async function saveFolder(blob, opts = {}) {
    const {
        folderName  = `recording-${Date.now()}`,
        screenshots = false,
        durationMs  = 0,
        mode        = 'unknown',
    } = opts;

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 0, message: 'Preparing files…' });

    const meta = {
        id:         folderName,
        created:    new Date().toISOString(),
        durationMs,
        mode,
        sizeBytes:  blob.size,
        mimeType:   blob.type,
    };

    if ('showDirectoryPicker' in window) {
        await _saveViaFSA(blob, meta, folderName, screenshots);
    } else {
        await _saveViaDownloads(blob, meta, folderName, screenshots);
    }

    _dispatch(SGA_RECORDER.SAVE_COMPLETE, { target: 'folder', folderId: folderName });
    return { folderId: folderName };
}

// ─── File System Access API path ──────────────────────────────────────────────

async function _saveViaFSA(blob, meta, folderName, screenshots) {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    const folder = await dir.getDirectoryHandle(folderName, { create: true });

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 30, message: 'Writing video…' });
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    await _writeFile(folder, `video.${ext}`, blob);

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 60, message: 'Writing metadata…' });
    await _writeFile(folder, 'metadata.json', new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }));

    if (screenshots) {
        _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 80, message: 'Capturing thumbnail…' });
        const thumb = await _captureFrame(blob, 1);
        if (thumb) await _writeFile(folder, 'thumbnail.jpg', thumb);
    }

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 100, message: 'Done.' });
}

async function _writeFile(dirHandle, name, blob) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w  = await fh.createWritable();
    await w.write(blob);
    await w.close();
}

// ─── Fallback: trigger individual downloads ───────────────────────────────────

async function _saveViaDownloads(blob, meta, folderName, screenshots) {
    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 30, message: 'Downloading video…' });
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    _triggerDownload(blob, `${folderName}/video.${ext}`);

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 70, message: 'Downloading metadata…' });
    _triggerDownload(
        new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
        `${folderName}/metadata.json`
    );

    if (screenshots) {
        const thumb = await _captureFrame(blob, 1);
        if (thumb) _triggerDownload(thumb, `${folderName}/thumbnail.jpg`);
    }

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'folder', percent: 100, message: 'Done.' });
}

function _triggerDownload(blob, name) {
    const a   = document.createElement('a');
    a.href    = URL.createObjectURL(blob);
    a.download = name.replace('/', '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ─── Thumbnail via canvas seek ────────────────────────────────────────────────

async function _captureFrame(blob, seekSeconds = 1) {
    return new Promise((resolve) => {
        const video   = document.createElement('video');
        const url     = URL.createObjectURL(blob);
        video.src     = url;
        video.muted   = true;
        video.preload = 'metadata';

        video.onloadedmetadata = () => {
            video.currentTime = Math.min(seekSeconds, video.duration * 0.1);
        };

        video.onseeked = () => {
            const canvas  = document.createElement('canvas');
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            canvas.toBlob((b) => {
                URL.revokeObjectURL(url);
                resolve(b);
            }, 'image/jpeg', 0.85);
        };

        video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    });
}

function _dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}
