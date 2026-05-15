/**
 * ui-settings — output format + quality controls + global action buttons.
 *
 * AVIF support is detected via `sg-image.supportsAvif()`; the AVIF radio is
 * disabled when the browser can't encode it.
 *
 * @module heic-converter/ui-settings
 */

import * as sgImage from '/core/image/v1/v1.0/v1.0.0/sg-image.js';

const FORMATS = [
    { mime: 'image/webp', label: 'WebP', hint: 'best size/quality tradeoff' },
    { mime: 'image/jpeg', label: 'JPEG', hint: 'most compatible' },
    { mime: 'image/png',  label: 'PNG',  hint: 'lossless, larger files' },
    { mime: 'image/avif', label: 'AVIF', hint: 'smallest, modern browsers only' },
];

/**
 * Mount the settings panel.
 * @param {{root: HTMLElement, state: object, api: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountSettings({ root, state, api }) {
    const avifOk = sgImage.supportsAvif();

    const formatHtml = FORMATS.map((f) => {
        const isAvif = f.mime === 'image/avif';
        const disabled = isAvif && !avifOk;
        return `
            <label class="hc-radio ${disabled ? 'hc-radio--disabled' : ''}">
                <input type="radio" name="hc-format" value="${f.mime}"
                       ${disabled ? 'disabled' : ''}
                       ${state.getFormat() === f.mime && !disabled ? 'checked' : ''}>
                <span class="hc-radio__label">${f.label}</span>
                <span class="hc-radio__hint">${f.hint}${disabled ? ' (unsupported here)' : ''}</span>
            </label>
        `;
    }).join('');

    root.innerHTML = `
        <h2 class="hc-panel__title">Output settings</h2>
        <fieldset class="hc-formats">
            <legend>Format</legend>
            ${formatHtml}
        </fieldset>
        <div class="hc-quality">
            <label for="hc-quality">Quality
                <span class="hc-quality__value" id="hc-quality-value">${Math.round(state.getQuality() * 100)}%</span>
            </label>
            <input type="range" id="hc-quality" min="1" max="100" step="1"
                   value="${Math.round(state.getQuality() * 100)}">
            <div class="hc-quality__hint">Applies to JPEG, WebP and AVIF. PNG is lossless.</div>
        </div>
        <div class="hc-actions">
            <button type="button" id="hc-convert-all" class="hc-btn hc-btn--primary">
                Convert all
            </button>
            <button type="button" id="hc-download-zip" class="hc-btn">Download all as ZIP</button>
            <button type="button" id="hc-reset" class="hc-btn hc-btn--ghost">Clear queue</button>
        </div>
    `;

    const qSlider = root.querySelector('#hc-quality');
    const qValue = root.querySelector('#hc-quality-value');
    const btnAll = root.querySelector('#hc-convert-all');
    const btnZip = root.querySelector('#hc-download-zip');
    const btnReset = root.querySelector('#hc-reset');
    const radios = root.querySelectorAll('input[name="hc-format"]');

    function onFormatChange(e) {
        const v = e.target.value;
        if (!v) return;
        try { api.setFormat({ format: v }); } catch (err) { console.error('[hc] setFormat', err); }
    }
    function onQualityInput(e) {
        const pct = Number(e.target.value);
        qValue.textContent = `${pct}%`;
        try { api.setQuality({ quality: pct / 100 }); } catch (err) { console.error('[hc] setQuality', err); }
    }
    function setBusy(b) {
        btnAll.disabled = b;
        btnZip.disabled = b;
        btnReset.disabled = b;
    }
    async function onConvertAll() {
        setBusy(true);
        try { await api.convertAll({}); } finally { setBusy(false); }
    }
    async function onDownloadZip() {
        setBusy(true);
        try { await api.downloadAllZip({}); } catch (err) {
            console.error('[hc] zip', err);
            alert(`Download ZIP failed: ${err.message}`);
        } finally { setBusy(false); }
    }
    function onReset() { api.reset({}); }

    radios.forEach((r) => r.addEventListener('change', onFormatChange));
    qSlider.addEventListener('input', onQualityInput);
    btnAll.addEventListener('click', onConvertAll);
    btnZip.addEventListener('click', onDownloadZip);
    btnReset.addEventListener('click', onReset);

    return {
        destroy() {
            radios.forEach((r) => r.removeEventListener('change', onFormatChange));
            qSlider.removeEventListener('input', onQualityInput);
            btnAll.removeEventListener('click', onConvertAll);
            btnZip.removeEventListener('click', onDownloadZip);
            btnReset.removeEventListener('click', onReset);
        },
    };
}
