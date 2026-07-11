// timeline-feedback.js — drag visual feedback (ghost + label) for sg-timeline (v0.1.0)

/**
 * Format seconds as MM:SS.mmm.
 * @param {number} t
 * @returns {string}
 */
function fmtMmSsMs(t) {
    const sign = t < 0 ? '-' : '';
    const abs = Math.abs(t);
    const m = Math.floor(abs / 60);
    const s = Math.floor(abs - m * 60);
    const ms = Math.round((abs - Math.floor(abs)) * 1000);
    return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Format seconds as SS.mmm.
 * @param {number} t
 * @returns {string}
 */
function fmtSsMs(t) {
    const v = Number.isFinite(t) ? t : 0;
    return v.toFixed(3) + 's';
}

/**
 * Lazily create (and cache on the lane) the ghost + drag-label elements.
 * @param {HTMLElement} lane
 * @returns {{ ghost: HTMLElement, label: HTMLElement }}
 */
function ensureFeedbackEls(lane) {
    let ghost = lane.querySelector('[data-role="sgt-ghost"]');
    if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'sgt-ghost';
        ghost.dataset.role = 'sgt-ghost';
        lane.appendChild(ghost);
    }
    let label = lane.querySelector('[data-role="sgt-drag-label"]');
    if (!label) {
        label = document.createElement('div');
        label.className = 'sgt-drag-label';
        label.dataset.role = 'sgt-drag-label';
        lane.appendChild(label);
    }
    return { ghost, label };
}

/**
 * Position the ghost rectangle inside the lane.
 * @param {HTMLElement} ghost
 * @param {number} leftPx
 * @param {number} widthPx
 * @returns {void}
 */
function placeGhost(ghost, leftPx, widthPx) {
    ghost.style.left = Math.max(0, leftPx) + 'px';
    ghost.style.width = Math.max(2, widthPx) + 'px';
    ghost.classList.add('is-visible');
}

/**
 * Position the floating label near the pointer (lane-relative).
 * @param {HTMLElement} lane
 * @param {HTMLElement} label
 * @param {number} clientX
 * @param {number} clientY
 * @param {string} text
 * @returns {void}
 */
function placeLabel(lane, label, clientX, clientY, text) {
    const rect = lane.getBoundingClientRect();
    const x = clientX - rect.left + lane.scrollLeft + 12;
    const y = clientY - rect.top + 12;
    label.style.left = x + 'px';
    label.style.top = y + 'px';
    label.textContent = text;
    label.classList.add('is-visible');
}

/**
 * Hide ghost + label and clear is-dragging state on a clip element.
 * @param {HTMLElement} lane
 * @param {HTMLElement|null} clipEl
 * @returns {void}
 */
function hideFeedback(lane, clipEl) {
    const ghost = lane.querySelector('[data-role="sgt-ghost"]');
    const label = lane.querySelector('[data-role="sgt-drag-label"]');
    if (ghost) ghost.classList.remove('is-visible');
    if (label) label.classList.remove('is-visible');
    if (clipEl) clipEl.classList.remove('is-dragging');
}

/**
 * Show drag feedback during a pointermove for a known drag kind.
 * @param {HTMLElement} lane
 * @param {{ kind: string, clipEl: HTMLElement, origIn: number, origOut: number }} drag
 * @param {{ leftPx: number, widthPx: number, time: number, inPoint?: number, outPoint?: number }} preview
 * @param {{ clientX: number, clientY: number }} pointer
 * @returns {void}
 */
export function showDragFeedback(lane, drag, preview, pointer) {
    const { ghost, label } = ensureFeedbackEls(lane);
    drag.clipEl.classList.add('is-dragging');
    placeGhost(ghost, preview.leftPx, preview.widthPx);
    if (drag.isCopy) ghost.classList.add('is-copy');
    else ghost.classList.remove('is-copy');
    let text = '';
    if (drag.kind === 'move') {
        const prefix = drag.isCopy ? '[copy] ' : '';
        text = `${prefix}t = ${fmtMmSsMs(preview.time)}`;
    } else if (drag.kind === 'trim-left') {
        const dur = (preview.outPoint != null ? preview.outPoint : drag.origOut) - preview.inPoint;
        text = `in = ${fmtSsMs(preview.inPoint)}  dur = ${fmtSsMs(dur)}`;
    } else if (drag.kind === 'trim-right') {
        const dur = preview.outPoint - (preview.inPoint != null ? preview.inPoint : drag.origIn);
        text = `out = ${fmtSsMs(preview.outPoint)}  dur = ${fmtSsMs(dur)}`;
    }
    placeLabel(lane, label, pointer.clientX, pointer.clientY, text);
}

/**
 * Tear down drag feedback (called on pointerup/cancel).
 * @param {HTMLElement} lane
 * @param {HTMLElement|null} clipEl
 * @returns {void}
 */
export function endDragFeedback(lane, clipEl) {
    hideFeedback(lane, clipEl);
}
