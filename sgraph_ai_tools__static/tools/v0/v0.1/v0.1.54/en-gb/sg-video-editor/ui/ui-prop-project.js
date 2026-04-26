/** ui-prop-project.js — "Project" section rendered into the Properties pane
 *  when nothing is selected. Currently shows the editable project name; future
 *  settings (fps, output resolution, …) plug in as additional rows below.
 */

import { section, row, readOnly, inlineRenameInput } from './ui-prop-fields.js';

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

/**
 * Render the Project section into `root`.
 *
 * @param {{ root: HTMLElement, project: object, api: object }} cfg
 *   `project` is the wrapped project ({ schemaVersion, project, assets, … }).
 */
export function renderProjectSection({ root, project, api }) {
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
}
