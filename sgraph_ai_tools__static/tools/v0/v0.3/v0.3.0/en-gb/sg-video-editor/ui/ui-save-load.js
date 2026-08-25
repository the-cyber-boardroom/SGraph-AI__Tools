/** ui-save-load.js — Save / Save As / Load / Delete / New controls.
 *
 * Mounts as a single block inside the Project section of the Properties pane.
 *
 * Dirty notice: listens for `sgve:state-changed` (dispatched by ui-shell after
 * every debounced state mutation) to show/hide the "UNSAVED CHANGES" banner.
 * The banner also carries a "Save now" shortcut so the user never has to hunt
 * for the Save button.
 *
 * All persistence calls go through the SgToolApi (`api.saveProject`, …).
 * Round-9-J: every SgToolApi call is awaited — even sync impls wrap in Promise.
 */

import { slugify } from './state-storage.js';
import { showConfirm } from './ui-confirm.js';

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Flush any focused text input (e.g. the inline-rename Name field) by blurring
 * it so a pending rename commits before we read the project name.
 */
function flushFocusedInput() {
    if (typeof document === 'undefined') return;
    const ae = document.activeElement;
    if (!ae) return;
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
        try { ae.blur(); } catch (_) {}
    }
}

function timeAgo(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return '—';
    const dMs = Date.now() - ts;
    if (dMs < 60_000) return `${Math.max(1, Math.floor(dMs / 1000))}s ago`;
    if (dMs < 3_600_000) return `${Math.floor(dMs / 60_000)}m ago`;
    if (dMs < 86_400_000) return `${Math.floor(dMs / 3_600_000)}h ago`;
    return `${Math.floor(dMs / 86_400_000)}d ago`;
}

function fmtBytes(n) {
    if (!Number.isFinite(n)) return '?';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Build a button with the standard properties-pane styling. */
function btn(label, kind, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sgve-prop-btn sgve-prop-btn--${kind}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
}

/**
 * Mount the Save/Load controls into `host`.
 *
 * @param {{
 *   host: HTMLElement,
 *   api: object,
 *   getProject: () => object,
 *   onLoaded?: () => void,
 *   onNewProject?: () => void,
 * }} cfg
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function mountSaveLoadControls({ host, api, getProject, onLoaded, onNewProject }) {
    if (!host || !api) return { refresh() {}, destroy() {} };

    const wrap = document.createElement('div');
    wrap.className = 'sgve-saveload';

    // ── Dirty notice (hidden until state changes) ─────────────────────────
    const dirtyNotice = document.createElement('div');
    dirtyNotice.className = 'sgve-unsaved-notice';
    dirtyNotice.hidden = true;
    dirtyNotice.innerHTML = '<span class="sgve-unsaved-notice__icon">⚠</span><span class="sgve-unsaved-notice__text">Unsaved changes</span>';
    const saveNowBtn = document.createElement('button');
    saveNowBtn.type = 'button';
    saveNowBtn.className = 'sgve-unsaved-notice__btn';
    saveNowBtn.textContent = 'Save now';
    saveNowBtn.addEventListener('click', () => onSaveClick());
    dirtyNotice.appendChild(saveNowBtn);
    wrap.appendChild(dirtyNotice);

    // ── Top row: Save / Save As / New ─────────────────────────────────────
    const topRow = document.createElement('div');
    topRow.className = 'sgve-saveload__row';
    topRow.appendChild(btn('Save', 'primary', onSaveClick));
    topRow.appendChild(btn('Save As…', 'secondary', onSaveAsClick));
    topRow.appendChild(btn('New', 'secondary', onNewClick));
    wrap.appendChild(topRow);

    // ── Saved-projects list ───────────────────────────────────────────────
    const list = document.createElement('div');
    list.className = 'sgve-saveload__list';
    wrap.appendChild(list);

    host.appendChild(wrap);

    function updateDirtyNotice(isDirty) {
        dirtyNotice.hidden = !isDirty;
    }

    async function fetchSavedProjects() {
        try {
            const r = await api.listSavedProjects();
            return (r && Array.isArray(r.projects)) ? r.projects : [];
        } catch (_) { return []; }
    }

    async function onSaveClick() {
        try {
            flushFocusedInput();
            const project = getProject();
            const name = (project && project.project && project.project.name) || 'Untitled';
            // Save silently — no overwrite confirmation when saving the current project.
            await api.saveProject({ name });
            updateDirtyNotice(false);
            document.dispatchEvent(new CustomEvent('sgve:project-saved'));
            await refresh();
        } catch (err) { emitErr('saveProject', err); }
    }

    async function onSaveAsClick() {
        try {
            flushFocusedInput();
            const project = getProject();
            const current = (project && project.project && project.project.name) || 'Untitled';
            const next = prompt('Save project as…', current);
            if (next == null) return;
            const trimmed = String(next).trim() || 'Untitled';
            try { await api.renameProject({ name: trimmed }); }
            catch (err) { emitErr('renameProject', err); return; }
            const existing = await fetchSavedProjects();
            const overwrite = existing.some(p => p && p.name === trimmed);
            if (overwrite) {
                const ok = await showConfirm(
                    `A saved project named "${trimmed}" already exists. Overwrite it?`,
                    { title: 'Overwrite project?', confirmLabel: 'Overwrite', danger: true });
                if (!ok) return;
            }
            await api.saveProject({ name: trimmed });
            updateDirtyNotice(false);
            document.dispatchEvent(new CustomEvent('sgve:project-saved'));
            await refresh();
        } catch (err) { emitErr('saveProject', err); }
    }

    async function onNewClick() {
        try {
            const r = await api.hasUnsavedChanges();
            const dirty = !!(r && (r.hasUnsavedChanges === true || r === true));
            if (dirty) {
                const ok = await showConfirm(
                    'You have unsaved changes. Start a new project anyway?',
                    { title: 'Discard unsaved changes?', confirmLabel: 'Discard & start new', danger: true });
                if (!ok) return;
            }
            const blank = {
                schemaVersion: '0.1.0',
                project: {
                    id: `p_${Math.random().toString(16).slice(2, 10)}`,
                    name: 'Untitled', fps: 30, width: 1280, height: 720,
                    createdAt: Date.now(),
                },
                assets: [],
                tracks: [{ id: 't-video-1', kind: 'video', index: 0, muted: false, clips: [] }],
                operations: [],
            };
            await api.setProject({ project: blank });
            try { await api.discardAutosave(); } catch (_) {}
            // Signal ui-shell to mark the blank project as the clean baseline
            // so hasUnsavedChanges() returns false until the user actually edits.
            document.dispatchEvent(new CustomEvent('sgve:new-project-created'));
            if (typeof onNewProject === 'function') onNewProject();
            await refresh();
        } catch (err) { emitErr('newProject', err); }
    }

    async function onLoadRowClick(slug) {
        try {
            const r = await api.hasUnsavedChanges();
            const dirty = !!(r && (r.hasUnsavedChanges === true || r === true));
            if (dirty) {
                const ok = await showConfirm(
                    'You have unsaved changes. Load this project anyway?',
                    { title: 'Discard unsaved changes?', confirmLabel: 'Discard & load', danger: true });
                if (!ok) return;
            }
            await api.loadProject({ slug });
            try { await api.discardAutosave(); } catch (_) {}
            if (typeof onLoaded === 'function') onLoaded();
            await refresh();
        } catch (err) { emitErr('loadProject', err); }
    }

    async function onDeleteRowClick(slug, name) {
        try {
            const ok = await showConfirm(
                `"${name}" will be permanently deleted and cannot be recovered.`,
                { title: 'Delete saved project?', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            await api.deleteSavedProject({ slug });
            await refresh();
        } catch (err) { emitErr('deleteSavedProject', err); }
    }

    async function refresh() {
        list.replaceChildren();
        // Sync the dirty notice with actual persistence state (accurate after save/load/new)
        try {
            const r = await api.hasUnsavedChanges();
            updateDirtyNotice(!!(r && (r.hasUnsavedChanges === true || r === true)));
        } catch (_) {}
        const entries = await fetchSavedProjects();
        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'sgve-saveload__empty';
            empty.textContent = 'No saved projects yet — click Save to create one.';
            list.appendChild(empty);
            return;
        }
        const heading = document.createElement('div');
        heading.className = 'sgve-saveload__heading';
        heading.textContent = 'Saved projects';
        list.appendChild(heading);
        for (const e of entries) {
            const row = document.createElement('div');
            row.className = 'sgve-saveload__row sgve-saveload__row--saved';
            const meta = document.createElement('div');
            meta.className = 'sgve-saveload__meta';
            const name = document.createElement('span');
            name.className = 'sgve-saveload__name';
            name.textContent = e.name || e.slug;
            const sub = document.createElement('span');
            sub.className = 'sgve-saveload__sub';
            sub.textContent = `${timeAgo(e.savedAt)} · ${fmtBytes(e.byteSize)}`;
            meta.append(name, sub);
            row.appendChild(meta);
            row.appendChild(btn('Load', 'primary', () => onLoadRowClick(e.slug)));
            row.appendChild(btn('Delete', 'danger', () => onDeleteRowClick(e.slug, e.name || e.slug)));
            list.appendChild(row);
        }
    }

    // Listen for state-changed events dispatched by ui-shell (debounced).
    function onSgveStateChanged(e) {
        if (e.detail && typeof e.detail.isDirty === 'boolean') {
            updateDirtyNotice(e.detail.isDirty);
        }
    }
    document.addEventListener('sgve:state-changed', onSgveStateChanged);

    refresh();

    return {
        refresh,
        destroy() {
            document.removeEventListener('sgve:state-changed', onSgveStateChanged);
            try { wrap.remove(); } catch (_) {}
        },
    };
}
