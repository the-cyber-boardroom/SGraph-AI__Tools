/**
 * composer-images.js — lazy <img> registry for image-asset clips.
 * @module video-composer/composer-images
 */

import { isImageAsset } from './composer-schema.js';

/**
 * Lazily decode an HTMLImageElement from a Blob.
 * @param {Blob} blob
 * @returns {{ img: HTMLImageElement, url: string, ready: Promise<HTMLImageElement> }}
 */
function makeImage(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    const ready = (typeof img.decode === 'function')
        ? img.decode().then(() => img).catch(() => img)
        : new Promise((resolve) => {
            img.addEventListener('load', () => resolve(img), { once: true });
            img.addEventListener('error', () => resolve(img), { once: true });
        });
    return { img, url, ready };
}

/**
 * Build a registry of HTMLImageElements keyed by image-asset id.
 * Images are created lazily on first `getImage` call and cached for reuse.
 * Object URLs are revoked on `destroy`.
 *
 * @param {Array<{ id: string, assetType?: string }>} assets Project asset entries.
 * @param {Map<string, Blob>} blobs Asset blob registry keyed by assetId.
 * @returns {{ getImage: (assetId: string) => HTMLImageElement|null, destroy: () => void }}
 */
export function createImageRegistry(assets, blobs) {
    const cache = new Map();
    const imageAssetIds = new Set(
        (Array.isArray(assets) ? assets : [])
            .filter(isImageAsset)
            .map(a => a.id),
    );

    function getImage(assetId) {
        if (!imageAssetIds.has(assetId)) return null;
        const cached = cache.get(assetId);
        if (cached) return cached.img;
        const blob = blobs && blobs.get ? blobs.get(assetId) : null;
        if (!(blob instanceof Blob)) return null;
        const entry = makeImage(blob);
        cache.set(assetId, entry);
        return entry.img;
    }

    /** Pre-warm every image asset and resolve when all are decoded. Without
     *  this, the first `getImage` call happens on the first draw tick — the
     *  returned `<img>` is not yet decoded, `drawImage` paints nothing, and
     *  an image-leading export opens on black frames. Missing blobs resolve
     *  immediately (the draw path skips them anyway). */
    function whenReady() {
        const waits = [];
        for (const id of imageAssetIds) {
            getImage(id);                       // populate the cache entry
            const entry = cache.get(id);
            if (entry && entry.ready) waits.push(entry.ready);
        }
        return Promise.allSettled(waits);
    }

    function destroy() {
        for (const entry of cache.values()) {
            try { URL.revokeObjectURL(entry.url); } catch (_) {}
        }
        cache.clear();
    }

    return { getImage, whenReady, destroy };
}
