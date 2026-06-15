/**
 * releases — the tool's changelog (newest first).
 *
 * Single source of truth for "what changed and when". Surfaced two ways:
 *   - the JS API action `getReleases()` (window.__tool.getReleases())
 *   - the "Releases" tab in the bottom JS-API dev panel
 *
 * RULE: bump `version` in manifest.json + the SgToolApi version on every release
 * and add an entry here in the SAME commit.
 *
 * @module audio-transcribe/releases
 */

/** @typedef {{ version: string, date: string, summary: string, changes: string[] }} Release */

/** @type {ReadonlyArray<Release>} */
export const RELEASES = Object.freeze([
    {
        version: '0.1.3',
        date: '2026-06-15',
        summary: 'Releases changelog (this tab) + getReleases API.',
        changes: [
            'New: this Releases tab in the JS-API dev panel, and the getReleases() API action — both surface this changelog.',
            'Process: the version badge now bumps on every release (it had been lagging behind shipped changes).',
        ],
    },
    {
        version: '0.1.2',
        date: '2026-06-15',
        summary: 'Per-item cost, identical-transcript fix, per-recording panel.',
        changes: [
            'Fixed: two different audio files could return the same transcript — the shared LLM bus resolved on the next response with no correlation id, so concurrent transcriptions crossed over. Transcription is now strictly serial.',
            'New: per-recording detail panel — "Open ▸" a Queue row to get a dedicated tab with an audio player, a per-item model selector + Re-transcribe (debug a bad transcription against another model), the transcript, and copy/download.',
            'New: per-transcription cost — shows the cost from the OpenRouter response, then the exact charged cost looked up by generation id a couple seconds later, plus token counts + latency (in the panel and the Queue row).',
            'Changed: sg-layout tabs unlocked — drag/re-dock them.',
        ],
    },
    {
        version: '0.1.1',
        date: '2026-06-14',
        summary: 'sg-layout shell, cost view, dev panel, banner; model + crash + recording fixes.',
        changes: [
            'Fixed: blank/crashing boot (ui-model consumed an async SgToolApi action as a synchronous array; sg-layout was awaited incorrectly).',
            'Fixed: 0-byte mic recordings on mobile (records in short chunks now, with a clear error if nothing is captured).',
            'Fixed: curated model list verified live on OpenRouter — default is now google/gemini-3.5-flash; dropped dead ids.',
            'New: 2-column sg-layout, OpenRouter usage/cost view, bottom JS-API dev panel (Skills/Explorer/Console/Manifest), SG site-header banner, visible version badge, full-width layout.',
        ],
    },
    {
        version: '0.1.0',
        date: '2026-06-13',
        summary: 'Initial release.',
        changes: [
            'Record from the mic or drag/drop many local audio files (including WhatsApp .opus voice notes).',
            'Batch-transcribe each to text via curated OpenRouter audio models, entirely in the browser.',
            'Three-tier never-fail .opus/webm decode (pass-through → decodeAudioData → WASM Opus), bundle to .zip, optional encrypted share via SG/Send.',
        ],
    },
]);

/** @returns {string} the current (latest) version. */
export function currentVersion() { return RELEASES.length ? RELEASES[0].version : '0.0.0'; }
