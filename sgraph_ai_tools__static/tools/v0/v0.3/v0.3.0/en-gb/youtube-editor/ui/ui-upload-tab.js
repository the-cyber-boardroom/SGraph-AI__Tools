/**
 * ui-upload-tab.js
 * Right tab — file dropzone + upload form. Uses api.uploadVideo() (which goes
 * through the editor pipeline + token, so no second OAuth popup vs the editor).
 *
 * Post-upload UX: dropzone hides, form fields disable, "Upload another"
 * button resets state. Success card prominent with the YouTube URL.
 *
 * Listens for the cross-tool hand-off (sg-yt-handoff-pickup window event)
 * to pre-fill the file + title from a sibling tool (e.g. video-recorder).
 *
 * @module ui-upload-tab
 */

import { SGA_YT } from '../api/youtube-editor-events.js';

export function initUploadTab(root, state, api, emit) {
    root.innerHTML = `
        <div class="yte-up">

            <header class="yte-up__head">
                <h2 class="yte-up__title">Upload a video</h2>
                <p class="yte-up__sub">
                    Bytes go directly browser → YouTube. Default privacy is <strong>Unlisted</strong>.
                </p>
            </header>

            <div id="not-connected" class="yte-up__notice" hidden>
                You're not signed in. Use the panel on the left to connect first.
            </div>

            <div id="dz-wrap">
                <sg-upload-dropzone id="dz" accept="video/*" label="Drop a video here, or click to choose"></sg-upload-dropzone>
                <div id="picked" class="yte-up__picked" hidden>
                    <span class="yte-up__picked-icon">🎬</span>
                    <span id="picked-name" class="yte-up__picked-name"></span>
                    <span id="picked-size" class="yte-up__picked-size"></span>
                    <button type="button" id="picked-clear" class="yte-up__picked-clear" aria-label="Remove file">✕</button>
                </div>
            </div>

            <div class="yte-up__grid">
                <label class="yte-up__label" for="up-title">Title <span class="yte-up__req">*</span></label>
                <input type="text" id="up-title" class="yte-up__input" maxlength="100" placeholder="My recording">

                <label class="yte-up__label" for="up-desc">Description</label>
                <textarea id="up-desc" class="yte-up__input yte-up__input--area" rows="2" maxlength="5000"></textarea>

                <label class="yte-up__label" for="up-tags">Tags</label>
                <input type="text" id="up-tags" class="yte-up__input" placeholder="demo, sgraph">

                <label class="yte-up__label" for="up-privacy">Privacy</label>
                <select id="up-privacy" class="yte-up__input">
                    <option value="private">Private</option>
                    <option value="unlisted" selected>Unlisted (link only)</option>
                    <option value="public">Public</option>
                </select>
            </div>

            <div class="yte-up__cta">
                <button type="button" id="up-btn" class="yte-up__btn yte-up__btn--primary" disabled>
                    Upload to YouTube
                </button>
                <button type="button" id="up-again-btn" class="yte-up__btn yte-up__btn--ghost" hidden>
                    ↺ Upload another
                </button>
            </div>

            <div id="up-prog-wrap" class="yte-up__progress" hidden>
                <div class="yte-up__progress-bar"><div id="up-prog-fill" class="yte-up__progress-fill"></div></div>
                <span id="up-prog-text" class="yte-up__progress-text">0%</span>
            </div>

            <div id="up-result" class="yte-up__result" hidden>
                <div class="yte-up__result-row">
                    <span class="yte-up__result-icon" aria-hidden="true">✓</span>
                    <div class="yte-up__result-meta">
                        <div class="yte-up__result-label">Uploaded successfully</div>
                        <a id="up-result-link" class="yte-up__result-link" target="_blank" rel="noopener"></a>
                    </div>
                    <button type="button" id="up-copy-btn" class="yte-up__btn yte-up__btn--ghost yte-up__btn--mini">Copy</button>
                </div>
            </div>

            <div id="up-error" class="yte-up__error" hidden></div>
        </div>
    `;

    const notConnEl  = root.querySelector('#not-connected');
    const dz         = root.querySelector('#dz');
    const dzWrap     = root.querySelector('#dz-wrap');
    const pickedEl   = root.querySelector('#picked');
    const pickedName = root.querySelector('#picked-name');
    const pickedSize = root.querySelector('#picked-size');
    const pickedClear = root.querySelector('#picked-clear');
    const titleInput = root.querySelector('#up-title');
    const descInput  = root.querySelector('#up-desc');
    const tagsInput  = root.querySelector('#up-tags');
    const privInput  = root.querySelector('#up-privacy');
    const btn        = root.querySelector('#up-btn');
    const againBtn   = root.querySelector('#up-again-btn');
    const progWrap   = root.querySelector('#up-prog-wrap');
    const progFill   = root.querySelector('#up-prog-fill');
    const progText   = root.querySelector('#up-prog-text');
    const resultEl   = root.querySelector('#up-result');
    const resultLink = root.querySelector('#up-result-link');
    const copyBtn    = root.querySelector('#up-copy-btn');
    const errEl      = root.querySelector('#up-error');

    let _file     = null;
    let _uploaded = false;          // true once we've shown the result card

    function _setFile(file) {
        _file = file || null;
        if (_file) {
            pickedName.textContent = _file.name || 'recording';
            pickedSize.textContent = _fmt(_file.size);
            dz.style.display = 'none';
            pickedEl.hidden  = false;
            // Pre-fill title from filename if user hasn't typed anything
            if (!titleInput.value) titleInput.value = (_file.name || '').replace(/\.[^.]+$/, '');
        } else {
            pickedEl.hidden  = true;
            dz.style.display = '';
        }
        _refresh();
    }

    function _enterFreshState() {
        _uploaded = false;
        _setFile(null);
        titleInput.value = '';
        descInput.value  = '';
        tagsInput.value  = '';
        privInput.value  = 'unlisted';
        progWrap.hidden  = true;
        resultEl.hidden  = true;
        errEl.hidden     = true;
        againBtn.hidden  = true;
        btn.hidden       = false;
        btn.textContent  = 'Upload to YouTube';
        _refresh();
    }

    function _refresh() {
        notConnEl.hidden = !!state.connected;
        btn.disabled = _uploaded || !state.connected || !_file;
    }

    dz.addEventListener('files-selected', (e) => _setFile(e.detail?.files?.[0] || null));
    pickedClear.addEventListener('click', () => _setFile(null));

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
            _uploaded = true;
            resultEl.hidden = false;
            resultLink.href = result.url || '#';
            resultLink.textContent = result.url || `(video id: ${result.id})`;
            // Lock the form down + offer fresh start
            btn.hidden       = true;
            againBtn.hidden  = false;
        } catch (err) {
            errEl.hidden = false;
            errEl.textContent = err.message;
            btn.textContent = 'Upload to YouTube';
        } finally {
            _refresh();
        }
    });

    againBtn.addEventListener('click', () => _enterFreshState());

    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(resultLink.href);
            const orig = copyBtn.textContent;
            copyBtn.textContent = '✓ Copied';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        } catch { /* clipboard blocked */ }
    });

    window.addEventListener(SGA_YT.UPLOAD_PROGRESS, (e) => _setProgress(e.detail.percent));
    window.addEventListener(SGA_YT.CONNECTED,       _refresh);
    window.addEventListener(SGA_YT.DISCONNECTED,    _refresh);

    // Hand-off from a sibling tool (e.g. video-recorder) — receive the blob
    // and pre-fill the form so the user just hits Upload.
    window.addEventListener('sg-yt-handoff-pickup', (e) => {
        const { blob, suggestedTitle, suggestedDescription, filename, sourceTool } = e.detail || {};
        if (!blob) return;
        const file = new File([blob], filename || 'recording.webm', { type: blob.type || 'video/webm' });
        _setFile(file);
        if (suggestedTitle)       titleInput.value = suggestedTitle;
        if (suggestedDescription) descInput.value  = suggestedDescription;
        if (notConnEl) {
            notConnEl.textContent = `Received from ${sourceTool || 'another tool'}. ${state.connected ? 'Ready to upload.' : 'Sign in on the left to upload.'}`;
            notConnEl.hidden = false;
            notConnEl.classList.add('yte-up__notice--ok');
        }
    });

    function _setProgress(pct) {
        const v = Math.max(0, Math.min(100, pct || 0));
        progFill.style.width = `${v}%`;
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
