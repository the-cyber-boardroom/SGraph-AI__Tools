/**
 * ui-shell — assembles the converter page layout.
 *
 * No sg-layout: this tool is a single-column linear flow (dropzone →
 * settings → results), which is much simpler than the sg-video-editor's
 * multi-pane editor. We just wire the four child panels directly into the
 * host element.
 *
 * @module heic-converter/ui-shell
 */

import { mountDropzone } from './ui-dropzone.js';
import { mountSettings } from './ui-settings.js';
import { mountResults } from './ui-results.js';
import { mountDevPanel } from './ui-dev-panel.js';

/**
 * Mount the converter shell into a host element.
 * @param {{host: HTMLElement, state: object, api: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountShell({ host, state, api }) {
    if (!host) return { destroy() {} };

    host.innerHTML = '';

    const topbar = document.createElement('header');
    topbar.className = 'hc-topbar';
    topbar.innerHTML = `
        <div class="hc-title">
            <h1>HEIC Converter</h1>
            <p class="hc-subtitle">
                Convert iPhone HEIC photos and videos to clean WebP, JPEG, PNG or AVIF images —
                entirely in your browser. Drop a whole Google Photos folder; videos become a
                still frame and Live Photo clips are de-duplicated. Files never leave this page,
                and all original metadata (including GPS) is stripped.
            </p>
        </div>
    `;
    host.appendChild(topbar);

    const dropzoneRoot = document.createElement('section');
    dropzoneRoot.className = 'hc-panel hc-panel--dropzone';
    host.appendChild(dropzoneRoot);

    const settingsRoot = document.createElement('section');
    settingsRoot.className = 'hc-panel hc-panel--settings';
    host.appendChild(settingsRoot);

    const resultsRoot = document.createElement('section');
    resultsRoot.className = 'hc-panel hc-panel--results';
    host.appendChild(resultsRoot);

    const devRoot = document.createElement('section');
    devRoot.className = 'hc-panel hc-panel--dev';
    host.appendChild(devRoot);

    const m1 = mountDropzone({ root: dropzoneRoot, state, api });
    const m2 = mountSettings({ root: settingsRoot, state, api });
    const m3 = mountResults({ root: resultsRoot, state, api });
    const m4 = mountDevPanel({ root: devRoot, api });

    return {
        destroy() {
            m1 && m1.destroy && m1.destroy();
            m2 && m2.destroy && m2.destroy();
            m3 && m3.destroy && m3.destroy();
            m4 && m4.destroy && m4.destroy();
            host.innerHTML = '';
        },
    };
}
