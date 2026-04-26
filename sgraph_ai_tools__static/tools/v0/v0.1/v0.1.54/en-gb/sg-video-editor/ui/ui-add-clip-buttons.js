/** ui-add-clip-buttons.js — "+ Shape" / "+ Text" toolbar for the asset panel.
 *
 * Adds shape (filled rect with chosen colour) or text (string + colour + size)
 * clips to the first video track at the current playhead. Colour palette
 * includes black/white + a small contrast set; custom hex via <input type=color>.
 */

const PALETTE = [
    '#000000', '#ffffff', '#dc2626', '#f97316', '#eab308',
    '#16a34a', '#0ea5e9', '#4f46e5', '#a855f7', '#ec4899',
    '#475569', '#14b8a6',
];

function findFirstVideoTrackId(project) {
    if (!project || !Array.isArray(project.tracks)) return null;
    const t = project.tracks.find(x => x && x.kind === 'video');
    return t ? t.id : null;
}

function emitErr(step, err) {
    document.dispatchEvent(new CustomEvent('tool:error', {
        detail: { step, message: err && err.message ? err.message : String(err) },
    }));
}

function buildButton(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sgve-add-btn';
    btn.textContent = label;
    return btn;
}

function buildPalette(onPick, initial) {
    const grid = document.createElement('div');
    grid.className = 'sgve-add-palette';
    for (const c of PALETTE) {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'sgve-add-swatch';
        if (c === initial) sw.classList.add('is-selected');
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('click', (e) => {
            e.preventDefault();
            for (const sib of grid.children) sib.classList.remove('is-selected');
            sw.classList.add('is-selected');
            onPick(c);
        });
        grid.appendChild(sw);
    }
    return grid;
}

function buildPopover() {
    const pop = document.createElement('div');
    pop.className = 'sgve-add-pop';
    return pop;
}

/**
 * Mount the toolbar. Returns a `{ destroy }` handle.
 *
 * @param {{
 *   host: HTMLElement,
 *   getProject: () => object|null,
 *   getPlayhead: () => number,
 *   api: object,
 * }} cfg
 * @returns {{ destroy: () => void }}
 */
export function mountAddClipButtons({ host, getProject, getPlayhead, api }) {
    const root = document.createElement('div');
    root.className = 'sgve-add-row';

    const shapeWrap = document.createElement('div');
    shapeWrap.className = 'sgve-add-wrap';
    const shapeBtn = buildButton('+ Shape');
    const shapePop = buildPopover();
    shapeWrap.append(shapeBtn, shapePop);

    const textWrap = document.createElement('div');
    textWrap.className = 'sgve-add-wrap';
    const textBtn = buildButton('+ Text');
    const textPop = buildPopover();
    textWrap.append(textBtn, textPop);

    root.append(shapeWrap, textWrap);
    host.appendChild(root);

    let shapeFill = '#000000';
    let textColor = '#ffffff';
    let textContent = 'Text';
    let textSize = 96;

    function closeAll() {
        shapePop.classList.remove('is-open');
        textPop.classList.remove('is-open');
        document.removeEventListener('click', onDocClick, true);
    }
    function onDocClick(e) {
        if (root.contains(e.target)) return;
        closeAll();
    }
    function openOne(pop) {
        const wasOpen = pop.classList.contains('is-open');
        closeAll();
        if (!wasOpen) {
            pop.classList.add('is-open');
            document.addEventListener('click', onDocClick, true);
        }
    }

    function trackIdOrError() {
        const trackId = findFirstVideoTrackId(getProject());
        if (!trackId) {
            emitErr('addClip', new Error('No video track to add to. Try "+ Track" first.'));
            return null;
        }
        return trackId;
    }

    function commitShape() {
        const trackId = trackIdOrError();
        if (!trackId) return;
        try {
            api.addShapeClip({
                trackId,
                timelineStart: getPlayhead(),
                shape: { type: 'rect', fill: shapeFill },
            });
        } catch (err) { emitErr('addShapeClip', err); }
        closeAll();
    }
    function commitText() {
        const trackId = trackIdOrError();
        if (!trackId) return;
        try {
            api.addTextClip({
                trackId,
                timelineStart: getPlayhead(),
                text: { content: textContent, color: textColor, fontSize: textSize },
            });
        } catch (err) { emitErr('addTextClip', err); }
        closeAll();
    }

    // Shape popover: palette + custom colour + Add button
    {
        const palette = buildPalette((c) => { shapeFill = c; }, shapeFill);
        const row = document.createElement('div'); row.className = 'sgve-add-row';
        const customLbl = document.createElement('span'); customLbl.textContent = 'Custom';
        const custom = document.createElement('input'); custom.type = 'color'; custom.value = shapeFill;
        custom.className = 'sgve-add-custom';
        custom.addEventListener('input', () => { shapeFill = custom.value; });
        row.append(customLbl, custom);
        const addBtn = buildButton('Add'); addBtn.classList.add('sgve-add-confirm');
        addBtn.addEventListener('click', commitShape);
        shapePop.append(palette, row, addBtn);
    }

    // Text popover: content input + palette + size + Add button
    {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = textContent;
        input.className = 'sgve-add-text-input';
        input.placeholder = 'Text content';
        input.addEventListener('input', () => { textContent = input.value; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } });

        const palette = buildPalette((c) => { textColor = c; }, textColor);

        const sizeRow = document.createElement('div'); sizeRow.className = 'sgve-add-row';
        const sizeLbl = document.createElement('span'); sizeLbl.textContent = 'Size';
        const sizeSel = document.createElement('select'); sizeSel.className = 'sgve-add-size';
        for (const [label, n] of [['S', 48], ['M', 96], ['L', 160], ['XL', 240]]) {
            const opt = document.createElement('option'); opt.value = String(n); opt.textContent = label;
            if (n === textSize) opt.selected = true;
            sizeSel.appendChild(opt);
        }
        sizeSel.addEventListener('change', () => { textSize = parseInt(sizeSel.value, 10) || 96; });
        sizeRow.append(sizeLbl, sizeSel);

        const addBtn = buildButton('Add'); addBtn.classList.add('sgve-add-confirm');
        addBtn.addEventListener('click', commitText);
        textPop.append(input, palette, sizeRow, addBtn);
    }

    shapeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openOne(shapePop); });
    textBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openOne(textPop); });

    return {
        destroy() {
            closeAll();
            try { root.remove(); } catch (_) {}
        },
    };
}
