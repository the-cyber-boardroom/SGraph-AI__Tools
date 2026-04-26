/** ui-shortcuts-panel.js — keyboard shortcuts cheatsheet panel.
 *  Mounted under the Assets panel (left column, bottom). Read-only. */

const SHORTCUTS = [
    { keys: ['Space'],                          desc: 'Play / pause' },
    { keys: ['Cmd/Ctrl', 'C'],                  desc: 'Copy selected clip' },
    { keys: ['Cmd/Ctrl', 'V'],                  desc: 'Paste at playhead on selected track' },
    { keys: ['Cmd/Ctrl', 'drag'],               desc: 'Copy clip while dragging' },
    { keys: ['S'],                              desc: 'Split selected clip at playhead' },
    { keys: ['click', 'header'],                desc: 'Select track' },
    { keys: ['dbl-click', 'name'],              desc: 'Rename track (or click ✎)' },
];

function buildKeyChip(text) {
    const span = document.createElement('span');
    span.className = 'sgve-sc-key';
    span.textContent = text;
    return span;
}

/**
 * Mount the shortcuts panel.
 * @param {{ host: HTMLElement }} cfg
 * @returns {{ destroy: () => void }}
 */
export function mountShortcutsPanel({ host }) {
    if (!host) return { destroy() {} };
    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'sgve-sc-panel';

    const header = document.createElement('div');
    header.className = 'sgve-sc-header';
    const title = document.createElement('div');
    title.className = 'sgve-sc-title';
    title.textContent = 'Shortcuts';
    header.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'sgve-sc-list';
    list.setAttribute('role', 'list');
    for (const sc of SHORTCUTS) {
        const li = document.createElement('li');
        li.className = 'sgve-sc-row';
        const keys = document.createElement('div');
        keys.className = 'sgve-sc-keys';
        for (const k of sc.keys) {
            // Treat '/' and 'header' / 'name' / 'drag' as plain glue text, not chips.
            if (k === '/' || k === 'header' || k === 'name' || k === 'drag') {
                const sep = document.createElement('span');
                sep.className = 'sgve-sc-glue';
                sep.textContent = ' ' + k + ' ';
                keys.appendChild(sep);
            } else {
                keys.appendChild(buildKeyChip(k));
            }
        }
        const desc = document.createElement('div');
        desc.className = 'sgve-sc-desc';
        desc.textContent = sc.desc;
        li.appendChild(keys);
        li.appendChild(desc);
        list.appendChild(li);
    }

    root.appendChild(header);
    root.appendChild(list);
    host.appendChild(root);

    return {
        destroy() { try { host.innerHTML = ''; } catch (_) {} },
    };
}
