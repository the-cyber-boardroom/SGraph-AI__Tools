/**
 * nr-extension.js
 * Talk to the SG Page Recorder extension, if it is there.
 *
 * WHY AN EXTENSION AT ALL. `getDisplayMedia` hands back pixels and audio and
 * nothing else — measured, not assumed: the only constrainable display
 * properties Chrome reports are `displaySurface` and `restrictOwnAudio`, and
 * `CaptureController`, the newest surface-control API, offers `forwardWheel`,
 * `setFocusBehavior` and zoom. Every one of those points OUTWARD, into the
 * captured tab. There is no inbound channel, by design: screen-sharing a bank
 * tab must not let the sharer read the keyboard. So mouse, keys, console and
 * network cannot come from the capture stream at any quality, and an extension
 * with its own permission grant is the only honest way to get them.
 *
 * PRESENCE IS A DOM ATTRIBUTE, not a hard-coded id. An unpacked extension's id
 * depends on where it was loaded from, so an id baked in here would work only
 * for whoever built it. The extension's content script sets
 * `document.documentElement.dataset.sgPageRecorder` to its version; that is the
 * whole detection.
 *
 * WHAT THIS FILE CANNOT DO, and says so: it cannot arm a tab. `activeTab` grants
 * access only in response to a click on the extension itself, so the person
 * whose page is about to be recorded is always the one who starts it. The tool
 * asks; a human consents.
 *
 * @module nr-extension
 */

const TIMEOUT_MS = 4000;
let seq = 0;

/** Is the extension installed on this page? */
export function extensionPresent() {
    const v = document.documentElement.dataset.sgPageRecorder;
    return { present: !!v, version: v || null };
}

/**
 * One request/response over postMessage, via the extension's content bridge.
 * Rejects rather than hanging if the extension is absent or asleep.
 */
function ask(type, payload = {}) {
    return new Promise((resolve, reject) => {
        if (!extensionPresent().present) {
            reject(Object.assign(new Error('SG Page Recorder is not installed'), { code: 'no-extension' }));
            return;
        }
        const id = `nr-${++seq}`;
        const timer = setTimeout(() => {
            window.removeEventListener('message', onReply);
            reject(Object.assign(new Error(`Extension did not answer ${type}`), { code: 'extension-timeout' }));
        }, TIMEOUT_MS);
        function onReply(ev) {
            if (ev.source !== window || !ev.data || ev.data.__sgprReply !== true || ev.data.id !== id) return;
            clearTimeout(timer);
            window.removeEventListener('message', onReply);
            if (ev.data.error) reject(Object.assign(new Error(ev.data.error), { code: 'extension-error' }));
            else resolve(ev.data.result);
        }
        window.addEventListener('message', onReply);
        window.postMessage({ __sgprTool: true, id, type, payload }, '*');
    });
}

/** Which tabs the extension is holding events for. */
export async function listTabs() {
    const r = await ask('sgpr:list');
    return { tabs: r?.tabs || [], version: r?.version || null };
}

/**
 * Take everything buffered for a tab and clear it there.
 *
 * The extension keeps no second copy once drained — one place for the data is
 * one place for it to leak from.
 */
export async function drain(tabId) {
    return ask('sgpr:drain', { tabId });
}

/** Run operator-authored JavaScript in the recorded page. @see nr-input probes */
export async function runProbe({ tabId, id, js, on = 'manual' }) {
    return ask('sgpr:run', { tabId, id, js, on });
}

export async function ping() { return ask('sgpr:ping'); }
export async function forget(tabId) { return ask('sgpr:forget', { tabId }); }

/**
 * Why the checkboxes are disabled, in words a person can act on.
 *
 * A disabled control with no reason is the failure this project keeps writing
 * tests about: the user cannot tell "off" from "broken" from "not supported".
 */
export function availability() {
    const { present, version } = extensionPresent();
    if (!present) {
        return {
            available: false,
            reason: 'SG Page Recorder is not installed. Mouse, keyboard, console and network cannot '
                + 'be read from a shared screen — the browser gives a capture stream pixels and audio '
                + 'only — so these feeds need the extension.',
            install: '/extension/sg-page-recorder/v0.1.0/README.md',
        };
    }
    return {
        available: true, version,
        reason: null,
        note: 'Arm the tab from the extension\'s own popup — a page cannot start recording another '
            + 'page, and should not be able to.',
    };
}
