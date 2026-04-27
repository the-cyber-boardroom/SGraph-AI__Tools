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
 * Resolve a clip's display label.
 *  - asset clips: prefixed with `[img]` when the asset is an image
 *  - shape clips: `[shape] rect (#hex)`
 *  - text clips:  `[text] "content"`
 * @param {object} clip
 * @param {object|null} project
 * @returns {string}
 */
export function clipLabel(clip, project) {
    if (clip && clip.kind === 'shape' && clip.shape) {
        const t = clip.shape.type || 'rect';
        const f = clip.shape.fill || '';
        return `[shape] ${t}${f ? ` ${f}` : ''}`;
    }
    if (clip && clip.kind === 'text' && clip.text) {
        const c = (clip.text.content || '').slice(0, 24);
        return `[text] "${c}"`;
    }
    if (clip.name && typeof clip.name === 'string') return clip.name;
    const a = clipAsset(clip, project);
    const base = (a && a.name) ? a.name : clip.assetId;
    return (a && a.assetType === 'image') ? `[img] ${base}` : base;
}
