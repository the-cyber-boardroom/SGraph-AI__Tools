/**
 * ui-debug-panel.js — Round-9-M memory observability panel.
 *
 * A read-only diagnostic surface mounted as a tab in the Properties stack
 * (right column). Lives behind the same `?debug=1` flag as the memory
 * probe — only mounted when the probe is active. Polls counters at 1 Hz.
 *
 * Surfaces:
 *   - Clip count
 *   - Live <video> element count (composer-tracked + DOM-scanned)
 *   - Live blob-URL count (from URL.createObjectURL wrapper)
 *   - Composer rebuild count
 *   - IDB asset count + total bytes
 *   - performance.memory JS heap (Chrome only — Safari shows "n/a")
 *   - Asset list with name / size / intrinsic resolution / instance count
 *
 * No mutation surface — read-only by design. Errors during `getStorageUsage`
 * are surfaced as "—" rather than blowing up the panel.
 *
 * @module sg-video-editor/debug/ui-debug-panel
 */

import { getSnapshot } from './memory-probe.js';

const POLL_MS = 1000;

function formatBytes(b) {
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function row(label, value, hint) {
    const li = document.createElement('li');
    li.className = 'sgve-debug-row';
    const lab = document.createElement('span');
    lab.className = 'sgve-debug-label';
    lab.textContent = label;
    const val = document.createElement('span');
    val.className = 'sgve-debug-value';
    val.textContent = value;
    li.appendChild(lab);
    li.appendChild(val);
    if (hint) li.title = hint;
    return li;
}

function clipCount(project) {
    if (!project || !Array.isArray(project.tracks)) return 0;
    let n = 0;
    for (const t of project.tracks) if (t && Array.isArray(t.clips)) n += t.clips.length;
    return n;
}

function buildAssetList(project) {
    const ul = document.createElement('ul');
    ul.className = 'sgve-debug-assets';
    const assets = (project && Array.isArray(project.assets)) ? project.assets : [];
    if (assets.length === 0) {
        const li = document.createElement('li');
        li.className = 'sgve-debug-empty';
        li.textContent = 'No assets.';
        ul.appendChild(li);
        return ul;
    }
    for (const a of assets) {
        if (!a) continue;
        const li = document.createElement('li');
        const w = Number.isFinite(a.width) ? a.width : '?';
        const h = Number.isFinite(a.height) ? a.height : '?';
        const dur = Number.isFinite(a.duration) ? `${a.duration.toFixed(1)}s` : '—';
        const size = Number.isFinite(a.bytes) ? formatBytes(a.bytes) : '—';
        const head = document.createElement('div');
        head.className = 'sgve-debug-asset-head';
        head.textContent = a.name || a.id || 'asset';
        const body = document.createElement('div');
        body.className = 'sgve-debug-asset-body';
        body.textContent = `${a.assetType || 'video'} · ${w}×${h} · ${dur} · ${size}`;
        const idLine = document.createElement('div');
        idLine.className = 'sgve-debug-asset-id';
        idLine.textContent = a.id;
        li.appendChild(head);
        li.appendChild(body);
        li.appendChild(idLine);
        ul.appendChild(li);
    }
    return ul;
}

/**
 * Mount the debug panel into a host element.
 *
 * @param {{
 *   host: HTMLElement,
 *   state: object,
 *   api: object,
 * }} cfg
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountDebugPanel({ host, state, api }) {
    if (!host) return { destroy() {}, refresh() {} };
    host.innerHTML = `
        <div class="sgve-debug-root">
            <h3 class="sgve-debug-h">Round-9-M memory probe</h3>
            <p class="sgve-debug-note">All counters update at 1 Hz. <code>?debug=1</code> in the URL is what enabled this panel; remove the flag to hide it.</p>
            <ul class="sgve-debug-rows" data-slot="rows"></ul>
            <h4 class="sgve-debug-h2">Assets</h4>
            <div data-slot="assets"></div>
        </div>
    `;
    const rowsSlot = host.querySelector('[data-slot="rows"]');
    const assetsSlot = host.querySelector('[data-slot="assets"]');

    let usageCache = null; // { totalBytes, assetBytes, assetCount, projectJsonBytes }
    let usageInFlight = false;

    async function refreshStorageUsage() {
        if (usageInFlight) return;
        if (!api || typeof api.getStorageUsage !== 'function') return;
        usageInFlight = true;
        try { usageCache = await api.getStorageUsage(); }
        catch (_) { usageCache = null; }
        finally { usageInFlight = false; }
    }

    function render() {
        const project = state.getProject();
        const snap = getSnapshot();
        rowsSlot.replaceChildren();
        rowsSlot.appendChild(row('Clips', String(clipCount(project)),
            'Total clips across all tracks.'));
        rowsSlot.appendChild(row(
            'Video elements (composer)',
            String(snap.videoElementsLive),
            'HTMLVideoElement instances the composer is tracking. Should be ≤ unique-video-asset count.'));
        rowsSlot.appendChild(row(
            'Video elements (DOM)',
            String(snap.videoElementsInDom),
            'document.querySelectorAll("video").length — includes hidden probe elements.'));
        rowsSlot.appendChild(row(
            'Live blob URLs',
            String(snap.blobUrlsLive),
            `created ${snap.blobUrlsCreatedTotal} · revoked ${snap.blobUrlsRevokedTotal}`));
        rowsSlot.appendChild(row(
            'Composer rebuilds',
            String(snap.composerRebuilds),
            'Each rebuild destroys + recreates every <video> + blob URL. High count = high decode pressure.'));
        const assetCount = usageCache ? usageCache.assetCount : '—';
        const assetBytes = usageCache ? formatBytes(usageCache.assetBytes) : '—';
        rowsSlot.appendChild(row(
            'IDB assets',
            `${assetCount} · ${assetBytes}`,
            'Round-9-J IndexedDB blob store.'));
        const pm = snap.perfMemory;
        if (pm) {
            rowsSlot.appendChild(row(
                'JS heap used',
                formatBytes(pm.usedJSHeapBytes),
                `total ${formatBytes(pm.totalJSHeapBytes)} · limit ${formatBytes(pm.jsHeapLimitBytes)}`));
        } else {
            rowsSlot.appendChild(row(
                'JS heap used',
                'n/a',
                'performance.memory only available in Chrome.'));
        }
        if (snap.lastEvent) {
            rowsSlot.appendChild(row('Last URL event', snap.lastEvent,
                'Most recent createObjectURL / revokeObjectURL call.'));
        }
        assetsSlot.replaceChildren(buildAssetList(project));
    }

    render();
    refreshStorageUsage().then(render).catch(() => {});

    let timer = null;
    let storageTick = 0;
    function tick() {
        render();
        // Storage usage is a heavier IDB cursor sweep — only poll every 5s.
        storageTick = (storageTick + 1) % 5;
        if (storageTick === 0) refreshStorageUsage().then(render).catch(() => {});
    }
    timer = setInterval(tick, POLL_MS);

    function onChange() { render(); }
    state.addEventListener('change', onChange);

    return {
        refresh: render,
        destroy() {
            if (timer) clearInterval(timer);
            timer = null;
            try { state.removeEventListener('change', onChange); } catch (_) {}
            host.innerHTML = '';
        },
    };
}
