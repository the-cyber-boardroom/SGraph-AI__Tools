/**
 * ui-open — the four ways a document gets in: drop, file picker, paste, URL.
 *
 * @module markdown-viewer/ui-open
 */

import { MV_EVENTS } from '../api/mv-events.js';
import * as pipeline from '../api/mv-pipeline.js';

let elDrop, elInput, elPaste, elPasteBtn, elUrl, elUrlBtn, elError;

/** Wire the open surfaces. Called once, after DOMContentLoaded. */
export function mountOpen() {
    elDrop     = document.getElementById('mv-drop');
    elInput    = document.getElementById('mv-file');
    elPaste    = document.getElementById('mv-paste');
    elPasteBtn = document.getElementById('mv-paste-go');
    elUrl      = document.getElementById('mv-url');
    elUrlBtn   = document.getElementById('mv-url-go');
    elError    = document.getElementById('mv-error');

    // ── Drop, anywhere on the page ──────────────────────────────────────────
    // Scoped to the window rather than the dropzone: once a document is open
    // the dropzone is hidden, and dropping a second file should still work.
    for (const type of ['dragenter', 'dragover']) {
        window.addEventListener(type, (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            elDrop.classList.add('mv-drop--over');
        });
    }
    for (const type of ['dragleave', 'drop']) {
        window.addEventListener(type, () => elDrop.classList.remove('mv-drop--over'));
    }
    window.addEventListener('drop', async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        await open(() => pipeline.loadFile(e.dataTransfer.files[0]));
    });

    // ── Picker ──────────────────────────────────────────────────────────────
    elDrop.addEventListener('click', () => elInput.click());
    elInput.addEventListener('change', async () => {
        if (elInput.files?.[0]) await open(() => pipeline.loadFile(elInput.files[0]));
        elInput.value = '';   // so re-picking the same file fires change again
    });

    // ── Paste ───────────────────────────────────────────────────────────────
    elPasteBtn.addEventListener('click', async () => {
        const text = elPaste.value.trim();
        if (!text) { showError('Paste some markdown first.'); return; }
        await open(() => pipeline.loadText(text, 'pasted.md', 'text'));
    });

    // ── URL ─────────────────────────────────────────────────────────────────
    elUrlBtn.addEventListener('click', () => openUrl());
    elUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openUrl(); });

    document.addEventListener(MV_EVENTS.ERROR, (e) => showError(e.detail?.message || 'Something went wrong.'));

    // ?url= opens a document straight from a link.
    const fromQuery = new URLSearchParams(window.location.search).get('url');
    if (fromQuery) { elUrl.value = fromQuery; openUrl(); }
}

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

async function openUrl() {
    const url = elUrl.value.trim();
    if (!url) { showError('Enter a URL first.'); return; }
    await open(() => pipeline.loadUrl(url));
}

/**
 * Run a loader, clearing any previous error and reporting a new one.
 * The pipeline already emits `mv:error`; catching here keeps an unhandled
 * rejection out of the console for what is an expected outcome.
 */
async function open(fn) {
    clearError();
    try { await fn(); }
    catch { /* reported via mv:error */ }
}

function showError(message) {
    elError.textContent = message;
    elError.hidden = false;
}

function clearError() {
    elError.textContent = '';
    elError.hidden = true;
}
