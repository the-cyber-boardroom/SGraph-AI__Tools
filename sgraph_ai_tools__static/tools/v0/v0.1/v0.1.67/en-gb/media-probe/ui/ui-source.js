/**
 * ui-source.js
 * Drop a recording, choose the sweep, run the lanes.
 *
 * The two lanes are separate buttons on purpose. The audio lane is seconds and
 * answers the question that matters most — "will this segment at all?" — while
 * the frame sweep is the expensive one. Bundling them behind a single "Analyse"
 * would stop anyone using the cheap answer, which is the answer that would have
 * caught the original defect.
 *
 * @module ui-source
 */

export function initSource(el, state, config, api, emit) {
    if (!el) return;
    el.innerHTML = `<div class="mp-src">
        <div id="mp-drop" class="mp-drop" tabindex="0">
          <div class="mp-drop__big">🎬</div>
          <div>Drop a recording here, or click to choose</div>
          <div class="mp-muted">mp4 · webm · mov · or audio only. Nothing is uploaded and no model is called —
            this costs nothing to run, which is the point of running it <b>before</b> an import.</div>
          <input id="mp-file" type="file" accept="video/*,audio/*" hidden>
        </div>
        <div id="mp-src-info" class="mp-muted">no recording loaded</div>

        <h4>1 · Audio <span class="mp-muted">— seconds, and the important one</span></h4>
        <div class="mp-row">
          <button id="mp-run-audio" class="mp-btn mp-btn--primary" disabled>Analyse audio</button>
          <span id="mp-audio-state" class="mp-muted"></span>
        </div>

        <h4>2 · Frames <span class="mp-muted">— the slow one</span></h4>
        <div class="mp-row">
          <label>coarse fps <input id="mp-coarse" type="number" min="0.2" max="10" step="0.2" value="1"></label>
          <label>fine fps <input id="mp-fine" type="number" min="1" max="30" step="1" value="10"></label>
          <label><input id="mp-twopass" type="checkbox" checked> two-pass</label>
        </div>
        <div class="mp-row">
          <button id="mp-run-frames" class="mp-btn" disabled>Sweep frames</button>
          <button id="mp-cancel" class="mp-btn mp-btn--sm" disabled>Cancel</button>
          <span id="mp-sweep-est" class="mp-muted"></span>
        </div>
        <div class="mp-bar"><div id="mp-progress" class="mp-bar__fill"></div></div>

        <h4>3 · Plan</h4>
        <div class="mp-row">
          <button id="mp-run-all" class="mp-btn" disabled>Analyse everything</button>
          <button id="mp-plan" class="mp-btn" disabled>Make a plan</button>
        </div>
        <div class="mp-row">
          <button id="mp-dl-json" class="mp-btn mp-btn--sm" disabled>⬇ probe.json</button>
          <button id="mp-dl-csv" class="mp-btn mp-btn--sm" disabled>⬇ traces.csv</button>
          <button id="mp-dl-zip" class="mp-btn mp-btn--sm" disabled>⬇ zip</button>
        </div>

        <h4>Cross-check <span class="mp-muted">— optional, loads FFmpeg</span></h4>
        <div class="mp-row">
          <button id="mp-ff-silence" class="mp-btn mp-btn--sm" disabled>silencedetect</button>
          <button id="mp-ff-scene" class="mp-btn mp-btn--sm" disabled>scene scores</button>
          <span id="mp-ff-state" class="mp-muted"></span>
        </div>
        <div class="mp-muted">FFmpeg's own filters compute what this tool hand-rolls, at the native frame rate.
          Worth one WASM load to see whether our numbers agree.</div>

        <div id="mp-warnings" class="mp-warnings"></div>
      </div>`;

    const q = s => el.querySelector(s);
    const drop = q('#mp-drop'), file = q('#mp-file');
    const setEnabled = () => {
        const has = !!state.source;
        q('#mp-run-audio').disabled = !has;
        q('#mp-run-frames').disabled = !has || !state.source.width;
        q('#mp-run-all').disabled = !has;
        q('#mp-plan').disabled = !(state.audio || state.scenes);
        for (const id of ['#mp-dl-json', '#mp-dl-csv', '#mp-dl-zip']) q(id).disabled = !has;
        q('#mp-ff-silence').disabled = !has;
        q('#mp-ff-scene').disabled = !has || !state.source.width;
    };

    async function load(f) {
        if (!f) return;
        q('#mp-src-info').textContent = `loading ${f.name}…`;
        try {
            const r = await api.loadVideo({ file: f });
            const px = r.width ? `${r.width}×${r.height}` : 'no picture in-browser';
            q('#mp-src-info').innerHTML = `<b>${r.name}</b> · ${(r.size / 1048576).toFixed(1)} MB · ${fmt(r.durationMs)} · ${px}`;
            q('#mp-sweep-est').textContent = r.sweepEstimate
                ? `≈ ${r.sweepEstimate.samples} samples, ~${Math.ceil(r.sweepEstimate.estimatedMs / 1000)} s`
                : '';
        } catch (err) {
            q('#mp-src-info').textContent = `${err.code || 'error'}: ${err.message}`;
        }
        setEnabled();
    }

    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { load(file.files && file.files[0]); file.value = ''; });
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); });
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); });
    drop.addEventListener('drop', e => load(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));

    q('#mp-run-audio').addEventListener('click', async () => {
        q('#mp-audio-state').textContent = 'measuring…';
        try {
            const s = await api.analyseAudio({});
            q('#mp-audio-state').innerHTML = `floor ${s.floor.toFixed(4)} · speech ${s.speech.toFixed(4)} · `
                + `threshold ${s.threshold.toFixed(4)} · <b>${s.topicGaps} topic gaps</b>`;
        } catch (err) { q('#mp-audio-state').textContent = `${err.code || 'error'}: ${err.message}`; }
        setEnabled();
    });

    q('#mp-run-frames').addEventListener('click', async () => {
        q('#mp-cancel').disabled = false;
        try {
            const s = await api.analyseFrames({
                coarseFps: Number(q('#mp-coarse').value), fineFps: Number(q('#mp-fine').value),
                twoPass: q('#mp-twopass').checked,
            });
            q('#mp-sweep-est').textContent = `${s.samples} samples · ${s.scenes} scenes`;
        } catch (err) { q('#mp-sweep-est').textContent = `${err.code || 'error'}: ${err.message}`; }
        q('#mp-cancel').disabled = true;
        q('#mp-progress').style.width = '0%';
        setEnabled();
    });
    q('#mp-cancel').addEventListener('click', () => api.cancelSweep());

    q('#mp-run-all').addEventListener('click', async () => {
        try { await api.analyseAll({}); } catch (err) { q('#mp-src-info').innerHTML += `<br>${err.message}`; }
        setEnabled();
    });
    q('#mp-plan').addEventListener('click', async () => {
        try { await api.plan({}); } catch (err) { q('#mp-src-info').innerHTML += `<br>${err.message}`; }
        setEnabled();
    });

    for (const [id, format] of [['#mp-dl-json', 'json'], ['#mp-dl-csv', 'csv'], ['#mp-dl-zip', 'zip']]) {
        q(id).addEventListener('click', () => api.downloadProbe({ format }).catch(() => {}));
    }
    for (const [id, what] of [['#mp-ff-silence', 'silence'], ['#mp-ff-scene', 'scene']]) {
        q(id).addEventListener('click', async () => {
            q('#mp-ff-state').textContent = 'loading FFmpeg…';
            try {
                const r = await api.runFfmpegLane({ what });
                q('#mp-ff-state').textContent = `${what}: ${r.rows} rows`;
            } catch (err) { q('#mp-ff-state').textContent = `${err.code || 'error'}: ${err.message}`; }
        });
    }

    window.addEventListener('mp:analyse:progress', e => {
        const d = e.detail || {};
        if (d.total) q('#mp-progress').style.width = `${Math.round(100 * (d.done || 0) / d.total)}%`;
        q('#mp-sweep-est').textContent = `pass ${d.pass}: ${d.done}/${d.total}`;
    });

    // Warnings accumulate and stay put. An unreliable measurement that scrolls
    // away is an unreliable measurement nobody saw.
    window.addEventListener('mp:warning', e => {
        const d = e.detail || {};
        const row = document.createElement('div');
        row.className = 'mp-warn';
        row.innerHTML = `<b>${d.code}</b> ${d.message || ''}`;
        q('#mp-warnings').appendChild(row);
    });
    window.addEventListener('mp:reset', () => {
        q('#mp-warnings').innerHTML = '';
        q('#mp-src-info').textContent = 'no recording loaded';
        q('#mp-audio-state').textContent = ''; q('#mp-sweep-est').textContent = '';
        setEnabled();
    });

    // A recording can also arrive through the JS API — an agent, an embedder, the
    // console. Without this the panel keeps saying "no recording loaded" while the
    // analysis is plainly running, which is the same misleading-chip bug that made
    // a reviewer think no API key was set.
    window.addEventListener('mp:source:loaded', e => {
        const d = e.detail || {};
        const px = d.width ? `${d.width}×${d.height}` : 'no picture in-browser';
        q('#mp-src-info').innerHTML = `<b>${d.name}</b> · ${((d.size || 0) / 1048576).toFixed(1)} MB · ${fmt(d.durationMs)} · ${px}`;
        setEnabled();
    });
    window.addEventListener('mp:analyse:complete', e => {
        const d = e.detail || {};
        if (d.lane === 'audio' && d.summary) {
            q('#mp-audio-state').innerHTML = `floor ${d.summary.floor.toFixed(4)} · speech ${d.summary.speech.toFixed(4)} · `
                + `threshold ${d.summary.threshold.toFixed(4)} · <b>${d.summary.topicGaps} topic gaps</b>`;
        }
        if (d.lane === 'frames' && d.summary) {
            q('#mp-sweep-est').textContent = `${d.summary.samples} samples · ${d.summary.scenes} scenes`;
            q('#mp-progress').style.width = '0%';
        }
        setEnabled();
    });
    window.addEventListener('mp:plan:ready', setEnabled);
    setEnabled();
}

function fmt(ms) {
    const t = Math.round(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
