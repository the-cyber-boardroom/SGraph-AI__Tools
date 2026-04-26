/** ui-shell.js — orchestrator: sg-layout + composer lifecycle + state↔components wiring. */

import { mountAssetPanel } from './ui-asset-panel.js';
import { mountExportControls } from './ui-export-controls.js';
import { buildLayoutDescriptor, wireTimelineEvents, resolvePanels } from './ui-shell-layout.js';
import { mountDevPanel } from './ui-dev-panel.js';
import { mountJsonPane } from './ui-json-pane.js';
import { mountPropertiesPanel } from './ui-properties-panel.js';
import { mountMessagesPanel } from './ui-messages-panel.js';
import { wireOverlay } from './ui-shell-overlay.js';
import { rebuildComposer, emitErr } from './ui-shell-composer.js';
import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';

// Side-effect import — register <sg-layout> custom element before use.
import '/core/sg-layout/v0.1.0/sg-layout.js';

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
    topbar.innerHTML = `<h2>Video Editor</h2><div class="sgve-toast" data-slot="toast" hidden></div><div class="sgve-actions" data-slot="export"></div>`;
    host.appendChild(topbar);

    const toastEl = topbar.querySelector('[data-slot="toast"]');
    let toastTimer = null;
    function showToast(message, kind) {
        if (!toastEl) return;
        toastEl.textContent = message;
        toastEl.dataset.kind = kind || 'info';
        toastEl.hidden = false;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.hidden = true; toastTimer = null; }, 3500);
    }
    function onToolToast(e) { showToast(e?.detail?.message || '', e?.detail?.kind); }
    function onToolError(e) { showToast(e?.detail?.message || 'Error', 'error'); }
    document.addEventListener('tool:toast', onToolToast);
    document.addEventListener('tool:error', onToolError);

    const layoutWrap = document.createElement('div');
    layoutWrap.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    host.appendChild(layoutWrap);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'display:block;width:100%;height:100%;';
    layoutWrap.appendChild(layout);

    const ready = new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));
    layout.setLayout(buildLayoutDescriptor());

    const exportSlot = topbar.querySelector('[data-slot="export"]');
    const ctx = { selectedClipId: null, selectedTrackId: null, currentPlayhead: 0, getComposer };

    let assetPanel = null, exportCtl = null, unwireTimeline = null;
    let previewEl = null, timelineEl = null;
    let pending = null, activePending = null;
    let onCanvasPlayhead = null, devPanel = null, jsonPane = null, propertiesPane = null, messagesPane = null, overlayWire = null;

    function schedulePushActive() {
        if (!overlayWire) return;
        if (typeof overlayWire.pushActive === 'function') overlayWire.pushActive();
        if (activePending) return;
        activePending = setTimeout(() => { activePending = null; overlayWire.pushActive(); }, 100);
    }
    function refreshProperties() {
        if (propertiesPane && typeof propertiesPane.refresh === 'function') propertiesPane.refresh();
    }
    function rebuild() {
        rebuildComposer({
            state, previewEl, getComposer, setComposer,
            playheadHint: ctx.currentPlayhead,
        });
    }
    function syncHistoryFlags() {
        if (timelineEl && typeof timelineEl.setHistoryFlags === 'function') {
            timelineEl.setHistoryFlags({ canUndo: state.canUndo(), canRedo: state.canRedo() });
        }
    }
    /** Mid-drag transform/crop: refresh the composer's live project + overlay
     *  in-place (no destroy/recreate, no debounce) so the canvas reflects every
     *  pointer tick without recording a history entry. */
    function handleTransientChange() {
        const flat = state.toComposerProject();
        const c = getComposer();
        if (c && typeof c.updateProject === 'function') c.updateProject(flat);
        if (overlayWire) overlayWire.pushActive();
    }

    function handleChange(e) {
        if (e && e.detail && e.detail.transient) { handleTransientChange(); return; }
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
            pending = null;
            const flat = state.toComposerProject();
            if (timelineEl) timelineEl.setProject(flat);
            if (assetPanel) assetPanel.refresh(state.getProject());
            syncHistoryFlags();
            rebuild();
            if (overlayWire) overlayWire.pushActive();
        }, 100);
    }

    async function mountInto() {
        await ready;
        const slots = resolvePanels(layout);
        const { assetsPanel, jsonPanel, propertiesPanel, messagesPanel } = slots;
        previewEl = slots.previewEl;
        timelineEl = slots.timelineEl;

        assetPanel = mountAssetPanel({
            host: assetsPanel,
            state,
            api,
            getPlayhead: () => ctx.currentPlayhead,
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

        overlayWire = wireOverlay({
            previewEl, api,
            getProject: () => state.toComposerProject(),
            getSelectedClipId: () => ctx.selectedClipId,
            getPlayhead: () => ctx.currentPlayhead,
            setSelectedClip: (id) => {
                if (timelineEl && typeof timelineEl.setSelectedClip === 'function') {
                    timelineEl.setSelectedClip(id);
                }
            },
        });

        if (timelineEl) {
            timelineEl.addEventListener('sg-timeline:clip-selected', schedulePushActive);
            timelineEl.addEventListener('sg-timeline:playhead-changed', schedulePushActive);
            timelineEl.addEventListener('sg-timeline:clip-selected', refreshProperties);
        }

        onCanvasPlayhead = (e) => {
            const t = e && e.detail && Number.isFinite(e.detail.time) ? e.detail.time : 0;
            if (timelineEl) timelineEl.setPlayheadTime(t);
            ctx.currentPlayhead = t;
            schedulePushActive();
        };
        if (previewEl) previewEl.getCanvas().addEventListener('composer:playhead-changed', onCanvasPlayhead);

        if (timelineEl) timelineEl.setProject(state.toComposerProject());
        assetPanel.refresh(state.getProject());
        if (jsonPanel) jsonPane = mountJsonPane({ host: jsonPanel, state });
        if (propertiesPanel) propertiesPane = mountPropertiesPanel({
            host: propertiesPanel, state, api,
            getSelectedClipId: () => ctx.selectedClipId,
        });
        if (messagesPanel) messagesPane = mountMessagesPanel({ host: messagesPanel });
        syncHistoryFlags();
        rebuild();
        state.addEventListener('change', handleChange);
        devPanel = mountDevPanel({ host, manifestUrl: './manifest.json' });
    }

    mountInto().catch(err => emitErr('mountShell', err));

    /** Tear down everything mounted by the shell. */
    function destroy() {
        if (pending) { clearTimeout(pending); pending = null; }
        if (activePending) { clearTimeout(activePending); activePending = null; }
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        try { document.removeEventListener('tool:toast', onToolToast); } catch (_) {}
        try { document.removeEventListener('tool:error', onToolError); } catch (_) {}
        try { state.removeEventListener('change', handleChange); } catch (_) {}
        if (unwireTimeline) { try { unwireTimeline(); } catch (_) {} }
        if (timelineEl) {
            try { timelineEl.removeEventListener('sg-timeline:clip-selected', schedulePushActive); } catch (_) {}
            try { timelineEl.removeEventListener('sg-timeline:playhead-changed', schedulePushActive); } catch (_) {}
            try { timelineEl.removeEventListener('sg-timeline:clip-selected', refreshProperties); } catch (_) {}
        }
        if (overlayWire) { try { overlayWire.destroy(); } catch (_) {} overlayWire = null; }
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
        try { propertiesPane && propertiesPane.destroy(); } catch (_) {}
        try { messagesPane && messagesPane.destroy(); } catch (_) {}
        try { devPanel && devPanel.destroy(); } catch (_) {}
        host.innerHTML = '';
    }

    return { destroy };
}
