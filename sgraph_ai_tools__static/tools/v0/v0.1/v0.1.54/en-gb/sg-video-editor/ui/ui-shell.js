/** ui-shell.js — orchestrator: layout + composer lifecycle + state↔components wiring. */

import { mountAssetPanel } from './ui-asset-panel.js';
import { mountExportControls } from './ui-export-controls.js';
import { createComposer } from '/core/video-composer/v0/v0.1/v0.1.0/sg-video-composer.js';

const ROOT_STYLE = 'display:flex;flex-direction:column;flex:1 1 auto;min-height:0;height:100%;';
const TOPBAR_STYLE = 'display:flex;align-items:center;justify-content:space-between;'
    + 'padding:.5rem 1rem;border-bottom:1px solid #1f2937;background:#111827;flex:0 0 auto;';
const MAIN_STYLE = 'display:flex;flex:1 1 auto;min-height:0;overflow:hidden;';
const SIDE_STYLE = 'flex:0 0 240px;border-right:1px solid #1f2937;min-height:0;overflow:hidden;';
const PREVIEW_STYLE = 'flex:1 1 auto;min-width:0;display:flex;align-items:center;'
    + 'justify-content:center;background:#000;padding:.5rem;';
const TIMELINE_STYLE = 'flex:0 0 220px;border-top:1px solid #1f2937;overflow:auto;background:#0f172a;';

/** Project has at least one clip on a video track. */
function hasAnyClip(flat) {
    if (!flat || !Array.isArray(flat.tracks)) return false;
    for (const t of flat.tracks) {
        if (t && t.kind === 'video' && Array.isArray(t.clips) && t.clips.length > 0) return true;
    }
    return false;
}

/** Wire <sg-timeline> events to the api + local playhead/selection. */
function wireTimelineEvents(timelineEl, api, ctx) {
    function onAdded(e) {
        const d = e.detail || {};
        try { api.addClip({ trackId: d.trackId || 't-video-1', assetId: d.assetId, timelineStart: d.timelineStart }); }
        catch (err) { document.dispatchEvent(new CustomEvent('tool:error', { detail: { step: 'addClip', message: err.message } })); }
    }
    function onMoved(e) {
        const d = e.detail || {};
        try { api.moveClip({ clipId: d.clipId, timelineStart: d.timelineStart }); }
        catch (err) { document.dispatchEvent(new CustomEvent('tool:error', { detail: { step: 'moveClip', message: err.message } })); }
    }
    function onTrimmed(e) {
        const d = e.detail || {};
        try { api.trimClip({ clipId: d.clipId, inPoint: d.inPoint, outPoint: d.outPoint }); }
        catch (err) { document.dispatchEvent(new CustomEvent('tool:error', { detail: { step: 'trimClip', message: err.message } })); }
    }
    function onSelected(e) { ctx.selectedClipId = (e.detail && e.detail.clipId) || null; }
    function onPlayhead(e) {
        const t = e.detail && Number.isFinite(e.detail.time) ? e.detail.time : 0;
        ctx.currentPlayhead = t;
        const c = ctx.getComposer();
        if (c && typeof c.seek === 'function') c.seek(t);
    }
    timelineEl.addEventListener('sg-timeline:clip-added', onAdded);
    timelineEl.addEventListener('sg-timeline:clip-moved', onMoved);
    timelineEl.addEventListener('sg-timeline:clip-trimmed', onTrimmed);
    timelineEl.addEventListener('sg-timeline:clip-selected', onSelected);
    timelineEl.addEventListener('sg-timeline:playhead-changed', onPlayhead);
    return () => {
        timelineEl.removeEventListener('sg-timeline:clip-added', onAdded);
        timelineEl.removeEventListener('sg-timeline:clip-moved', onMoved);
        timelineEl.removeEventListener('sg-timeline:clip-trimmed', onTrimmed);
        timelineEl.removeEventListener('sg-timeline:clip-selected', onSelected);
        timelineEl.removeEventListener('sg-timeline:playhead-changed', onPlayhead);
    };
}

/**
 * Mount the editor shell into a host element.
 * @param {{host: HTMLElement, state: object, api: object, getComposer: () => object|null, setComposer: (c: object|null) => void}} opts
 * @returns {{destroy: () => void}}
 */
export function mountShell({ host, state, api, getComposer, setComposer }) {
    if (!host) return { destroy() {} };

    host.innerHTML = `
        <div class="sgve-root" style="${ROOT_STYLE}">
            <header class="sgve-topbar" style="${TOPBAR_STYLE}">
                <h2 style="margin:0;font-size:1rem">SG Video Editor</h2>
                <div class="sgve-actions" data-slot="export"></div>
            </header>
            <div class="sgve-main" style="${MAIN_STYLE}">
                <aside class="sgve-side" data-slot="assets" style="${SIDE_STYLE}"></aside>
                <section class="sgve-preview" style="${PREVIEW_STYLE}"><sg-preview-canvas></sg-preview-canvas></section>
            </div>
            <footer class="sgve-timeline" style="${TIMELINE_STYLE}"><sg-timeline></sg-timeline></footer>
        </div>
    `;
    const root = host.firstElementChild;
    const previewEl = root.querySelector('sg-preview-canvas');
    const timelineEl = root.querySelector('sg-timeline');
    const assetsSlot = root.querySelector('[data-slot="assets"]');
    const exportSlot = root.querySelector('[data-slot="export"]');

    const ctx = { selectedClipId: null, currentPlayhead: 0, getComposer };

    const assetPanel = mountAssetPanel({
        host: assetsSlot,
        state,
        onFilesPicked: async (files) => {
            for (const file of files) {
                try { await api.loadAsset({ file }); }
                catch (err) { document.dispatchEvent(new CustomEvent('tool:error', { detail: { step: 'loadAsset', message: err && err.message || String(err) } })); }
            }
        },
    });

    const exportCtl = mountExportControls({
        host: exportSlot,
        onExport: ({ onProgress } = {}) => api.exportMp4({ preferMp4: true, onProgress }),
    });

    const unwireTimeline = wireTimelineEvents(timelineEl, api, ctx);

    function onCanvasPlayhead(e) {
        const t = e && e.detail && Number.isFinite(e.detail.time) ? e.detail.time : 0;
        timelineEl.setPlayheadTime(t);
    }
    previewEl.getCanvas().addEventListener('composer:playhead-changed', onCanvasPlayhead);

    function rebuildComposer() {
        const existing = getComposer();
        if (existing) { previewEl.detachComposer(); try { existing.destroy(); } catch (_) {} setComposer(null); }
        const flat = state.toComposerProject();
        if (!hasAnyClip(flat)) return;
        const fps = Number.isFinite(flat.fps) ? flat.fps : 30;
        try {
            const c = createComposer({ project: flat, assets: state.getAssetRegistry(), canvas: previewEl.getCanvas(), fps });
            previewEl.attachComposer(c);
            setComposer(c);
        } catch (err) {
            document.dispatchEvent(new CustomEvent('tool:error', { detail: { step: 'composer', message: err && err.message || String(err) } }));
        }
    }

    let pending = null;
    function handleChange() {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
            pending = null;
            const flat = state.toComposerProject();
            timelineEl.setProject(flat);
            assetPanel.refresh(state.getProject());
            rebuildComposer();
        }, 100);
    }

    state.addEventListener('change', handleChange);

    // Initial render — synchronous, no debounce.
    timelineEl.setProject(state.toComposerProject());
    assetPanel.refresh(state.getProject());
    rebuildComposer();

    /** Tear down everything mounted by the shell. */
    function destroy() {
        if (pending) { clearTimeout(pending); pending = null; }
        state.removeEventListener('change', handleChange);
        unwireTimeline();
        previewEl.getCanvas().removeEventListener('composer:playhead-changed', onCanvasPlayhead);
        const c = getComposer();
        if (c) { try { previewEl.detachComposer(); } catch (_) {} try { c.destroy(); } catch (_) {} setComposer(null); }
        try { exportCtl.destroy(); } catch (_) {}
        try { assetPanel.destroy(); } catch (_) {}
        host.innerHTML = '';
    }

    return { destroy };
}
