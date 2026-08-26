/* =================================================================================
   SGraph — Tool Registry
   v0.1.0 — Fetch and group tool manifests for data-driven landing pages

   Each tool has a manifest.json declaring its identity, category, status,
   and dependencies. This module loads them in parallel and groups by category.

   Usage:
     import { loadManifests, groupByCategory, TOOL_SLUGS } from '/_common/js/sg-tool-registry.js'

     const manifests = await loadManifests()
     const groups    = groupByCategory(manifests)








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

   v0.1.66 changes (2026-08-16):
     - Added 'narrated-review' under Media. Narrate a walk through a screen,
       press a key at each moment that matters: continuous audio with the
       keypress as a MARKER (never a start/stop), screenshot at the press
       instant, VAD-snapped segment bounds → ordered image+words PAIRS →
       parallel transcription (core/sg-transcribe) + screenshot-grounded
       cleanup with a rolling summary → one markdown document + zip/SG-Send.
       No video is recorded. Adds two new core modules: core/sg-live-capture
       (promoted from audio-transcribe's live engine) and core/sg-zip.
     - narrated-review v0.1.4 adds VIDEO IMPORT as a third ingest path into the
       same capture list (live / authored / video), so there is deliberately NO
       separate 'video-review' slug: importVideo() extracts the audio, cuts it at
       its own silences, and picks the frame each spoken segment is about. A
       video-first landing page is a later, cosmetic addition.
   v0.1.67 changes (2026-08-17):
     - Added 'media-probe' under Media. Drop in a recording and SEE its structure
       before paying a model to guess at it: framewise audio energy with the noise
       floor and speaking level located, a gap-length histogram that says whether
       topic-length pauses exist at all, four independent frame-difference metrics,
       scene changes with their evidence, the measured picture-leads-words offset,
       and a plan() proposing where to cut and where to shoot — or refusing. No
       model calls, no uploads, no cost. Adds core/sg-media-analysis.
       Built because narrated-review v0.1.4 cut a real screencast into nine slices
       of exactly 30 s: a fixed absolute silence threshold sat below that
       recording's noise floor, and nothing plotted the distribution it was being
       compared against.
     - Added 'markdown-viewer' under Misc. Open a .md file and read or print it,
       on the new core/markdown v1.1.0 (blocks, inline, front matter, escaping,
       stylesheet). Landed on a sibling branch and merged here; the two tools are
       independent and share only this registry.
   v0.1.68 changes (2026-08-25):
     - Added 'youtube-probe' under Developer. A TEST HARNESS, not a product: it
       answers the open questions in the v0.2.92 talk-miner pack with evidence
       rather than reasoning. Seven offline tests (no token, no network, no
       clicks) cover the caption parsers and the region-mask hypothesis by
       recording a synthetic TALK in-page — a moving speaker beside slides,
       which is the property a screencast fixture lacks. Eight manual tests
       cover the YouTube captions API, the third-party refusal path, and tab
       capture with audio. Delete it once the questions are answered.
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
    'playbooklm', 'page-builder', 'video-creator',
    // Media
    'image-tools', 'video-tools', 'voice-memo', 'video-recorder',
    'youtube-editor', 'youtube-upload', 'sg-video-editor', 'heic-converter', 'audio-transcribe', 'live-transcribe',
    'video-publisher', 'whatsapp-desk', 'narrated-review', 'media-probe',
    // Vault & Send
    'vault', 'vault-browser', 'vault-peek', 'openrouter', 'sg-send-cli', 'send-receive',
    // Code & Runtime
    'pyodide-repl', 'folder-editor', 'llm-dev',
    // Developer — visualisation + sandbox tools
    'mermaid-diagrams', 'agent-with-tools', 'youtube-probe',
    // Developer Sandbox
    'vfs-dev', 'vfs-tree-demo', 'sg-tree-demo', 'send-sim', 'vault-pyodide',
    // Misc
    'speed-test', 'linkedin-publisher', 'markdown-viewer',
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
