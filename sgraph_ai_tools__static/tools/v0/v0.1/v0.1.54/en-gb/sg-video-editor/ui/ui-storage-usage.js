/** ui-storage-usage.js — Properties-pane "Storage: …" readout.
 *
 * Small, async, refreshable. Mounts a single line under the Save/Load
 * controls showing the total size of asset blobs in IndexedDB plus the
 * project-JSON byte total in localStorage. Round-9-J.
 */

import { section, row, readOnly } from './ui-prop-fields.js';

function fmtBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 KB';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Mount the storage usage section into `host`. Returns a `refresh()` so the
 * caller can re-poll on demand (e.g. after a save / delete).
 *
 * @param {{ host: HTMLElement, api: object }} cfg
 * @returns {{ refresh: () => Promise<void>, destroy: () => void }}
 */
export function mountStorageUsage({ host, api }) {
    if (!host || !api || typeof api.getStorageUsage !== 'function') {
        return { refresh: async () => {}, destroy: () => {} };
    }
    const sec = section('Storage');
    const value = readOnly('—');
    sec.appendChild(row('Used', value));
    host.appendChild(sec);

    let destroyed = false;

    async function refresh() {
        if (destroyed) return;
        try {
            const u = await api.getStorageUsage();
            if (destroyed) return;
            const assetCount = u && Number.isFinite(u.assetCount) ? u.assetCount : 0;
            const total = u && Number.isFinite(u.totalBytes) ? u.totalBytes : 0;
            const noun = assetCount === 1 ? 'asset' : 'assets';
            value.textContent = `${fmtBytes(total)} (${assetCount} ${noun})`;
        } catch (_) {
            value.textContent = 'unavailable';
        }
    }

    refresh();

    return {
        refresh,
        destroy() {
            destroyed = true;
            try { sec.remove(); } catch (_) {}
        },
    };
}
