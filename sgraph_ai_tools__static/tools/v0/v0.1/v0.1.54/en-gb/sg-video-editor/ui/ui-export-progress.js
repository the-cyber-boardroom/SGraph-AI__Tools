/** ui-export-progress.js — fixed-width export button + L→R progress fill.
 *
 * The export button used to jitter between "Export MP4" and "Exporting 47%"
 * (Round-9-I Task 4). This module owns the button's three pieces of state:
 *
 *   1. Fixed `min-width` set in JS once at mount so the button never reflows
 *      between the idle label and the longest exporting label
 *      ("Exporting 100%"). Measured at mount via a hidden probe span so
 *      it tracks whatever font the parent stylesheet inherits.
 *   2. A `--progress` CSS custom property that drives the inline ::after
 *      pseudo-element width — left-to-right teal fill behind the centred
 *      label.
 *   3. Centred text alignment on the label so percentages feel intentional.
 */

const ROOT_STYLE = 'display:inline-flex;align-items:center;gap:.5rem;';

/**
 * Mount the idle/exporting button + its status text into a host. The host is
 * cleared. Returns a small handle the caller drives:
 *
 *   setLabel(text)   — label inside the button (idle or "Exporting N%")
 *   setProgress(0-1) — drives the ::after fill width
 *   setBusy(bool)    — sets disabled + the .is-exporting class
 *   setStatus(text, visible) — small caption line next to / below the button
 *   button           — the underlying <button>, so wireClick is owned by the
 *                      caller
 *   destroy()        — clears the host
 *
 * The min-width is computed once at mount: we render the longest possible
 * label (`Exporting 100%`) into a hidden probe span sharing the button's
 * font, take its width, and add 24px of horizontal padding budget. Anything
 * shorter centres inside without reflow.
 *
 * @param {{ host: HTMLElement }} cfg
 * @returns {{
 *   button: HTMLButtonElement,
 *   statusEl: HTMLSpanElement,
 *   root: HTMLDivElement,
 *   setLabel: (text: string) => void,
 *   setProgress: (ratio: number) => void,
 *   setBusy: (busy: boolean) => void,
 *   setStatus: (text: string, visible?: boolean) => void,
 *   destroy: () => void,
 * }}
 */
export function mountExportButton({ host }) {
    host.innerHTML = `
        <div class="sgve-export" style="${ROOT_STYLE}">
            <button type="button" class="sgve-export-btn">
                <span class="sgve-export-btn__label">Export MP4</span>
            </button>
            <span class="sgve-export-status" hidden></span>
        </div>
    `;
    const root = host.firstElementChild;
    const button = root.querySelector('.sgve-export-btn');
    const labelEl = button.querySelector('.sgve-export-btn__label');
    const statusEl = root.querySelector('.sgve-export-status');

    // Pin a min-width that fits the longest label so the button never
    // jitters width between idle ("Export MP4") and exporting
    // ("Exporting 100%"). Measure inside a hidden probe so the value
    // reflects whatever font the parent stylesheet inherits.
    const probe = document.createElement('span');
    probe.textContent = 'Exporting 100%';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;'
        + 'font:inherit;letter-spacing:inherit;';
    button.appendChild(probe);
    const labelWidth = probe.getBoundingClientRect().width;
    button.removeChild(probe);
    if (labelWidth > 0) button.style.minWidth = Math.ceil(labelWidth + 28) + 'px';

    function setLabel(text) {
        labelEl.textContent = text || '';
    }
    function setProgress(ratio) {
        const r = Math.max(0, Math.min(1, Number(ratio) || 0));
        button.style.setProperty('--sgve-progress', (r * 100).toFixed(2) + '%');
    }
    function setBusy(busy) {
        button.disabled = !!busy;
        button.classList.toggle('is-exporting', !!busy);
        if (!busy) setProgress(0);
    }
    function setStatus(text, visible = true) {
        statusEl.textContent = text || '';
        statusEl.hidden = !visible;
    }
    function destroy() { host.innerHTML = ''; }

    setProgress(0);
    return { root, button, statusEl, setLabel, setProgress, setBusy, setStatus, destroy };
}
