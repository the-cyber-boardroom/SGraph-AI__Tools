/** ui-perf-panel.js — Perf tab: live metrics, sparklines, device info, instructions. */

import { createPerfSampler } from './perf-sampler.js';
import { PERF_INSTRUCTIONS_HTML } from './perf-instructions.js';

function fmtBytes(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
    return b + ' B';
}

function spark(vals, col) {
    if (vals.length < 2) return '<svg width="100%" height="28"></svg>';
    const w = 160, h = 28;
    const max = Math.max(...vals, 1);
    const pts = vals.map((v, i) => {
        const x = ((i / (vals.length - 1)) * (w - 2) + 1).toFixed(1);
        const y = (h - 2 - (v / max) * (h - 4)).toFixed(1);
        return `${x},${y}`;
    }).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%">` +
        `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5"` +
        ` stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function card(val, label, sub) {
    return `<div class="sgve-perf-card">` +
        `<span class="sgve-perf-val">${val}</span>` +
        `<span class="sgve-perf-lbl">${label}</span>` +
        (sub ? `<span class="sgve-perf-sub">${sub}</span>` : '') +
        `</div>`;
}

function renderLive(d) {
    const { snap, fps, heapHistory, blobHistory, vidHistory } = d;
    const pm = snap.perfMemory;
    const heapUsed  = pm ? pm.usedJSHeapBytes  : 0;
    const heapLimit = pm ? pm.jsHeapLimitBytes : 0;
    const heapPct   = heapLimit > 0 ? ` (${((heapUsed / heapLimit) * 100).toFixed(0)}%)` : '';
    const probeTip  = snap.enabled ? '' : ' ⚠ enable probe for lifecycle counts';

    return `<div class="sgve-perf-cards">` +
        card(fmtBytes(heapUsed), 'JS Heap',
            heapLimit > 0 ? `limit ${fmtBytes(heapLimit)}${heapPct}` : 'Chrome only') +
        card(snap.blobUrlsLive || 0, 'Blob URLs live',
            `${snap.blobUrlsCreatedTotal || 0} created total${probeTip}`) +
        card(snap.videoElementsInDom || 0, '&lt;video&gt; in DOM', '') +
        card(snap.videoElementsLive || 0, 'video els (probe)', probeTip ? 'enable probe' : `${snap.videosCreatedTotal || 0} created`) +
        card(snap.composerRebuilds || 0, 'rebuilds', 'destroy + recreate cycles') +
        card(fps || '—', 'rAF FPS', '') +
        `</div>` +
        `<div class="sgve-perf-sparks">` +
        `<div class="sgve-perf-spark"><span class="sgve-perf-spark-lbl">Heap (JS)</span>${spark(heapHistory, '#4ecdc4')}</div>` +
        `<div class="sgve-perf-spark"><span class="sgve-perf-spark-lbl">Blob URLs</span>${spark(blobHistory, '#f59e0b')}</div>` +
        `<div class="sgve-perf-spark"><span class="sgve-perf-spark-lbl">Video in DOM</span>${spark(vidHistory, '#f43f5e')}</div>` +
        `</div>`;
}

function renderDevice(device, storage) {
    const chips = [];
    if (device.memGB)   chips.push(`<span class="sgve-perf-chip"><b>RAM</b> ~${device.memGB} GB</span>`);
    if (device.threads) chips.push(`<span class="sgve-perf-chip"><b>CPU</b> ${device.threads} threads</span>`);
    if (storage) {
        chips.push(`<span class="sgve-perf-chip"><b>IDB quota</b> ${fmtBytes(storage.quota)}</span>`);
        chips.push(`<span class="sgve-perf-chip"><b>IDB used</b> ${fmtBytes(storage.usage)}</span>`);
    } else {
        chips.push(`<span class="sgve-perf-chip sgve-perf-muted">storage estimate pending…</span>`);
    }
    return `<div class="sgve-perf-chips">${chips.join('')}</div>`;
}

function renderProject(proj) {
    if (!proj) return `<div class="sgve-perf-chips"><span class="sgve-perf-chip sgve-perf-muted">no project</span></div>`;
    return `<div class="sgve-perf-chips">` +
        `<span class="sgve-perf-chip"><b>Assets</b> ${proj.assetCount} · ${fmtBytes(proj.bytes)}</span>` +
        `<span class="sgve-perf-chip"><b>Clips</b> ${proj.clipCount} on ${proj.trackCount} tracks</span>` +
        `</div>`;
}

function section(heading, bodyEl) {
    const el = document.createElement('div');
    el.className = 'sgve-perf-section';
    const h = document.createElement('div');
    h.className = 'sgve-cfg-heading';
    h.textContent = heading;
    el.appendChild(h);
    el.appendChild(bodyEl);
    return el;
}

/**
 * Mount the Perf panel into a host element.
 * @param {{ host: HTMLElement, state: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountPerfPanel({ host, state }) {
    if (!host) return { destroy() {} };

    const root = document.createElement('div');
    root.className = 'sgve-perf-panel';

    const liveBody   = document.createElement('div');
    const deviceBody = document.createElement('div');
    const projBody   = document.createElement('div');

    root.appendChild(section('Live', liveBody));
    root.appendChild(section('Device & Storage', deviceBody));
    root.appendChild(section('Project', projBody));

    // Instructions — collapsible
    const instrEl  = document.createElement('details');
    instrEl.className = 'sgve-perf-instr';
    const sum = document.createElement('summary');
    sum.className = 'sgve-cfg-heading sgve-perf-instr-sum';
    sum.textContent = 'Chrome investigation guide ▸';
    const instrBody = document.createElement('div');
    instrBody.className = 'sgve-perf-instr-body';
    instrBody.innerHTML = PERF_INSTRUCTIONS_HTML;
    instrEl.appendChild(sum);
    instrEl.appendChild(instrBody);
    root.appendChild(instrEl);

    const sampler = createPerfSampler({ state });

    function refresh() {
        const d = sampler.getLive();
        liveBody.innerHTML   = renderLive(d);
        deviceBody.innerHTML = renderDevice(d.device, d.storage);
        projBody.innerHTML   = renderProject(d.project);
    }

    sampler.start();
    refresh();
    const ivId = setInterval(refresh, 1000);
    sampler.fetchStorageEstimate().then(refresh).catch(() => {});

    host.appendChild(root);

    return {
        destroy() {
            sampler.stop();
            clearInterval(ivId);
            try { host.removeChild(root); } catch (_) {}
        },
    };
}
