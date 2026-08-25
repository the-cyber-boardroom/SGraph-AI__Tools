/**
 * ui-bundle — bundle/zip controls + embedded <sg-send-drop> encrypted send.
 *
 * Appears once ≥1 item is `done`. Two include checkboxes (Audio / Transcripts)
 * drive both the zip and the send (default: transcripts on, audio off). A
 * "Download .zip" button and a "Send via SG/Send" button that hands the bundle
 * to the embedded <sg-send-drop>. Sending needs a live send.sgraph.ai + an
 * access token (the component prompts for auth).
 *
 * @module audio-transcribe/ui-bundle
 */

import { AT_EVENTS } from '../api/audio-transcribe-events.js';

/**
 * Mount the bundle + send panel.
 * @param {{ root: HTMLElement, state: object, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountBundle({ root, state, api }) {
    root.classList.add('at-panel--hidden');
    root.innerHTML = `
        <h2 class="at-panel__title">Bundle &amp; Send</h2>
        <div class="at-include-row">
            <label><input type="checkbox" id="at-inc-transcripts" checked> Transcripts (.txt)</label>
            <label><input type="checkbox" id="at-inc-audio"> Audio files</label>
        </div>
        <div class="at-bundle-actions">
            <button type="button" class="at-btn primary" id="at-download-zip">Download .zip</button>
            <button type="button" class="at-btn" id="at-send-toggle">Send via SG/Send</button>
        </div>
        <div id="at-send-area" hidden>
            <p class="at-status-line">Sending needs a SG/Send access token — the component below will prompt you.</p>
            <sg-send-drop id="at-send-drop"></sg-send-drop>
        </div>
        <div class="at-share-url" id="at-share" hidden></div>
        <div class="at-notice" id="at-bundle-notice" role="status" aria-live="polite"></div>
    `;

    const incTranscripts = root.querySelector('#at-inc-transcripts');
    const incAudio = root.querySelector('#at-inc-audio');
    const dlBtn = root.querySelector('#at-download-zip');
    const sendToggle = root.querySelector('#at-send-toggle');
    const sendArea = root.querySelector('#at-send-area');
    const dropper = root.querySelector('#at-send-drop');
    const share = root.querySelector('#at-share');
    const notice = root.querySelector('#at-bundle-notice');

    function include() {
        return { audio: !!incAudio.checked, transcripts: !!incTranscripts.checked };
    }
    function showNotice(text, kind) {
        notice.textContent = text;
        notice.dataset.kind = kind || 'info';
    }

    function refreshVisibility() {
        const anyDone = state.getItems().some((it) => it.status === 'done');
        root.classList.toggle('at-panel--hidden', !anyDone);
    }

    async function onDownload() {
        showNotice('Building .zip…', 'info');
        try {
            const res = await api.downloadZip({ include: include() });
            showNotice(`Downloaded ${res.name} (${res.count} item(s)).`, 'info');
        } catch (err) { showNotice(`Download failed: ${err.message}`, 'error'); }
    }

    function onSendToggle() { sendArea.hidden = !sendArea.hidden; }

    async function onSend() {
        share.hidden = true;
        showNotice('Sending via SG/Send…', 'info');
        try {
            const res = await api.sendViaSgSend({ include: include() });
            share.hidden = false;
            share.innerHTML = `Share URL: <a href="${res.shareUrl}" target="_blank" rel="noopener">${res.shareUrl}</a>`;
            showNotice('Sent.', 'info');
        } catch (err) {
            if (err.code === 'send-auth-required') showNotice('Enter your SG/Send access token above, then send again.', 'warn');
            else showNotice(`Send failed: ${err.message}`, 'error');
        }
    }

    // The dropper has its own internal send button; we also trigger via toggle.
    // Provide an explicit "send now" affordance after the area is revealed.
    const sendNowBtn = document.createElement('button');
    sendNowBtn.type = 'button';
    sendNowBtn.className = 'at-btn primary small';
    sendNowBtn.textContent = 'Build bundle & send';
    sendNowBtn.style.marginTop = '10px';
    sendArea.appendChild(sendNowBtn);

    const onChange = () => refreshVisibility();
    state.addEventListener('change', onChange);
    dlBtn.addEventListener('click', onDownload);
    sendToggle.addEventListener('click', onSendToggle);
    sendNowBtn.addEventListener('click', onSend);

    const onSendComplete = (e) => {
        const url = e.detail && e.detail.url;
        if (url) { share.hidden = false; share.innerHTML = `Share URL: <a href="${url}" target="_blank" rel="noopener">${url}</a>`; }
    };
    if (dropper) dropper.addEventListener(AT_EVENTS.SEND_COMPLETE, onSendComplete);

    refreshVisibility();

    return {
        destroy() {
            state.removeEventListener('change', onChange);
            dlBtn.removeEventListener('click', onDownload);
            sendToggle.removeEventListener('click', onSendToggle);
            sendNowBtn.removeEventListener('click', onSend);
            if (dropper) dropper.removeEventListener(AT_EVENTS.SEND_COMPLETE, onSendComplete);
        },
    };
}
