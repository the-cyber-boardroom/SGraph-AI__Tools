/**
 * mp-api.js
 * Entry point — registers SgToolApi, activates (JS-API-first: window.__tool is
 * live from tool:ready, BEFORE the UI mounts), then hands off to the shell.
 *
 * @module mp-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { zipEntries } from '/core/sg-zip/v0/v0.1/v0.1.0/sg-zip.js';
import { estimateCost } from '/core/sg-media-analysis/v0/v0.1/v0.1.0/plan.js';
import { MP_EVENTS } from './mp-events.js';
import { state, config, loadConfig, saveConfig, probeToJson } from './mp-state.js';
import * as Pipe from './mp-pipeline.js';
import { findings } from './mp-findings.js';
import { init as initShell } from '../ui/ui-shell.js';

const api = new SgToolApi({
    name:     'media-probe',
    version:  { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(name, detail = {}) { api._emit(name, detail); }

loadConfig();
Pipe.initPipeline({ emit });

function getStatus() {
    return {
        status: state.status,
        source: state.source,
        lanes: { ...state.lanes },
        threshold: config.threshold,
        strategy: state.plan ? state.plan.strategy : null,
        ffmpegLoaded: !!state.ffmpeg,
        notMeasured: probeToJson().gaps_in_analysis.map(x => x.code),
    };
}

function reset() {
    state.reset();
    emit(MP_EVENTS.RESET, {});
    return { ok: true };
}

/** CSV of the traces — the shape a spreadsheet or a notebook wants. */
function probeCsv() {
    const rows = [];
    if (state.audio) {
        rows.push('# audio: frame,tMs,rms,dbfs,flatness');
        for (let i = 0; i < state.audio.frames; i++) {
            rows.push(`${i},${i * state.audio.frameMs},${state.audio.rms[i].toFixed(6)},${state.audio.dbfs[i].toFixed(2)},${state.audio.flatness[i].toFixed(4)}`);
        }
    }
    if (state.frames) {
        rows.push('# frames: tMs,meanAbs,blockMax,edgeDiff,histDist');
        for (const t of state.frames.trace) {
            rows.push(`${t.at},${t.meanAbs.toFixed(6)},${t.blockMax.toFixed(6)},${t.edgeDiff.toFixed(6)},${t.histDist.toFixed(6)}`);
        }
    }
    return rows.join('\n');
}

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function downloadProbe(p = {}) {
    const format = p.format || 'json';
    const base = `media-probe-${(state.source && state.source.name || 'probe').replace(/\.[^.]+$/, '')}`;
    if (format === 'csv') {
        const blob = new Blob([probeCsv()], { type: 'text/csv' });
        download(blob, `${base}.csv`);
        return { name: `${base}.csv`, bytes: blob.size };
    }
    if (format === 'zip') {
        const blob = await zipEntries([
            { path: 'probe.json', text: JSON.stringify(probeToJson(), null, 2) },
            { path: 'traces.csv', text: probeCsv() },
            { path: 'FINDINGS.md', text: findings().markdown },
        ], { JSZip: p.JSZip });
        download(blob, `${base}.zip`);
        return { name: `${base}.zip`, bytes: blob.size };
    }
    const blob = new Blob([JSON.stringify(probeToJson(), null, 2)], { type: 'application/json' });
    download(blob, `${base}.json`);
    return { name: `${base}.json`, bytes: blob.size };
}

api
    .register('getStatus',          getStatus,                { async: false })
    .register('loadVideo',          Pipe.loadVideo,           { async: true, events: [MP_EVENTS.SOURCE_LOADED],
        sanitiseParams: p => ({ ...p, file: p?.file ? `<${p.file.type || 'media'} ${p.file.size || 0}b>` : undefined }) })
    .register('estimateSweep',      Pipe.estimateSweep,       { async: false })

    .register('analyseAudio',       Pipe.analyseAudio,        { async: true, events: [MP_EVENTS.ANALYSE_COMPLETE] })
    .register('analyseFrames',      Pipe.analyseFrames,       { async: true, events: [MP_EVENTS.ANALYSE_PROGRESS, MP_EVENTS.ANALYSE_COMPLETE] })
    .register('cancelSweep',        Pipe.cancelSweep,         { async: false })
    .register('captureFilmstrip',   Pipe.captureFilmstrip,    { async: true, events: [MP_EVENTS.ANALYSE_COMPLETE] })
    .register('getFilmstrip',       () => ({ frames: (state.filmstrip || []).map(f => ({ at: f.at, mark: f.mark, thumb: f.thumb })) }), { async: false })
    .register('analyseAll',         Pipe.analyseAll,          { async: true })

    .register('setThreshold',       Pipe.setThreshold,        { async: false, events: [MP_EVENTS.THRESHOLD_CHANGED] })
    .register('replaySegmentation', Pipe.replaySegmentation,  { async: false })
    .register('findScenes',         Pipe.findScenesNow,       { async: false })
    .register('alignSignals',       Pipe.alignSignals,        { async: false })

    .register('plan',               Pipe.makePlan,            { async: false, events: [MP_EVENTS.PLAN_READY] })
    .register('compare',            Pipe.compare,             { async: false })
    .register('estimateCost',       (p = {}) => estimateCost(p.captures || 0), { async: false })

    .register('getProbe',           probeToJson,              { async: false })
    .register('getFindings',        findings,                 { async: false })
    .register('getSceneThumb',      (p = {}) => Pipe.thumbAt(p.at || 0, p.width).then(dataUrl => ({ dataUrl })), { async: true })
    .register('downloadProbe',      downloadProbe,            { async: true })

    .register('runFfmpegLane',      Pipe.runFfmpegLane,       { async: true, events: [MP_EVENTS.FFMPEG_READY] })
    .register('ffmpegAvailable',    () => ({ loaded: !!state.ffmpeg, wasmSupported: typeof WebAssembly === 'object' }), { async: false })

    .register('setConfig',          (p = {}) => {
        for (const k of ['coarseFps', 'fineFps', 'twoPass', 'sceneMetric', 'sceneFactor', 'minSceneMs', 'frameMs']) {
            if (p[k] !== undefined) config[k] = p[k];
        }
        saveConfig();
        return { ...config };
    }, { async: false })
    .register('reset',              reset,                    { async: false, events: [MP_EVENTS.RESET] });

// JS-API-first: activate before UI so window.__tool is live from tool:ready.
api.activate();

await initShell(state, config, api, emit);
