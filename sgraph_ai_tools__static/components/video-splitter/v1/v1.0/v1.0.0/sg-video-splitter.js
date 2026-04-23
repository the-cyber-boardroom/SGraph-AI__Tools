/**
 * sg-video-splitter.js — <sg-video-splitter> Web Component
 *
 * Shadow DOM component for splitting, trimming, and extracting
 * audio/video from video files using FFmpeg WASM.
 *
 * @module sg-video-splitter
 * @version 1.0.0
 */

import {
    loadFFmpeg,
    getVideoInfo,
    splitVideo,
    trimVideo,
    extractAudio,
    extractVideo,
    parseTime,
    formatTime,
    isWasmSupported,
} from '/core/video/v1/v1.0/v1.0.0/sg-video.js';

/** @type {string} JSZip CDN URL for Download All as ZIP */
const JSZIP_CDN_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

/**
 * Format bytes into a human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Fetch the component CSS from a co-located file.
 * Falls back to empty string on error.
 *
 * @returns {Promise<string>}
 */
async function fetchComponentCSS() {
    try {
        const cssUrl = new URL('./sg-video-splitter.css', import.meta.url).href;
        const resp = await fetch(cssUrl);
        if (resp.ok) return await resp.text();
    } catch (_e) { /* ignore */ }
    return '';
}

/**
 * Video splitter/trimmer/extractor Web Component.
 *
 * Usage:
 *   <sg-video-splitter></sg-video-splitter>
 *
 * Public API:
 *   - loadVideo(file: File): Promise<void>
 *   - reset(): void
 *
 * Attributes:
 *   - disabled: disables all controls
 *
 * Events emitted:
 *   - sg-split-start  { detail: { mode, filename } }
 *   - sg-split-complete { detail: { results } }
 *   - sg-split-error  { detail: { error, message } }
 *
 * @extends HTMLElement
 */
export class SgVideoSplitter extends HTMLElement {
    /** @type {string[]} Observed attributes */
    static get observedAttributes() {
        return ['disabled'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        /** @type {File|null} Currently loaded video file */
        this._file = null;

        /** @type {{ duration: number, width: number, height: number, hasAudio: boolean, hasVideo: boolean, filename: string, size: number }|null} */
        this._videoInfo = null;

        /** @type {'split'|'trim'|'extract'} Active mode */
        this._mode = 'split';

        /** @type {'fixed'|'custom'} Split sub-mode */
        this._splitSubMode = 'fixed';

        /** @type {Array<{ start: string, end: string }>} Custom segments */
        this._customSegments = [{ start: '0:00', end: '' }];

        /** @type {string[]} Blob URLs to revoke on cleanup */
        this._blobUrls = [];

        /** @type {Array<{ blob: Blob, filename: string, startTime?: number, endTime?: number, duration?: number }>} */
        this._results = [];

        /** @type {boolean} Whether an operation is in progress */
        this._processing = false;

        /** @type {boolean} CSS loaded flag */
        this._cssLoaded = false;

        /** @type {string} Cached CSS text */
        this._cssText = '';
    }

    async connectedCallback() {
        if (!this._cssLoaded) {
            this._cssText = await fetchComponentCSS();
            this._cssLoaded = true;
        }
        this._render();
    }

    /**
     * Handle attribute changes.
     *
     * @param {string} name
     * @param {string|null} _oldVal
     * @param {string|null} _newVal
     */
    attributeChangedCallback(name, _oldVal, _newVal) {
        if (name === 'disabled') {
            this._render();
        }
    }

    /**
     * Load a video file, extract metadata, and display controls.
     *
     * @param {File} file - Video file to load
     * @returns {Promise<void>}
     */
    async loadVideo(file) {
        this._cleanup();
        this._file = file;
        this._results = [];
        this._mode = 'split';
        this._splitSubMode = 'fixed';
        this._customSegments = [{ start: '0:00', end: '' }];

        try {
            this._videoInfo = await getVideoInfo(file);
            // Fill default end time for first custom segment
            this._customSegments[0].end = formatTime(this._videoInfo.duration);
        } catch (err) {
            this._emitError(err);
            return;
        }

        this._render();
    }

    /**
     * Reset all state and return to initial empty view.
     */
    reset() {
        this._cleanup();
        this._file = null;
        this._videoInfo = null;
        this._results = [];
        this._mode = 'split';
        this._splitSubMode = 'fixed';
        this._customSegments = [{ start: '0:00', end: '' }];
        this._processing = false;
        this._render();
    }

    /**
     * Revoke all tracked blob URLs.
     *
     * @private
     */
    _cleanup() {
        for (const url of this._blobUrls) {
            try { URL.revokeObjectURL(url); } catch (_e) { /* ignore */ }
        }
        this._blobUrls = [];
    }

    /**
     * Emit a custom event.
     *
     * @param {string} name
     * @param {object} detail
     * @private
     */
    _emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }

    /**
     * Emit sg-split-error event.
     *
     * @param {Error} err
     * @private
     */
    _emitError(err) {
        this._emit('sg-split-error', { error: err, message: err.message });
    }

    /**
     * Create a tracked blob URL.
     *
     * @param {Blob} blob
     * @returns {string}
     * @private
     */
    _createBlobUrl(blob) {
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);
        return url;
    }

    /**
     * Get the disabled state.
     *
     * @returns {boolean}
     * @private
     */
    get _isDisabled() {
        return this.hasAttribute('disabled');
    }

    // ─── Rendering ───────────────────────────────────────────────

    /**
     * Full render of the shadow DOM.
     *
     * @private
     */
    _render() {
        const shadow = this.shadowRoot;
        shadow.innerHTML = '';

        // Inject styles
        const style = document.createElement('style');
        style.textContent = this._cssText;
        shadow.appendChild(style);

        const container = document.createElement('div');
        container.className = 'sg-vs-container';

        if (!this._videoInfo) {
            container.innerHTML = `<div class="sg-vs-empty">No video loaded. Use <code>loadVideo(file)</code> to begin.</div>`;
            shadow.appendChild(container);
            return;
        }

        // Info bar
        container.appendChild(this._renderInfo());

        // Preview player
        container.appendChild(this._renderPreview());

        // Mode tabs
        container.appendChild(this._renderModeTabs());

        // Active mode panel
        container.appendChild(this._renderActivePanel());

        // Progress area (hidden by default, shown during processing)
        const progress = this._renderProgress();
        progress.style.display = 'none';
        progress.setAttribute('data-role', 'progress');
        container.appendChild(progress);

        // Results
        if (this._results.length > 0) {
            container.appendChild(this._renderResults());
            container.appendChild(this._renderActions());
        }

        shadow.appendChild(container);
    }

    /**
     * Render the file info bar.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderInfo() {
        const info = this._videoInfo;
        const div = document.createElement('div');
        div.className = 'sg-vs-info';
        div.innerHTML = `
            <strong>${this._escHtml(info.filename)}</strong>
            <span class="sg-vs-info-sep">|</span>
            <span>Duration: ${formatTime(info.duration)}</span>
            <span class="sg-vs-info-sep">|</span>
            <span>Size: ${formatBytes(info.size)}</span>
        `;
        return div;
    }

    /**
     * Render video preview player.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderPreview() {
        const div = document.createElement('div');
        div.className = 'sg-vs-preview';
        const video = document.createElement('video');
        video.controls = true;
        const url = this._createBlobUrl(this._file);
        video.src = url;
        div.appendChild(video);
        return div;
    }

    /**
     * Render mode selector tabs.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderModeTabs() {
        const div = document.createElement('div');
        div.className = 'sg-vs-modes';

        const modes = [
            { key: 'split', label: 'Split' },
            { key: 'trim', label: 'Trim' },
            { key: 'extract', label: 'Extract' },
        ];

        for (const m of modes) {
            const btn = document.createElement('button');
            btn.textContent = m.label;
            btn.type = 'button';
            if (m.key === this._mode) {
                btn.classList.add('sg-vs-mode-active');
            }
            if (this._processing) btn.disabled = true;
            btn.addEventListener('click', () => {
                if (this._processing) return;
                this._mode = /** @type {'split'|'trim'|'extract'} */ (m.key);
                this._render();
            });
            div.appendChild(btn);
        }

        return div;
    }

    /**
     * Render the active mode's panel.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderActivePanel() {
        switch (this._mode) {
            case 'split':   return this._renderSplitPanel();
            case 'trim':    return this._renderTrimPanel();
            case 'extract': return this._renderExtractPanel();
            default:        return document.createElement('div');
        }
    }

    // ─── Split Panel ─────────────────────────────────────────────

    /**
     * Render the split mode panel.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderSplitPanel() {
        const panel = document.createElement('div');
        panel.className = 'sg-vs-panel';

        // Sub-mode toggle
        const subToggle = document.createElement('div');
        subToggle.className = 'sg-vs-split-submode';

        const subModes = [
            { key: 'fixed', label: 'Fixed length' },
            { key: 'custom', label: 'Custom segments' },
        ];

        for (const sm of subModes) {
            const btn = document.createElement('button');
            btn.textContent = sm.label;
            btn.type = 'button';
            if (sm.key === this._splitSubMode) {
                btn.classList.add('sg-vs-split-submode-active');
            }
            if (this._processing) btn.disabled = true;
            btn.addEventListener('click', () => {
                if (this._processing) return;
                this._splitSubMode = /** @type {'fixed'|'custom'} */ (sm.key);
                this._render();
            });
            subToggle.appendChild(btn);
        }

        panel.appendChild(subToggle);

        if (this._splitSubMode === 'fixed') {
            panel.appendChild(this._renderFixedSplitControls());
        } else {
            panel.appendChild(this._renderCustomSegmentControls());
        }

        return panel;
    }

    /**
     * Render fixed-length split controls.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderFixedSplitControls() {
        const frag = document.createElement('div');
        frag.style.display = 'contents';

        const row = document.createElement('div');
        row.className = 'sg-vs-fixed-row';

        const label = document.createElement('label');
        label.textContent = 'Segment length (seconds):';
        label.style.fontSize = '0.85rem';
        label.style.color = 'var(--sg-text-muted)';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.value = '30';
        input.step = '1';
        if (this._processing) input.disabled = true;

        const hint = document.createElement('span');
        hint.className = 'sg-vs-segment-hint';
        this._updateFixedHint(hint, 30);

        input.addEventListener('input', () => {
            const val = parseInt(input.value, 10);
            this._updateFixedHint(hint, val);
        });

        row.appendChild(label);
        row.appendChild(input);
        row.appendChild(hint);
        frag.appendChild(row);

        // Split button
        const btn = document.createElement('button');
        btn.className = 'sg-vs-action-btn';
        btn.textContent = 'Split Video';
        btn.type = 'button';
        if (this._processing) btn.disabled = true;
        btn.addEventListener('click', () => {
            const val = parseInt(input.value, 10);
            if (!val || val <= 0) return;
            this._doFixedSplit(val);
        });
        frag.appendChild(btn);

        return frag;
    }

    /**
     * Update the hint text for fixed-length split.
     *
     * @param {HTMLElement} hint
     * @param {number} seconds
     * @private
     */
    _updateFixedHint(hint, seconds) {
        if (!this._videoInfo || !seconds || seconds <= 0) {
            hint.textContent = '';
            return;
        }
        const count = Math.ceil(this._videoInfo.duration / seconds);
        hint.textContent = `\u2192 ${count} segment${count !== 1 ? 's' : ''} will be created`;
    }

    /**
     * Render custom segment list controls.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderCustomSegmentControls() {
        const frag = document.createElement('div');
        frag.style.display = 'contents';

        const segList = document.createElement('div');
        segList.className = 'sg-vs-segments';

        for (let i = 0; i < this._customSegments.length; i++) {
            segList.appendChild(this._renderSegmentRow(i));
        }

        frag.appendChild(segList);

        // Add segment button
        const addBtn = document.createElement('button');
        addBtn.className = 'sg-vs-add-segment-btn';
        addBtn.textContent = '+ Add segment';
        addBtn.type = 'button';
        if (this._processing) addBtn.disabled = true;
        addBtn.addEventListener('click', () => {
            const lastEnd = this._customSegments.length > 0
                ? this._customSegments[this._customSegments.length - 1].end
                : '0:00';
            this._customSegments.push({
                start: lastEnd || '0:00',
                end: formatTime(this._videoInfo.duration),
            });
            this._render();
        });
        frag.appendChild(addBtn);

        // Split button
        const btn = document.createElement('button');
        btn.className = 'sg-vs-action-btn';
        btn.textContent = 'Split Video';
        btn.type = 'button';
        if (this._processing) btn.disabled = true;
        btn.addEventListener('click', () => this._doCustomSplit());
        frag.appendChild(btn);

        return frag;
    }

    /**
     * Render a single segment row for custom mode.
     *
     * @param {number} index
     * @returns {HTMLElement}
     * @private
     */
    _renderSegmentRow(index) {
        const row = document.createElement('div');
        row.className = 'sg-vs-segment-row';

        const startInput = document.createElement('input');
        startInput.type = 'text';
        startInput.placeholder = '0:00';
        startInput.value = this._customSegments[index].start;
        if (this._processing) startInput.disabled = true;
        startInput.addEventListener('change', () => {
            this._customSegments[index].start = startInput.value;
        });

        const arrow = document.createElement('span');
        arrow.className = 'sg-vs-arrow';
        arrow.textContent = '\u2192';

        const endInput = document.createElement('input');
        endInput.type = 'text';
        endInput.placeholder = formatTime(this._videoInfo.duration);
        endInput.value = this._customSegments[index].end;
        if (this._processing) endInput.disabled = true;
        endInput.addEventListener('change', () => {
            this._customSegments[index].end = endInput.value;
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'sg-vs-remove-btn';
        removeBtn.textContent = '\u00d7';
        removeBtn.type = 'button';
        if (this._processing) removeBtn.disabled = true;
        if (this._customSegments.length <= 1) removeBtn.disabled = true;
        removeBtn.addEventListener('click', () => {
            if (this._customSegments.length <= 1) return;
            this._customSegments.splice(index, 1);
            this._render();
        });

        row.appendChild(startInput);
        row.appendChild(arrow);
        row.appendChild(endInput);
        row.appendChild(removeBtn);

        return row;
    }

    // ─── Trim Panel ──────────────────────────────────────────────

    /**
     * Render the trim mode panel.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderTrimPanel() {
        const panel = document.createElement('div');
        panel.className = 'sg-vs-panel';

        const controls = document.createElement('div');
        controls.className = 'sg-vs-trim-controls';

        const startLabel = document.createElement('label');
        startLabel.textContent = 'Start:';
        const startInput = document.createElement('input');
        startInput.type = 'text';
        startInput.placeholder = '0:00';
        startInput.value = '0:00';
        if (this._processing) startInput.disabled = true;

        const endLabel = document.createElement('label');
        endLabel.textContent = 'End:';
        const endInput = document.createElement('input');
        endInput.type = 'text';
        endInput.placeholder = formatTime(this._videoInfo.duration);
        endInput.value = formatTime(this._videoInfo.duration);
        if (this._processing) endInput.disabled = true;

        controls.appendChild(startLabel);
        controls.appendChild(startInput);
        controls.appendChild(endLabel);
        controls.appendChild(endInput);
        panel.appendChild(controls);

        // Hint
        const hint = document.createElement('div');
        hint.className = 'sg-vs-trim-hint';
        const updateTrimHint = () => {
            const s = parseTime(startInput.value) || 0;
            const e = parseTime(endInput.value) || this._videoInfo.duration;
            const total = this._videoInfo.duration;
            const kept = Math.max(0, e - s);
            const trimStart = s;
            const trimEnd = Math.max(0, total - e);
            hint.textContent = `Keep: ${formatTime(kept)} of ${formatTime(total)} (trimming ${formatTime(trimStart)} from start, ${formatTime(trimEnd)} from end)`;
        };
        updateTrimHint();
        startInput.addEventListener('input', updateTrimHint);
        endInput.addEventListener('input', updateTrimHint);
        panel.appendChild(hint);

        // Trim button
        const btn = document.createElement('button');
        btn.className = 'sg-vs-action-btn';
        btn.textContent = 'Trim';
        btn.type = 'button';
        if (this._processing) btn.disabled = true;
        btn.addEventListener('click', () => {
            const s = parseTime(startInput.value);
            const e = parseTime(endInput.value);
            if (s === null || e === null || e <= s) return;
            this._doTrim(s, e);
        });
        panel.appendChild(btn);

        return panel;
    }

    // ─── Extract Panel ───────────────────────────────────────────

    /**
     * Render the extract mode panel.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderExtractPanel() {
        const panel = document.createElement('div');
        panel.className = 'sg-vs-panel';

        const btns = document.createElement('div');
        btns.className = 'sg-vs-extract-buttons';

        const bothBtn = document.createElement('button');
        bothBtn.textContent = 'Extract Both (Audio + Video)';
        bothBtn.type = 'button';
        if ((!this._videoInfo.hasAudio && !this._videoInfo.hasVideo) || this._processing) bothBtn.disabled = true;
        bothBtn.addEventListener('click', () => this._doExtractBoth());

        const audioBtn = document.createElement('button');
        audioBtn.textContent = 'Extract Audio Only';
        audioBtn.type = 'button';
        if (!this._videoInfo.hasAudio || this._processing) audioBtn.disabled = true;
        audioBtn.addEventListener('click', () => this._doExtractAudio());

        const videoBtn = document.createElement('button');
        videoBtn.textContent = 'Extract Video Only';
        videoBtn.type = 'button';
        if (!this._videoInfo.hasVideo || this._processing) videoBtn.disabled = true;
        videoBtn.addEventListener('click', () => this._doExtractVideo());

        btns.appendChild(bothBtn);
        btns.appendChild(audioBtn);
        btns.appendChild(videoBtn);
        panel.appendChild(btns);

        if (!this._videoInfo.hasAudio) {
            const note = document.createElement('div');
            note.className = 'sg-vs-trim-hint';
            note.textContent = 'No audio stream detected in this file.';
            panel.appendChild(note);
        }
        if (!this._videoInfo.hasVideo) {
            const note = document.createElement('div');
            note.className = 'sg-vs-trim-hint';
            note.textContent = 'No video stream detected in this file.';
            panel.appendChild(note);
        }

        return panel;
    }

    // ─── Progress ────────────────────────────────────────────────

    /**
     * Render the progress bar area.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderProgress() {
        const div = document.createElement('div');
        div.className = 'sg-vs-progress';
        div.innerHTML = `
            <span class="sg-vs-progress-label" data-role="progress-label">Loading FFmpeg...</span>
            <div class="sg-vs-progress-bar">
                <div class="sg-vs-progress-bar-fill" data-role="progress-fill"></div>
            </div>
        `;
        return div;
    }

    /**
     * Show progress UI with a label and optional ratio.
     *
     * @param {string} label
     * @param {number} [ratio=0] 0..1
     * @private
     */
    _showProgress(label, ratio = 0) {
        const container = this.shadowRoot.querySelector('[data-role="progress"]');
        if (!container) return;
        container.style.display = '';
        const lbl = container.querySelector('[data-role="progress-label"]');
        const fill = container.querySelector('[data-role="progress-fill"]');
        if (lbl) lbl.textContent = label;
        if (fill) fill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    }

    /**
     * Hide progress UI.
     *
     * @private
     */
    _hideProgress() {
        const container = this.shadowRoot.querySelector('[data-role="progress"]');
        if (container) container.style.display = 'none';
    }

    // ─── Results ─────────────────────────────────────────────────

    /**
     * Render the results list.
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderResults() {
        const div = document.createElement('div');
        div.className = 'sg-vs-results';

        const header = document.createElement('div');
        header.className = 'sg-vs-results-header';
        header.textContent = `Results (${this._results.length})`;
        div.appendChild(header);

        for (let i = 0; i < this._results.length; i++) {
            div.appendChild(this._renderResultRow(i));
        }

        return div;
    }

    /**
     * Render a single result row.
     *
     * @param {number} index
     * @returns {HTMLElement}
     * @private
     */
    _renderResultRow(index) {
        const r = this._results[index];
        const row = document.createElement('div');
        row.className = 'sg-vs-result-row';

        const info = document.createElement('div');
        info.className = 'sg-vs-result-info';

        let infoHtml = `<strong>${this._escHtml(r.filename)}</strong>`;
        if (r.startTime !== undefined && r.endTime !== undefined) {
            infoHtml += ` &middot; ${formatTime(r.startTime)} \u2013 ${formatTime(r.endTime)}`;
        }
        if (r.duration !== undefined) {
            infoHtml += ` &middot; ${formatTime(r.duration)}`;
        }
        infoHtml += ` &middot; ${formatBytes(r.blob.size)}`;
        info.innerHTML = infoHtml;

        const btns = document.createElement('div');
        btns.className = 'sg-vs-result-btns';

        // Play button
        const playBtn = document.createElement('button');
        playBtn.textContent = '\u25b6 Play';
        playBtn.type = 'button';
        playBtn.addEventListener('click', () => {
            this._togglePlayback(row, r);
        });

        // Download button
        const dlBtn = document.createElement('button');
        dlBtn.textContent = '\u2193 Download';
        dlBtn.type = 'button';
        dlBtn.addEventListener('click', () => {
            this._downloadBlob(r.blob, r.filename);
        });

        btns.appendChild(playBtn);
        btns.appendChild(dlBtn);

        row.appendChild(info);
        row.appendChild(btns);

        return row;
    }

    /**
     * Toggle inline playback for a result row.
     *
     * @param {HTMLElement} row
     * @param {{ blob: Blob, filename: string }} result
     * @private
     */
    _togglePlayback(row, result) {
        const existing = row.querySelector('.sg-vs-result-player');
        if (existing) {
            existing.remove();
            return;
        }

        const playerDiv = document.createElement('div');
        playerDiv.className = 'sg-vs-result-player';

        const url = this._createBlobUrl(result.blob);
        const isAudio = result.blob.type.startsWith('audio/');

        if (isAudio) {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = url;
            playerDiv.appendChild(audio);
        } else {
            const video = document.createElement('video');
            video.controls = true;
            video.src = url;
            playerDiv.appendChild(video);
        }

        row.appendChild(playerDiv);
    }

    /**
     * Render the actions bar (Download All as ZIP).
     *
     * @returns {HTMLElement}
     * @private
     */
    _renderActions() {
        const div = document.createElement('div');
        div.className = 'sg-vs-actions';

        if (this._results.length > 1) {
            const btn = document.createElement('button');
            btn.textContent = 'Download All as ZIP';
            btn.type = 'button';
            btn.addEventListener('click', () => this._doDownloadZip());
            div.appendChild(btn);
        }

        return div;
    }

    // ─── Operations ──────────────────────────────────────────────

    /**
     * Perform fixed-length split.
     *
     * @param {number} segmentLength - Seconds per segment
     * @returns {Promise<void>}
     * @private
     */
    async _doFixedSplit(segmentLength) {
        const duration = this._videoInfo.duration;
        const segments = [];
        for (let start = 0; start < duration; start += segmentLength) {
            segments.push({
                start,
                end: Math.min(start + segmentLength, duration),
            });
        }
        await this._executeSplit(segments);
    }

    /**
     * Perform custom-segment split.
     *
     * @returns {Promise<void>}
     * @private
     */
    async _doCustomSplit() {
        const segments = [];
        for (const seg of this._customSegments) {
            const start = parseTime(seg.start);
            const end = parseTime(seg.end);
            if (start === null || end === null || end <= start) continue;
            segments.push({ start, end });
        }
        if (segments.length === 0) return;
        await this._executeSplit(segments);
    }

    /**
     * Execute a split operation with given segments.
     *
     * @param {Array<{ start: number, end: number }>} segments
     * @returns {Promise<void>}
     * @private
     */
    async _executeSplit(segments) {
        if (this._processing) return;
        this._processing = true;
        this._results = [];
        this._render();

        this._emit('sg-split-start', { mode: 'split', filename: this._videoInfo.filename });

        try {
            this._showProgress('Loading FFmpeg...', 0);
            const ffmpeg = await loadFFmpeg((p) => {
                this._showProgress('Loading FFmpeg...', p.ratio || 0);
            });

            const results = await splitVideo(ffmpeg, this._file, segments, (idx, total) => {
                this._showProgress(`Processing segment ${idx + 1} of ${total}...`, (idx + 1) / total);
            });

            this._results = results;
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emit('sg-split-complete', { results });
        } catch (err) {
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emitError(err);
        }
    }

    /**
     * Perform trim operation.
     *
     * @param {number} start
     * @param {number} end
     * @returns {Promise<void>}
     * @private
     */
    async _doTrim(start, end) {
        if (this._processing) return;
        this._processing = true;
        this._results = [];
        this._render();

        this._emit('sg-split-start', { mode: 'trim', filename: this._videoInfo.filename });

        try {
            this._showProgress('Loading FFmpeg...', 0);
            const ffmpeg = await loadFFmpeg((p) => {
                this._showProgress('Loading FFmpeg...', p.ratio || 0);
            });

            this._showProgress('Trimming...', 0.5);
            const result = await trimVideo(ffmpeg, this._file, start, end);

            this._results = [{
                blob: result.blob,
                filename: result.filename,
                startTime: start,
                endTime: end,
                duration: result.duration,
            }];
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emit('sg-split-complete', { results: this._results });
        } catch (err) {
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emitError(err);
        }
    }

    /**
     * Perform audio extraction.
     *
     * @returns {Promise<void>}
     * @private
     */
    async _doExtractAudio() {
        if (this._processing) return;
        this._processing = true;
        this._results = [];
        this._render();

        this._emit('sg-split-start', { mode: 'extract-audio', filename: this._videoInfo.filename });

        try {
            this._showProgress('Loading FFmpeg...', 0);
            const ffmpeg = await loadFFmpeg((p) => {
                this._showProgress('Loading FFmpeg...', p.ratio || 0);
            });

            this._showProgress('Extracting audio...', 0.5);
            const result = await extractAudio(ffmpeg, this._file);

            this._results = [{
                blob: result.blob,
                filename: result.filename,
                duration: this._videoInfo.duration,
            }];
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emit('sg-split-complete', { results: this._results });
        } catch (err) {
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emitError(err);
        }
    }

    /**
     * Perform video-only extraction (strip audio).
     *
     * @returns {Promise<void>}
     * @private
     */
    async _doExtractVideo() {
        if (this._processing) return;
        this._processing = true;
        this._results = [];
        this._render();

        this._emit('sg-split-start', { mode: 'extract-video', filename: this._videoInfo.filename });

        try {
            this._showProgress('Loading FFmpeg...', 0);
            const ffmpeg = await loadFFmpeg((p) => {
                this._showProgress('Loading FFmpeg...', p.ratio || 0);
            });

            this._showProgress('Extracting video...', 0.5);
            const result = await extractVideo(ffmpeg, this._file);

            this._results = [{
                blob: result.blob,
                filename: result.filename,
                duration: this._videoInfo.duration,
            }];
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emit('sg-split-complete', { results: this._results });
        } catch (err) {
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emitError(err);
        }
    }

    /**
     * Perform both audio and video extraction in a single pass.
     * Produces two results: audio-only and video-only files.
     *
     * @returns {Promise<void>}
     * @private
     */
    async _doExtractBoth() {
        if (this._processing) return;
        this._processing = true;
        this._results = [];
        this._render();

        this._emit('sg-split-start', { mode: 'extract-both', filename: this._videoInfo.filename });

        try {
            this._showProgress('Loading FFmpeg...', 0);
            const ffmpeg = await loadFFmpeg((p) => {
                this._showProgress('Loading FFmpeg...', p.ratio || 0);
            });

            const results = [];

            // Extract audio
            this._showProgress('Extracting audio...', 0.25);
            try {
                const audio = await extractAudio(ffmpeg, this._file);
                results.push({
                    blob: audio.blob,
                    filename: audio.filename,
                    duration: this._videoInfo.duration,
                });
            } catch (_audioErr) {
                // Audio extraction may fail if no audio stream — continue to video
            }

            // Extract video (strip audio)
            this._showProgress('Extracting video...', 0.65);
            try {
                const video = await extractVideo(ffmpeg, this._file);
                results.push({
                    blob: video.blob,
                    filename: video.filename,
                    duration: this._videoInfo.duration,
                });
            } catch (_videoErr) {
                // Video extraction may fail if no video stream
            }

            if (results.length === 0) {
                throw new Error('Neither audio nor video could be extracted from this file.');
            }

            this._results = results;
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emit('sg-split-complete', { results: this._results });
        } catch (err) {
            this._processing = false;
            this._hideProgress();
            this._render();
            this._emitError(err);
        }
    }

    // ─── Download helpers ────────────────────────────────────────

    /**
     * Trigger a download of a Blob.
     *
     * @param {Blob} blob
     * @param {string} filename
     * @private
     */
    _downloadBlob(blob, filename) {
        const url = this._createBlobUrl(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        this.shadowRoot.appendChild(a);
        a.click();
        a.remove();
    }

    /**
     * Download all results as a ZIP file using JSZip from CDN.
     *
     * @returns {Promise<void>}
     * @private
     */
    async _doDownloadZip() {
        try {
            // Load JSZip if not already available
            if (typeof globalThis.JSZip === 'undefined') {
                await this._loadScript(JSZIP_CDN_URL);
            }

            const JSZip = globalThis.JSZip;
            if (!JSZip) {
                throw new Error('Failed to load JSZip library.');
            }

            const zip = new JSZip();
            for (const r of this._results) {
                zip.file(r.filename, r.blob);
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const baseName = this._videoInfo.filename.includes('.')
                ? this._videoInfo.filename.substring(0, this._videoInfo.filename.lastIndexOf('.'))
                : this._videoInfo.filename;
            this._downloadBlob(zipBlob, `${baseName}_output.zip`);
        } catch (err) {
            this._emitError(err);
        }
    }

    /**
     * Load an external script by URL (appended to document head).
     *
     * @param {string} url
     * @returns {Promise<void>}
     * @private
     */
    _loadScript(url) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${url}"]`);
            if (existing) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
            document.head.appendChild(script);
        });
    }

    // ─── Utilities ───────────────────────────────────────────────

    /**
     * Escape HTML special characters.
     *
     * @param {string} str
     * @returns {string}
     * @private
     */
    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Register the custom element
if (!customElements.get('sg-video-splitter')) {
    customElements.define('sg-video-splitter', SgVideoSplitter);
}