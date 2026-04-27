/** ui-shell.js — orchestrator: sg-layout + composer lifecycle + state↔components wiring. */

import { mountAssetPanel } from './ui-asset-panel.js';
import { mountExportControls } from './ui-export-controls.js';
import { buildLayoutDescriptor, wireTimelineEvents, resolvePanels } from './ui-shell-layout.js';
import { mountDevPanel } from './ui-dev-panel.js';
import { mountJsonPane } from './ui-json-pane.js';
import { mountPropertiesPanel } from './ui-properties-panel.js';
import { mountMessagesPanel } from './ui-messages-panel.js';
import { mountShortcutsPanel } from './ui-shortcuts-panel.js';
import { mountConfigPanel } from './ui-config-panel.js';
import { mountPerfPanel } from './debug/ui-perf-panel.js';
import { editorConfig } from './editor-config.js';
import { attachGlobalShortcuts } from './ui-keyboard.js';
import { attachAutosave } from './ui-autosave.js';
import { wireOverlay } from './ui-shell-overlay.js';
import { rebuildComposer, emitErr } from './ui-shell-composer.js';
import { initMemoryProbe, isMemoryProbeEnabled, debugLog, notifyComposerRebuilt }
    from './debug/memory-probe.js';
import { mountDebugPanel } from './debug/ui-debug-panel.js';
import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';

/**
 * True when the URL has `?debug=1` (or `?debug` empty). Drives the Round-9-M
 * observability surface. Tolerates running in environments without `URL`.
 */
function isDebugRequested() {
    try {
        if (typeof window === 'undefined' || !window.location) return false;
        const sp = new URLSearchParams(window.location.search || '');
        if (!sp.has('debug')) return false;
        const v = sp.get('debug');
        return v === '' || v === '1' || v === 'true' || v === 'yes';
    } catch (_) { return false; }
}

// Side-effect import — register <sg-layout> custom element before use.
import '/core/sg-layout/v0.1.0/sg-layout.js';

/**
 * Mount the editor shell into a host element.
 * @param {{host: HTMLElement, state: object, api: object, getComposer: () => object|null, setComposer: (c: object|null) => void}} opts
 * @returns {{destroy: () => void}}
 */
export function mountShell({ host, state, api, getComposer, setComposer }) {
    if (!host) return { destroy() {} };

    // Round-9-M: install the URL.* + video-element counters BEFORE the layout
    // fires its first composer rebuild. The probe only matters when the user
    // opted in via `?debug=1`; otherwise it's a no-op.
    const debugEnabled = isDebugRequested();
    if (debugEnabled) {
        initMemoryProbe();
        debugLog('memory probe enabled. Add `?debug=0` to the URL to disable.');
    }

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
    layout.setLayout(buildLayoutDescriptor({ withDebugTab: debugEnabled }));

    const exportSlot = topbar.querySelector('[data-slot="export"]');
    const ctx = {
        selectedClipId: null,
        selectedTrackId: null,
        currentPlayhead: 0,
        getComposer,
        getProject: () => state.getProject(),
    };

    let assetPanel = null, exportCtl = null, unwireTimeline = null;
    let previewEl = null, timelineEl = null;
    let pending = null, activePending = null;
    let onCanvasPlayhead = null, devPanel = null, jsonPane = null, propertiesPane = null, messagesPane = null, overlayWire = null;
    let onTimelineTest = null;
    let shortcutsPane = null, keyboardWire = null;
    /** Autosave handle — debounced writes + on-init restore prompt. */
    let autosaveHandle = null;
    /** Round-9-M debug panel handle (only when ?debug=1). */
    let debugPane = null;
    /** Config + Debug panel handle. */
    let configPane = null;
    /** Perf panel handle. */
    let perfPane = null;
    /** Unsubscribe fn for the perfEnabled config watcher. */
    let unsubPerfConfig = null;
    /** Slot element for the perf panel (captured during mountInto). */
    let perfSlot = null;

    /** beforeunload guard: prompt the browser's native confirm if the project
     *  is dirty (per the hash-based `hasUnsavedChanges()` check, which is the
     *  canonical "did the saved JSON drift from in-memory" comparison).
     *
     *  Round-9-K Item 2: the previous implementation also tripped on
     *  `lastMutationAt > autosave.lastFlushAt` to catch the autosave debounce
     *  window. That secondary check fires even after a successful MANUAL
     *  save (manual-save bumps `lastSavedHash` but never touches
     *  `autosave.lastFlushAt`), which is why every reload-after-save
     *  triggered the browser's "Reload site?" popup. The hash check alone
     *  is sufficient: both manual save + autosave call `state.markSaved(json)`
     *  with the bytes that hit storage, so `hasUnsavedChanges()` is the
     *  authoritative source of truth. If the user mutates during the autosave
     *  debounce window the hash will differ from the last saved baseline and
     *  the guard fires for the right reason. */
    function onBeforeUnload(e) {
        try {
            if (!state || typeof state.hasUnsavedChanges !== 'function') return;
            if (!state.hasUnsavedChanges()) return;
            e.preventDefault();
            e.returnValue = '';
        } catch (_) { /* never block unload on a guard error */ }
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    /** Cancel any queued handleChange / schedulePushActive callbacks. Exposed
     *  via `sgve:cancel-pending` so the Config panel can provide a Stop button. */
    function cancelPending() {
        if (pending) { clearTimeout(pending); pending = null; }
        if (activePending) { clearTimeout(activePending); activePending = null; }
    }
    function onCancelPending() { cancelPending(); }
    document.addEventListener('sgve:cancel-pending', onCancelPending);
    // Console escape hatch: sgveCancel() from DevTools stops the queued pipeline run.
    try { window.sgveCancel = cancelPending; } catch (_) {}

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
        if (isMemoryProbeEnabled()) {
            notifyComposerRebuilt();
            debugLog('composer rebuilt; playheadHint=' + (ctx.currentPlayhead || 0).toFixed(3));
        }
    }
    function syncHistoryFlags() {
        if (timelineEl && typeof timelineEl.setHistoryFlags === 'function') {
            timelineEl.setHistoryFlags({ canUndo: state.canUndo(), canRedo: state.canRedo() });
        }
    }
    function syncClipboardFlags() {
        if (timelineEl && typeof timelineEl.setClipboardFlags === 'function') {
            timelineEl.setClipboardFlags({ canPaste: !!state.hasClipboard() });
        }
    }
    function onClipboardChange() { syncClipboardFlags(); }
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
            if (editorConfig.get('timelineEnabled') && timelineEl) timelineEl.setProject(flat);
            if (editorConfig.get('assetPanelEnabled') && assetPanel) assetPanel.refresh(state.getProject());
            syncHistoryFlags();
            if (editorConfig.get('previewEnabled')) rebuild();
            if (editorConfig.get('overlayEnabled') && overlayWire) overlayWire.pushActive();
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
            getSelectedTrackId: () => ctx.selectedTrackId,
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
        if (slots.shortcutsPanel) shortcutsPane = mountShortcutsPanel({ host: slots.shortcutsPanel });
        if (slots.configPanel) configPane = mountConfigPanel({ host: slots.configPanel });
        perfSlot = slots.perfPanel || null;
        function refreshPerfPanel() {
            const want = !!editorConfig.get('perfEnabled');
            if (want && !perfPane && perfSlot) {
                perfPane = mountPerfPanel({ host: perfSlot, state });
            } else if (!want && perfPane) {
                try { perfPane.destroy(); } catch (_) {}
                perfPane = null;
                if (perfSlot) perfSlot.innerHTML = '';
            }
        }
        refreshPerfPanel();
        unsubPerfConfig = editorConfig.onChange((key) => {
            if (key === 'perfEnabled' || key === '*') refreshPerfPanel();
        });
        if (debugEnabled && slots.debugPanel) {
            debugPane = mountDebugPanel({ host: slots.debugPanel, state, api });
        }
        keyboardWire = attachGlobalShortcuts({
            api,
            getSelectedClipId: () => ctx.selectedClipId,
            getSelectedTrackId: () => ctx.selectedTrackId,
            getPlayhead: () => ctx.currentPlayhead,
            getComposer,
        });
        syncHistoryFlags();
        syncClipboardFlags();
        rebuild();
        state.addEventListener('change', handleChange);
        state.addEventListener('clipboard', onClipboardChange);
        // Autosave: debounced writes + on-init restore prompt. Wired AFTER
        // change listeners so the prompt-driven setProject (if accepted)
        // flows through the normal handleChange pipeline.
        autosaveHandle = attachAutosave({ state, api });
        // Defer the restore prompt to the next tick so the layout has
        // finished mounting — confirm() blocks the main thread and an
        // un-painted UI behind it is jarring.
        setTimeout(() => {
            try { autosaveHandle && autosaveHandle.promptRestore(); } catch (_) {}
        }, 0);
        devPanel = mountDevPanel({ host, manifestUrl: './manifest.json' });

        // ── Timeline stress test helpers ──────────────────────────────────────
        function buildTestProject(durationSec) {
            return {
                width: 1920, height: 1080, fps: 30,
                tracks: [{ id: 'test-track', kind: 'video', muted: false, locked: false,
                    clips: [{ id: 'test-clip', assetId: 'test-asset',
                        timelineStart: 0, inPoint: 0, outPoint: durationSec }] }],
                assets: [{ id: 'test-asset', name: `test-${durationSec}s.mp4`,
                    assetType: 'video', duration: durationSec, width: 1920, height: 1080 }],
            };
        }
        function runTimelineTest(durationSec) {
            if (!timelineEl) { console.log('[sgve] no timeline'); return; }
            const proj = buildTestProject(durationSec);
            const t0 = performance.now();
            timelineEl.setProject(proj);
            console.log(`[sgve] sgveTimelineTest(${durationSec}s) wall=${(performance.now() - t0).toFixed(1)}ms`);
        }
        try { window.sgveTimelineTest = runTimelineTest; } catch (_) {}
        onTimelineTest = (e) => { runTimelineTest((e && e.detail && e.detail.durationSec) || 60); };
        document.addEventListener('sgve:timeline-test', onTimelineTest);
    }

    mountInto().catch(err => emitErr('mountShell', err));

    /** Tear down everything mounted by the shell. */
    function destroy() {
        if (pending) { clearTimeout(pending); pending = null; }
        if (activePending) { clearTimeout(activePending); activePending = null; }
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        try { window.removeEventListener('beforeunload', onBeforeUnload); } catch (_) {}
        try { document.removeEventListener('sgve:cancel-pending', onCancelPending); } catch (_) {}
        try { document.removeEventListener('sgve:timeline-test', onTimelineTest); } catch (_) {}
        try { delete window.sgveTimelineTest; } catch (_) {}
        try { document.removeEventListener('tool:toast', onToolToast); } catch (_) {}
        try { document.removeEventListener('tool:error', onToolError); } catch (_) {}
        try { state.removeEventListener('change', handleChange); } catch (_) {}
        try { state.removeEventListener('clipboard', onClipboardChange); } catch (_) {}
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
        try { shortcutsPane && shortcutsPane.destroy(); } catch (_) {}
        try { keyboardWire && keyboardWire.destroy(); } catch (_) {}
        try { autosaveHandle && autosaveHandle.destroy(); } catch (_) {} autosaveHandle = null;
        try { configPane && configPane.destroy(); } catch (_) {} configPane = null;
        if (unsubPerfConfig) { try { unsubPerfConfig(); } catch (_) {} unsubPerfConfig = null; }
        try { perfPane   && perfPane.destroy();   } catch (_) {} perfPane   = null;
        try { debugPane && debugPane.destroy(); } catch (_) {} debugPane = null;
        try { devPanel && devPanel.destroy(); } catch (_) {}
        host.innerHTML = '';
    }

    return { destroy };
}
