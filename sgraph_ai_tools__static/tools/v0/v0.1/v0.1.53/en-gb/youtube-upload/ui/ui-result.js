/**
 * ui-result.js
 * Right panel — live activity log + last-result card.
 * Listens to SGA_YT events on window.
 *
 * @module ui-result
 */

import { SGA_YT } from '../api/youtube-upload-events.js';

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {Function} emit
 */
export function initResult(root, state, emit) {
    root.innerHTML = `
        <div class="yt-activity">
            <div class="yt-activity__header">
                <span class="yt-activity__title">Activity</span>
                <button type="button" class="yt-activity__clear" id="clear-log">clear</button>
            </div>
            <div id="yt-log" class="yt-activity__log" aria-live="polite"></div>
        </div>

        <div id="yt-result-card" class="yt-result-card" hidden>
            <div class="yt-result-card__label">Last upload</div>
            <a id="yt-result-link" class="yt-result-card__link" target="_blank" rel="noopener"></a>
            <div id="yt-result-meta" class="yt-result-card__meta"></div>
        </div>
    `;

    const logEl    = root.querySelector('#yt-log');
    const clearBtn = root.querySelector('#clear-log');
    const card     = root.querySelector('#yt-result-card');
    const link     = root.querySelector('#yt-result-link');
    const meta     = root.querySelector('#yt-result-meta');

    clearBtn.addEventListener('click', () => { logEl.innerHTML = ''; });

    function log(level, msg) {
        const row = document.createElement('div');
        row.className = `yt-log-row yt-log-row--${level}`;
        const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
        row.innerHTML = `<span class="yt-log-row__time">${time}</span><span class="yt-log-row__msg">${msg}</span>`;
        logEl.appendChild(row);
        logEl.scrollTop = logEl.scrollHeight;
    }

    function fmtBytes(n) {
        if (!n && n !== 0) return '';
        const u = ['B','KB','MB','GB']; let i = 0; let v = n;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
    }

    window.addEventListener(SGA_YT.READY,        () => log('info',  'Tool ready.'));
    window.addEventListener(SGA_YT.CONNECTED,    (e) => {
        const mins = e.detail?.expiresAt ? Math.round((e.detail.expiresAt - Date.now()) / 60000) : null;
        log('ok', `Connected to YouTube${mins != null ? ` — token expires in ${mins} min` : ''}.`);
    });
    window.addEventListener(SGA_YT.DISCONNECTED, () => log('info', 'Disconnected.'));
    window.addEventListener(SGA_YT.FILE_SET,     (e) => {
        log('info', `File selected: ${e.detail.fileName} (${fmtBytes(e.detail.fileSize)})`);
    });
    window.addEventListener(SGA_YT.UPLOAD_START, (e) => {
        log('info', `Uploading "${e.detail.metadata?.title}" (${fmtBytes(e.detail.fileSize)})…`);
    });
    window.addEventListener(SGA_YT.UPLOAD_PROGRESS, (e) => {
        // Throttle to log only at 10% increments
        const p = e.detail.percent;
        if (p % 10 === 0 && p !== logEl._lastP) {
            log('info', `Progress: ${p}%`);
            logEl._lastP = p;
        }
    });
    window.addEventListener(SGA_YT.UPLOAD_COMPLETE, (e) => {
        const { id, url } = e.detail;
        log('ok', `Upload complete — video id ${id}.`);
        if (url) {
            card.hidden = false;
            link.href = url;
            link.textContent = url;
            meta.textContent = `Privacy: ${e.detail.status?.privacyStatus || 'unknown'}`;
        }
    });
    window.addEventListener(SGA_YT.ERROR, (e) => {
        log('err', `[${e.detail?.step || 'error'}] ${e.detail?.message || 'unknown error'}`);
    });
}
