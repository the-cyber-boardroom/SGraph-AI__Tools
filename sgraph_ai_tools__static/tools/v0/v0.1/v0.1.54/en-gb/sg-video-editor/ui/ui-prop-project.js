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
        sec.appendChild(row('Output', readOnly(`${meta.width} × ${meta.height}`)));
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
