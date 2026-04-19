/**
 * sg-video-player.js
 * Reusable video player Web Component for Blob or URL playback.
 *
 * Usage:
 *   <!-- URL -->
 *   <sg-video-player src="https://..." poster="..."></sg-video-player>
 *
 *   <!-- Blob (programmatic) -->
 *   <sg-video-player></sg-video-player>
 *   element.setBlob(blob);
 *
 * Events (composed, bubbling):
 *   sg-video-player:ready       { duration }
 *   sg-video-player:play        {}
 *   sg-video-player:pause       {}
 *   sg-video-player:ended       {}
 *   sg-video-player:error       { message }
 *   sg-video-player:timeupdate  { currentTime, duration }  (throttled ~250ms)
 *
 * IMPORTANT: Call destroy() before removing from DOM if setBlob() was used,
 * to revoke the internal object URL.
 *
 * @module sg-video-player
 * @version 0.1.0
 */

import { SgComponent, SgComponentPaths } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';

export class SgVideoPlayer extends SgComponent {
    static jsUrl = import.meta.url;

    #objectUrl      = null;
    #timeupdateTs   = 0;

    // ─── Observed attributes ───────────────────────────────────────────────

    static get observedAttributes() {
        return ['src', 'poster', 'autoplay', 'loop', 'muted', 'label'];
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (!this._isReady || oldVal === newVal) return;
        const video = this._video();
        if (!video) return;

        switch (name) {
            case 'src':      this._setSrc(newVal);             break;
            case 'poster':   video.poster   = newVal ?? '';    break;
            case 'autoplay': video.autoplay = this.hasAttribute('autoplay'); break;
            case 'loop':     video.loop     = this.hasAttribute('loop');     break;
            case 'muted':    video.muted    = this.hasAttribute('muted');    break;
            case 'label':    this._updateLabel();              break;
        }
    }

    // ─── Accessors ─────────────────────────────────────────────────────────

    get duration()    { return this._video()?.duration    ?? 0; }
    get currentTime() { return this._video()?.currentTime ?? 0; }
    get paused()      { return this._video()?.paused      ?? true; }

    // ─── Public API ────────────────────────────────────────────────────────

    /**
     * Set a Blob as the video source. Creates an internal object URL (revoked on next call or destroy()).
     * @param {Blob} blob
     * @param {string} [mimeType]  Optional MIME type override. Defaults to blob.type.
     */
    setBlob(blob, mimeType) {
        this._revokeObjectUrl();
        const type = mimeType || blob.type || 'video/webm';
        this.#objectUrl = URL.createObjectURL(new Blob([blob], { type }));
        this._setSrc(this.#objectUrl);
    }

    /**
     * Set a URL as the video source.
     * @param {string} url
     */
    setUrl(url) {
        this._revokeObjectUrl();
        this._setSrc(url);
    }

    /** @returns {Promise<void>} */
    play() {
        return this._video()?.play() ?? Promise.resolve();
    }

    pause() {
        this._video()?.pause();
    }

    /**
     * @param {number} seconds
     */
    seek(seconds) {
        const v = this._video();
        if (v) v.currentTime = seconds;
    }

    /**
     * Revoke any internal object URL and detach the source. Call before removal from DOM.
     */
    destroy() {
        this._revokeObjectUrl();
        const v = this._video();
        if (v) { v.pause(); v.src = ''; v.load(); }
        this.cleanup();
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    onReady() {
        const video = this._video();
        if (!video) return;

        // Apply attribute values that arrived before ready
        if (this.hasAttribute('autoplay')) video.autoplay = true;
        if (this.hasAttribute('loop'))     video.loop     = true;
        if (this.hasAttribute('muted'))    video.muted    = true;
        if (this.getAttribute('poster'))   video.poster   = this.getAttribute('poster');

        this.addTrackedListener(video, 'loadedmetadata', () => {
            this.emit('sg-video-player:ready', { duration: video.duration });
        });
        this.addTrackedListener(video, 'play',  () => this.emit('sg-video-player:play',  {}));
        this.addTrackedListener(video, 'pause', () => this.emit('sg-video-player:pause', {}));
        this.addTrackedListener(video, 'ended', () => this.emit('sg-video-player:ended', {}));
        this.addTrackedListener(video, 'error', () => {
            const msg = video.error?.message ?? 'Unknown video error';
            this.emit('sg-video-player:error', { message: msg });
        });
        this.addTrackedListener(video, 'timeupdate', () => {
            const now = Date.now();
            if (now - this.#timeupdateTs < 250) return;
            this.#timeupdateTs = now;
            this.emit('sg-video-player:timeupdate', { currentTime: video.currentTime, duration: video.duration });
        });

        const srcAttr = this.getAttribute('src');
        if (srcAttr) this._setSrc(srcAttr);

        this._updateLabel();
    }

    cleanup() {
        this._revokeObjectUrl();
        super.cleanup();
    }

    // ─── Internal ──────────────────────────────────────────────────────────

    _video()     { return this.$('video'); }

    _setSrc(src) {
        const v = this._video();
        if (!v) return;
        v.src = src ?? '';
        v.load();
    }

    _updateLabel() {
        const el = this.$('.sg-vp__label');
        if (!el) return;
        const lbl = this.getAttribute('label');
        el.textContent  = lbl ?? '';
        el.style.display = lbl ? '' : 'none';
    }

    _revokeObjectUrl() {
        if (this.#objectUrl) {
            URL.revokeObjectURL(this.#objectUrl);
            this.#objectUrl = null;
        }
    }
}

customElements.define('sg-video-player', SgVideoPlayer);
