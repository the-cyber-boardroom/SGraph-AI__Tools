// timeline-clip-label.js — pure helpers for resolving a clip's asset + label.

/**
 * Look up the asset record for a clip from the project's assets.
 * Handles both array-of-assets and id-keyed object shapes.
 * @param {{ assetId: string }} clip
 * @param {{ assets?: object|Array<object> }|null} project
 * @returns {object|null}
 */
export function clipAsset(clip, project) {
    const assets = project && project.assets;
    if (!assets || typeof assets !== 'object') return null;
    if (Array.isArray(assets)) return assets.find(x => x && x.id === clip.assetId) || null;
    return assets[clip.assetId] || null;
}

/**
 * Resolve a clip's display label, prefixed with [img] for image clips.
 * @param {object} clip
 * @param {object|null} project
 * @returns {string}
 */
export function clipLabel(clip, project) {
    const a = clipAsset(clip, project);
    const base = (a && a.name) ? a.name : clip.assetId;
    return (a && a.assetType === 'image') ? `[img] ${base}` : base;
}
