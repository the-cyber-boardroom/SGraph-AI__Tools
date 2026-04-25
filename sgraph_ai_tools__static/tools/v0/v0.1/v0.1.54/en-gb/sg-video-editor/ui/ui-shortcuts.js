/** ui-shortcuts.js — global Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (or +Y) shortcuts. */

/** Should the shortcut be ignored because focus is on a text-editing field? */
function isEditingTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;
    return false;
}

/**
 * Attach window-level keyboard shortcuts that trigger api.undo / api.redo.
 * Skipped while focus is on an INPUT, TEXTAREA, or contenteditable element.
 * Phase 1 limitation: shadow-DOM active elements are not introspected.
 *
 * @param {{undo: () => void, redo: () => void}} api
 * @returns {() => void} unwire
 */
export function attachShortcuts(api) {
    function onKey(e) {
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        const k = (e.key || '').toLowerCase();
        if (k !== 'z' && k !== 'y') return;
        if (isEditingTarget(e.target)) return;
        const isRedo = (k === 'z' && e.shiftKey) || k === 'y';
        e.preventDefault();
        try {
            if (isRedo) api.redo();
            else api.undo();
        } catch (_) { /* surfaced as tool:error elsewhere */ }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
}
