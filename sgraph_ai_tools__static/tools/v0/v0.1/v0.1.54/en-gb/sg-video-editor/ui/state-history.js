/** state-history.js — snapshot stack for undo/redo on the project state. */

/** Deep-clone a JSON-shaped project. Uses structuredClone when available. */
function cloneProject(project) {
    if (typeof structuredClone === 'function') return structuredClone(project);
    return JSON.parse(JSON.stringify(project));
}

/**
 * Create an undo/redo history. Snapshots are deep clones of the project JSON.
 * Each stack is capped at `maxEntries`; oldest entries are dropped on overflow.
 *
 * @param {{maxEntries?: number}} [opts]
 * @returns {{
 *   pushSnapshot: (project: object) => void,
 *   undo: (currentProject: object) => object|null,
 *   redo: (currentProject: object) => object|null,
 *   canUndo: () => boolean,
 *   canRedo: () => boolean,
 *   clear: () => void,
 * }}
 */
export function createHistory(opts = {}) {
    const maxEntries = Number.isFinite(opts.maxEntries) && opts.maxEntries > 0
        ? Math.floor(opts.maxEntries)
        : 50;
    const undoStack = [];
    const redoStack = [];

    function trim(stack) {
        while (stack.length > maxEntries) stack.shift();
    }

    /** Record the pre-mutation state and discard any redo history. */
    function pushSnapshot(project) {
        if (project == null) return;
        undoStack.push(cloneProject(project));
        trim(undoStack);
        redoStack.length = 0;
    }

    /** Pop the most recent snapshot; the caller's current project goes onto redo. */
    function undo(currentProject) {
        if (undoStack.length === 0) return null;
        redoStack.push(cloneProject(currentProject));
        trim(redoStack);
        return undoStack.pop();
    }

    /** Mirror of undo — pop redo, push current onto undo. */
    function redo(currentProject) {
        if (redoStack.length === 0) return null;
        undoStack.push(cloneProject(currentProject));
        trim(undoStack);
        return redoStack.pop();
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }

    function clear() {
        undoStack.length = 0;
        redoStack.length = 0;
    }

    return { pushSnapshot, undo, redo, canUndo, canRedo, clear };
}
