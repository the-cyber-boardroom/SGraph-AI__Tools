/**
 * ui-timeline.js
 * The centrepiece: every measurement on one shared time axis.
 *
 * Lanes, top to bottom: audio energy with the threshold lines drawn ON it, the
 * gaps that threshold produces, the four frame metrics, then two boundary lanes —
 * what narrated-review does today, and what the plan proposes.
 *
 * Dragging the threshold line re-runs the REAL VAD and redraws the boundary
 * lanes. That interaction is the whole tool: it turns an invisible constant into
 * something you can feel. The original defect — nine identical 30-second captures
 * because the threshold sat below the noise floor — is visible here in one glance,
 * because the floor and the line are on the same axis.
 *
 * @module ui-timeline
 */

import { replaySegmentation } from '../api/mp-pipeline.js';

const LANE = { film: 46, audio: 90, gaps: 14, metric: 34, bounds: 22 };
const METRIC_COLOURS = { meanAbs: '#64748b', blockMax: '#14b8a6', edgeDiff: '#f59e0b', histDist: '#a855f7' };
const PAD_L = 54, PAD_R = 10, PAD_T = 8;

export function initTimeline(el, state, config, api) {
    if (!el) return;
    el.innerHTML = `<div class="mp-tl">
        <div class="mp-row mp-tl__ctrl">
          <label>silence threshold
            <input id="mp-thr" type="range" min="0" max="1000" value="0" disabled>
          </label>
          <span id="mp-thr-val" class="mp-mono">—</span>
          <span id="mp-thr-out" class="mp-muted"></span>
        </div>
        <div class="mp-tl__wrap">
          <canvas id="mp-canvas" class="mp-canvas"></canvas>
          <div id="mp-scrub" class="mp-scrub" hidden>
            <img id="mp-scrub-img" alt="frame at the cursor">
            <div id="mp-scrub-meta" class="mp-scrub__meta"></div>
          </div>
        </div>
        <div class="mp-legend" id="mp-legend"></div>
        <div class="mp-muted">Drag the slider: the gap lane and both boundary lanes re-run the real VAD live.
          If the dashed <i>0.01</i> line sits inside the energy band rather than under it, an absolute threshold
          cannot work on this recording — that is the failure this tool exists to make visible.</div>
      </div>`;

    const canvas = el.querySelector('#mp-canvas');
    const slider = el.querySelector('#mp-thr');
    const thrVal = el.querySelector('#mp-thr-val');
    const thrOut = el.querySelector('#mp-thr-out');

    el.querySelector('#mp-legend').innerHTML = Object.entries(METRIC_COLOURS)
        .map(([k, c]) => `<span class="mp-legend__i"><i style="background:${c}"></i>${k}</span>`).join('')
        + '<span class="mp-legend__i"><i style="background:#14b8a6"></i>threshold</span>'
        + '<span class="mp-legend__i"><i style="background:#64748b"></i>old fixed 0.01</span>';

    // The slider is exponential over the recording's own range, because the
    // interesting region is a narrow band just above the noise floor.
    function sliderToValue(v) {
        const max = state.audio ? Math.max(state.audio.levels.speech * 1.5, 0.02) : 0.1;
        return (v / 1000) ** 2 * max;
    }
    function valueToSlider(x) {
        const max = state.audio ? Math.max(state.audio.levels.speech * 1.5, 0.02) : 0.1;
        return Math.round(1000 * Math.sqrt(Math.max(0, Math.min(1, x / max))));
    }

    slider.addEventListener('input', () => {
        if (!state.audio) return;
        const v = sliderToValue(Number(slider.value));
        const r = api.setThreshold({ value: v });
        Promise.resolve(r).then(res => {
            thrVal.textContent = v.toFixed(4);
            thrOut.textContent = `${res.gaps} gaps · ${res.populations.topic.count} topic · `
                + `${res.segments} segments, ${res.capped} force-cut`;
            draw();
        }).catch(() => {});
    });

    function ready() {
        if (!state.audio) return;
        slider.disabled = false;
        slider.value = valueToSlider(config.threshold);
        thrVal.textContent = Number(config.threshold).toFixed(4);
        draw();
    }
    for (const ev of ['mp:analyse:complete', 'mp:plan:ready', 'mp:threshold:changed']) {
        window.addEventListener(ev, () => { loadFilms(); ready(); });
    }
    window.addEventListener('mp:reset', () => {
        slider.disabled = true; thrVal.textContent = '—'; films = []; hideScrub(); clear();
    });
    // A tab that was hidden when the data arrived still has to draw when shown.
    new ResizeObserver(() => draw()).observe(el);

    function clear() {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // ── Filmstrip images ─────────────────────────────────────────────────────
    // Canvas cannot draw a data URL directly, so each thumbnail is decoded once
    // into an Image and cached. Redraw when they are all in, otherwise the first
    // paint shows an empty strip.
    let films = [];
    function loadFilms() {
        const src = state.filmstrip || [];
        if (films.length === src.length && films.every((f, i) => f.at === src[i].at)) return;
        films = src.map(f => ({ at: f.at, mark: f.mark, img: null }));
        let pending = src.length;
        if (!pending) return;
        src.forEach((f, i) => {
            const img = new Image();
            img.onload = () => { films[i].img = img; if (--pending === 0) draw(); };
            img.onerror = () => { if (--pending === 0) draw(); };
            img.src = f.thumb;
        });
    }

    // ── Hover: a playhead across every lane + a frame preview ────────────────
    // The point of a screenshot track is answering "what was on screen HERE?", so
    // the preview comes from the already-decoded strip rather than a fresh seek —
    // instant, and it cannot fight the sampler for the one <video> element.
    let hoverMs = null;
    canvas.addEventListener('mousemove', e => {
        if (!state.audio && !state.frames) return;
        const rect = canvas.getBoundingClientRect();
        const plotW = rect.width - PAD_L - PAD_R;
        const rel = (e.clientX - rect.left - PAD_L) / plotW;
        if (rel < 0 || rel > 1) { hideScrub(); return; }
        const durationMs = Math.max(1, (state.source && state.source.durationMs) || 0);
        hoverMs = Math.round(rel * durationMs);
        showScrub(e.clientX - rect.left, rect);
        draw();
    });
    canvas.addEventListener('mouseleave', () => { hideScrub(); draw(); });

    function nearestFilm(ms) {
        let best = null;
        for (const f of films) {
            if (!f.img) continue;
            if (!best || Math.abs(f.at - ms) < Math.abs(best.at - ms)) best = f;
        }
        return best;
    }
    function showScrub(x, rect) {
        const scrub = el.querySelector('#mp-scrub');
        const f = nearestFilm(hoverMs);
        if (!f) { scrub.hidden = true; return; }
        el.querySelector('#mp-scrub-img').src = f.img.src;
        const scene = (state.scenes ? state.scenes.scenes : []).find(s => Math.abs(s.at - hoverMs) < 400);
        el.querySelector('#mp-scrub-meta').textContent =
            `${fmt(hoverMs)}${f.at !== hoverMs ? ` · frame ${fmt(f.at)}` : ''}${scene ? ' · scene change' : ''}`;
        scrub.hidden = false;
        scrub.style.left = `${Math.min(Math.max(0, x - 94), rect.width - 196)}px`;
    }
    function hideScrub() {
        hoverMs = null;
        el.querySelector('#mp-scrub').hidden = true;
    }

    function draw() {
        const a = state.audio;
        const w = Math.max(320, el.clientWidth - 28);
        const metricLanes = state.frames ? 4 : 0;
        const filmLane = (state.filmstrip && state.filmstrip.length) ? LANE.film : 0;
        const h = PAD_T + filmLane + LANE.audio + LANE.gaps + metricLanes * LANE.metric + LANE.bounds * 2 + 34;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!a) return;

        const durationMs = Math.max(1, state.source.durationMs || a.durationMs);
        const plotW = w - PAD_L - PAD_R;
        const x = ms => PAD_L + plotW * Math.min(1, ms / durationMs);
        let y = PAD_T;

        // ── Filmstrip ─────────────────────────────────────────────────────────
        // What was on screen, at the time it was on screen. Thumbnails sit at
        // their real x position rather than in even slots, and any that would
        // collide with the previous one is skipped — so the spacing itself tells
        // you where the tool looked most closely.
        if (filmLane) {
            label(ctx, 'screen', y + LANE.film / 2);
            ctx.fillStyle = '#0e1526';
            ctx.fillRect(PAD_L, y, plotW, LANE.film);
            const th = LANE.film - 6;
            const tw = Math.round(th * (state.source.width || 16) / (state.source.height || 9));
            let right = PAD_L - 2;
            for (const f of films) {
                if (!f.img) continue;
                const px = x(f.at);
                if (px < right + 2) continue;                  // would overlap — skip
                if (px + tw > PAD_L + plotW) break;
                ctx.drawImage(f.img, px, y + 3, tw, th);
                if (f.mark) {
                    // A detected change: mark it so the strip shows WHY it is here.
                    ctx.fillStyle = '#14b8a6';
                    ctx.fillRect(px, y + 1, tw, 2);
                }
                right = px + tw;
            }
            y += LANE.film + 4;
        }

        // ── Audio energy ──────────────────────────────────────────────────────
        const eMax = Math.max(a.levels.speech * 1.6, 0.02);
        label(ctx, 'energy', y + LANE.audio / 2);
        ctx.fillStyle = '#0e1526';
        ctx.fillRect(PAD_L, y, plotW, LANE.audio);
        ctx.strokeStyle = '#2dd4bf';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // One vertical extent per pixel column: a 4-minute recording is ~13 000
        // frames over ~900 px, so plotting every frame would just be aliasing.
        for (let px = 0; px < plotW; px++) {
            const from = Math.floor(a.frames * px / plotW);
            const to = Math.max(from + 1, Math.floor(a.frames * (px + 1) / plotW));
            let peak = 0;
            for (let i = from; i < to && i < a.frames; i++) peak = Math.max(peak, a.rms[i]);
            const yy = y + LANE.audio - Math.min(1, peak / eMax) * LANE.audio;
            ctx.moveTo(PAD_L + px, y + LANE.audio);
            ctx.lineTo(PAD_L + px, yy);
        }
        ctx.stroke();

        // Floor and speech bands — the context the threshold has to sit inside.
        hline(ctx, PAD_L, plotW, y + LANE.audio - Math.min(1, a.levels.floor / eMax) * LANE.audio, '#f8717155', 'floor');
        hline(ctx, PAD_L, plotW, y + LANE.audio - Math.min(1, a.levels.speech / eMax) * LANE.audio, '#38bdf855', 'speech');
        // The active threshold (solid) and the value that failed (dashed).
        hline(ctx, PAD_L, plotW, y + LANE.audio - Math.min(1, config.threshold / eMax) * LANE.audio, '#14b8a6', '');
        ctx.setLineDash([4, 3]);
        hline(ctx, PAD_L, plotW, y + LANE.audio - Math.min(1, 0.01 / eMax) * LANE.audio, '#94a3b8', '0.01');
        ctx.setLineDash([]);
        y += LANE.audio + 4;

        // ── Gaps at the current threshold ─────────────────────────────────────
        label(ctx, 'gaps', y + LANE.gaps / 2);
        ctx.fillStyle = '#0e1526'; ctx.fillRect(PAD_L, y, plotW, LANE.gaps);
        for (const g of (state.gaps ? state.gaps.all : [])) {
            // Only topic-length gaps are boundary candidates; the rest are word
            // and sentence gaps and are drawn faint so the ratio is visible.
            ctx.fillStyle = g.durationMs >= 1000 ? '#14b8a6' : g.durationMs >= 300 ? '#0d9488aa' : '#33415555';
            const gw = Math.max(1, plotW * g.durationMs / durationMs);
            ctx.fillRect(x(g.tMs), y + 2, gw, LANE.gaps - 4);
        }
        y += LANE.gaps + 4;

        // ── Frame metrics ─────────────────────────────────────────────────────
        if (state.frames) {
            for (const [m, colour] of Object.entries(METRIC_COLOURS)) {
                label(ctx, m, y + LANE.metric / 2);
                ctx.fillStyle = '#0e1526'; ctx.fillRect(PAD_L, y, plotW, LANE.metric);
                const mMax = Math.max(state.frames.p95[m] * 3, 0.01);
                ctx.strokeStyle = colour; ctx.beginPath();
                for (const t of state.frames.trace) {
                    const px = x(t.at);
                    const yy = y + LANE.metric - Math.min(1, t[m] / mMax) * LANE.metric;
                    ctx.moveTo(px, y + LANE.metric); ctx.lineTo(px, yy);
                }
                ctx.stroke();
                y += LANE.metric + 2;
            }
        }

        // ── Boundaries: today, and the plan ───────────────────────────────────
        bounds(ctx, 'today', y, state.today ? segmentsOf(state.today) : [], x, plotW, durationMs, true);
        y += LANE.bounds + 4;
        bounds(ctx, 'plan', y, state.plan ? state.plan.cuts.map(c => c.tMs) : [], x, plotW, durationMs, false,
            state.plan ? state.plan.cuts : []);
        y += LANE.bounds + 4;

        // Time axis.
        ctx.fillStyle = '#7a8699'; ctx.font = '10px system-ui, sans-serif';
        const stepMs = niceStep(durationMs);
        for (let t = 0; t <= durationMs; t += stepMs) {
            ctx.fillRect(x(t), y, 1, 4);
            ctx.fillText(fmt(t), x(t) - 12, y + 15);
        }

        // Playhead last, so it sits over every lane — the "where am I" line that
        // makes a stack of traces readable as one moment in time.
        if (hoverMs != null) {
            ctx.strokeStyle = '#f8fafc'; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x(hoverMs) + 0.5, PAD_T);
            ctx.lineTo(x(hoverMs) + 0.5, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    /**
     * The exact cut positions the real VAD produces at the current threshold.
     * Called through the pipeline rather than the registered action, because the
     * registered form returns a Promise and drawing is synchronous.
     */
    function segmentsOf() {
        try { return replaySegmentation({}).segments.map(s => s.tStart); }
        catch (_) { return []; }
    }

    function bounds(ctx, name, y, cuts, x, plotW, durationMs, isToday, meta) {
        label(ctx, name, y + LANE.bounds / 2);
        ctx.fillStyle = '#0e1526'; ctx.fillRect(PAD_L, y, plotW, LANE.bounds);
        const all = [...cuts, durationMs];
        for (let i = 0; i < cuts.length; i++) {
            const from = x(cuts[i]), to = x(all[i + 1]);
            const m = meta && meta[i];
            // Amber means ARBITRARY: no pause and no scene change behind it. Only
            // 'length-limit' qualifies — the start of a recording is a boundary by
            // definition, and colouring it as a guess was misleading.
            const arbitrary = !!m && m.source === 'length-limit';
            ctx.fillStyle = isToday ? '#475569' : arbitrary ? '#f59e0b' : '#14b8a6';
            ctx.fillRect(from + 1, y + 3, Math.max(1, to - from - 2), LANE.bounds - 6);
        }
        ctx.fillStyle = '#0a0a18';
        for (const c of cuts) ctx.fillRect(x(c), y, 1, LANE.bounds);
    }

    function label(ctx, text, y) {
        ctx.fillStyle = '#7a8699'; ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(text, 4, y + 3);
    }
    function hline(ctx, x0, w, y, colour, text) {
        ctx.strokeStyle = colour; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
        if (text) { ctx.fillStyle = colour; ctx.font = '9px system-ui, sans-serif'; ctx.fillText(text, x0 + 2, y - 2); }
    }
}

function niceStep(durationMs) {
    for (const s of [5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3]) {
        if (durationMs / s <= 12) return s;
    }
    return 900e3;
}
function fmt(ms) {
    const t = Math.round(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
