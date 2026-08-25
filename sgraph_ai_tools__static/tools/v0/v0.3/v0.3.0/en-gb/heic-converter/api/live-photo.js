/**
 * live-photo — Live Photo pairing helper for the HEIC Converter.
 *
 * Pure logic, no DOM. iPhone Live Photos download from Google Photos as TWO
 * files sharing a basename: a still (`.HEIC`/`.JPG`) and a motion clip
 * (`.MOV`/`.MP4`). This helper groups files by case-insensitive basename and
 * flags which videos are the motion half of a Live Photo pair so the pipeline
 * can drop them (dedup) while keeping the still.
 *
 * This intentionally lives in the tool (not `core/`) for now; it will be
 * lifted to `core/sg-live-photo` when `photo-pack` needs it.
 *
 * @module heic-converter/live-photo
 */

const STILL_EXT = /\.(heic|heif|jpe?g)$/i;
const VIDEO_EXT = /\.(mov|mp4|m4v|qt)$/i;

/**
 * Lower-cased basename of a filename with the extension stripped. Strips any
 * folder path so files in different folders with the same name still group.
 * @param {string} name
 * @returns {string}
 */
function basenameKey(name) {
    const noPath = String(name || '').split('/').pop();
    const noExt = noPath.replace(/\.[^.]+$/, '');
    return noExt.toLowerCase();
}

/**
 * Group a list of files into Live Photo pairs.
 *
 * A "Live Photo pair" exists when a basename has BOTH a still
 * (HEIC/HEIF/JPG/JPEG) and a video (MOV/MP4/M4V/QT). For those, the video is
 * reported in `pairedVideoNames` so the pipeline can mark it as a duplicate.
 *
 * Standalone videos (no matching still) are NOT reported — they should always
 * be frame-extracted.
 *
 * @param {Array<File|{name:string}>} files
 * @returns {{
 *   items: Array<{name: string, key: string, isStill: boolean, isVideo: boolean}>,
 *   pairedVideoNames: Set<string>
 * }}
 *   `items` is the classified input; `pairedVideoNames` is a Set of the exact
 *   `name` strings of videos that are the motion half of a Live Photo pair.
 */
export function groupLivePhotos(files) {
    const list = Array.from(files || []);
    const items = list.map((f) => {
        const name = (f && f.name) || '';
        return {
            name,
            key: basenameKey(name),
            isStill: STILL_EXT.test(name),
            isVideo: VIDEO_EXT.test(name),
        };
    });

    /** @type {Map<string, {hasStill: boolean, videoNames: string[]}>} */
    const byKey = new Map();
    for (const it of items) {
        if (!it.key) continue;
        if (!byKey.has(it.key)) byKey.set(it.key, { hasStill: false, videoNames: [] });
        const group = byKey.get(it.key);
        if (it.isStill) group.hasStill = true;
        if (it.isVideo) group.videoNames.push(it.name);
    }

    const pairedVideoNames = new Set();
    for (const group of byKey.values()) {
        if (group.hasStill && group.videoNames.length > 0) {
            for (const vn of group.videoNames) pairedVideoNames.add(vn);
        }
    }

    return { items, pairedVideoNames };
}
