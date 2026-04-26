/** ui-properties-panel.js — kind-aware properties editor for the selected clip.
 *
 * Subscribes to state changes + selection changes via callbacks. Renders a
 * kind-specific form (asset / shape / text / nothing-selected). When nothing
 * is selected we show the Project section instead of an empty placeholder.
 *
 * Field/row/section builders live in `ui-prop-fields.js`; the project section
 * lives in `ui-prop-project.js` (so adding fps / resolution / future project
 * settings is a one-block edit there, not a sweep through this file).
 */

import { getClipKind } from '/core/video-composer/v0/v0.1/v0.1.0/composer-schema.js';
import {
    row, section, readOnly,
    numberInput, rangeInput, colorInput, textArea, textInput, buttonRow,
} from './ui-prop-fields.js';
import { renderProjectSection } from './ui-prop-project.js';

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/** Find a clip + its track in the wrapped project (not the flat composer one). */
function findSelectedClip(project, clipId) {
    if (!project || !clipId || !Array.isArray(project.tracks)) return null;
    for (const t of project.tracks) {
        if (!t || !Array.isArray(t.clips)) continue;
        for (const c of t.clips) if (c && c.id === clipId) return { clip: c, track: t };
    }
    return null;
}

function findAssetById(project, assetId) {
    if (!project || !assetId || !Array.isArray(project.assets)) return null;
    return project.assets.find(a => a && a.id === assetId) || null;
}

/* ── Form renderers per clip kind ─────────────────────────────── */

function renderTransform({ root, clip, api }) {
    const t = clip.transform || { x: 0.5, y: 0.5, scale: 1 };
    const sec = section('Transform');
    function setTransform(patch, transient) {
        try {
            api.setClipTransform({
                clipId: clip.id,
                transform: { ...t, ...patch },
                transient: !!transient,
            });
            Object.assign(t, patch);
        } catch (err) { emitErr('setClipTransform', err); }
    }
    sec.appendChild(row('X', rangeInput({
        value: t.x, min: 0, max: 1, step: 0.001,
        onInput: (v) => setTransform({ x: v }, true),
        onChange: (v) => setTransform({ x: v }, false),
    })));
    sec.appendChild(row('Y', rangeInput({
        value: t.y, min: 0, max: 1, step: 0.001,
        onInput: (v) => setTransform({ y: v }, true),
        onChange: (v) => setTransform({ y: v }, false),
    })));
    sec.appendChild(row('Scale', rangeInput({
        value: t.scale, min: 0.05, max: 8, step: 0.01,
        onInput: (v) => setTransform({ scale: v }, true),
        onChange: (v) => setTransform({ scale: v }, false),
    })));
    root.appendChild(sec);
}

function renderAssetForm({ root, clip, project, api }) {
    const asset = findAssetById(project, clip.assetId);
    const sec = section('Asset');
    sec.appendChild(row('Name', readOnly(asset?.name || clip.assetId)));
    sec.appendChild(row('Type', readOnly(asset?.assetType || 'asset')));
    if (asset && asset.width && asset.height) {
        sec.appendChild(row('Source', readOnly(`${asset.width} × ${asset.height}`)));
    }
    if (asset && Number.isFinite(asset.duration)) {
        sec.appendChild(row('Duration', readOnly(`${asset.duration.toFixed(2)}s`)));
    }
    root.appendChild(sec);

    renderTransform({ root, clip, api });

    const cropSec = section('Crop (0..1 of source)');
    const c = clip.crop || { x: 0, y: 0, w: 1, h: 1 };
    function setCrop(patch, transient) {
        try {
            api.setClipCrop({
                clipId: clip.id,
                crop: { ...c, ...patch },
                transient: !!transient,
            });
            Object.assign(c, patch);
        } catch (err) { emitErr('setClipCrop', err); }
    }
    for (const k of ['x', 'y', 'w', 'h']) {
        cropSec.appendChild(row(k.toUpperCase(), rangeInput({
            value: c[k], min: 0, max: 1, step: 0.001,
            onInput: (v) => setCrop({ [k]: v }, true),
            onChange: (v) => setCrop({ [k]: v }, false),
        })));
    }
    root.appendChild(cropSec);
}

function renderShapeForm({ root, clip, api }) {
    const sec = section('Shape');
    const s = clip.shape || { type: 'rect', fill: '#000000', w: 480, h: 320 };
    sec.appendChild(row('Type', readOnly(s.type)));
    sec.appendChild(row('Fill', colorInput({
        value: s.fill,
        onChange: (v) => {
            try { api.setShapeProps({ clipId: clip.id, shape: { fill: v } }); }
            catch (err) { emitErr('setShapeProps', err); }
        },
    })));
    sec.appendChild(row('Width (px)', numberInput({
        value: s.w, min: 1, step: 1,
        onChange: (v) => {
            try { api.setShapeProps({ clipId: clip.id, shape: { w: v } }); }
            catch (err) { emitErr('setShapeProps', err); }
        },
    })));
    sec.appendChild(row('Height (px)', numberInput({
        value: s.h, min: 1, step: 1,
        onChange: (v) => {
            try { api.setShapeProps({ clipId: clip.id, shape: { h: v } }); }
            catch (err) { emitErr('setShapeProps', err); }
        },
    })));
    root.appendChild(sec);
    renderTransform({ root, clip, api });
}

function renderTextForm({ root, clip, api }) {
    const sec = section('Text');
    const t = clip.text || { content: '', color: '#ffffff', fontSize: 64, fontFamily: 'system-ui, sans-serif', w: 720, h: 160 };
    sec.appendChild(row('Content', textArea({
        value: t.content,
        onChange: (v) => {
            try { api.setTextProps({ clipId: clip.id, text: { content: v } }); }
            catch (err) { emitErr('setTextProps', err); }
        },
    })));
    sec.appendChild(row('Colour', colorInput({
        value: t.color,
        onChange: (v) => {
            try { api.setTextProps({ clipId: clip.id, text: { color: v } }); }
            catch (err) { emitErr('setTextProps', err); }
        },
    })));
    sec.appendChild(row('Font size', numberInput({
        value: t.fontSize, min: 8, step: 1,
        onChange: (v) => {
            try { api.setTextProps({ clipId: clip.id, text: { fontSize: v } }); }
            catch (err) { emitErr('setTextProps', err); }
        },
    })));
    sec.appendChild(row('Font family', textInput({
        value: t.fontFamily,
        onChange: (v) => {
            try { api.setTextProps({ clipId: clip.id, text: { fontFamily: v } }); }
            catch (err) { emitErr('setTextProps', err); }
        },
    })));
    root.appendChild(sec);
    renderTransform({ root, clip, api });
}

function renderTimelineSection({ root, clip, api }) {
    const sec = section('Timeline');
    sec.appendChild(row('Start (s)', numberInput({
        value: clip.timelineStart, min: 0, step: 0.01,
        onChange: (v) => {
            try { api.moveClip({ clipId: clip.id, timelineStart: v }); }
            catch (err) { emitErr('moveClip', err); }
        },
    })));
    sec.appendChild(row('In (s)', numberInput({
        value: clip.inPoint, min: 0, step: 0.01,
        onChange: (v) => {
            try { api.trimClip({ clipId: clip.id, inPoint: v, outPoint: clip.outPoint }); }
            catch (err) { emitErr('trimClip', err); }
        },
    })));
    sec.appendChild(row('Out (s)', numberInput({
        value: clip.outPoint, min: 0.01, step: 0.01,
        onChange: (v) => {
            try { api.trimClip({ clipId: clip.id, inPoint: clip.inPoint, outPoint: v }); }
            catch (err) { emitErr('trimClip', err); }
        },
    })));
    root.appendChild(sec);
}

function renderActions({ root, clip, api }) {
    const sec = section('Actions');
    sec.appendChild(buttonRow('Delete clip', 'danger', () => {
        try { api.removeClip({ clipId: clip.id }); }
        catch (err) { emitErr('removeClip', err); }
    }));
    root.appendChild(sec);
}

/** Hint shown alongside the Project section when no clip is selected. */
function renderEmptyHint(root) {
    const hint = document.createElement('div');
    hint.className = 'sgve-prop-empty';
    hint.textContent = 'Select a clip on the timeline to edit its properties.';
    root.appendChild(hint);
}

/* ── Mount ─────────────────────────────────────────────────────── */

/**
 * @param {{
 *   host: HTMLElement,
 *   state: object,
 *   api: object,
 *   getSelectedClipId: () => string|null,
 * }} cfg
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function mountPropertiesPanel({ host, state, api, getSelectedClipId }) {
    if (!host) return { refresh() {}, destroy() {} };
    host.classList.add('sgve-prop-host');
    const root = document.createElement('div');
    root.className = 'sgve-prop-panel';
    host.appendChild(root);

    function refresh() {
        const project = state.getProject();
        const clipId = getSelectedClipId();
        const found = clipId ? findSelectedClip(project, clipId) : null;
        root.replaceChildren();
        if (!found) {
            // Nothing selected — show the Project section + a hint.
            renderProjectSection({ root, project, api });
            renderEmptyHint(root);
            return;
        }
        const { clip } = found;
        const kind = getClipKind(clip);
        if (kind === 'shape') renderShapeForm({ root, clip, api });
        else if (kind === 'text') renderTextForm({ root, clip, api });
        else renderAssetForm({ root, clip, project, api });
        renderTimelineSection({ root, clip, api });
        renderActions({ root, clip, api });
    }

    function onChange(e) {
        // Skip transient updates — the form fields drove them, the active
        // input already shows the value. Re-rendering would steal focus.
        if (e && e.detail && e.detail.transient) return;
        // Skip if a focused inline-rename / textarea / input lives inside
        // the panel — re-rendering would steal focus mid-edit. The next
        // non-transient change after blur will refresh.
        const ae = document.activeElement;
        if (ae && root.contains(ae)) return;
        refresh();
    }
    state.addEventListener('change', onChange);
    refresh();

    return {
        refresh,
        destroy() {
            try { state.removeEventListener('change', onChange); } catch (_) {}
            try { root.remove(); } catch (_) {}
            host.classList.remove('sgve-prop-host');
        },
    };
}
