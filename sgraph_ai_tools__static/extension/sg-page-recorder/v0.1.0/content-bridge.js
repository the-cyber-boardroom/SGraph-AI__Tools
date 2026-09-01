/**
 * content-bridge.js — the only part of the extension that touches tools.sgraph.ai.
 *
 * It does two small things: announce that the extension exists, and relay
 * messages between the tool page and the service worker.
 *
 * PRESENCE IS ANNOUNCED BY A DOM ATTRIBUTE, not by a hard-coded extension id.
 * An unpacked extension's id depends on where it was loaded from, so a page that
 * knows the id only works for whoever built it. The page reads
 * `document.documentElement.dataset.sgPageRecorder` instead, and the checkbox in
 * narrated-review is enabled or disabled by whether it is there.
 *
 * The relay is deliberately one-directional in trust: the page may ask to arm a
 * tab, drain events or run a probe, and it may not ask for anything else. The
 * allow-list below is the whole surface.
 */

const ALLOWED = new Set(['sgpr:ping', 'sgpr:arm', 'sgpr:disarm', 'sgpr:list', 'sgpr:drain', 'sgpr:run', 'sgpr:forget']);

document.documentElement.dataset.sgPageRecorder = chrome.runtime.getManifest().version;

window.addEventListener('message', ev => {
    if (ev.source !== window || !ev.data || ev.data.__sgprTool !== true) return;
    const { id, type, payload } = ev.data;
    if (!ALLOWED.has(type)) {
        window.postMessage({ __sgprReply: true, id, error: `not allowed: ${type}` }, '*');
        return;
    }
    chrome.runtime.sendMessage({ type, ...(payload || {}) }, res => {
        const err = chrome.runtime.lastError;
        window.postMessage({ __sgprReply: true, id, result: res, error: err ? err.message : undefined }, '*');
    });
});
