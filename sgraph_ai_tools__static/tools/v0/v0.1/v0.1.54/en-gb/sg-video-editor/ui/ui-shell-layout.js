/** ui-shell-layout.js — sg-layout descriptor + sg-timeline event wiring helpers. */

/**
 * Build the sg-layout descriptor: assets column on the left, preview+timeline column on the right.
 *
 * @param {{ withDebugTab?: boolean }} [opts] — when `withDebugTab` is true a "Debug" tab
 * is appended to the right-hand stack (Round-9-M memory observability). Driven by
 * the shell's `?debug=1` query string check.
 * @returns {object}
 */
export function buildLayoutDescriptor(opts = {}) {
    const rightTabs = [
        { type: 'tab', id: 't-properties', title: 'Properties', tag: 'div', locked: true, closable: false },
        { type: 'tab', id: 't-json',       title: 'JSON',       tag: 'div', locked: true, closable: false },
        { type: 'tab', id: 't-messages',   title: 'Messages',   tag: 'div', locked: true, closable: false },
        { type: 'tab', id: 't-config',     title: 'Config',     tag: 'div', locked: true, closable: false },
        { type: 'tab', id: 't-perf',       title: 'Perf',       tag: 'div', locked: true, closable: false },
    ];
    if (opts && opts.withDebugTab) {
        rightTabs.push({ type: 'tab', id: 't-debug', title: 'Debug', tag: 'div', locked: true, closable: false });
    }
    return {
        type: 'row', id: 'root', sizes: [0.20, 0.58, 0.22],
        children: [
            { type: 'column', id: 'col-left', sizes: [0.7, 0.3],
              children: [
                  { type: 'stack', id: 's-assets', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-assets', title: 'Assets', tag: 'div', locked: true, closable: false }] },
                  { type: 'stack', id: 's-shortcuts', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-shortcuts', title: 'Shortcuts', tag: 'div', locked: true, closable: false }] },
              ] },
            { type: 'column', id: 'col-centre', sizes: [0.7, 0.3],
              children: [
                  { type: 'stack', id: 's-preview', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-preview', title: 'Preview', tag: 'div', locked: true, closable: false }] },
                  { type: 'stack', id: 's-timeline', activeTab: 0,
                    tabs: [{ type: 'tab', id: 't-timeline', title: 'Timeline', tag: 'div', locked: true, closable: false }] },
              ] },
            { type: 'stack', id: 's-right', activeTab: 0, tabs: rightTabs },
        ],
    };
}

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

function emitToast(message) {
    document.dispatchEvent(new CustomEvent('tool:toast', {
        detail: { message, kind: 'info' },
    }));
}

/**
 * Run `fn(trackId)` against `targetTrackId`. On `code:'overlap'` (snap-abut
 * couldn't clear the position), insert a fresh video track ABOVE the target
 * and retry once with the new track. The user dropped expecting their chosen
 * position to land — so we keep `timelineStart` exactly and just give it a
 * fresh lane.
 *
 * Returns the result of `fn` (resolved value).
 *
 * @param {object} api
 * @param {string} targetTrackId
 * @param {(trackId: string) => any|Promise<any>} fn
 * @returns {Promise<any>}
 */
async function withOverlapAutoTrackAbove(api, targetTrackId, fn) {
    try {
        return await fn(targetTrackId);
    } catch (err) {
        if (!err || err.code !== 'overlap') throw err;
        let newTrackId = null;
        try {
            const r = await api.addTrack({ insertAboveTrackId: targetTrackId });
            newTrackId = r && r.trackId;
        } catch (_) { throw err; /* re-throw original */ }
        if (!newTrackId) throw err;
        emitToast('Added a new track above — drop position was fully blocked');
        return await fn(newTrackId);
    }
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
    const shortcutsPanel = layout.getPanelElement('t-shortcuts');
    const configPanel = layout.getPanelElement('t-config');
    const perfPanel   = layout.getPanelElement('t-perf');
    const debugPanel  = layout.getPanelElement('t-debug');
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
    if (shortcutsPanel) shortcutsPanel.className = 'sgve-panel-slot sgve-shortcuts';
    if (configPanel) configPanel.className = 'sgve-panel-slot sgve-config';
    if (perfPanel)   perfPanel.className   = 'sgve-panel-slot sgve-perf';
    if (debugPanel)  debugPanel.className  = 'sgve-panel-slot sgve-debug';
    return {
        assetsPanel, previewPanel, timelinePanel,
        jsonPanel, propertiesPanel, messagesPanel, shortcutsPanel,
        configPanel, perfPanel, debugPanel,
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
        // If snap can't clear the slot on the target track, fall through to
        // adding a fresh track ABOVE and retrying with the user's chosen start.
        const targetTrackId = d.trackId || 't-video-1';
        withOverlapAutoTrackAbove(api, targetTrackId, (trackId) => api.addClip({
            trackId,
            assetId: d.assetId,
            timelineStart: d.timelineStart,
            snap: true,
        })).catch(err => emitErr('addClip', err));
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
    function onTrackLock(e) {
        const d = e.detail || {};
        if (!d.trackId || typeof d.locked !== 'boolean') return;
        Promise.resolve(api.setTrackLocked({ trackId: d.trackId, locked: d.locked }))
            .catch(err => emitErr('setTrackLocked', err));
    }
    function onTrackRenamed(e) {
        const d = e.detail || {};
        if (!d.trackId) return;
        Promise.resolve(api.renameTrack({ trackId: d.trackId, name: d.name == null ? '' : d.name }))
            .catch(err => emitErr('renameTrack', err));
    }
    function onTrackSelected(e) {
        const d = e.detail || {};
        ctx.selectedTrackId = d.trackId || null;
        // Mirror the selection back into the timeline so visual state is in sync
        // when this came from a programmatic source.
        if (typeof timelineEl.setSelectedTrack === 'function') {
            timelineEl.setSelectedTrack(ctx.selectedTrackId);
        }
    }
    function onClipTrackChange(e) {
        const d = e.detail || {};
        if (!d.clipId || !d.toTrackId) return;
        // Atomically move to the destination track AT the user's chosen
        // timelineStart, with snap-abut on overlap. This avoids the old
        // two-step bug where the first call tested overlap against the clip's
        // stale source position on the destination track. If snap can't clear,
        // create a fresh track ABOVE the destination and retry — same UX as
        // asset-panel drops (issue #2).
        const baseParams = { clipId: d.clipId, snap: true };
        if (Number.isFinite(d.timelineStart)) baseParams.timelineStart = d.timelineStart;
        withOverlapAutoTrackAbove(api, d.toTrackId, (trackId) => api.moveClipToTrack({
            ...baseParams,
            toTrackId: trackId,
        })).catch(err => emitErr('moveClipToTrack', err));
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
    function onSelected(e) {
        const clipId = (e.detail && e.detail.clipId) || null;
        ctx.selectedClipId = clipId;
        // When a clip becomes selected, mirror its parent track into
        // selectedTrackId so paste / +Shape / +Text default to the same lane
        // as the source clip. When a clip is deselected (clipId === null), we
        // intentionally leave selectedTrackId alone — the user might still
        // want it (e.g. they're about to paste onto the same lane).
        if (clipId && typeof ctx.getProject === 'function') {
            try {
                const proj = ctx.getProject();
                const tracks = (proj && Array.isArray(proj.tracks)) ? proj.tracks : [];
                for (const t of tracks) {
                    if (t && Array.isArray(t.clips) && t.clips.some(c => c && c.id === clipId)) {
                        if (ctx.selectedTrackId !== t.id) {
                            ctx.selectedTrackId = t.id;
                            // Mirror onto the timeline so the header gets the
                            // selected accent without the user needing to
                            // separately click the lane label.
                            if (typeof timelineEl.setSelectedTrack === 'function') {
                                timelineEl.setSelectedTrack(t.id);
                            }
                        }
                        break;
                    }
                }
            } catch (_) { /* best-effort */ }
        }
    }
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
    function onClipCopy(e) {
        const d = e.detail || {};
        if (!d.clipId) return;
        // Two paths funnel here: (a) toolbar Copy button (no toTrackId/start),
        // (b) Cmd+drag (with toTrackId + timelineStart). For (a) we just copy.
        // For (b) we copy then immediately paste at the drop target.
        Promise.resolve(api.copyClip({ clipId: d.clipId }))
            .then(() => {
                if (d.toTrackId && Number.isFinite(d.timelineStart)) {
                    return api.pasteClip({
                        targetTrackId: d.toTrackId,
                        timelineStart: d.timelineStart,
                        snap: true,
                    });
                }
                return null;
            })
            .catch(err => emitErr('copyClip', err));
    }
    function onClipPaste() {
        // Resolve target track + start at host level: prefer the user's
        // selected track, otherwise the first video track, else t-video-1.
        // Time = current playhead. Snap=true (paste is intentional, accept
        // unlimited cap so it lands somewhere reasonable).
        const cb = api.hasClipboard ? api.hasClipboard() : null;
        const has = cb && (cb.hasClipboard === true || cb === true);
        if (!has) return;
        const proj = (typeof ctx.getProject === 'function') ? ctx.getProject() : null;
        let targetTrack = ctx.selectedTrackId || null;
        if (!targetTrack && proj && Array.isArray(proj.tracks)) {
            const first = proj.tracks.find(t => t && t.kind === 'video');
            if (first) targetTrack = first.id;
        }
        if (!targetTrack) targetTrack = 't-video-1';
        Promise.resolve(api.pasteClip({
            targetTrackId: targetTrack,
            timelineStart: ctx.currentPlayhead || 0,
            snap: true,
        })).catch(err => emitErr('pasteClip', err));
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
    timelineEl.addEventListener('sg-timeline:clip-copied', onClipCopy);
    timelineEl.addEventListener('sg-timeline:clip-paste-requested', onClipPaste);
    timelineEl.addEventListener('sg-timeline:playhead-changed', onPlayhead);
    timelineEl.addEventListener('sg-timeline:track-add-requested', onTrackAdd);
    timelineEl.addEventListener('sg-timeline:track-remove-requested', onTrackRemove);
    timelineEl.addEventListener('sg-timeline:track-mute-requested', onTrackMute);
    timelineEl.addEventListener('sg-timeline:track-lock-requested', onTrackLock);
    function onClipRenamed(e) {
        const d = e.detail || {};
        if (!d.clipId) return;
        Promise.resolve(api.renameClip({ clipId: d.clipId, name: d.name || '' }))
            .catch(err => emitErr('renameClip', err));
    }
    timelineEl.addEventListener('sg-timeline:clip-renamed', onClipRenamed);
    timelineEl.addEventListener('sg-timeline:track-renamed', onTrackRenamed);
    timelineEl.addEventListener('sg-timeline:track-selected', onTrackSelected);
    timelineEl.addEventListener('sg-timeline:clip-track-changed', onClipTrackChange);
    return () => {
        timelineEl.removeEventListener('sg-timeline:clip-renamed', onClipRenamed);
        timelineEl.removeEventListener('sg-timeline:clip-added', onAdded);
        timelineEl.removeEventListener('sg-timeline:clip-moved', onMoved);
        timelineEl.removeEventListener('sg-timeline:clip-trimmed', onTrimmed);
        timelineEl.removeEventListener('sg-timeline:clip-selected', onSelected);
        timelineEl.removeEventListener('sg-timeline:clip-deleted', onDeleted);
        timelineEl.removeEventListener('sg-timeline:clip-split', onSplit);
        timelineEl.removeEventListener('sg-timeline:clip-color-requested', onColor);
        timelineEl.removeEventListener('sg-timeline:undo-requested', onUndo);
        timelineEl.removeEventListener('sg-timeline:redo-requested', onRedo);
        timelineEl.removeEventListener('sg-timeline:clip-copied', onClipCopy);
        timelineEl.removeEventListener('sg-timeline:clip-paste-requested', onClipPaste);
        timelineEl.removeEventListener('sg-timeline:playhead-changed', onPlayhead);
        timelineEl.removeEventListener('sg-timeline:track-add-requested', onTrackAdd);
        timelineEl.removeEventListener('sg-timeline:track-remove-requested', onTrackRemove);
        timelineEl.removeEventListener('sg-timeline:track-mute-requested', onTrackMute);
        timelineEl.removeEventListener('sg-timeline:track-lock-requested', onTrackLock);
        timelineEl.removeEventListener('sg-timeline:track-renamed', onTrackRenamed);
        timelineEl.removeEventListener('sg-timeline:track-selected', onTrackSelected);
        timelineEl.removeEventListener('sg-timeline:clip-track-changed', onClipTrackChange);
    };
}
