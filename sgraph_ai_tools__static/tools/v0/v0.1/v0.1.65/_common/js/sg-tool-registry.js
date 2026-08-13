/* =================================================================================
   SGraph — Tool Registry
   v0.1.0 — Fetch and group tool manifests for data-driven landing pages

   Each tool has a manifest.json declaring its identity, category, status,
   and dependencies. This module loads them in parallel and groups by category.

   Usage:
     import { loadManifests, groupByCategory, TOOL_SLUGS } from '/_common/js/sg-tool-registry.js'

     const manifests = await loadManifests()
     const groups    = groupByCategory(manifests)

   v0.1.47 changes:
     - Added 'misc' category for tools that don't fit existing categories.
     - Added 'ai' category for AI/pipeline tools (infographic-gen, page-builder, playbooklm).
     - Added 'speed-test' to TOOL_SLUGS under Misc.
     - Added 'page-builder' and 'playbooklm' to TOOL_SLUGS under AI.

   v0.1.48 changes:
     - Added 'voice-memo' to TOOL_SLUGS under Media (manifest.json added in v0.1.48).
     - Added 'video-recorder' to TOOL_SLUGS under Media.

   v0.1.56 changes:
     - Added 'youtube-editor', 'youtube-upload' (added in v0.1.53) under Media.
     - Added 'sg-video-editor' (added in v0.1.54) under Media.
     - Added 'linkedin-publisher' (added in v0.1.55) under Misc.
     - Added 'vault-peek' (added in v0.1.56) under Vault & Send.

   v0.1.57 changes:
     - Added 'mermaid-diagrams' (added in v0.1.57) under Developer.

   v0.1.58 changes:
     - Added 'agent-with-tools' (added in v0.1.58) under Developer.

   v0.1.59 changes:
     - Added 'heic-converter' (added in v0.1.59) under Media. Batch HEIC ->
       WebP/JPEG/PNG/AVIF converter; shipped as a Phase 1-pulled-forward
       deliverable of the photo-pack / google-photos plan (v0.2.58). Built on
       the new shared core/sg-heic module.

   v0.1.60 changes:
     - Added 'audio-transcribe' (added in v0.1.60) under Media. Record or
       drag/drop many audio files (incl. WhatsApp .opus voice notes) and
       transcribe each to text via curated OpenRouter audio models, in-browser.
       Batch queue + zip bundle + embedded sg-send-drop encrypted send. Adds two
       new core modules: core/sg-audio-decode (WASM Opus -> WAV) and
       core/sg-wasm-cache (Cache-API WASM persistence).
     - Added 'live-transcribe' under Media. A minimal "big button" experience
       variation of audio-transcribe focused on Live (near-realtime) mode:
       press to talk, watch the transcript refine, per-segment cost shown; or
       drop a file. Reuses the audio-transcribe api/ modules + ui-live panel.

   v0.1.64 changes (2026-08-05):
     - Added 'video-publisher' under Media. One page from recording to
       YouTube URL: record (engine shared with video-recorder via
       core/sg-recorder) or import, three-route audio extraction,
       OpenRouter transcription, strict-JSON metadata generation, direct
       browser→YouTube upload. Consolidates the four-tool publish workflow.

   v0.1.65 changes (2026-08-13):
     - Added 'whatsapp-desk' under Media. Inbox + composer for a Business
       WhatsApp number on the official Meta Cloud API: per-chat tabs,
       24h-window-aware composer, voice-note transcription
       (core/sg-transcribe), draft-only AI replies. Demo mode needs no
       credentials; live mode needs Meta creds + the whatsapp_relay worker.
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
    // AI Pipelines
    'playbooklm', 'page-builder',
    // Media
    'image-tools', 'video-tools', 'voice-memo', 'video-recorder',
    'youtube-editor', 'youtube-upload', 'sg-video-editor', 'heic-converter', 'audio-transcribe', 'live-transcribe',
    'video-publisher', 'whatsapp-desk',
    // Vault & Send
    'vault', 'vault-browser', 'vault-peek', 'openrouter', 'sg-send-cli',
    // Code & Runtime
    'pyodide-repl', 'folder-editor', 'llm-dev',
    // Developer — visualisation + sandbox tools
    'mermaid-diagrams', 'agent-with-tools',
    // Developer Sandbox
    'vfs-dev', 'vfs-tree-demo', 'sg-tree-demo', 'send-sim', 'vault-pyodide',
    // Misc
    'speed-test', 'linkedin-publisher',
];

/**
 * Category display metadata. Order determines render order on landing page.
 * @type {Array<{id: string, label: string, audience: string}>}
 */
const CATEGORIES = [
    { id: 'security',  label: 'Security & Crypto',  audience: 'user'      },
    { id: 'llm',       label: 'AI / LLM',           audience: 'user'      },
    { id: 'ai',        label: 'AI Pipelines',        audience: 'user'      },
    { id: 'media',     label: 'Media',               audience: 'user'      },
    { id: 'vault',     label: 'Vault & Send',        audience: 'user'      },
    { id: 'code',      label: 'Code & Runtime',      audience: 'developer' },
    { id: 'developer', label: 'Developer',           audience: 'developer' },
    { id: 'dev',       label: 'Developer Sandbox',   audience: 'developer' },
    { id: 'misc',      label: 'Misc',                audience: 'user'      },
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
