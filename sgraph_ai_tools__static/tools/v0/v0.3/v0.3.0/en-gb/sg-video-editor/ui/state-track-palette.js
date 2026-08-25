/** state-track-palette.js — contrast palette + track auto-colour helpers.
 *
 * Mirrors the 6-shade contrast palette introduced in commit 1400898 for clip
 * auto-shading (indigo/teal/amber/rose/purple/sky). Tracks pick the next free
 * palette slot as they're created so adjacent lanes get visibly different
 * default colours. Per-clip colour overrides (`clip.color`) win at render
 * time; the track colour itself is just another override layer underneath.
 *
 * Render priority for a clip rectangle:
 *
 *     clip.color   →   track.color   →   palette[trackIndex % palette.length]
 *
 * A loaded project missing `track.color` gets a default assigned at validate
 * time so legacy projects don't flicker between the auto-shade and the new
 * palette colour on first render.
 */

/** The contrast palette. Hex strings, 6 entries. Indigo / teal / amber /
 *  rose / purple / sky — same six the clip auto-shade uses. */
export const TRACK_PALETTE = Object.freeze([
    '#4f46e5', // indigo-600
    '#0d9488', // teal-600
    '#b45309', // amber-700
    '#be185d', // rose-700
    '#7e22ce', // purple-700
    '#0369a1', // sky-700
]);

/**
 * Pick the next palette colour for a fresh track. Cycles by array index of
 * the track in the project's `tracks[]` (after insertion). When `tracks`
 * already has tracks with colours assigned, this still cycles by index —
 * cheap and predictable; the user can always override later via
 * `setTrackColor`.
 *
 * @param {number} indexInTracks Position in the project's `tracks[]` array.
 * @returns {string}
 */
export function pickTrackColor(indexInTracks) {
    const i = (Number.isInteger(indexInTracks) && indexInTracks >= 0)
        ? indexInTracks
        : 0;
    return TRACK_PALETTE[i % TRACK_PALETTE.length];
}

/**
 * Assign palette defaults to any video track missing `track.color`. Called by
 * `validateWrapped` so legacy / freshly-loaded projects pick up colours in
 * their first render without flickering. Mutates `project` in place; returns
 * `true` when at least one track gained a colour. Safe to call repeatedly.
 *
 * @param {object} project Wrapped project (with `tracks[]`).
 * @returns {boolean} True iff any track was modified.
 */
export function ensureTrackColors(project) {
    if (!project || !Array.isArray(project.tracks)) return false;
    let changed = false;
    let videoIdx = 0;
    for (let i = 0; i < project.tracks.length; i++) {
        const t = project.tracks[i];
        if (!t || t.kind !== 'video') continue;
        if (typeof t.color !== 'string' || !t.color) {
            t.color = pickTrackColor(videoIdx);
            changed = true;
        }
        videoIdx++;
    }
    return changed;
}
