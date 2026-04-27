// timeline-split-button.js — toolbar Split button for sg-timeline (v0.1.0)

import { snapToFps, clipTimelineEnd } from '../../../../../core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import { SGT_EVENTS } from './timeline-events.js';

/**
 * Find a clip by id across all video tracks of project.
 * @param {object|null} project
 * @param {string|null} clipId
 * @returns {object|null}
 */
function findClip(project, clipId) {
    if (!project || !clipId || !Array.isArray(project.tracks)) return null;
    for (const t of project.tracks) {
        if (t && t.kind === 'video' && Array.isArray(t.clips)) {
            for (const c of t.clips) if (c && c.id === clipId) return c;
        }
    }
    return null;
}

/**
 * Compute the snapped split-time and whether splitting is allowed for the
 * currently-selected clip and playhead. Mirrors the keyboard-S guard.
 * @param {{project: object|null, fps: number, playhead?: number, selectedClipId?: string|null}} state
 * @returns {{ enabled: boolean, clip: object|null, atTime: number }}
 */
export function computeSplitState(state) {
    const sel = state && state.selectedClipId;
    const clip = findClip(state ? state.project : null, sel);
    if (!clip) return { enabled: false, clip: null, atTime: 0 };
    const fps = state.fps || 30;
    const ph = Number.isFinite(state.playhead) ? state.playhead : 0;
    const t = snapToFps(ph, fps);
    const enabled = t > clip.timelineStart && t < clipTimelineEnd(clip);
    return { enabled, clip, atTime: t };
}

/**
 * Build the Split toolbar button. Caller appends `root` somewhere.
 * Refresh must be called whenever selection, playhead, or project changes.
 *
 * @param {{
 *   getState: () => {project: object|null, fps: number, playhead?: number, selectedClipId?: string|null},
 *   dispatch: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ root: HTMLElement, refresh: () => void, dispose: () => void }}
 */
export function mountSplitButton(cfg) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'split-button';
    btn.textContent = 'Split';
    btn.title = 'Split selected clip at playhead (S)';
    btn.disabled = true;

    function refresh() {
        const { enabled } = computeSplitState(cfg.getState());
        btn.disabled = !enabled;
    }

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const { enabled, clip, atTime } = computeSplitState(cfg.getState());
        if (!enabled || !clip) return;
        cfg.dispatch(SGT_EVENTS.CLIP_SPLIT_REQUESTED, { clipId: clip.id, atTime });
    });

    refresh();
    return { root: btn, refresh, dispose: () => btn.remove() };
}
