/**
 * sg-wasm-cache — Cache-API persistence for versioned remote WASM/ES modules.
 *
 * Heavy WASM binaries (a WASM Opus decoder, or a future ~25 MB ffmpeg-core.wasm)
 * should download ONCE and be reused across sessions. This wrapper persists the
 * fetched bytes in the Cache API (cache name `sg-wasm-v1`), keyed by the
 * **versioned URL**. Because the version lives in the URL (e.g.
 * `…ogg-opus-decoder@1.7.3/+esm`), a version bump is a brand-new key — automatic
 * invalidation — and `pruneOldVersions` evicts the superseded entry so the cache
 * does not grow unbounded.
 *
 * Two load paths:
 *   - `cachedImport(url)` — for a SELF-CONTAINED single-file ESM (no relative
 *     sub-imports). On a hit, the cached bytes are reconstructed into a Blob URL
 *     and `import()`ed → no network. SAFE ONLY for self-contained modules (e.g.
 *     ogg-opus-decoder, whose WASM is inlined): a module with relative
 *     sub-imports would resolve them against the blob origin and fail.
 *   - `cachedFetch(url)` — for a SEPARATE binary (e.g. a future ffmpeg-core.wasm);
 *     returns an ArrayBuffer and the caller makes a Blob URL itself. Use THIS for
 *     multi-file ESM/assets.
 *
 * No build step, no dependencies, pure ES module. Pure functions over the
 * standard `caches` global; falls back gracefully (plain `import`/`fetch`) when
 * the Cache API is unavailable (e.g. insecure context, Node).
 *
 * @module sg-wasm-cache
 * @version 0.1.0
 */

/** Cache name. Bump the suffix only on a breaking change to the cached shape. */
export const CACHE_NAME = 'sg-wasm-v1';

/**
 * Whether the Cache API is usable in this context.
 * @returns {boolean}
 */
export function isCacheApiAvailable() {
    return typeof caches !== 'undefined' && caches && typeof caches.open === 'function';
}

/**
 * Open (or create) the shared WASM cache.
 * @returns {Promise<Cache|null>} the Cache, or null when unavailable.
 */
async function openCache() {
    if (!isCacheApiAvailable()) return null;
    try { return await caches.open(CACHE_NAME); } catch { return null; }
}

/**
 * Fetch a remote binary/module ONCE, persisting its bytes in the Cache API.
 * On a subsequent call for the same URL, the bytes come from the cache (no
 * network). Always resolves to a fresh ArrayBuffer copy.
 *
 * @param {string} url - the versioned URL to fetch.
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<ArrayBuffer>} the resource bytes.
 */
export async function cachedFetch(url, opts = {}) {
    const cache = await openCache();
    if (cache) {
        const hit = await cache.match(url);
        if (hit) return await hit.arrayBuffer();
    }
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) throw new Error(`sg-wasm-cache: fetch failed (${res.status}) for ${url}`);
    // Clone before reading the body so we can both cache and return it.
    if (cache) {
        try { await cache.put(url, res.clone()); } catch { /* cache write is best-effort */ }
    }
    return await res.arrayBuffer();
}

/**
 * Import a SELF-CONTAINED single-file ES module, persisting it in the Cache API
 * so it downloads once. On a cache hit the module text is reconstructed into a
 * Blob URL and imported with no network. On ANY failure (no Cache API, blob
 * import rejected, etc.) falls back to a plain dynamic `import(url)`.
 *
 * @param {string} url - the versioned ESM URL (must be a self-contained module).
 * @returns {Promise<*>} the imported module namespace object.
 */
export async function cachedImport(url) {
    const cache = await openCache();
    if (!cache) return import(/* @vite-ignore */ url);

    try {
        let text;
        const hit = await cache.match(url);
        if (hit) {
            text = await hit.text();
        } else {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`sg-wasm-cache: import fetch failed (${res.status}) for ${url}`);
            text = await res.text();
            try {
                await cache.put(url, new Response(text, {
                    headers: { 'Content-Type': 'text/javascript' },
                }));
            } catch { /* best-effort */ }
        }
        const blob = new Blob([text], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
            return await import(/* @vite-ignore */ blobUrl);
        } finally {
            // Revoke after the import has resolved its module graph.
            setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } }, 0);
        }
    } catch {
        // Network/blob/import failure → fall back to a direct import.
        return import(/* @vite-ignore */ url);
    }
}

/**
 * Delete cache entries whose URL starts with `prefix` but is not `keepUrl`.
 * Use this to evict a superseded `@x.y.z` after bumping the pin.
 *
 * @param {string} prefix  - e.g. 'https://cdn.jsdelivr.net/npm/ogg-opus-decoder@'
 * @param {string} keepUrl - the current (versioned) URL to retain.
 * @returns {Promise<number>} number of entries evicted.
 */
export async function pruneOldVersions(prefix, keepUrl) {
    const cache = await openCache();
    if (!cache) return 0;
    let evicted = 0;
    try {
        const keys = await cache.keys();
        for (const req of keys) {
            const u = req.url;
            if (u.startsWith(prefix) && u !== keepUrl) {
                if (await cache.delete(req)) evicted += 1;
            }
        }
    } catch { /* ignore */ }
    return evicted;
}
