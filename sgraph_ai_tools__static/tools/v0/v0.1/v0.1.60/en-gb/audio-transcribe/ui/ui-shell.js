/**
 * ui-shell — assembles the audio-transcribe page layout.
 *
 * Single-column linear flow: source → queue → model → bundle/send → dev panel.
 * No sg-layout (five simple panels). Wires each child panel into the host.
 * The <sg-llm-request> engine is appended by the api entry before mountShell.
 *
 * @module audio-transcribe/ui-shell
 */

import { mountSource } from './ui-source.js';
import { mountQueue } from './ui-queue.js';
import { mountModel } from './ui-model.js';
import { mountBundle } from './ui-bundle.js';
import { mountDevPanel } from './ui-dev-panel.js';

/**
 * Mount the tool shell into a host element.
 * @param {{ host: HTMLElement, state: object, api: object }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountShell({ host, state, api }) {
    if (!host) return { destroy() {} };

    // Keep the <sg-llm-request> engine that the api entry appended.
    const engine = host.querySelector('sg-llm-request');
    host.innerHTML = '';
    if (engine) host.appendChild(engine);

    const v = (api && api._version) || {};
    const vLabel = v.api ? `v${v.api}` : '';

    const topbar = document.createElement('header');
    topbar.className = 'at-topbar';
    topbar.innerHTML = `
        <h1>Audio Transcribe ${vLabel ? `<span class="at-version" title="tool version">${vLabel}</span>` : ''}</h1>
        <p class="at-subtitle">
            Record from your mic or drop many audio files — including WhatsApp
            <code>.opus</code> voice notes — and transcribe each to text with
            curated OpenRouter models, entirely in your browser. Batch queue with
            per-row status and retry. Audio is sent to OpenRouter for
            transcription (unlike the local-only voice-memo tool); decoding of
            <code>.opus</code> happens in your browser on every browser, Safari
            included.
        </p>
    `;
    host.appendChild(topbar);

    const sourceRoot = section('at-panel at-panel--source');
    const queueRoot  = section('at-panel at-panel--queue');
    const modelRoot  = section('at-panel at-panel--model');
    const bundleRoot = section('at-panel at-panel--bundle');
    const devRoot    = section('at-panel at-panel--dev');
    for (const el of [sourceRoot, queueRoot, modelRoot, bundleRoot, devRoot]) host.appendChild(el);

    /** @param {string} cls */
    function section(cls) { const s = document.createElement('section'); s.className = cls; return s; }

    const m = [
        mountModel({ root: modelRoot, state, api }),
        mountSource({ root: sourceRoot, state, api }),
        mountQueue({ root: queueRoot, state, api }),
        mountBundle({ root: bundleRoot, state, api }),
        mountDevPanel({ root: devRoot, api }),
    ];

    return {
        destroy() { m.forEach((x) => x && x.destroy && x.destroy()); host.innerHTML = ''; },
    };
}
