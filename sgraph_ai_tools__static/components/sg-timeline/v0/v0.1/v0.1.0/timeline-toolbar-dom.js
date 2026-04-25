// timeline-toolbar-dom.js — toolbar DOM helpers for sg-timeline (v0.1.0)

/**
 * Build the zoom toolbar shell (- / + / Fit + zoom-label span).
 * Caller appends optional extras (Split, colour-picker) to the returned root.
 * @param {{ onZoomOut: () => void, onZoomIn: () => void, onFit: () => void }} handlers
 * @returns {{ root: HTMLElement, label: HTMLElement }}
 */
export function buildToolbar(handlers) {
    const root = document.createElement('div');
    root.className = 'zoom-toolbar';
    const mkBtn = (text, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
        return b;
    };
    root.appendChild(mkBtn('-', 'Zoom out', handlers.onZoomOut));
    root.appendChild(mkBtn('+', 'Zoom in', handlers.onZoomIn));
    root.appendChild(mkBtn('Fit', 'Fit project to view', handlers.onFit));
    const label = document.createElement('span');
    label.className = 'zoom-label';
    root.appendChild(label);
    return { root, label };
}

/**
 * Walk up from the lane to the first ancestor that is actively scrolling
 * (clientWidth < scrollWidth) or whose computed overflow-x is auto/scroll.
 * The lane itself is the scroll content and must be skipped. Falls back to
 * the lane's parent so callers always get something measurable.
 * @param {HTMLElement|null} lane
 * @returns {HTMLElement|null}
 */
export function findScrollViewport(lane) {
    if (!lane) return null;
    let el = lane.parentElement;
    while (el) {
        if (el.clientWidth > 0 && el.clientWidth < el.scrollWidth) return el;
        const win = el.ownerDocument && el.ownerDocument.defaultView;
        const cs = win ? win.getComputedStyle(el) : null;
        if (cs && (cs.overflowX === 'auto' || cs.overflowX === 'scroll')) return el;
        el = el.parentElement;
    }
    return lane.parentElement;
}

/**
 * Update the read-only zoom label.
 * @param {HTMLElement} label
 * @param {number} pps
 * @returns {void}
 */
export function updateLabel(label, pps) {
    label.textContent = `${Math.round(pps)} px/s`;
}
