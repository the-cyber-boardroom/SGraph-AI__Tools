/** ui-shell-layout.js — sg-layout descriptor + sg-timeline event wiring helpers. */

/**
 * Build the sg-layout descriptor: assets column on the left, preview+timeline column on the right.
 * @returns {object}
 */
export function buildLayoutDescriptor() {
    return {
        type: 'row', id: 'root', sizes: [0.20, 0.58, 0.22],
        children: [
            { type: 'stack', id: 's-assets', activeTab: 0,
              tabs: [{ type: 'tab', id: 't-assets', title: 'Assets', tag: 'div', locked: true, closable: false }] },
            { type: 'column', id: 'col-centre', sizes: [0.7, 0.3],
              children: [
                  { type: 'stack', id: 's-preview', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-preview', title: 'Preview', tag: 'div', locked: true, closable: false }] },
                  { type: 'stack', id: 's-timeline', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-timeline', title: 'Timeline', tag: 'div', locked: true, closable: false }] },
              ] },
            { type: 'stack', id: 's-right', activeTab: 0,
              tabs: [
                  { type: 'tab', id: 't-properties', title: 'Properties', tag: 'div', locked: true, closable: false },
                  { type: 'tab', id: 't-json',       title: 'JSON',       tag: 'div', locked: true, closable: false },
                  { type: 'tab', id: 't-messages',   title: 'Messages',   tag: 'div', locked: true, closable: false },
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
 * Resolve the four panel host elements + tag the slots with classes;
 * inject inner custom elements for preview + timeline.
 * @param {HTMLElement} layout
 * @returns {{ assetsPanel: HTMLElement|null, previewPanel: HTMLElement|null, timelinePanel: HTMLElement|null, jsonPanel: HTMLElement|null, previewEl: HTMLElement|null, timelineEl: HTMLElement|null }}
 */
export function resolvePanels(layout) {
    const assetsPanel = layout.getPanelElement('t-assets');
    const previewPanel = layout.getPanelElement('t-preview');
    const timelinePanel = layout.getPanelElement('t-timeline');
    const jsonPanel = layout.getPanelElement('t-json');
    const propertiesPanel = layout.getPanelElement('t-properties');
    const messagesPanel = layout.getPanelElement('t-messages');
    let previewEl = null;
    let timelineEl = null;
    if (assetsPanel) assetsPanel.className = 'sgve-panel-slot';
    if (previewPanel) {
        previewPanel.className = 'sgve-panel-slot sgve-preview';
        previewPanel.innerHTML = '<sg-preview-canvas></sg-preview-canvas>';
        previewEl = previewPanel.querySelector('sg-preview-canvas');
    }
    if (timelinePanel) {
        timelinePanel.className = 'sgve-panel-slot sgve-timeline';
        timelinePanel.innerHTML = '<sg-timeline></sg-timeline>';
        timelineEl = timelinePanel.querySelector('sg-timeline');
    }
    if (jsonPanel) jsonPanel.className = 'sgve-panel-slot sgve-json';
    if (propertiesPanel) propertiesPanel.className = 'sgve-panel-slot sgve-properties';
    if (messagesPanel) messagesPanel.className = 'sgve-panel-slot sgve-messages';
    return {
        assetsPanel, previewPanel, timelinePanel,
        jsonPanel, propertiesPanel, messagesPanel,
        previewEl, timelineEl,
    };
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
        // snap: drag-drop snap-abuts to the nearest neighbour edge on overlap.
        Promise.resolve(api.addClip({ trackId: d.trackId || 't-video-1', assetId: d.assetId, timelineStart: d.timelineStart, snap: true }))
            .catch(err => emitErr('addClip', err));
    }
    function onTrackAdd() {
        Promise.resolve(api.addTrack({})).catch(err => emitErr('addTrack', err));
    }
    function onTrackRemove(e) {
        const d = e.detail || {};
        if (!d.trackId) return;
        Promise.resolve(api.removeTrack({ trackId: d.trackId })).catch(err => emitErr('removeTrack', err));
    }
    function onTrackMute(e) {
        const d = e.detail || {};
        if (!d.trackId || typeof d.muted !== 'boolean') return;
        Promise.resolve(api.setTrackMuted({ trackId: d.trackId, muted: d.muted }))
            .catch(err => emitErr('setTrackMuted', err));
    }
    function onClipTrackChange(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.toTrackId) return;
        // Atomically move to the destination track AT the user's chosen
        // timelineStart, with snap-abut on overlap. This avoids the old
        // two-step bug where the first call tested overlap against the clip's
        // stale source position on the destination track.
        const params = { clipId: d.clipId, toTrackId: d.toTrackId, snap: true };
        if (Number.isFinite(d.timelineStart)) params.timelineStart = d.timelineStart;
        Promise.resolve(api.moveClipToTrack(params))
            .catch(err => emitErr('moveClipToTrack', err));
    }
    function onMoved(e) {
        const d = e.detail || {};
        // snap: drag-on-timeline snap-abuts to the nearest neighbour edge on overlap.
        Promise.resolve(api.moveClip({ clipId: d.clipId, timelineStart: d.timelineStart, snap: true }))
            .catch(err => emitErr('moveClip', err));
    }
    function onTrimmed(e) {
        const d = e.detail || {};
        Promise.resolve(api.trimClip({ clipId: d.clipId, inPoint: d.inPoint, outPoint: d.outPoint }))
            .catch(err => emitErr('trimClip', err));
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
        Promise.resolve(api.removeClip({ clipId: d.clipId }))
            .catch(err => emitErr('removeClip', err));
    }
    function onSplit(e) {
        const d = e.detail || {};
        if (!d.clipId || !Number.isFinite(d.atTime)) return;
        Promise.resolve(api.splitClip({ clipId: d.clipId, atTime: d.atTime }))
            .catch(err => emitErr('splitClip', err));
    }
    function onColor(e) {
        const d = e.detail || {};
        if (!d.clipId) return;
        Promise.resolve(api.setClipColor({ clipId: d.clipId, color: d.color == null ? null : d.color }))
            .catch(err => emitErr('setClipColor', err));
    }
    function onUndo() {
        Promise.resolve(api.undo()).catch(err => emitErr('undo', err));
    }
    function onRedo() {
        Promise.resolve(api.redo()).catch(err => emitErr('redo', err));
    }
    timelineEl.addEventListener('sg-timeline:clip-added', onAdded);
    timelineEl.addEventListener('sg-timeline:clip-moved', onMoved);
    timelineEl.addEventListener('sg-timeline:clip-trimmed', onTrimmed);
    timelineEl.addEventListener('sg-timeline:clip-selected', onSelected);
    timelineEl.addEventListener('sg-timeline:clip-deleted', onDeleted);
    timelineEl.addEventListener('sg-timeline:clip-split', onSplit);
    timelineEl.addEventListener('sg-timeline:clip-color-requested', onColor);
    timelineEl.addEventListener('sg-timeline:undo-requested', onUndo);
    timelineEl.addEventListener('sg-timeline:redo-requested', onRedo);
    timelineEl.addEventListener('sg-timeline:playhead-changed', onPlayhead);
    timelineEl.addEventListener('sg-timeline:track-add-requested', onTrackAdd);
    timelineEl.addEventListener('sg-timeline:track-remove-requested', onTrackRemove);
    timelineEl.addEventListener('sg-timeline:track-mute-requested', onTrackMute);
    timelineEl.addEventListener('sg-timeline:clip-track-changed', onClipTrackChange);
    return () => {
        timelineEl.removeEventListener('sg-timeline:clip-added', onAdded);
        timelineEl.removeEventListener('sg-timeline:clip-moved', onMoved);
        timelineEl.removeEventListener('sg-timeline:clip-trimmed', onTrimmed);
        timelineEl.removeEventListener('sg-timeline:clip-selected', onSelected);
        timelineEl.removeEventListener('sg-timeline:clip-deleted', onDeleted);
        timelineEl.removeEventListener('sg-timeline:clip-split', onSplit);
        timelineEl.removeEventListener('sg-timeline:clip-color-requested', onColor);
        timelineEl.removeEventListener('sg-timeline:undo-requested', onUndo);
        timelineEl.removeEventListener('sg-timeline:redo-requested', onRedo);
        timelineEl.removeEventListener('sg-timeline:playhead-changed', onPlayhead);
        timelineEl.removeEventListener('sg-timeline:track-add-requested', onTrackAdd);
        timelineEl.removeEventListener('sg-timeline:track-remove-requested', onTrackRemove);
        timelineEl.removeEventListener('sg-timeline:track-mute-requested', onTrackMute);
        timelineEl.removeEventListener('sg-timeline:clip-track-changed', onClipTrackChange);
    };
}
