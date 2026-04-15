/* =================================================================================
   SGraph Tools — Transfer Progress Component
   v1.0.0

   Reusable progress bar for upload and download operations.

   Usage:
     <script type="module" src="/components/transfer-progress/v1/v1.0/v1.0.0/sg-transfer-progress.js"></script>
     <sg-transfer-progress phase="uploading"></sg-transfer-progress>

     // Set progress from script — accepts either format:
     el.progress = {                       // ChunkedUploader / ChunkedDownloader shape
         percent: 65,
         bytesTotal: 104857600,
         bytesUploaded: 67108864,          // or bytesDownloaded for download
         bytesPerSecond: 2516582,
         etaSecs: 14,
         stage: 'uploading',
         chunksTotal: 10,
         chunksDone: 6,
         threadCount: 3
     };
     // OR simpler shape (e.g. from Send app v0.3.x overlay):
     el.progress = { loaded: 67108864, total: 104857600, phase: 'downloading' };

   Properties:
     progress — UploadProgress | DownloadProgress | { loaded, total, phase }
     phase    — 'idle'|'uploading'|'downloading'|'decrypting'|'encrypting'|
                'completing'|'complete'|'error'   (overrides progress.stage/phase)
     label    — custom label string (overrides phase-derived label)

   Attributes:
     phase, label   (both reflected)

   Events:
     none — display-only component

   CSS custom properties (all optional — defaults suit a dark/mid theme):
     --sg-tp-bar-bg     track background  (default rgba(255,255,255,0.12))
     --sg-tp-bar-fill   fill colour       (default #4ECDC4)
     --sg-tp-bar-fill-complete  fill when complete (default #52D273)
     --sg-tp-text       primary text      (default rgba(255,255,255,0.9))
     --sg-tp-text-muted secondary text    (default rgba(255,255,255,0.5))
     --sg-tp-height     bar height        (default 8px)
     --sg-tp-radius     bar radius        (default 4px)
     --sg-tp-gap        row gap           (default 0.35rem)

   Compatible with:
     • ChunkedUploader  onProgress callback  (sg-send-upload  v1.1+)
     • ChunkedDownloader onProgress callback (sg-send-download v1.0+)
     • Custom { loaded, total, phase } objects from any byte-tracking code
   ================================================================================= */

// ─── Phase → human-readable label ─────────────────────────────────────────────

const PHASE_LABELS = Object.freeze({
    idle:        '',
    uploading:   'Uploading\u2026',
    downloading: 'Downloading\u2026',
    decrypting:  'Decrypting\u2026',
    encrypting:  'Encrypting\u2026',
    completing:  'Completing\u2026',
    complete:    'Complete',
    error:       'Error',
    // ChunkedUploader internal stages
    initiating:  'Preparing\u2026',
    reading:     'Reading\u2026',
    creating:    'Creating transfer\u2026',
    zipping:     'Compressing\u2026',
});

// ─── Inline styles (Shadow DOM — no external file needed) ─────────────────────

const STYLES = /* css */`
:host {
    display: block;
    font-family: inherit;
    box-sizing: border-box;
}
.tp {
    display: flex;
    flex-direction: column;
    gap: var(--sg-tp-gap, 0.35rem);
}
.tp-label {
    font-size: 0.85rem;
    color: var(--sg-tp-text-muted, rgba(255,255,255,0.6));
    min-height: 1.1em;
    line-height: 1.3;
}
.tp-track {
    width: 100%;
    height: var(--sg-tp-height, 8px);
    background: var(--sg-tp-bar-bg, rgba(255,255,255,0.12));
    border-radius: var(--sg-tp-radius, 4px);
    overflow: hidden;
}
.tp-fill {
    height: 100%;
    width: 0%;
    background: var(--sg-tp-bar-fill, #4ECDC4);
    border-radius: inherit;
    transition: width 0.3s ease, background 0.2s;
}
.tp-fill[data-complete] {
    background: var(--sg-tp-bar-fill-complete, #52D273);
}
.tp-bytes {
    font-size: 0.8rem;
    color: var(--sg-tp-text-muted, rgba(255,255,255,0.5));
}
.tp-stats {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    color: var(--sg-tp-text-muted, rgba(255,255,255,0.45));
}
.tp-parts {
    font-size: 0.75rem;
    color: var(--sg-tp-text-muted, rgba(255,255,255,0.38));
}
.tp-bytes:empty,
.tp-stats:empty,
.tp-parts:empty { display: none; }
`;

// ─── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Normalise either a ChunkedUploader/ChunkedDownloader UploadProgress /
 * DownloadProgress object, or the simpler { loaded, total, phase } format
 * used by Send-app ad-hoc byte tracking, into a single canonical shape.
 *
 * @param {object|null} p           - Raw progress object.
 * @param {string}      [phaseHint] - Explicit phase (takes priority).
 * @returns {{ percent:number, loaded:number, total:number,
 *             bps:number, eta:number, chunks:number, done:number, phase:string }}
 */
export function normalizeProgress(p, phaseHint) {
    if (!p) return { percent: 0, loaded: 0, total: 0, bps: 0, eta: Infinity, chunks: 0, done: 0, phase: phaseHint || 'idle' };

    const loaded  = p.bytesUploaded   ?? p.bytesDownloaded ?? p.loaded ?? 0;
    const total   = p.bytesTotal      ?? p.total           ?? 0;
    const percent = p.percent         ?? (total > 0 ? Math.round(loaded / total * 100) : 0);
    const bps     = p.bytesPerSecond  ?? 0;
    const eta     = p.etaSecs         ?? Infinity;
    const chunks  = p.chunksTotal     ?? 0;
    const done    = p.chunksDone      ?? 0;
    const phase   = phaseHint || p.phase || p.stage || 'uploading';

    return { percent, loaded, total, bps, eta, chunks, done, phase };
}

/**
 * Format bytes-per-second to a human-readable speed string.
 * Returns empty string when bps is 0 / unknown.
 *
 * @param {number} bps
 * @returns {string}  e.g. "2.4 MB/s", "512 KB/s"
 */
export function formatSpeed(bps) {
    if (!bps || bps <= 0) return '';
    if (bps < 1024)             return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024)      return `${(bps / 1024).toFixed(1)} KB/s`;
    if (bps < 1024 ** 3)        return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    return `${(bps / 1024 ** 3).toFixed(2)} GB/s`;
}

/**
 * Format seconds remaining to a human-readable ETA string.
 * Returns empty string for infinite / zero / negative values.
 *
 * @param {number} etaSecs
 * @returns {string}  e.g. "1m 23s", "45s"
 */
export function formatEta(etaSecs) {
    if (!isFinite(etaSecs) || etaSecs <= 0) return '';
    const s = Math.round(etaSecs);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** @param {number} bytes @returns {string} */
function _fmtMB(bytes) {
    const mb = bytes / 1048576;
    return mb >= 100 ? `${Math.round(mb)} MB`
         : mb >= 10  ? `${mb.toFixed(1)} MB`
         :              `${mb.toFixed(2)} MB`;
}

// ─── Web Component ─────────────────────────────────────────────────────────────

/**
 * <sg-transfer-progress> — Reusable upload/download progress bar component.
 *
 * Displays: phase label, animated progress bar, MB transferred,
 * speed (MB/s), ETA, and chunk count when multipart.
 *
 * @export
 */
export class SgTransferProgress extends HTMLElement {

    static observedAttributes = ['phase', 'label'];

    /** @type {object|null} */ #progress = null;
    /** @type {string}      */ #phase    = 'idle';
    /** @type {string|null} */ #label    = null;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
<style>${STYLES}</style>
<div class="tp">
    <div class="tp-label"           aria-live="polite"></div>
    <div class="tp-track"           role="progressbar"
         aria-valuemin="0"          aria-valuemax="100"
         aria-valuenow="0"          aria-label="Transfer progress">
        <div class="tp-fill"></div>
    </div>
    <div class="tp-bytes"></div>
    <div class="tp-stats"></div>
    <div class="tp-parts"></div>
</div>`;
    }

    // ── Properties ──────────────────────────────────────────────────────────────

    /** @param {object|null} v */
    get progress() { return this.#progress; }
    set progress(v) { this.#progress = v ?? null; this._update(); }

    /** @param {string} v */
    get phase() { return this.#phase; }
    set phase(v) { this.#phase = v || 'idle'; this._update(); }

    /** @param {string|null} v */
    get label() { return this.#label; }
    set label(v) { this.#label = v || null; this._update(); }

    // ── Lifecycle ────────────────────────────────────────────────────────────────

    connectedCallback() { this._update(); }

    attributeChangedCallback(name, _old, val) {
        if (name === 'phase') this.#phase = val || 'idle';
        if (name === 'label') this.#label = val || null;
        this._update();
    }

    // ── Update ───────────────────────────────────────────────────────────────────

    _update() {
        const shadow = this.shadowRoot;
        const fill   = shadow.querySelector('.tp-fill');
        if (!fill) return;                           // constructor not complete yet

        const n = normalizeProgress(this.#progress, this.#phase);
        const isComplete = n.phase === 'complete' || n.percent >= 100;

        // Label
        const labelEl   = shadow.querySelector('.tp-label');
        labelEl.textContent = this.#label || PHASE_LABELS[n.phase] || n.phase;

        // Progress bar
        fill.style.width = `${Math.min(100, n.percent)}%`;
        if (isComplete) fill.setAttribute('data-complete', '');
        else            fill.removeAttribute('data-complete');

        const track = shadow.querySelector('.tp-track');
        track.setAttribute('aria-valuenow', n.percent);

        // Bytes row
        const bytesEl = shadow.querySelector('.tp-bytes');
        bytesEl.textContent = (n.total > 0)
            ? `${_fmtMB(n.loaded)} / ${_fmtMB(n.total)}`
            : '';

        // Speed + ETA stats row
        const statsEl = shadow.querySelector('.tp-stats');
        statsEl.textContent = '';
        const speed = formatSpeed(n.bps);
        const eta   = n.bps > 0 ? formatEta(n.eta) : '';
        if (speed) {
            const sp = Object.assign(document.createElement('span'), { textContent: speed });
            statsEl.appendChild(sp);
        }
        if (eta) {
            const et = Object.assign(document.createElement('span'), { textContent: `ETA\u00a0${eta}` });
            statsEl.appendChild(et);
        }

        // Parts row (only for genuine multipart transfers)
        const partsEl = shadow.querySelector('.tp-parts');
        partsEl.textContent = (n.chunks > 1)
            ? `${n.done}\u202f/\u202f${n.chunks} parts`
            : '';
    }
}

// ─── Register ──────────────────────────────────────────────────────────────────

if (!customElements.get('sg-transfer-progress')) {
    customElements.define('sg-transfer-progress', SgTransferProgress);
}
