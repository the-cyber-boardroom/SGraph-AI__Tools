/* =================================================================================
   SGraph — Tool Registry
   v0.1.0 — Fetch and group tool manifests for data-driven landing pages

   Each tool has a manifest.json declaring its identity, category, status,
   and dependencies. This module loads them in parallel and groups by category.

   Usage:
     import { loadManifests, groupByCategory, TOOL_SLUGS } from '/_common/js/sg-tool-registry.js'

     const manifests = await loadManifests()
     const groups    = groupByCategory(manifests)
   ================================================================================= */

/**
 * Canonical list of all tool slugs. Kept in display order within categories.
 * When a new tool is added, append its slug here.
 * @type {string[]}
 */
const TOOL_SLUGS = [
    // Security & Crypto
    'ssh-keygen', 'file-hasher', 'file-encryptor', 'key-generator',
    // AI / LLM
    'chat', 'one-shot-chat', 'infographic-gen', 'multi-agent-chat', 'agentic', 'model-compatibility',
    // Media
    'image-tools', 'video-tools', 'video-recorder',
    // Vault & Send
    'vault', 'vault-browser', 'openrouter', 'sg-send-cli',
    // Code & Runtime
    'pyodide-repl', 'folder-editor', 'llm-dev',
    // Developer Sandbox
    'vfs-dev', 'vfs-tree-demo', 'sg-tree-demo', 'send-sim', 'vault-pyodide',
];

/**
 * Category display metadata. Order determines render order on landing page.
 * @type {Array<{id: string, label: string, audience: string}>}
 */
const CATEGORIES = [
    { id: 'security', label: 'Security & Crypto',  audience: 'user'      },
    { id: 'llm',      label: 'AI / LLM',           audience: 'user'      },
    { id: 'media',    label: 'Media',               audience: 'user'      },
    { id: 'vault',    label: 'Vault & Send',        audience: 'user'      },
    { id: 'code',     label: 'Code & Runtime',      audience: 'developer' },
    { id: 'dev',      label: 'Developer Sandbox',   audience: 'developer' },
];

/**
 * Fetch all tool manifests from a known list of slugs.
 * Uses Promise.allSettled so one failed fetch does not block the rest.
 *
 * @param {Object}   [opts]
 * @param {string}   [opts.basePath='']  - Path prefix before slug (e.g. '' for same-level)
 * @param {string[]} [opts.slugs]        - Override slug list (default: TOOL_SLUGS)
 * @returns {Promise<Object[]>} Array of parsed manifest objects
 */
async function loadManifests(opts = {}) {
    const basePath = opts.basePath ?? '';
    const slugs    = opts.slugs ?? TOOL_SLUGS;

    const results = await Promise.allSettled(
        slugs.map(slug =>
            fetch(`${basePath}${slug}/manifest.json`)
                .then(r => {
                    if (!r.ok) return null;
                    return r.json();
                })
        )
    );

    return results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
}

/**
 * Group manifests by category, preserving CATEGORIES display order.
 * Unknown categories fall into 'dev'.
 *
 * @param {Object[]} manifests
 * @returns {Map<string, {label: string, audience: string, tools: Object[]}>}
 */
function groupByCategory(manifests) {
    const groups = new Map();
    for (const cat of CATEGORIES) {
        groups.set(cat.id, { label: cat.label, audience: cat.audience, tools: [] });
    }

    for (const m of manifests) {
        const group = groups.get(m.category) || groups.get('dev');
        group.tools.push(m);
    }

    return groups;
}

/**
 * Render an HTML tool card from a manifest object.
 *
 * @param {Object} manifest
 * @returns {string} HTML string for one tool card
 */
function renderToolCard(manifest) {
    const keywords = (manifest.keywords || []).join(' ');
    const statusClass = `status--${manifest.status}`;
    const statusLabel  = manifest.status.charAt(0).toUpperCase() + manifest.status.slice(1);

    return `<a href="${manifest.slug}/" class="tool-card" data-search="${keywords}" data-category="${manifest.category}" data-status="${manifest.status}">
    <div class="card-top">
        <span class="tool-card__icon">${manifest.icon}</span>
        <span class="tool-card__title">${manifest.name}</span>
    </div>
    <p class="tool-card__desc">${manifest.description}</p>
    <div class="card-footer"><span class="tool-card__status ${statusClass}">${statusLabel}</span></div>
</a>`;
}

export { TOOL_SLUGS, CATEGORIES, loadManifests, groupByCategory, renderToolCard };
