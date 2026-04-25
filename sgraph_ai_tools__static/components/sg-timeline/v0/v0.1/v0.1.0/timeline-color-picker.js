// timeline-color-picker.js — per-clip colour-override picker (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';

const PRESETS = [
    '#4f46e5', '#0d9488', '#b45309', '#be185d', '#7e22ce', '#0369a1',
    '#dc2626', '#16a34a', '#475569', '#1f2937', '#f8fafc', '#f97316',
];

const EMPTY_BG = 'linear-gradient(45deg,#475569 25%,transparent 25%,transparent 75%,#475569 75%),' +
                 'linear-gradient(45deg,#475569 25%,transparent 25%,transparent 75%,#475569 75%)';

/**
 * Find the colour of the currently-selected clip in the project, if any.
 * @param {object|null} project
 * @param {string|null} clipId
 * @returns {string|null}
 */
function findClipColor(project, clipId) {
    if (!project || !clipId || !Array.isArray(project.tracks)) return null;
    for (const t of project.tracks) {
        if (t && Array.isArray(t.clips)) {
            for (const c of t.clips) if (c && c.id === clipId) return c.color || null;
        }
    }
    return null;
}

/**
 * Build the swatch popover DOM (presets + custom + reset).
 * @param {(color: string|null) => void} onPick
 * @returns {{ pop: HTMLElement, custom: HTMLInputElement }}
 */
function buildPopover(onPick) {
    const pop = document.createElement('div');
    pop.className = 'color-picker__pop';
    const grid = document.createElement('div');
    grid.className = 'color-picker__grid';
    for (const c of PRESETS) {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'color-picker__swatch';
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('click', (e) => { e.preventDefault(); onPick(c); });
        grid.appendChild(sw);
    }
    pop.appendChild(grid);
    const row1 = document.createElement('div');
    row1.className = 'color-picker__row';
    const customLabel = document.createElement('span');
    customLabel.textContent = 'Custom';
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.className = 'color-picker__custom';
    custom.addEventListener('change', () => onPick(custom.value));
    row1.append(customLabel, custom);
    const row2 = document.createElement('div');
    row2.className = 'color-picker__row';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'color-picker__reset';
    reset.textContent = 'Use auto';
    reset.addEventListener('click', (e) => { e.preventDefault(); onPick(null); });
    row2.appendChild(reset);
    pop.append(row1, row2);
    return { pop, custom };
}

/**
 * Mount the colour-picker control inside a host element (e.g. zoom toolbar).
 * Dispatches CLIP_COLOR_REQUESTED with `{ clipId, color }` on selection.
 *
 * @param {{ host: HTMLElement, getState: () => {project: object|null, selectedClipId: string|null}, dispatch: (name: string, detail: object) => void }} cfg
 * @returns {{ root: HTMLElement, refresh: () => void, dispose: () => void }}
 */
export function mountColorPicker(cfg) {
    const root = document.createElement('div');
    root.className = 'color-picker';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-picker__btn';
    btn.title = 'Clip colour';
    const dot = document.createElement('span');
    dot.className = 'color-picker__dot';
    btn.appendChild(dot);
    root.appendChild(btn);

    function pick(color) {
        const sel = cfg.getState().selectedClipId;
        if (!sel) return;
        cfg.dispatch(SGT_EVENTS.CLIP_COLOR_REQUESTED, { clipId: sel, color });
        close();
    }

    const { pop, custom } = buildPopover(pick);
    root.appendChild(pop);

    function refresh() {
        const { project, selectedClipId } = cfg.getState();
        const has = !!selectedClipId;
        btn.disabled = !has;
        const color = has ? findClipColor(project, selectedClipId) : null;
        if (color) {
            dot.style.setProperty('--cp-color', color);
            dot.style.setProperty('--cp-empty', 'none');
            custom.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#4f46e5';
        } else {
            dot.style.setProperty('--cp-color', 'transparent');
            dot.style.setProperty('--cp-empty', `${EMPTY_BG}`);
        }
    }

    function close() { pop.classList.remove('is-open'); document.removeEventListener('click', onDocClick, true); }
    function open() { pop.classList.add('is-open'); document.addEventListener('click', onDocClick, true); }
    function onDocClick(e) { if (!root.contains(e.target) && (!e.composedPath || !e.composedPath().includes(root))) close(); }

    btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (btn.disabled) return;
        if (pop.classList.contains('is-open')) close(); else open();
    });

    refresh();
    return { root, refresh, dispose: () => { close(); root.remove(); } };
}
