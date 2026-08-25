/** ui-prop-project.js — "Project" section rendered into the Properties pane
 *  when nothing is selected. Shows the editable project name + Save / Load
 *  controls. Future per-project settings (fps, output resolution, …) plug in
 *  as additional rows below the name field.
 */

import { section, row, readOnly, inlineRenameInput } from './ui-prop-fields.js';
import { mountSaveLoadControls } from './ui-save-load.js';
import { mountStorageUsage } from './ui-storage-usage.js';

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Render the Project section into `root`.
 *
 * Mounts the Save / Load controls inside the same section so persistence is
 * always one click away from where the user names the project. The save/load
 * controls live in `ui-save-load.js`; this file just stitches them in.
 *
 * @param {{ root: HTMLElement, project: object, api: object, getProject?: () => object }} cfg
 *   `project` is the wrapped project ({ schemaVersion, project, assets, … }).
 *   `getProject` is optional but preferred — without it, the save/load
 *   controls fall back to a closure over the rendered project, which can go
 *   stale across re-renders.
 */
export function renderProjectSection({ root, project, api, getProject }) {
    const meta = (project && project.project) || {};
    const sec = section('Project');
    // Editable name field: Enter / blur commits, Escape cancels.
    const nameInput = inlineRenameInput({
        value: meta.name || 'Untitled',
        onCommit: (v) => {
            try { api.renameProject({ name: v }); }
            catch (err) { emitErr('renameProject', err); }
        },
    });
    sec.appendChild(row('Name', nameInput));
    // Read-only structural metadata (acts as visual confirmation of the
    // serialised project shape; future tasks may make some of these editable).
    if (Number.isFinite(meta.fps)) sec.appendChild(row('FPS', readOnly(meta.fps)));
    if (Number.isFinite(meta.width) && Number.isFinite(meta.height)) {
        // Editable output size — type "1080 x 1920" (or "1080×1920") and commit
        // with Enter/blur. Lets the user flip a landscape canvas to portrait
        // after dropping a vertical recording. Applied via setProject so it's
        // undoable; bad input reverts silently on re-render.
        async function applyDims(w, h) {
            try {
                const p = await api.getProject();
                if (p.project.width === w && p.project.height === h) return;
                p.project.width = w;
                p.project.height = h;
                await api.setProject({ project: p });
            } catch (err) { emitErr('setOutputSize', err); }
        }
        // Deliberate commit model: resizing the canvas re-fits every clip, so
        // it only happens on the Apply button or Enter — never on blur.
        // Escape restores the current value.
        const dimsWrap = document.createElement('div');
        dimsWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
        const dimsInput = document.createElement('input');
        dimsInput.type = 'text';
        dimsInput.className = 'sgve-prop-input';
        dimsInput.value = `${meta.width} × ${meta.height}`;
        dimsInput.spellcheck = false;
        dimsInput.style.flex = '1';
        dimsInput.title = 'Output size, e.g. 1080 x 1920 — press Enter or Apply';
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'sgve-prop-btn sgve-prop-btn--secondary';
        applyBtn.textContent = 'Apply';
        applyBtn.title = 'Resize the output canvas (undoable)';
        function commitDims() {
            const m = String(dimsInput.value || '').match(/^\s*(\d{2,5})\s*[x×,*\s]\s*(\d{2,5})\s*$/i);
            if (!m) { emitErr('setOutputSize', new Error(`Cannot parse "${dimsInput.value}" — use e.g. 1080 x 1920`)); return; }
            // Blur before applying: the properties panel skips its re-render
            // while a text field inside it has focus, so committing from
            // Enter would otherwise leave the chips/value stale until reload.
            dimsInput.blur();
            applyDims(Math.min(7680, Math.max(16, parseInt(m[1], 10))),
                      Math.min(7680, Math.max(16, parseInt(m[2], 10))));
        }
        applyBtn.addEventListener('click', commitDims);
        dimsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitDims(); }
            else if (e.key === 'Escape') {
                e.preventDefault();
                dimsInput.value = `${meta.width} × ${meta.height}`;
                dimsInput.blur();
            }
        });
        dimsWrap.appendChild(dimsInput);
        dimsWrap.appendChild(applyBtn);
        sec.appendChild(row('Output', dimsWrap));

        // Preset chips — common landscape + vertical (Shorts) sizes. The
        // active chip highlights; the panel re-renders on project change so
        // the highlight tracks manual edits too.
        const PRESETS = [
            { w: 1280, h: 720,  label: 'Landscape 720p' },
            { w: 1920, h: 1080, label: 'Landscape 1080p' },
            { w: 1080, h: 1920, label: 'Vertical (Shorts)' },
        ];
        const chips = document.createElement('div');
        chips.className = 'sgve-output-presets';
        chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:4px 0 6px;';
        for (const pr of PRESETS) {
            const b = document.createElement('button');
            b.type = 'button';
            const active = meta.width === pr.w && meta.height === pr.h;
            b.textContent = `${pr.label} · ${pr.w}×${pr.h}`;
            b.title = `Set output to ${pr.w} × ${pr.h}`;
            b.dataset.preset = `${pr.w}x${pr.h}`;
            b.style.cssText = [
                'font-size:10.5px', 'padding:3px 8px', 'border-radius:10px',
                'cursor:pointer', 'font-family:inherit', 'line-height:1.4',
                active
                    ? 'background:rgba(20,184,166,0.18);border:1px solid #14b8a6;color:#5eead4'
                    : 'background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);color:#94a3b8',
            ].join(';');
            b.addEventListener('click', () => applyDims(pr.w, pr.h));
            chips.appendChild(b);
        }
        sec.appendChild(chips);
    }
    root.appendChild(sec);

    // Save / Load controls. Mounted into a dedicated section so future
    // settings can sit between Name and Save without re-flowing the layout.
    const saveSec = section('Save / Load');
    root.appendChild(saveSec);
    mountSaveLoadControls({
        host: saveSec,
        api,
        getProject: getProject || (() => project),
    });
    // Round-9-J: Storage usage line — a quick read of IDB + localStorage
    // total bytes so the user can see how much disk their assets are
    // chewing without leaving the editor.
    mountStorageUsage({ host: root, api });
}
