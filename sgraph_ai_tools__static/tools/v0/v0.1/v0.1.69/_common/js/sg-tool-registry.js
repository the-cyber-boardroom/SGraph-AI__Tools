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
   v0.1.69 changes (2026-08-25):
     - No slug changes. 'youtube-probe' v0.1.1 — the suite was RUN for real
       against a Google account, and every question in the v0.2.92 pack now has
       a measured answer. M4 passed: auto-generated captions CAN be downloaded
       through the API (46,435 bytes, 255 cues), so for your own videos the
       words are free, already timestamped, and no VAD is involved anywhere on
       that path. M8 passed: a tab can be captured with its audio. Routes B and
       C are therefore COMPLEMENTARY rather than alternatives — captions are the
       text spine, capture is the audio and the frames — and the pack's
       either/or framing was wrong.
       Four defects the live run exposed are fixed here, the worst being that a
       fixture which failed to record was reported as a FAILED HYPOTHESIS. A
       fifth status, 'error', now means the harness broke and nothing was
       measured. v0.1.68 is left exactly as it was tested.
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
    'video-publisher', 'whatsapp-desk', 'narrated-review', 'media-probe',
    // Vault & Send
    'vault', 'vault-browser', 'vault-peek', 'openrouter', 'sg-send-cli',
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
