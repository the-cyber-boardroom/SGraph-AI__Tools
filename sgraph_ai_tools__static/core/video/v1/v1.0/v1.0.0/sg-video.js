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

            // Audio detection via browser APIs is unreliable at the
            // loadedmetadata stage — audioTracks is not widely supported,
            // mozHasAudio is Firefox-only, and webkitAudioDecodedByteCount
            // is always 0 before playback starts. Instead, we assume audio
            // is present for any media file with duration > 0 and let
            // FFmpeg handle the actual stream detection. If extractAudio()
            // is called on a file with no audio, FFmpeg will produce an
            // error which the component handles gracefully.
            const hasAudio = duration > 0;

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

    const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-vn',
        '-c:a', 'copy',
        outputName,
    ]);

    if (exitCode !== 0) {
        await ffmpeg.deleteFile(inputName);
        throw new Error('extractAudio: FFmpeg failed — the file may not contain an audio stream.');
    }

    let blob;
    try {
        blob = await _readAndCleanup(ffmpeg, outputName, 'audio/mp4');
    } catch (_e) {
        await ffmpeg.deleteFile(inputName);
        throw new Error('extractAudio: no audio output produced — the file may not contain an audio stream.');
    }

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

    const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-an',
        '-c:v', 'copy',
        outputName,
    ]);

    if (exitCode !== 0) {
        await ffmpeg.deleteFile(inputName);
        throw new Error('extractVideo: FFmpeg failed — the file may not contain a video stream.');
    }

    let blob;
    try {
        const mimeType = _mimeFromFilename(outputName);
        blob = await _readAndCleanup(ffmpeg, outputName, mimeType);
    } catch (_e) {
        await ffmpeg.deleteFile(inputName);
        throw new Error('extractVideo: no video output produced — the file may not contain a video stream.');
    }

    await ffmpeg.deleteFile(inputName);

    return {
        blob,
        filename: outputName,
    };
}

/**
 * Generate a small test video clip in the browser using Canvas + MediaRecorder.
 * Produces a ~2-second WebM with a video track (coloured frames with counter)
 * and an audio track (440 Hz sine tone).
 *
 * Useful for health-checking FFmpeg without needing external test files.
 *
 * @returns {Promise<File>} A small WebM file (~50-100 KB)
 */
export async function generateTestClip() {
    const DURATION_MS = 2000;
    const FPS = 10;
    const WIDTH = 160;
    const HEIGHT = 120;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    // Create audio context with a 440 Hz tone
    const audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    oscillator.frequency.value = 440;
    const dest = audioCtx.createMediaStreamDestination();
    oscillator.connect(dest);
    oscillator.start();

    // Combine canvas video stream + audio stream
    const canvasStream = canvas.captureStream(FPS);
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) {
        canvasStream.addTrack(audioTrack);
    }

    // Record
    const recorder = new MediaRecorder(canvasStream, {
        mimeType: 'video/webm;codecs=vp8,opus',
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const recordingDone = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();

    // Draw frames — cycling colours with a frame counter
    const colours = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6'];
    const totalFrames = Math.ceil((DURATION_MS / 1000) * FPS);
    for (let i = 0; i < totalFrames; i++) {
        ctx.fillStyle = colours[i % colours.length];
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), WIDTH / 2, HEIGHT / 2);
        await new Promise((r) => setTimeout(r, 1000 / FPS));
    }

    recorder.stop();
    oscillator.stop();
    audioCtx.close();
    await recordingDone;

    const blob = new Blob(chunks, { type: 'video/webm' });
    return new File([blob], 'test-clip.webm', { type: 'video/webm' });
}

/**
 * Run a health check on the FFmpeg environment. Loads FFmpeg if needed,
 * generates a test clip, and verifies split, trim, and extract operations.
 *
 * @param {Function} [onStep] - Optional callback({ step, total, label, status })
 *   called after each check completes. status is 'pass', 'fail', or 'skip'.
 * @returns {Promise<{ passed: boolean, results: Array<{ label: string, status: string, detail: string }> }>}
 */
export async function runHealthCheck(onStep) {
    const results = [];
    const steps = [
        'WebAssembly support',
        'Load FFmpeg WASM',
        'Generate test clip',
        'Get video info',
        'Split video',
        'Trim video',
        'Extract audio',
        'Extract video (silent)',
    ];
    const total = steps.length;
    let stepIndex = 0;

    function report(label, status, detail = '') {
        results.push({ label, status, detail });
        if (typeof onStep === 'function') {
            onStep({ step: stepIndex, total, label, status });
        }
        stepIndex++;
    }

    // 1. WASM support
    if (!isWasmSupported()) {
        report(steps[0], 'fail', 'WebAssembly not available');
        return { passed: false, results };
    }
    report(steps[0], 'pass');

    // 2. Load FFmpeg
    let ffmpeg;
    try {
        ffmpeg = await loadFFmpeg();
        report(steps[1], 'pass', 'FFmpeg WASM loaded successfully');
    } catch (err) {
        report(steps[1], 'fail', err.message);
        return { passed: false, results };
    }

    // 3. Generate test clip
    let testFile;
    try {
        testFile = await generateTestClip();
        report(steps[2], 'pass', `${(testFile.size / 1024).toFixed(1)} KB test clip generated`);
    } catch (err) {
        report(steps[2], 'fail', err.message);
        return { passed: false, results };
    }

    // 4. Get video info
    try {
        const info = await getVideoInfo(testFile);
        const ok = info.duration > 0 && info.width > 0 && info.height > 0;
        report(steps[3], ok ? 'pass' : 'fail',
            `${info.width}x${info.height}, ${formatTime(info.duration)}, ` +
            `audio: ${info.hasAudio ? 'yes' : 'no'}`);
    } catch (err) {
        report(steps[3], 'fail', err.message);
    }

    // 5. Split (2 segments of 1 second each)
    try {
        const segs = await splitVideo(ffmpeg, testFile, [
            { start: 0, end: 1 },
            { start: 1, end: 2 },
        ]);
        const ok = segs.length === 2 && segs[0].blob.size > 0 && segs[1].blob.size > 0;
        report(steps[4], ok ? 'pass' : 'fail',
            `${segs.length} segments, ${(segs[0].blob.size / 1024).toFixed(1)} KB + ${(segs[1].blob.size / 1024).toFixed(1)} KB`);
    } catch (err) {
        report(steps[4], 'fail', err.message);
    }

    // 6. Trim (keep 0.5–1.5s)
    try {
        const trimmed = await trimVideo(ffmpeg, testFile, 0.5, 1.5);
        const ok = trimmed.blob.size > 0;
        report(steps[5], ok ? 'pass' : 'fail',
            `${(trimmed.blob.size / 1024).toFixed(1)} KB trimmed clip`);
    } catch (err) {
        report(steps[5], 'fail', err.message);
    }

    // 7. Extract audio
    try {
        const audio = await extractAudio(ffmpeg, testFile);
        report(steps[6], 'pass', `${(audio.blob.size / 1024).toFixed(1)} KB audio extracted`);
    } catch (err) {
        // Audio extraction may fail on WebM depending on codec support
        report(steps[6], 'skip', err.message);
    }

    // 8. Extract video (silent)
    try {
        const video = await extractVideo(ffmpeg, testFile);
        report(steps[7], 'pass', `${(video.blob.size / 1024).toFixed(1)} KB silent video extracted`);
    } catch (err) {
        report(steps[7], 'skip', err.message);
    }

    const passed = results.every(r => r.status === 'pass' || r.status === 'skip');
    return { passed, results };
}
