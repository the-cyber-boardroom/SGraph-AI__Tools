/**
 * sg-video — Browser-based video processing via FFmpeg WASM
 *
 * Pure ES module. No frameworks, no build step.
 * Wraps FFmpeg WASM for split, trim, and extract operations.
 *
 * @module sg-video
 * @version 1.0.0
 */

/** @type {string} CDN URL for FFmpeg WASM ES module */
export const FFMPEG_CDN_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';

/** @type {string} CDN URL for FFmpeg util ES module */
export const FFMPEG_UTIL_URL = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js';

/** @type {import('@ffmpeg/ffmpeg').FFmpeg|null} Cached FFmpeg instance */
let _ffmpegInstance = null;

/** @type {Promise<import('@ffmpeg/ffmpeg').FFmpeg>|null} In-flight load promise to prevent duplicate loads */
let _loadPromise = null;

/** @type {Function|null} Cached fetchFile function */
let _fetchFile = null;

/**
 * Check if WebAssembly is available in this environment.
 *
 * @returns {boolean} True if WebAssembly is supported
 */
export function isWasmSupported() {
    try {
        return typeof WebAssembly === 'object'
            && typeof WebAssembly.instantiate === 'function';
    } catch (_e) {
        return false;
    }
}

/**
 * Parse a time string into seconds.
 *
 * Accepts:
 * - Plain seconds: "30", "90.5"
 * - mm:ss: "1:30"
 * - hh:mm:ss: "1:02:30"
 *
 * @param {string|number} input - Time value to parse
 * @returns {number|null} Time in seconds, or null if input is invalid
 */
export function parseTime(input) {
    if (input === null || input === undefined || input === '') {
        return null;
    }

    // If already a number, return it (if finite and non-negative)
    if (typeof input === 'number') {
        return Number.isFinite(input) && input >= 0 ? input : null;
    }

    const str = String(input).trim();
    if (str === '') {
        return null;
    }

    const parts = str.split(':');

    if (parts.length === 1) {
        // Plain seconds
        const val = Number(parts[0]);
        return Number.isFinite(val) && val >= 0 ? val : null;
    }

    if (parts.length === 2) {
        // mm:ss
        const minutes = Number(parts[0]);
        const seconds = Number(parts[1]);
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds)
            || minutes < 0 || seconds < 0 || seconds >= 60) {
            return null;
        }
        return minutes * 60 + seconds;
    }

    if (parts.length === 3) {
        // hh:mm:ss
        const hours   = Number(parts[0]);
        const minutes = Number(parts[1]);
        const seconds = Number(parts[2]);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)
            || hours < 0 || minutes < 0 || seconds < 0
            || minutes >= 60 || seconds >= 60) {
            return null;
        }
        return hours * 3600 + minutes * 60 + seconds;
    }

    return null;
}

/**
 * Format seconds into a human-readable time string.
 *
 * Returns mm:ss for durations under 1 hour, hh:mm:ss otherwise.
 *
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }

    const totalSeconds = Math.floor(seconds);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    const sPad = String(s).padStart(2, '0');

    if (h > 0) {
        const mPad = String(m).padStart(2, '0');
        return `${h}:${mPad}:${sPad}`;
    }

    return `${m}:${sPad}`;
}

/**
 * Lazy-load FFmpeg WASM from CDN. Returns a cached instance on subsequent calls.
 *
 * @param {Function} [onProgress] - Optional callback receiving { ratio } during WASM load (0..1)
 * @returns {Promise<import('@ffmpeg/ffmpeg').FFmpeg>} The loaded FFmpeg instance
 * @throws {Error} If WebAssembly is not supported or FFmpeg fails to load
 */
export async function loadFFmpeg(onProgress) {
    // Return cached instance immediately
    if (_ffmpegInstance) {
        return _ffmpegInstance;
    }

    // If a load is already in flight, wait for it
    if (_loadPromise) {
        return _loadPromise;
    }

    _loadPromise = _doLoadFFmpeg(onProgress);

    try {
        const instance = await _loadPromise;
        return instance;
    } catch (err) {
        // Reset so a retry is possible
        _loadPromise = null;
        throw err;
    }
}

/**
 * Internal: performs the actual FFmpeg load.
 *
 * @param {Function} [onProgress]
 * @returns {Promise<import('@ffmpeg/ffmpeg').FFmpeg>}
 * @private
 */
async function _doLoadFFmpeg(onProgress) {
    if (!isWasmSupported()) {
        throw new Error('WebAssembly is not supported in this browser.');
    }

    let FFmpeg, fetchFile;

    try {
        const ffmpegModule = await import(/* webpackIgnore: true */ FFMPEG_CDN_URL);
        FFmpeg = ffmpegModule.FFmpeg;
    } catch (err) {
        throw new Error(`Failed to load FFmpeg module from CDN: ${err.message}`);
    }

    try {
        const utilModule = await import(/* webpackIgnore: true */ FFMPEG_UTIL_URL);
        fetchFile = utilModule.fetchFile;
    } catch (err) {
        throw new Error(`Failed to load FFmpeg util module from CDN: ${err.message}`);
    }

    const ffmpeg = new FFmpeg();

    if (typeof onProgress === 'function') {
        ffmpeg.on('progress', onProgress);
    }

    try {
        await ffmpeg.load();
    } catch (err) {
        throw new Error(`FFmpeg WASM failed to initialize: ${err.message}`);
    }

    _ffmpegInstance = ffmpeg;
    _fetchFile = fetchFile;

    return ffmpeg;
}

/**
 * Get the cached fetchFile function, loading it if necessary.
 *
 * @returns {Promise<Function>} The fetchFile utility
 * @private
 */
async function _getFetchFile() {
    if (_fetchFile) {
        return _fetchFile;
    }
    // If fetchFile isn't cached yet, import the util module
    const utilModule = await import(/* webpackIgnore: true */ FFMPEG_UTIL_URL);
    _fetchFile = utilModule.fetchFile;
    return _fetchFile;
}

/**
 * Write a File/Blob to FFmpeg's virtual filesystem.
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {string} name - Filename in virtual FS
 * @param {File|Blob} file
 * @returns {Promise<void>}
 * @private
 */
async function _writeInputFile(ffmpeg, name, file) {
    const fetchFile = await _getFetchFile();
    const data = await fetchFile(file);
    await ffmpeg.writeFile(name, data);
}

/**
 * Read a file from FFmpeg's virtual filesystem, create a Blob, then delete the file.
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {string} name - Filename in virtual FS
 * @param {string} mimeType - MIME type for the output Blob
 * @returns {Promise<Blob>}
 * @private
 */
async function _readAndCleanup(ffmpeg, name, mimeType) {
    const data = await ffmpeg.readFile(name);
    await ffmpeg.deleteFile(name);
    return new Blob([data.buffer], { type: mimeType });
}

/**
 * Derive a MIME type from a filename extension.
 *
 * @param {string} filename
 * @returns {string}
 * @private
 */
function _mimeFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'mp4':  'video/mp4',
        'webm': 'video/webm',
        'mkv':  'video/x-matroska',
        'avi':  'video/x-msvideo',
        'mov':  'video/quicktime',
        'aac':  'audio/aac',
        'm4a':  'audio/mp4',
        'mp3':  'audio/mpeg',
        'ogg':  'audio/ogg',
        'wav':  'audio/wav',
    };
    return map[ext] || 'application/octet-stream';
}

/**
 * Extract video metadata using a native HTMLVideoElement.
 *
 * @param {File|Blob} file - Video file to inspect
 * @returns {Promise<{ duration: number, width: number, height: number, hasAudio: boolean, hasVideo: boolean, filename: string, size: number }>}
 *   Object containing duration (seconds), dimensions, track presence, filename, and byte size.
 * @throws {Error} If the file cannot be loaded as a video
 */
export async function getVideoInfo(file) {
    if (!(file instanceof Blob)) {
        throw new Error('getVideoInfo: expected a File or Blob');
    }

    const filename = file.name || 'unknown';
    const size = file.size;

    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;

        const url = URL.createObjectURL(file);

        const cleanup = () => {
            URL.revokeObjectURL(url);
            video.removeAttribute('src');
            video.load(); // release resources
        };

        video.addEventListener('loadedmetadata', () => {
            const duration = video.duration;
            const width    = video.videoWidth;
            const height   = video.videoHeight;

            // videoWidth/videoHeight > 0 means there's a video track
            const hasVideo = width > 0 && height > 0;

            // For audio detection we check audioTracks if available,
            // otherwise fall back to a heuristic: if duration > 0 it likely has audio
            let hasAudio = false;
            if (video.audioTracks) {
                hasAudio = video.audioTracks.length > 0;
            } else if (video.mozHasAudio !== undefined) {
                hasAudio = video.mozHasAudio;
            } else if (video.webkitAudioDecodedByteCount !== undefined) {
                hasAudio = video.webkitAudioDecodedByteCount > 0;
            } else {
                // Assume audio exists if it's a video container with duration
                hasAudio = duration > 0;
            }

            cleanup();

            resolve({
                duration,
                width,
                height,
                hasAudio,
                hasVideo,
                filename,
                size,
            });
        });

        video.addEventListener('error', () => {
            cleanup();
            reject(new Error(`getVideoInfo: could not load video metadata for "${filename}"`));
        });

        video.src = url;
    });
}

/**
 * Split a video file into multiple segments using stream copy (no re-encoding).
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg - Loaded FFmpeg instance (from loadFFmpeg)
 * @param {File|Blob} file - Source video file
 * @param {Array<{ start: number, end: number }>} segments - Array of time ranges in seconds
 * @param {Function} [onSegmentComplete] - Optional callback(index, total) after each segment
 * @returns {Promise<Array<{ blob: Blob, filename: string, startTime: number, endTime: number, duration: number }>>}
 *   Array of segment results with blob, filename, time info, and duration.
 * @throws {Error} If ffmpeg is not loaded, file is invalid, or segments array is empty
 */
export async function splitVideo(ffmpeg, file, segments, onSegmentComplete) {
    if (!ffmpeg) {
        throw new Error('splitVideo: ffmpeg instance is required. Call loadFFmpeg() first.');
    }
    if (!(file instanceof Blob)) {
        throw new Error('splitVideo: expected a File or Blob');
    }
    if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error('splitVideo: segments must be a non-empty array of { start, end }');
    }

    const inputName = file.name || 'input.mp4';
    const ext = inputName.includes('.') ? inputName.substring(inputName.lastIndexOf('.')) : '.mp4';
    const baseName = inputName.includes('.')
        ? inputName.substring(0, inputName.lastIndexOf('.'))
        : inputName;

    await _writeInputFile(ffmpeg, inputName, file);

    const results = [];

    for (let i = 0; i < segments.length; i++) {
        const { start, end } = segments[i];
        const outputName = `${baseName}_segment_${i + 1}${ext}`;

        await ffmpeg.exec([
            '-ss', String(start),
            '-to', String(end),
            '-i', inputName,
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            outputName,
        ]);

        const mimeType = _mimeFromFilename(outputName);
        const blob = await _readAndCleanup(ffmpeg, outputName, mimeType);

        results.push({
            blob,
            filename: outputName,
            startTime: start,
            endTime: end,
            duration: end - start,
        });

        if (typeof onSegmentComplete === 'function') {
            onSegmentComplete(i, segments.length);
        }
    }

    // Clean up input file
    await ffmpeg.deleteFile(inputName);

    return results;
}

/**
 * Trim a video to keep only the portion between start and end times (stream copy, no re-encoding).
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg - Loaded FFmpeg instance
 * @param {File|Blob} file - Source video file
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @returns {Promise<{ blob: Blob, filename: string, duration: number }>}
 *   Trimmed video blob, suggested filename, and duration.
 * @throws {Error} If parameters are invalid
 */
export async function trimVideo(ffmpeg, file, start, end) {
    if (!ffmpeg) {
        throw new Error('trimVideo: ffmpeg instance is required. Call loadFFmpeg() first.');
    }
    if (!(file instanceof Blob)) {
        throw new Error('trimVideo: expected a File or Blob');
    }
    if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
        throw new Error('trimVideo: start must be >= 0 and end must be > start');
    }

    const inputName = file.name || 'input.mp4';
    const ext = inputName.includes('.') ? inputName.substring(inputName.lastIndexOf('.')) : '.mp4';
    const baseName = inputName.includes('.')
        ? inputName.substring(0, inputName.lastIndexOf('.'))
        : inputName;
    const outputName = `${baseName}_trimmed${ext}`;

    await _writeInputFile(ffmpeg, inputName, file);

    await ffmpeg.exec([
        '-ss', String(start),
        '-to', String(end),
        '-i', inputName,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        outputName,
    ]);

    const mimeType = _mimeFromFilename(outputName);
    const blob = await _readAndCleanup(ffmpeg, outputName, mimeType);

    await ffmpeg.deleteFile(inputName);

    return {
        blob,
        filename: outputName,
        duration: end - start,
    };
}

/**
 * Extract the audio track from a video file, stripping video (stream copy, no re-encoding).
 *
 * Output format is .m4a (AAC in MP4 container) for broad compatibility.
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg - Loaded FFmpeg instance
 * @param {File|Blob} file - Source video file
 * @returns {Promise<{ blob: Blob, filename: string }>}
 *   Audio-only blob and suggested filename.
 * @throws {Error} If parameters are invalid
 */
export async function extractAudio(ffmpeg, file) {
    if (!ffmpeg) {
        throw new Error('extractAudio: ffmpeg instance is required. Call loadFFmpeg() first.');
    }
    if (!(file instanceof Blob)) {
        throw new Error('extractAudio: expected a File or Blob');
    }

    const inputName = file.name || 'input.mp4';
    const baseName = inputName.includes('.')
        ? inputName.substring(0, inputName.lastIndexOf('.'))
        : inputName;
    const outputName = `${baseName}_audio.m4a`;

    await _writeInputFile(ffmpeg, inputName, file);

    await ffmpeg.exec([
        '-i', inputName,
        '-vn',
        '-c:a', 'copy',
        outputName,
    ]);

    const blob = await _readAndCleanup(ffmpeg, outputName, 'audio/mp4');

    await ffmpeg.deleteFile(inputName);

    return {
        blob,
        filename: outputName,
    };
}

/**
 * Extract the video track from a file, stripping audio (stream copy, no re-encoding).
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg - Loaded FFmpeg instance
 * @param {File|Blob} file - Source video file
 * @returns {Promise<{ blob: Blob, filename: string }>}
 *   Video-only blob and suggested filename.
 * @throws {Error} If parameters are invalid
 */
export async function extractVideo(ffmpeg, file) {
    if (!ffmpeg) {
        throw new Error('extractVideo: ffmpeg instance is required. Call loadFFmpeg() first.');
    }
    if (!(file instanceof Blob)) {
        throw new Error('extractVideo: expected a File or Blob');
    }

    const inputName = file.name || 'input.mp4';
    const ext = inputName.includes('.') ? inputName.substring(inputName.lastIndexOf('.')) : '.mp4';
    const baseName = inputName.includes('.')
        ? inputName.substring(0, inputName.lastIndexOf('.'))
        : inputName;
    const outputName = `${baseName}_video${ext}`;

    await _writeInputFile(ffmpeg, inputName, file);

    await ffmpeg.exec([
        '-i', inputName,
        '-an',
        '-c:v', 'copy',
        outputName,
    ]);

    const mimeType = _mimeFromFilename(outputName);
    const blob = await _readAndCleanup(ffmpeg, outputName, mimeType);

    await ffmpeg.deleteFile(inputName);

    return {
        blob,
        filename: outputName,
    };
}
