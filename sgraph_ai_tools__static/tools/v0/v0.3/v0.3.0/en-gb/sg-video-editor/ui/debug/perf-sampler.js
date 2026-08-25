/** perf-sampler.js — 1 Hz data sampler + rAF FPS counter for the Perf panel. */

import { getSnapshot } from './memory-probe.js';

const HISTORY = 60; // one sample per second, 60-second window

function push(arr, v) { arr.push(v); if (arr.length > HISTORY) arr.shift(); }

/**
 * Create a performance data sampler tied to the editor state.
 * @param {{ state: object }} opts
 * @returns {{ start, stop, getLive, fetchStorageEstimate }}
 */
export function createPerfSampler({ state }) {
    let _running = false;
    let _ivId = null;
    let _rafId = null;
    let _fpsFrames = 0;
    let _fpsTick = 0;
    let _fpsLive = 0;
    let _storageEst = null;

    const _heapMb = [];
    const _blobs  = [];
    const _videos = [];
    const _fps    = [];

    function _raf(now) {
        if (!_running) return;
        _fpsFrames++;
        if (now - _fpsTick >= 1000) {
            _fpsLive = _fpsFrames;
            _fpsFrames = 0;
            _fpsTick = now;
            push(_fps, _fpsLive);
        }
        _rafId = requestAnimationFrame(_raf);
    }

    function _sample() {
        const s = getSnapshot();
        const pm = s.perfMemory;
        push(_heapMb, pm ? pm.usedJSHeapBytes / 1048576 : 0);
        push(_blobs,  s.blobUrlsLive || 0);
        push(_videos, s.videoElementsInDom || 0);
    }

    function _device() {
        return {
            memGB:   (typeof navigator !== 'undefined' && navigator.deviceMemory)       || null,
            threads: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || null,
        };
    }

    function _project() {
        try {
            const p = state && typeof state.getProject === 'function' && state.getProject();
            if (!p) return null;
            const assets = Array.isArray(p.assets) ? p.assets : [];
            const tracks = Array.isArray(p.tracks)  ? p.tracks : [];
            const bytes  = assets.reduce((s, a) => s + (a ? (a.bytes || 0) : 0), 0);
            const clips  = tracks.reduce((s, t) => s + (t && Array.isArray(t.clips) ? t.clips.length : 0), 0);
            return { assetCount: assets.length, bytes, trackCount: tracks.length, clipCount: clips };
        } catch (_) { return null; }
    }

    async function fetchStorageEstimate() {
        if (_storageEst) return _storageEst;
        try {
            const e = await navigator.storage.estimate();
            _storageEst = { quota: e.quota || 0, usage: e.usage || 0 };
        } catch (_) { _storageEst = null; }
        return _storageEst;
    }

    return {
        start() {
            if (_running) return;
            _running = true;
            _fpsTick = performance.now();
            _rafId = requestAnimationFrame(_raf);
            _sample();
            _ivId = setInterval(_sample, 1000);
            fetchStorageEstimate();
        },
        stop() {
            _running = false;
            if (_ivId)  { clearInterval(_ivId);           _ivId  = null; }
            if (_rafId) { cancelAnimationFrame(_rafId);   _rafId = null; }
        },
        getLive() {
            return {
                snap:        getSnapshot(),
                fps:         _fpsLive,
                heapHistory: _heapMb.slice(),
                blobHistory: _blobs.slice(),
                vidHistory:  _videos.slice(),
                fpsHistory:  _fps.slice(),
                device:      _device(),
                storage:     _storageEst,
                project:     _project(),
            };
        },
        fetchStorageEstimate,
    };
}
