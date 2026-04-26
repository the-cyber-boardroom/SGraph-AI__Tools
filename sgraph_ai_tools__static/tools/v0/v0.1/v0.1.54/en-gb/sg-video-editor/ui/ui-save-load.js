/** ui-save-load.js — Save / Save As / Load / Delete / New controls.
 *
 * Mounts as a single block inside the Project section of the Properties pane.
 * Uses native `confirm()` / `prompt()` for the few yes-no / one-line inputs;
 * a custom modal could swap in later without touching the API surface.
 *
 * Only deals with DOM + browser dialogs. All persistence calls go through the
 * SgToolApi (`api.saveProject`, `api.loadProject`, …).
 *
 * Round-9-J: every call to a SgToolApi method goes through `await` because
 * SgToolApi._invoke is itself async — callers MUST await even if the
 * registered impl is synchronous, otherwise we read a Promise as if it were
 * the raw value (the bug that hid the saved-projects list in Round-9-H).
 */

import { slugify } from './state-storage.js';

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Flush any focused text input (e.g. the inline-rename Name field) by blurring
 * it. Inputs created via `inlineRenameInput` commit on `blur` — without this
 * the user's pending rename is still in the DOM input but not yet in the
 * project model, so a click-Save-without-blur would save under the OLD name
 * and the toast would announce the OLD name. Blur is synchronous, so the
 * follow-on `getProject()` reads the updated value.
 *
 * Tolerant of `document.activeElement === null` (some shadow-DOM contexts).
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
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
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

    // Top row: Save / Save As / New
    const topRow = document.createElement('div');
    topRow.className = 'sgve-saveload__row';
    topRow.appendChild(btn('Save', 'primary', onSaveClick));
    topRow.appendChild(btn('Save As…', 'secondary', onSaveAsClick));
    topRow.appendChild(btn('New', 'secondary', onNewClick));
    wrap.appendChild(topRow);

    // Saved-projects list (rendered on refresh).
    const list = document.createElement('div');
    list.className = 'sgve-saveload__list';
    wrap.appendChild(list);

    host.appendChild(wrap);

    /** Resolve the saved-projects list, awaiting the SgToolApi promise. */
    async function fetchSavedProjects() {
        try {
            const r = await api.listSavedProjects();
            return (r && Array.isArray(r.projects)) ? r.projects : [];
        } catch (_) { return []; }
    }

    async function onSaveClick() {
        try {
            // Round-9-K Item 1: flush any focused rename input BEFORE reading
            // the project name. Otherwise a user who types a new name and
            // clicks Save without first blurring sees a toast with the OLD
            // name (the inline-rename input only commits on Enter / blur).
            flushFocusedInput();
            const project = getProject();
            const name = (project && project.project && project.project.name) || 'Untitled';
            const existing = await fetchSavedProjects();
            const slug = slugify(name);
            const overwrite = existing.some(p => p && (p.slug === slug || p.name === name));
            if (overwrite) {
                if (!confirm(`A saved project named "${name}" exists. Overwrite?`)) return;
            }
            await api.saveProject({ name });
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
            // Apply rename to the in-memory project so the display reflects
            // the user's choice. Then save under the new name.
            try { await api.renameProject({ name: trimmed }); }
            catch (err) { emitErr('renameProject', err); return; }
            const existing = await fetchSavedProjects();
            const overwrite = existing.some(p => p && p.name === trimmed);
            if (overwrite) {
                if (!confirm(`A saved project named "${trimmed}" exists. Overwrite?`)) return;
            }
            await api.saveProject({ name: trimmed });
            await refresh();
        } catch (err) { emitErr('saveProject', err); }
    }

    async function onNewClick() {
        try {
            const r = await api.hasUnsavedChanges();
            const dirty = !!(r && (r.hasUnsavedChanges === true || r === true));
            if (dirty) {
                if (!confirm('Discard unsaved changes and start a new project?')) return;
            }
            // Replace via setProject. Build a fresh blank wrapped project.
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
            if (typeof onNewProject === 'function') onNewProject();
            await refresh();
        } catch (err) { emitErr('newProject', err); }
    }

    async function onLoadRowClick(slug) {
        try {
            const r = await api.hasUnsavedChanges();
            const dirty = !!(r && (r.hasUnsavedChanges === true || r === true));
            if (dirty) {
                if (!confirm('Discard unsaved changes and load this project?')) return;
            }
            await api.loadProject({ slug });
            try { await api.discardAutosave(); } catch (_) {}
            if (typeof onLoaded === 'function') onLoaded();
            await refresh();
        } catch (err) { emitErr('loadProject', err); }
    }

    async function onDeleteRowClick(slug, name) {
        try {
            if (!confirm(`Delete saved project "${name}"? This cannot be undone.`)) return;
            await api.deleteSavedProject({ slug });
            await refresh();
        } catch (err) { emitErr('deleteSavedProject', err); }
    }

    async function refresh() {
        list.replaceChildren();
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

    refresh();

    return {
        refresh,
        destroy() {
            try { wrap.remove(); } catch (_) {}
        },
    };
}
