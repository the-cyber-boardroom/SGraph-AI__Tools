// timeline-focus.js — shared "is focus inside a text-entry?" helper (v0.1.0)
//
// Used by:
//   - timeline-keyboard.js   (Delete / Backspace / S shortcuts)
//   - sg-video-editor/ui/ui-keyboard.js (Space, Cmd/Ctrl+C/V)
//
// Both have the same vulnerability: a global / host-scoped keydown listener
// will fire while the user is typing in an <input> (e.g. the inline track
// rename input mounted by timeline-track-headers.js). Pressing Backspace to
// edit the input would otherwise also delete the selected clip.
//
// The check pierces shadow roots — sg-timeline lives in a shadow root, so
// `document.activeElement` in the light DOM is the host element; the real
// focused element is reached via `host.shadowRoot.activeElement`, which can
// itself be another shadow host, etc.
//
// Pure function, no DOM mutation, no preventDefault — callers decide what to
// do with the result. The intended usage is `if (isTextEntryFocus()) return;`
// at the top of a keydown handler so the input still receives the keystroke
// (no preventDefault means the input edits normally).
//
// Kept under ~50 lines and dependency-free per the project rule "split by
// concern, not by size — extract on the third repetition" (CLAUDE.md).
//

/**
 * Walk through nested shadow roots to find the deepest active element.
 * @param {Element|null} ae
 * @returns {Element|null}
 */
function deepestActive(ae) {
    let cur = ae;
    while (cur && cur.shadowRoot && cur.shadowRoot.activeElement) {
        cur = cur.shadowRoot.activeElement;
    }
    return cur;
}

/**
 * Whether the current focus is inside a text-entry control (INPUT,
 * TEXTAREA, SELECT, or any contenteditable), including any element nested
 * inside open shadow roots.
 *
 * Caller convention: `if (isTextEntryFocus()) return;` — do NOT preventDefault
 * so the typed key reaches the actual input.
 *
 * @returns {boolean}
 */
export function isTextEntryFocus() {
    const ae = deepestActive(document.activeElement);
    if (!ae) return false;
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (ae.isContentEditable) return true;
    return false;
}
