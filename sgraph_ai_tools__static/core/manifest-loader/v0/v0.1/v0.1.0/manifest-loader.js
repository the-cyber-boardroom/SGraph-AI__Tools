/**
 * Manifest-driven dependency loader for SGraph tools.
 * Reads manifest.json, loads CSS (phase 1), external scripts (phase 1),
 * custom element JS (phase 2), and tool JS (phase 3) in order.
 * Calls the entry module's init() with the manifest context.
 *
 * Usage in index.html:
 *   <script type="module">
 *     import { loadManifest } from '/core/manifest-loader/v0/v0.1/v0.1.0/manifest-loader.js';
 *     await loadManifest('./manifest.json');
 *   </script>
 *
 * @module manifest-loader
 * @version 0.1.0
 */

/**
 * Load a tool manifest and all its declared dependencies in phase order.
 * After all phases complete, calls the entry module's init(manifest) if present.
 *
 * @param {string} manifestUrl - Relative or absolute URL to manifest.json
 * @returns {Promise<object>} The parsed manifest object
 */
export async function loadManifest(manifestUrl) {
  const base = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`manifest-loader: failed to fetch ${manifestUrl} (${res.status})`);
  const manifest = await res.json();

  const loaderEntries = manifest.dependencies?.loader ?? [];

  // Group by phase
  const phases = {};
  for (const entry of loaderEntries) {
    const p = entry.phase ?? 1;
    if (!phases[p]) phases[p] = [];
    phases[p].push(entry);
  }

  // Process phases in numeric order
  const phaseNums = Object.keys(phases).map(Number).sort((a, b) => a - b);
  let entryModule = null;

  for (const phaseNum of phaseNums) {
    const entries = phases[phaseNum];

    // Load all non-entry entries in parallel for this phase
    await Promise.all(entries.map(entry => loadEntry(entry, base)));

    // Find entry module in this phase (loaded after phase completes)
    const entryEntry = entries.find(e => e.entry && e.type === 'js');
    if (entryEntry) {
      const url = resolveUrl(entryEntry.path, base);
      entryModule = await import(url);
    }
  }

  if (entryModule?.init) {
    await entryModule.init(manifest);
  }

  return manifest;
}

/**
 * Resolve a path against a base URL.
 *
 * @param {string} path - The path to resolve (may be absolute, root-relative, or relative)
 * @param {string} base - The base URL (must end with '/')
 * @returns {string} Resolved absolute-or-root-relative URL
 */
function resolveUrl(path, base) {
  if (path.startsWith('http') || path.startsWith('/')) return path;
  return base + path;
}

/**
 * Load a single dependency entry (CSS, non-module JS, or ES module).
 * Entry-flagged modules are handled by the caller after the phase completes.
 *
 * @param {object} entry - Loader entry from manifest.dependencies.loader[]
 * @param {string} base  - Base URL prefix for relative paths
 * @returns {Promise<void>}
 */
async function loadEntry(entry, base) {
  // Entry modules are imported separately after the phase completes
  if (entry.entry) return;

  if (entry.type === 'css') {
    const href = resolveUrl(entry.path, base);
    if (!document.querySelector(`link[href="${href}"]`)) {
      await new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
      });
    }
    return;
  }

  if (entry.type === 'js' && entry.module === false) {
    // Non-module external script (e.g. jsPDF, JSZip via CDN UMD bundles)
    const src = resolveUrl(entry.path, base);
    if (!document.querySelector(`script[src="${src}"]`)) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return;
  }

  if (entry.type === 'js') {
    // ES module — dynamic import() for side-effect registrations (custom elements)
    const url = resolveUrl(entry.path, base);
    await import(url);
  }
}
