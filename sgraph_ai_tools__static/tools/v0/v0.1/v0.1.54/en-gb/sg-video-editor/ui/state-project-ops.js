/** state-project-ops.js — pure project-meta operations (name, future fps/resolution). */

function badArg(msg) { return Object.assign(new Error(msg), { code: 'invalid-arg' }); }

const FALLBACK_NAME = 'Untitled';

/**
 * Rename the project. Whitespace is stripped from both ends; an empty result
 * falls back to `'Untitled'`. Throws `invalid-arg` if `name` is not a string.
 *
 * @param {object} project Wrapped project state.
 * @param {{ name: string }} params
 * @returns {{ name: string }} The applied name (post-trim, post-fallback).
 */
export function renameProjectOp(project, { name }) {
    if (typeof name !== 'string') throw badArg('name must be a string');
    const trimmed = name.trim();
    const next = trimmed === '' ? FALLBACK_NAME : trimmed;
    project.project.name = next;
    return { name: next };
}

export { FALLBACK_NAME };
