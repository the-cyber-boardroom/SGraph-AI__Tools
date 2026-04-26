/** ui-prop-fields.js — small DOM helpers (row / section / inputs) shared by
 *  the Properties pane forms. Pure builders; no state subscription. */

/** Build a `<label class="sgve-prop-row">` containing `<span>label</span> + control`. */
export function row(label, control) {
    const r = document.createElement('label');
    r.className = 'sgve-prop-row';
    const l = document.createElement('span');
    l.className = 'sgve-prop-label';
    l.textContent = label;
    r.append(l, control);
    return r;
}

/** Build a `<section class="sgve-prop-section">` with an `<h4>` heading. */
export function section(title) {
    const s = document.createElement('section');
    s.className = 'sgve-prop-section';
    const h = document.createElement('h4');
    h.textContent = title;
    s.appendChild(h);
    return s;
}

/** Read-only display span. `text == null` renders an em-dash. */
export function readOnly(text) {
    const span = document.createElement('span');
    span.className = 'sgve-prop-ro';
    span.textContent = text == null ? '—' : String(text);
    return span;
}

/** Numeric input that fires `onInput` per keystroke (for transient updates)
 *  and `onChange` on commit (Enter / blur). */
export function numberInput({ value, min, max, step, onInput, onChange }) {
    const el = document.createElement('input');
    el.type = 'number';
    el.className = 'sgve-prop-input';
    if (Number.isFinite(min)) el.min = String(min);
    if (Number.isFinite(max)) el.max = String(max);
    if (Number.isFinite(step)) el.step = String(step);
    el.value = String(value);
    let pendingValue = null;
    el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return;
        pendingValue = v;
        if (onInput) onInput(v);
    });
    el.addEventListener('change', () => {
        const v = pendingValue != null ? pendingValue : parseFloat(el.value);
        pendingValue = null;
        if (Number.isFinite(v) && onChange) onChange(v);
    });
    return el;
}

/** Range slider. `onInput` fires every drag tick; `onChange` on commit. */
export function rangeInput({ value, min, max, step, onInput, onChange }) {
    const el = document.createElement('input');
    el.type = 'range';
    el.className = 'sgve-prop-range';
    el.min = String(min); el.max = String(max);
    if (Number.isFinite(step)) el.step = String(step);
    el.value = String(value);
    el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (Number.isFinite(v) && onInput) onInput(v);
    });
    el.addEventListener('change', () => {
        const v = parseFloat(el.value);
        if (Number.isFinite(v) && onChange) onChange(v);
    });
    return el;
}

/** Native `<input type="color">` paired with a hex text input. */
export function colorInput({ value, onChange }) {
    const wrap = document.createElement('span');
    wrap.className = 'sgve-prop-color';
    const sw = document.createElement('input');
    sw.type = 'color';
    sw.value = value || '#000000';
    sw.className = 'sgve-prop-color-sw';
    sw.addEventListener('change', () => onChange(sw.value));
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.value = value || '';
    hex.placeholder = '#000000';
    hex.className = 'sgve-prop-color-hex';
    hex.addEventListener('change', () => {
        const v = hex.value.trim();
        if (/^#[0-9a-f]{3,8}$/i.test(v)) { sw.value = v; onChange(v); }
    });
    wrap.append(sw, hex);
    return wrap;
}

/** Two-row text area, commits on `change`. */
export function textArea({ value, onChange }) {
    const el = document.createElement('textarea');
    el.className = 'sgve-prop-textarea';
    el.rows = 2;
    el.value = value || '';
    el.addEventListener('change', () => onChange(el.value));
    return el;
}

/** Single-line text input, commits on `change`. */
export function textInput({ value, onChange }) {
    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'sgve-prop-input';
    el.value = value || '';
    el.addEventListener('change', () => onChange(el.value));
    return el;
}

/**
 * Single-line text input with the same UX as the track-rename inline input:
 *  - Enter commits and blurs
 *  - Escape cancels (restores the original value) and blurs
 *  - Blur commits the current value
 *
 * Useful for "click a label, edit it inline" flows where a stale value is
 * unacceptable. `onCommit` only fires when the trimmed value differs from the
 * original (avoids spamming history with no-op renames).
 */
export function inlineRenameInput({ value, onCommit }) {
    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'sgve-prop-input sgve-prop-rename';
    el.value = value || '';
    el.setAttribute('aria-label', 'Rename');
    const original = String(value || '');
    let done = false;
    function commit(save) {
        if (done) return;
        done = true;
        if (save) {
            const next = el.value;
            if (next.trim() !== original.trim() && onCommit) onCommit(next);
        } else {
            el.value = original;
        }
    }
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); el.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); el.blur(); }
    });
    el.addEventListener('blur', () => commit(true));
    return el;
}

/** Themed action button. `kind` is appended as `sgve-prop-btn--<kind>`. */
export function buttonRow(label, kind, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sgve-prop-btn sgve-prop-btn--${kind}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
}
