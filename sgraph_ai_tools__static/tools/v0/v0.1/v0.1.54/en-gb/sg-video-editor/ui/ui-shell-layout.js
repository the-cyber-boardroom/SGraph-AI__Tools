/** ui-shell-layout.js — sg-layout descriptor + sg-timeline event wiring helpers. */

/**
 * Build the sg-layout descriptor: assets column on the left, preview+timeline column on the right.
 * @returns {object}
 */
export function buildLayoutDescriptor() {
    return {
        type: 'row', id: 'root', sizes: [0.22, 0.78],
        children: [
            { type: 'stack', id: 's-assets', activeTab: 0,
              tabs: [{ type: 'tab', id: 't-assets', title: 'Assets', tag: 'div', locked: true, closable: false }] },
            { type: 'column', id: 'col-right', sizes: [0.7, 0.3],
              children: [
                  { type: 'stack', id: 's-preview', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-preview', title: 'Preview', tag: 'div', locked: true, closable: false }] },
                  { type: 'stack', id: 's-timeline', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-timeline', title: 'Timeline', tag: 'div', locked: true, closable: false }] },
              ] },
        ],
    };
}

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Wire <sg-timeline> events to the api + local playhead/selection.
 * @param {HTMLElement} timelineEl
 * @param {object} api
 * @param {{selectedClipId: string|null, currentPlayhead: number, getComposer: () => object|null}} ctx
 * @returns {() => void} unwire
 */
export function wireTimelineEvents(timelineEl, api, ctx) {
    function onAdded(e) {
        const d = e.detail || {};
        try { api.addClip({ trackId: d.trackId || 't-video-1', assetId: d.assetId, timelineStart: d.timelineStart }); }
        catch (err) { emitErr('addClip', err); }
    }
    function onMoved(e) {
        const d = e.detail || {};
        try { api.moveClip({ clipId: d.clipId, timelineStart: d.timelineStart }); }
        catch (err) { emitErr('moveClip', err); }
    }
    function onTrimmed(e) {
        const d = e.detail || {};
        try { api.trimClip({ clipId: d.clipId, inPoint: d.inPoint, outPoint: d.outPoint }); }
        catch (err) { emitErr('trimClip', err); }
    }
    function onSelected(e) { ctx.selectedClipId = (e.detail && e.detail.clipId) || null; }
    function onPlayhead(e) {
        const t = e.detail && Number.isFinite(e.detail.time) ? e.detail.time : 0;
        ctx.currentPlayhead = t;
        const c = ctx.getComposer();
        if (c && typeof c.seek === 'function') c.seek(t);
    }
    function onDeleted(e) {
        const d = e.detail || {};
        if (!d.clipId) return;
        try { api.removeClip({ clipId: d.clipId }); }
        catch (err) { emitErr('removeClip', err); }
    }
    function onSplit(e) {
        const d = e.detail || {};
        if (!d.clipId || !Number.isFinite(d.atTime)) return;
        try { api.splitClip({ clipId: d.clipId, atTime: d.atTime }); }
        catch (err) { emitErr('splitClip', err); }
    }
    timelineEl.addEventListener('sg-timeline:clip-added', onAdded);
    timelineEl.addEventListener('sg-timeline:clip-moved', onMoved);
    timelineEl.addEventListener('sg-timeline:clip-trimmed', onTrimmed);
    timelineEl.addEventListener('sg-timeline:clip-selected', onSelected);
    timelineEl.addEventListener('sg-timeline:clip-deleted', onDeleted);
    timelineEl.addEventListener('sg-timeline:clip-split', onSplit);
    timelineEl.addEventListener('sg-timeline:playhead-changed', onPlayhead);
    return () => {
        timelineEl.removeEventListener('sg-timeline:clip-added', onAdded);
        timelineEl.removeEventListener('sg-timeline:clip-moved', onMoved);
        timelineEl.removeEventListener('sg-timeline:clip-trimmed', onTrimmed);
        timelineEl.removeEventListener('sg-timeline:clip-selected', onSelected);
        timelineEl.removeEventListener('sg-timeline:clip-deleted', onDeleted);
        timelineEl.removeEventListener('sg-timeline:clip-split', onSplit);
        timelineEl.removeEventListener('sg-timeline:playhead-changed', onPlayhead);
    };
}
