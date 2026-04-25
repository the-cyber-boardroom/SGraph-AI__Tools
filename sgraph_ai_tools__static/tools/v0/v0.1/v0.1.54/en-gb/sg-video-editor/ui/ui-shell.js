/** ui-shell.js — orchestrator: sg-layout + composer lifecycle + state↔components wiring. */

import { mountAssetPanel } from './ui-asset-panel.js';
import { mountExportControls } from './ui-export-controls.js';
import { buildLayoutDescriptor, wireTimelineEvents, resolvePanels } from './ui-shell-layout.js';
import { mountDevPanel } from './ui-dev-panel.js';
import { mountJsonPane } from './ui-json-pane.js';
import { createComposer } from '/core/video-composer/v0/v0.1/v0.1.0/sg-video-composer.js';
import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';

// Side-effect import — register <sg-layout> custom element before use.
import '/core/sg-layout/v0.1.0/sg-layout.js';

/** Project has at least one clip on a video track. */
function hasAnyClip(flat) {
    if (!flat || !Array.isArray(flat.tracks)) return false;
    for (const t of flat.tracks) {
        if (t && t.kind === 'video' && Array.isArray(t.clips) && t.clips.length > 0) return true;
    }
    return false;
}

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Mount the editor shell into a host element.
 * @param {{host: HTMLElement, state: object, api: object, getComposer: () => object|null, setComposer: (c: object|null) => void}} opts
 * @returns {{destroy: () => void}}
 */
export function mountShell({ host, state, api, getComposer, setComposer }) {
    if (!host) return { destroy() {} };

    host.innerHTML = '';

    const topbar = document.createElement('header');
    topbar.className = 'sgve-topbar';
    topbar.innerHTML = `<h2>Video Editor</h2><div class="sgve-actions" data-slot="export"></div>`;
    host.appendChild(topbar);

    const layoutWrap = document.createElement('div');
    layoutWrap.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    host.appendChild(layoutWrap);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'display:block;width:100%;height:100%;';
    layoutWrap.appendChild(layout);

    const ready = new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
    layout.setLayout(buildLayoutDescriptor());

    const exportSlot = topbar.querySelector('[data-slot="export"]');
    const ctx = { selectedClipId: null, currentPlayhead: 0, getComposer };

    let assetPanel = null;
    let exportCtl = null;
    let unwireTimeline = null;
    let previewEl = null;
    let timelineEl = null;
    let pending = null;
    let onCanvasPlayhead = null;
    let devPanel = null;
    let jsonPane = null;

    function rebuildComposer() {
        const existing = getComposer();
        if (existing) {
            try { previewEl && previewEl.detachComposer(); } catch (_) {}
            try { existing.destroy(); } catch (_) {}
            setComposer(null);
        }
        const flat = state.toComposerProject();
        if (!hasAnyClip(flat) || !previewEl) return;
        const fps = Number.isFinite(flat.fps) ? flat.fps : 30;
        try {
            const c = createComposer({ project: flat, assets: state.getAssetRegistry(), canvas: previewEl.getCanvas(), fps });
            previewEl.attachComposer(c);
            setComposer(c);
        } catch (err) { emitErr('composer', err); }
    }

    function syncHistoryFlags() {
        if (timelineEl && typeof timelineEl.setHistoryFlags === 'function') {
            timelineEl.setHistoryFlags({ canUndo: state.canUndo(), canRedo: state.canRedo() });
        }
    }

    function handleChange() {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
            pending = null;
            const flat = state.toComposerProject();
            if (timelineEl) timelineEl.setProject(flat);
            if (assetPanel) assetPanel.refresh(state.getProject());
            syncHistoryFlags();
            rebuildComposer();
        }, 100);
    }

    async function mountInto() {
        await ready;
        const slots = resolvePanels(layout);
        const { assetsPanel, jsonPanel } = slots;
        previewEl = slots.previewEl;
        timelineEl = slots.timelineEl;

        assetPanel = mountAssetPanel({
            host: assetsPanel,
            state,
            onFilesPicked: async (files) => {
                for (const file of files) {
                    try { await api.loadAsset({ file }); }
                    catch (err) { emitErr('loadAsset', err); }
                }
            },
        });

        exportCtl = mountExportControls({
            host: exportSlot,
            onExport: ({ onProgress } = {}) => api.exportMp4({ preferMp4: true, onProgress }),
        });

        if (timelineEl) unwireTimeline = wireTimelineEvents(timelineEl, api, ctx);

        onCanvasPlayhead = (e) => {
            const t = e && e.detail && Number.isFinite(e.detail.time) ? e.detail.time : 0;
            if (timelineEl) timelineEl.setPlayheadTime(t);
        };
        if (previewEl) previewEl.getCanvas().addEventListener('composer:playhead-changed', onCanvasPlayhead);

        if (timelineEl) timelineEl.setProject(state.toComposerProject());
        assetPanel.refresh(state.getProject());
        if (jsonPanel) jsonPane = mountJsonPane({ host: jsonPanel, state });
        syncHistoryFlags();
        rebuildComposer();
        state.addEventListener('change', handleChange);

        devPanel = mountDevPanel({ host, manifestUrl: './manifest.json' });
    }

    mountInto().catch(err => emitErr('mountShell', err));

    /** Tear down everything mounted by the shell. */
    function destroy() {
        if (pending) { clearTimeout(pending); pending = null; }
        try { state.removeEventListener('change', handleChange); } catch (_) {}
        if (unwireTimeline) { try { unwireTimeline(); } catch (_) {} }
        if (previewEl && onCanvasPlayhead) {
            try { previewEl.getCanvas().removeEventListener('composer:playhead-changed', onCanvasPlayhead); } catch (_) {}
        }
        const c = getComposer();
        if (c) {
            try { previewEl && previewEl.detachComposer(); } catch (_) {}
            try { c.destroy(); } catch (_) {}
            setComposer(null);
        }
        try { exportCtl && exportCtl.destroy(); } catch (_) {}
        try { assetPanel && assetPanel.destroy(); } catch (_) {}
        try { jsonPane && jsonPane.destroy(); } catch (_) {}
        try { devPanel && devPanel.destroy(); } catch (_) {}
        host.innerHTML = '';
    }

    return { destroy };
}
