/** asset-row.js — render helpers for asset list rows. */

/** Minimal HTML escaper for attribute/text content. */
export function escape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Format seconds as m:ss; returns '–' when not a valid duration. */
export function formatDuration(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '–';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Format a byte size as KB/MB/GB. */
export function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Build a row element for one asset entry. For image assets a thumbnail
 * <img> is created from a freshly-allocated object URL, returned in `urls`
 * so the caller can revoke them when refreshing.
 *
 * @param {object} asset Asset entry (id, name, assetType, duration, bytes, ...).
 * @param {Map<string, Blob>} registry assetId -> Blob.
 * @returns {{ element: HTMLLIElement, urls: Array<string> }}
 */
export function buildAssetRow(asset, registry) {
    const li = document.createElement('li');
    li.className = 'sgve-asset-row';
    li.draggable = true;
    li.dataset.assetId = asset.id;
    const type = asset.assetType === 'image' ? 'image' : 'video';
    li.dataset.assetType = type;

    const urls = [];
    const thumb = document.createElement('span');
    thumb.className = 'sgve-asset-thumb';
    if (type === 'image') {
        const blob = registry && registry.get ? registry.get(asset.id) : null;
        if (blob) {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';
            img.src = url;
            thumb.appendChild(img);
        }
        thumb.dataset.kind = 'image';
    } else {
        thumb.dataset.kind = 'video';
    }
    li.appendChild(thumb);

    const name = document.createElement('span');
    name.className = 'sgve-asset-name';
    name.textContent = asset.name || asset.id;
    li.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'sgve-asset-meta';
    const durLabel = type === 'image' ? 'image' : formatDuration(asset.duration);
    meta.textContent = `${durLabel} · ${formatSize(asset.bytes ?? 0)}`;
    li.appendChild(meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sgve-asset-del';
    del.dataset.role = 'remove-asset';
    del.dataset.assetId = asset.id;
    del.title = 'Remove asset (only if not used by any clip)';
    del.setAttribute('aria-label', 'Remove asset');
    del.textContent = '×';
    li.appendChild(del);

    return { element: li, urls };
}
