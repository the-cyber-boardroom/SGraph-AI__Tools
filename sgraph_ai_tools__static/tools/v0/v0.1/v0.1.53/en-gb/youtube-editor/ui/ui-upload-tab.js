/**
 * ui-upload-tab.js
 * Right tab — embeds <sg-youtube-upload> for the resumable insert path.
 * The component already does its own auth UI; we keep its client-id input
 * visible too for now (single source of truth: localStorage). The component's
 * connect flow uses the upload-only scope, but if the editor's full-scope
 * token is already cached the component will pick it up — wait, NO: the
 * component reads from provider 'youtube-upload' and the editor uses
 * 'youtube-editor'. To avoid a double-popup we feed the editor token in
 * directly via uploadVideo() instead.
 *
 * For v0.1 we keep it simple: use the api.uploadVideo() method (which uses
 * the editor pipeline + token) and a minimal local form rather than the
 * embeddable component. That keeps the token model unified.
 *
 * @module ui-upload-tab
 */

import { SGA_YT } from '../api/youtube-editor-events.js';

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {object} api    SgToolApi instance
 * @param {Function} emit
 */
export function initUploadTab(root, state, api, emit) {
    root.innerHTML = `
        <div class="yte-up">
            <h2 class="yte-up__title">Upload a video</h2>
            <p class="yte-up__intro">
                Bytes go straight from this browser tab to YouTube. Default privacy is
                <strong>Unlisted</strong>. The upload uses the same OAuth grant as the
                rest of this tool — no second consent popup.
            </p>

            <div id="not-connected" class="yte-up__notice" hidden>
                You're not signed in. Use the panel on the left to connect first.
            </div>

            <sg-upload-dropzone id="dz" accept="video/*" label="Drop a video here, or click to choose"></sg-upload-dropzone>

            <label class="yte-up__label" for="up-title">Title <span class="yte-up__req">*</span></label>
            <input type="text" id="up-title" class="yte-up__input" maxlength="100" placeholder="My recording">

            <label class="yte-up__label" for="up-desc">Description</label>
            <textarea id="up-desc" class="yte-up__input yte-up__input--area" rows="3" maxlength="5000"></textarea>

            <label class="yte-up__label" for="up-tags">Tags (comma-separated)</label>
            <input type="text" id="up-tags" class="yte-up__input" placeholder="demo, sgraph">

            <label class="yte-up__label" for="up-privacy">Privacy</label>
            <select id="up-privacy" class="yte-up__input">
                <option value="private">Private</option>
                <option value="unlisted" selected>Unlisted (link only)</option>
                <option value="public">Public</option>
            </select>

            <div class="yte-up__file">
                <span class="yte-up__label" style="margin:0;">Selected file</span>
                <span id="up-file-name" class="yte-up__file-name">— none —</span>
                <span id="up-file-size" class="yte-up__file-size"></span>
            </div>

            <button type="button" id="up-btn" class="yte-up__btn yte-up__btn--primary" disabled>
                Upload to YouTube
            </button>

            <div id="up-prog-wrap" class="yte-up__progress" hidden>
                <div id="up-prog-bar" class="yte-up__progress-bar"></div>
                <div id="up-prog-text" class="yte-up__progress-text">0%</div>
            </div>

            <div id="up-result" class="yte-up__result" hidden>
                <div class="yte-up__result-label">Uploaded</div>
                <a id="up-result-link" class="yte-up__result-link" target="_blank" rel="noopener"></a>
            </div>

            <div id="up-error" class="yte-up__error" hidden></div>
        </div>
    `;

    const notConnEl  = root.querySelector('#not-connected');
    const dz         = root.querySelector('#dz');
    const titleInput = root.querySelector('#up-title');
    const descInput  = root.querySelector('#up-desc');
    const tagsInput  = root.querySelector('#up-tags');
    const privInput  = root.querySelector('#up-privacy');
    const fileNameEl = root.querySelector('#up-file-name');
    const fileSizeEl = root.querySelector('#up-file-size');
    const btn        = root.querySelector('#up-btn');
    const progWrap   = root.querySelector('#up-prog-wrap');
    const progBar    = root.querySelector('#up-prog-bar');
    const progText   = root.querySelector('#up-prog-text');
    const resultEl   = root.querySelector('#up-result');
    const linkEl     = root.querySelector('#up-result-link');
    const errEl      = root.querySelector('#up-error');

    let _file = null;

    function _refresh() {
        notConnEl.hidden = !!state.connected;
        btn.disabled = !state.connected || !_file;
    }

    dz.addEventListener('files-selected', (e) => {
        _file = e.detail?.files?.[0] || null;
        if (_file) {
            fileNameEl.textContent = _file.name || 'recording';
            fileSizeEl.textContent = `(${_fmt(_file.size)})`;
        } else {
            fileNameEl.textContent = '— none —';
            fileSizeEl.textContent = '';
        }
        _refresh();
    });

    btn.addEventListener('click', async () => {
        if (!_file || !state.connected) return;
        const metadata = {
            title:         titleInput.value.trim() || _file.name,
            description:   descInput.value || '',
            tags:          (tagsInput.value || '').split(',').map(t => t.trim()).filter(Boolean),
            privacyStatus: privInput.value || 'unlisted',
        };
        errEl.hidden = true;
        resultEl.hidden = true;
        progWrap.hidden = false;
        _setProgress(0);
        btn.disabled = true;
        btn.textContent = 'Uploading…';

        try {
            const result = await api.uploadVideo({ file: _file, metadata });
            _setProgress(100);
            resultEl.hidden = false;
            linkEl.href = result.url || '#';
            linkEl.textContent = result.url || `(video id: ${result.id})`;
        } catch (err) {
            errEl.hidden = false;
            errEl.textContent = err.message;
        } finally {
            btn.disabled = !_file || !state.connected;
            btn.textContent = 'Upload to YouTube';
        }
    });

    window.addEventListener(SGA_YT.UPLOAD_PROGRESS, (e) => _setProgress(e.detail.percent));
    window.addEventListener(SGA_YT.CONNECTED,       _refresh);
    window.addEventListener(SGA_YT.DISCONNECTED,    _refresh);

    function _setProgress(pct) {
        const v = Math.max(0, Math.min(100, pct || 0));
        progBar.style.setProperty('--progress', `${v}%`);
        progText.textContent = `${v}%`;
    }

    _refresh();
}

function _fmt(n) {
    if (!n && n !== 0) return '';
    const u = ['B','KB','MB','GB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
